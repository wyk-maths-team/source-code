// api/problem.js
import { sqlDb, isContestActive, contestProblemIds } from '../lib/docStore.js';
import { auditLog } from '../lib/audit.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { sanitizeHTML } from '../lib/sanitize.js';
// import { sanitizeDiscussion } from '../lib/sanitize.js';
// MongoDB 已下线：_id 现在就是字符串。
// 保留同名构造器，让 `new ObjectId(x)` 的旧写法继续可用（返回字符串包装对象）。
function ObjectId(v) {
  if (new.target) return new String(String(v));
  return String(v);
}
import { wrapHandler } from '../lib/errors.js';
import * as P from '../lib/pgStore.js';
import * as U from '../lib/userStore.js';
//説明：所有的題目相關的操作都在這裏。
// ============== 輔助函數 ==============
// ============== 輔助函數 ==============
function isAdminUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

// ═══════════════ Solves 計數快取 ═══════════════
// 避免 all=1 對每道題做 $lookup，改為一次性聚合 + 5 分鐘快取
let _solvesCache = { map: null, expireAt: 0 };
const SOLVES_CACHE_TTL = 5 * 60_000;

async function getSolvesCountMap(db) {
  if (_solvesCache.map && _solvesCache.expireAt > Date.now()) {
    return _solvesCache.map;
  }
  // ⭐ 一条 GROUP BY 取代原来扫全库 userstats.states 的聚合
  const map = await U.getSolvesCountMap();
  _solvesCache = { map, expireAt: Date.now() + SOLVES_CACHE_TTL };
  return map;
}

// 讓其他模組（例如 submit 成功後）能主動失效快取
export function invalidateSolvesCache() {
  _solvesCache = { map: null, expireAt: 0 };
}

function checkAccess(user, problemId) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (!user.states) return false;
  return user.states[problemId] === 'passed';
}



// 計算 before → after 的欄位差異
function diffFields(before, after) {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (k === '_id') continue;
    const b = before ? before[k] : undefined;
    const a = after ? after[k] : undefined;
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes[k] = {
        before: b === undefined ? null : b,
        after: a === undefined ? null : a
      };
    }
  }
  return changes;
}

async function auditProblemChange(db, operator, problemId, before, after) {
  const changes = diffFields(before, after);
  if (Object.keys(changes).length === 0) return;

  // 只在「關鍵欄位」變動時發通知；其餘只寫 DB（level=null）
  const CRITICAL_FIELDS = ['ans', 'public', 'logic', 'statement'];
  const criticalChanged = Object.keys(changes).filter(k => CRITICAL_FIELDS.includes(k));
  const level = criticalChanged.length > 0 ? 'warn' : null;

  await auditLog(db, 'problem_change', {
    problemId: String(problemId),
    collection: 'problems',
    changes,
    criticalFields: criticalChanged.length ? criticalChanged : undefined,
  }, operator, level);
}

async function auditProblemDelete(db, operator, problem) {
  await auditLog(db, 'problem_delete', {
    problemId: String(problem.id),
    collection: 'problems',
    name: problem.name,
    backup: problem,     // 完整文檔備份
  }, operator, 'danger');
}

// 题目表已经迁到 PostgreSQL，版本号存在 app_settings。
// 保留函数名与 db 参数，调用处不用改（db 参数已不再使用）。
async function bumpProblemsVersion() {
  await P.bumpProblemsVersion();
}

// 共用：抓某題的 discussions（含 liked 標記）
async function fetchDiscussions(db, problemId, username, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  const collection = db.collection('discussions');
  const total = await collection.countDocuments({ problemId });
  const discussions = await collection
    .find({ problemId })
    .sort({ likes: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
  const enriched = discussions.map(d => ({
    ...d,
    liked: Array.isArray(d.likedBy) && d.likedBy.includes(username)
  }));
  return {
    discussions: enriched,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
  };
}

// ============== 主處理器 ==============
async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const decoded = await verifyToken(req);
  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  req.user = { username: decoded.username, role: decoded.role };

  const db = sqlDb();
  const action = req.query.action || (req.body && req.body.action);

  // ==================== 管理員操作（前綴 admin*） ====================
  if (typeof action === 'string' && action.startsWith('admin')) {
    if (!isAdminUser(req.user)) {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    // ----- 題目 CRUD -----
    if (action === 'adminProblems') {
      if (req.method === 'GET') {
        const { id } = req.query;
        if (id) {
          const problem = await P.getProblemForAdmin(String(id));   // ⭐ PostgreSQL，含 tags
          if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
          return res.status(200).json({ success: true, problem });
        }
        const problems = await P.listAllForAdmin();                  // ⭐ PostgreSQL，含 answer/logic
        return res.status(200).json({ success: true, problems });
      }

      if (req.method === 'POST') {
        const { id, name, statement, ans, difficulty, tags, public: isPublic, logic, FS } = req.body || {};
        if (!id || !name || !statement || ans === undefined) {
          return res.status(400).json({ success: false, message: 'Missing fields' });
        }
        const idStr = String(id);
        const exist = await P.problemExists(idStr);
        if (exist) return res.status(400).json({ success: false, message: 'Problem ID already exists' });

        const newProblem = {
          id: idStr,
          name,
          statement,
          ans: String(ans),
          difficulty: Number(difficulty) || 0,
          tags: Array.isArray(tags) ? tags : [],
          public: isPublic === false ? false : true,
          logic: logic || '',
          FS: FS === true,
        };
        // ⭐ problems / tags / problem_tags 全部在 PostgreSQL 的同一个事务里
        await P.createProblem(newProblem);
        await bumpProblemsVersion();
        await auditLog(db, 'problem_create', {
          problemId: idStr,
          collection: 'problems',
          name: newProblem.name,
          after: newProblem,
        }, req.user.username, 'info');
        return res.status(201).json({ success: true, message: 'Problem created' });
      }

      if (req.method === 'PUT') {
        const { id, ids, name, statement, ans, difficulty, tags, public: isPublic, logic, FS } = req.body || {};

        // 批量更新 public
        if (Array.isArray(ids) && ids.length && isPublic !== undefined) {
          const idStrs = ids.map(String);
          const target = isPublic === false ? false : true;
          // ⭐ 先取旧值（审计要 before/after）
          const beforeList = await P.getProblemsByIds(idStrs);
          const result = await P.setProblemsPublic(idStrs, target);
          for (const prob of beforeList) {
            await auditProblemChange(db, req.user.username, prob.id, { public: prob.public }, { public: target });
          }
          await bumpProblemsVersion();
          return res.status(200).json({ success: true, message: `Updated ${result.updated} problems` });
        }

        // 單題更新
        if (!id) return res.status(400).json({ success: false, message: 'Missing problem ID' });
        const idStr = String(id);
        const before = await P.getProblemForAdmin(idStr);   // 含 tags，审计才能看见标签变化
        if (!before) return res.status(404).json({ success: false, message: 'Problem not found' });

        const upd = {};
        if (name !== undefined) upd.name = name;
        if (statement !== undefined) upd.statement = statement;
        if (ans !== undefined) upd.ans = String(ans);
        if (difficulty !== undefined) upd.difficulty = Number(difficulty) || 0;
        if (tags !== undefined) upd.tags = Array.isArray(tags) ? tags : [];
        if (isPublic !== undefined) upd.public = isPublic === false ? false : true;
        if (logic !== undefined) upd.logic = logic;
        if (FS !== undefined) upd.FS = FS === true;

        if (Object.keys(upd).length === 0) {
          return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        // ⭐ 字段与标签在 PostgreSQL 的同一个事务里更新
        await P.updateProblem(idStr, upd);
        await bumpProblemsVersion();
        await auditProblemChange(db, req.user.username, idStr, before, { ...before, ...upd });
        return res.status(200).json({ success: true, message: 'Problem updated' });
      }

      if (req.method === 'DELETE') {
        const { id, ids } = req.body || {};
        if (!id && !ids) return res.status(400).json({ success: false, message: 'Missing id or ids' });

        if (id) {
          const idStr = String(id);
          const problem = await P.getProblemForAdmin(idStr);
          if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
          // ⭐ 题目删在 PG；用户答题状态仍在 Mongo，需要同时清掉，否则会留下指向不存在题目的状态
          await P.deleteProblems([idStr]);
          await U.deleteProblemStatesEverywhere(idStr);
          await auditProblemDelete(db, req.user.username, problem);
          await bumpProblemsVersion();
          return res.status(200).json({ success: true, message: 'Problem deleted' });
        }

          if (Array.isArray(ids) && ids.length) {
          // ⭐ 限制一次最多刪 50 題，防止一鍵掃蕩
          if (ids.length > 50) {
            return res.status(400).json({
              success: false,
              message: `一次最多刪除 50 題（你送了 ${ids.length}）`
            });
          }

          const idStrs = ids.map(String);
          // 审计要保留完整文档（含答案），所以先逐条读出来再删
          const problems = await Promise.all(idStrs.map((pid) => P.getProblemForAdmin(pid)));
          const existing = problems.filter(Boolean);
          await P.deleteProblems(idStrs);
          for (const pid of idStrs) {
            await U.deleteProblemStatesEverywhere(pid);
          }

          // ⭐ 寫 N 筆 audit_logs（保持完整），但只發 1 條 webhook
          // ⭐ 每筆只寫 DB 不發通知（避免 Discord 被掃屏）
          for (const prob of existing) {
            await auditLog(db, 'problem_delete', {
              problemId: String(prob.id),
              collection: 'problems',
              name: prob.name,
              backup: prob,
              batch: true,
            }, req.user.username, null);   // level=null → 只寫 DB
          }

          // ⭐ 一條匯總通知
          await auditLog(db, 'problem_delete_batch', {
            ids: existing.map(p => p.id),
            count: existing.length,
            collection: 'problems',
          }, req.user.username, 'danger');

          await bumpProblemsVersion();
          return res.status(200).json({ success: true, message: `Deleted ${existing.length} problems` });
        }
        return res.status(400).json({ success: false, message: 'Invalid ids' });
      }
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ----- 編輯頁：一次拿 problem + discussions -----
    if (action === 'adminEditProblem') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const id = String(req.query.id || '').trim();
      if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

      const problem = await P.getProblemForAdmin(id);   // ⭐ PostgreSQL，含 answer/logic/tags
      if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 50));
      const { discussions, pagination } = await fetchDiscussions(db, id, req.user.username, page, limit);

      return res.status(200).json({
        success: true,
        problem,
        discussions,
        pagination
      });
    }
        // ----- 試卷：讀取所有子題（含 ans）-----
    if (action === 'adminPaperQuestions') {
      if (req.method === 'GET') {
        const paperId = String(req.query.paperId || '').trim();
        if (!paperId) return res.status(400).json({ success: false, message: 'Missing paperId' });

        const paper = await P.getProblem(paperId, { withAnswer: true });
        if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });

        const stmt = String(paper.statement || '');
        const m = stmt.match(/<div[^>]*class=["'][^"']*paper-mount[^"']*["'][^>]*>/i);
        if (!m) return res.status(400).json({ success: false, message: 'Not a paper' });

        const tag = m[0];
        const pdfUrl = (tag.match(/data-pdf=["']([^"']+)["']/) || [])[1] || '';
        const total = parseInt((tag.match(/data-total=["']?(\d+)/) || [])[1], 10);
        if (!Number.isFinite(total) || total < 1 || total > 100) {
          return res.status(400).json({ success: false, message: 'Invalid data-total' });
        }

        const prefix = paperId.slice(0, -2);
        const ids = [];
        for (let i = 1; i <= total; i++) ids.push(prefix + String(i).padStart(2, '0'));

        // ⭐ 一次批量取（含答案）+ 一次批量取标签，避免 2×N 次往返
        const [existing, tagMap] = await Promise.all([
          P.getProblemsByIds(ids, { withAnswer: true }),
          P.getTagsForProblems(ids),
        ]);
        const map = Object.fromEntries(
          existing.map(q => [q.id, { ...q, tags: tagMap[q.id] || [] }])
        );

        const questions = ids.map(qid => ({
          id: qid,
          exists: !!map[qid],
          ans: map[qid]?.ans || '',
          difficulty: map[qid]?.difficulty ?? 5,
          tags: map[qid]?.tags || [],
          public: map[qid]?.public !== false,
        }));

        return res.status(200).json({ success: true, paperId, pdfUrl, total, questions });
      }

      if (req.method === 'PUT') {
        const { paperId, questions } = req.body || {};
        if (!paperId || !Array.isArray(questions)) {
          return res.status(400).json({ success: false, message: 'Missing paperId or questions' });
        }

        const paper = await P.getProblem(paperId, { withAnswer: true });
        if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });

        const prefix = paperId.slice(0, -2);
        const errors = [];
        const toUpsert = [];

        // 先做纯校验，通过的收集起来一次性写库（单事务）
        for (const q of questions) {
          const qid = String(q.id || '').trim();
          if (!qid || qid === paperId) continue;
          if (!qid.startsWith(prefix)) {
            errors.push(`${qid}: prefix mismatch (expected ${prefix}XX)`);
            continue;
          }
          toUpsert.push({
            id: qid,
            ans: q.ans,
            difficulty: q.difficulty,
            tags: q.tags,
            public: q.public,
          });
        }

        const { created, updated } = await P.upsertPaperQuestions(toUpsert);
        await bumpProblemsVersion();

        return res.status(200).json({ success: true, created, updated, errors });
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }
    // ----- 圖片上傳（→ GitHub static repo） -----
    if (action === 'adminUploadImage') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { image, problemId } = req.body || {};
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ success: false, message: 'Missing image data' });
      }

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const approxBytes = Math.floor(base64Data.length * 3 / 4);
      if (approxBytes > 10 * 1024 * 1024) {
        return res.status(400).json({ success: false, message: 'Image too large (max 10MB)' });
      }

      try {
        const { uploadNumberedImage, uploadTimestampedImage } =
          await import('../lib/github-upload.js');

        const url = problemId
        ? await uploadNumberedImage(image, { folder: 'images/problems', baseName: String(problemId) })
        : await uploadTimestampedImage(image, { folder: 'images/problems', baseName: 'img' });

        await auditLog(db, 'upload_problem_image', {
          url,
          problemId: problemId || null,
        }, req.user.username, 'info');
        return res.status(200).json({ success: true, url });
      } catch (err) {
        console.error('Problem image upload error:', err);
        return res.status(500).json({ success: false, message: 'Upload failed: ' + err.message });
      }
    }

    // ----- 刪除討論 -----
    if (action === 'adminDeleteDiscussion') {
      if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ success: false, message: 'Missing discussion id' });
      let oid;
      try { oid = new ObjectId(id); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
      const result = await db.collection('discussions').deleteOne({ _id: oid });
      if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Post not found' });
      await auditLog(db, 'delete_discussion', { id }, req.user.username, 'warn');
      return res.status(200).json({ success: true, message: 'Discussion deleted' });
    }

    // ----- 設定 likes -----
    if (action === 'adminSetDiscussionLikes') {
      if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
      const { id, likes } = req.body || {};
      if (!id || likes === undefined) return res.status(400).json({ success: false, message: 'Missing id or likes' });
      let oid;
      try { oid = new ObjectId(id); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
      const result = await db.collection('discussions').updateOne(
        { _id: oid },
        { $set: { likes: Number(likes) } }
      );
      if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Post not found' });
      await auditLog(db, 'set_discussion_likes', {
        id,
        likes: Number(likes),
      }, req.user.username, 'warn');
      return res.status(200).json({ success: true, message: 'Likes updated' });
    }

    return res.status(400).json({ success: false, message: 'Invalid admin action' });
  }

  // ==================== 討論區 ====================
  if (action === 'discussions') {
    if (!req.user.states) {
      req.user.states = await U.getStates(req.user.username);
    }

    if (req.method === 'GET') {
      const pid = String(req.query.problemId || '');
      if (!pid) return res.status(400).json({ success: false, message: 'Missing problemId' });
      if (!checkAccess(req.user, pid)) return res.status(403).json({ success: false, message: 'Access denied' });

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
      const { discussions, pagination } = await fetchDiscussions(db, pid, req.user.username, page, limit);
      return res.status(200).json({ success: true, discussions, pagination });
    }

    if (req.method === 'POST') {
      const { problemId: pid, content: postContent } = req.body || {};
      if (!pid || !postContent) return res.status(400).json({ success: false, message: 'Missing fields' });
      const pidStr = String(pid);
      if (!checkAccess(req.user, pidStr)) return res.status(403).json({ success: false, message: 'Access denied' });

      const trimmed = String(postContent).trim().slice(0, 5000);
      const cleanContent = sanitizeHTML(trimmed);

      const newPost = {
        problemId: pidStr,
        username: req.user.username,
        content: cleanContent,
        likes: 0,
        likedBy: [],
        createdAt: new Date()
      };
      const result = await db.collection('discussions').insertOne(newPost);
      newPost._id = result.insertedId;
      return res.status(201).json({ success: true, discussion: newPost });
    }

    if (req.method === 'PUT') {
      const { discussionId: did } = req.body || {};
      if (!did) return res.status(400).json({ success: false, message: 'Missing discussionId' });

      let oid;
      try { oid = new ObjectId(did); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }

      const post = await db.collection('discussions').findOne({ _id: oid });
      if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

      if (!checkAccess(req.user, post.problemId)) return res.status(403).json({ success: false, message: 'Access denied' });

      const alreadyLiked = Array.isArray(post.likedBy) && post.likedBy.includes(req.user.username);
      if (alreadyLiked) {
        await db.collection('discussions').updateOne(
          { _id: oid },
          { $pull: { likedBy: req.user.username }, $inc: { likes: -1 } }
        );
      } else {
        await db.collection('discussions').updateOne(
          { _id: oid },
          { $addToSet: { likedBy: req.user.username }, $inc: { likes: 1 } }
        );
      }

      const updated = await db.collection('discussions').findOne({ _id: oid });
      return res.status(200).json({ success: true, discussion: updated });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ==================== 相似題目 ====================
  if (action === 'similar') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const pid = String(req.query.id || '').trim();
    if (!pid) return res.status(400).json({ success: false, message: 'Missing problem id' });

    const adminUser = isAdminUser(req.user);

    // 相似题目走 PostgreSQL：problem_tags 自连接 GROUP BY 算共同标签数，
    // 比原来 MongoDB 的 $setIntersection 更快，而且能走索引。
    const [current, curTags] = await Promise.all([
      P.getProblem(pid),
      P.getProblemTags(pid),
    ]);

    if (!current) return res.status(404).json({ success: false, message: 'Problem not found' });
    if (!adminUser && !current.public) {
      return res.status(404).json({ success: false, message: 'Problem not found' });
    }

    const curDiff = Number(current.difficulty) || 0;

    // 没有标签时退化到「难度最接近」，对应原来的 diffDelta 排序
    const similar = curTags.length > 0
      ? await P.similarProblems(pid, curDiff, 15)
      : await P.nearestByDifficulty(pid, curDiff, 15);

    return res.status(200).json({
      success: true,
      current: { id: pid, tags: curTags, difficulty: curDiff },
      similar
    });
  }

  // ==================== 舉報 ====================
  if (action === 'report') {
    if (req.method === 'POST') {
      const { problemId, reason } = req.body || {};
      if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });
      const pidStr = String(problemId);
      if (!(await P.problemExists(pidStr))) {
        return res.status(404).json({ success: false, message: 'Problem not found' });
      }

      const trimmedReason = String(reason || '').trim().slice(0, 1000);

      await db.collection('reports').insertOne({
        problemId: pidStr,
        username: req.user.username,
        reason: trimmedReason,
        resolved: false,
        timestamp: new Date()
      });
      await auditLog(db, 'problem_report', {
              collection: 'reports',
              problemId:pidStr,
              reason:trimmedReason
            }, req.user.username, null);   // level=null → 只寫 DB
      return res.status(201).json({ success: true, message: 'Report submitted' });
    }

    if (req.method === 'GET') {
      if (!isAdminUser(req.user)) return res.status(403).json({ success: false, message: 'Admin only' });
      const reports = await db.collection('reports').find({}).sort({ resolved: 1, timestamp: -1 }).toArray();
      return res.status(200).json({ success: true, reports });
    }

    if (req.method === 'PUT') {
      if (!isAdminUser(req.user)) return res.status(403).json({ success: false, message: 'Admin only' });
      const { reportId, resolved } = req.body || {};
      if (!reportId) return res.status(400).json({ success: false, message: 'Missing reportId' });
      let oid;
      try { oid = new ObjectId(reportId); }
      catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
      const result = await db.collection('reports').updateOne({ _id: oid }, { $set: { resolved: !!resolved } });
      if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Report not found' });
      return res.status(200).json({ success: true, message: 'Report updated' });
    }

    if (req.method === 'DELETE') {
      if (!isAdminUser(req.user)) return res.status(403).json({ success: false, message: 'Admin only' });
      const { reportId } = req.body || {};
      if (!reportId) return res.status(400).json({ success: false, message: 'Missing reportId' });
      let oid;
      try { oid = new ObjectId(reportId); }
      catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
      const result = await db.collection('reports').deleteOne({ _id: oid });
      if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Report not found' });
      return res.status(200).json({ success: true, message: 'Report deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }
    // ==================== 試卷：一次拿 PDF + 所有子題 AC 狀態 ====================
  if (action === 'paper') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    try {
      const adminUser = isAdminUser(req.user);

      const paper = await P.getProblem(id, { withAnswer: true });   // 需要 statement 解析 paper-mount
      if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });
      if (!adminUser && paper.public === false) {
        return res.status(404).json({ success: false, message: 'Paper not found' });
      }

      // 解析 paper-mount HTML
      const stmt = String(paper.statement || '');
      const paperMatch = stmt.match(/<div[^>]*class=["'][^"']*paper-mount[^"']*["'][^>]*>/i);
      if (!paperMatch) {
        return res.status(400).json({ success: false, message: 'Not a paper' });
      }
      const tag = paperMatch[0];
      const pdfUrl = (tag.match(/data-pdf=["']([^"']+)["']/) || [])[1] || '';
      const total = parseInt((tag.match(/data-total=["']?(\d+)/) || [])[1], 10);

      if (!pdfUrl || !Number.isFinite(total) || total < 1 || total > 100) {
        return res.status(400).json({ success: false, message: 'Invalid paper config' });
      }

      // 子題 ID：主 ID 前綴 + 補零 2 位題號
      const prefix = id.slice(0, -2);
      const questionIds = [];
      for (let i = 1; i <= total; i++) {
        questionIds.push(prefix + String(i).padStart(2, '0'));
      }

      // 檢查子題存在 + 拿用戶狀態
      const [questions, states] = await Promise.all([
        P.getProblemsByIds(questionIds),
        U.getStates(req.user.username),
      ]);

      const existing = new Set(questions.map(q => q.id));

      const enriched = questionIds
        .filter(qid => existing.has(qid))
        .map(qid => ({
          id: qid,
          ac: states[qid] === 'passed',
        }));

      return res.status(200).json({
        success: true,
        paper: {
          id,
          pdfUrl,
          total: enriched.length,
          questions: enriched,
        },
      });
    } catch (err) {
      console.error('Error in /api/problem?action=paper:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
    // ==================== 單題頁面：一次拿 problem + states + favorites ====================
  if (action === 'page') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    try {
      const adminUser = isAdminUser(req.user);

      // ⭐ problems 和 userstats 已迁到 PostgreSQL，走 lib/pgStore.js。
      //    getProblem 默认不取 answer/logic（判题才需要），所以不用再手动剥离。
      //    userdata（收藏）还没迁，继续读 Mongo。
      // 题目、做题状态、收藏全部在 PostgreSQL
      const [problem, state, favorites] = await Promise.all([
        P.getProblem(id),
        U.getProblemState(req.user.username, id),
        U.getFavorites(req.user.username),
      ]);

      if (!problem) {
        return res.status(404).json({ success: false, message: 'Problem not found' });
      }

      if (!adminUser) {
        let canView = problem.public;
        if (!canView) {
          const now = new Date();
          const team = await db.collection('teams').findOne({
            members: req.user.username,
          });

          // ⭐ 竞赛活跃判断在 JS 里做（docStore 不支持 $expr）
          const candidates = await db.collection('contests').find({
            participants: req.user.username,
            startTime: { $lte: now },
          }).toArray();
          const contest = candidates.find(c =>
            isContestActive(c, now) && contestProblemIds(c).includes(id));
          if (contest) canView = true;

          // ⭐ Team 检查
          if (!canView) {
            const activeSpecials = (await db.collection('contests').find({
              special: true,
              startTime: { $lte: now },
            }).toArray()).filter(c => isContestActive(c, now));

            for (const c of activeSpecials) {
              const hasProblem = (c.problems || []).some(p => {
                const pid = (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p);
                return pid === id;
              });
              if (!hasProblem) continue;

              const t = await db.collection('teams').findOne({
                contestId: c.id,
                members: req.user.username
              });
              if (t) { canView = true; break; }
            }
          }
        }
        if (!canView) {
          return res.status(404).json({ success: false, message: 'Problem not found' });
        }
      }

      // 双保险：即使 getProblem 以后改成带 answer，这里也不外泄
      const { ans, logic, ...safeProblem } = problem;

      const favorited = favorites.includes(id);

      return res.status(200).json({
        success: true,
        problem: safeProblem,
        state,
        favorited
      });
    } catch (err) {
      console.error('Error in /api/problem?action=page:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ==================== 題目查詢（用戶端） ====================
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id, ids, checkVersion, page = '1', limit = '20', tags, sortBy, order } = req.query;

  try {
    const adminUser = isAdminUser(req.user);

    // 版本號（存在 PostgreSQL 的 app_settings）
    if (checkVersion === '1') {
      return res.status(200).json({ success: true, version: await P.getProblemsVersion() });
    }

    // 輕量 id 列表
    if (ids === '1') {
      // ⭐ 非管理員只能看到 public 題目
      const idList = await P.getAllProblemIds({ publicOnly: !adminUser });
      return res.status(200).json({ success: true, ids: idList });
    }

    if (req.query.all === '1') {
      const publicOnly = !adminUser;
      const withStatement = req.query.withStatement === '1';

      const [version, problems, solvesMap, allTags] = await Promise.all([
        P.getProblemsVersion(),
        P.getAllProblems({ publicOnly, withStatement }),
        getSolvesCountMap(db),
        P.listTagNames({ publicOnly }),
      ]);

      // 補上 solves（一次遍歷，O(N)）。solves 仍来自 Mongo 的 userstats。
      for (const p of problems) {
        p.solves = solvesMap[p.id] || 0;
      }

      return res.status(200).json({ success: true, version, problems, allTags });
    }

    // 多個 ID（收藏夾）
    if (ids) {
      const idArray = String(ids).split(',').map(s => s.trim()).filter(Boolean);
      if (idArray.length === 0) {
        return res.status(200).json({ success: true, problems: [], allTags: [] });
      }
      const publicOnly = !adminUser;
      const [problems, allTags, solvesMap] = await Promise.all([
        P.listProblemsByIds(idArray, { publicOnly, sortBy, order }),
        P.listTagNames({ publicOnly }),
        getSolvesCountMap(db),
      ]);
      for (const p of problems) p.solves = solvesMap[p.id] || 0;
      // solves 的数据源在 Mongo，SQL 排不了，只能在这里补排
      if (sortBy === 'solves') {
        problems.sort((a, b) => (order === 'desc' ? b.solves - a.solves : a.solves - b.solves));
      }
      return res.status(200).json({ success: true, problems, allTags });
    }

    // 單題詳情
    if (id) {
      const idStr = String(id);
      const problem = await P.getProblemForAdmin(idStr);   // 先取全量，再剥离答案
      if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

      if (!adminUser) {
        let canView = problem.public;
        if (!canView) {
          const now = new Date();
          const candidates = await db.collection('contests').find({
            participants: req.user.username,
            startTime: { $lte: now },
          }).toArray();
          const contest = candidates.find(c =>
            isContestActive(c, now) && contestProblemIds(c).includes(idStr));
          if (contest) canView = true;
        }
        if (!canView) {
          return res.status(404).json({ success: false, message: 'Problem not found' });
        }
      }

      // 一律剝離 ans / logic（用戶端永遠拿不到；admin 要答案請用 adminProblems / adminEditProblem）
      const { ans, logic, ...safeProblem } = problem;
      return res.status(200).json({ success: true, problem: safeProblem });
    }

    // 分頁列表
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const publicOnly = !adminUser;

    const tagList = tags
      ? String(tags).split(',').map(t => t.trim()).filter(Boolean)
      : [];

    const allowedSortFields = ['id', 'difficulty', 'solves'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'id';
    const sortOrder = order === 'desc' ? 'desc' : 'asc';

    const [solvesMap, allTags] = await Promise.all([
      getSolvesCountMap(db),
      P.listTagNames({ publicOnly }),
    ]);

    let problems;
    let total;

    if (sortField === 'solves') {
      // solves 来自 Mongo 的 userstats，SQL 排不了。
      // 题量约 2700，拉全量在内存里排序分页，和原来聚合的代价同阶。
      const all = await P.getAllProblems({ publicOnly });
      for (const p of all) p.solves = solvesMap[p.id] || 0;
      all.sort((a, b) => {
        const d = a.solves - b.solves;
        if (d !== 0) return sortOrder === 'desc' ? -d : d;
        return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
      });
      total = all.length;
      const start = (pageNum - 1) * limitNum;
      problems = all.slice(start, start + limitNum);
    } else {
      const r = await P.listProblemsPage({
        publicOnly,
        tags: tagList,
        sortBy: sortField,
        order: sortOrder,
        page: pageNum,
        limit: limitNum,
      });
      problems = r.problems;
      total = r.total;
      for (const p of problems) p.solves = solvesMap[p.id] || 0;
    }

    return res.status(200).json({
      success: true,
      problems,
      allTags,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (err) {
    console.error('Error in /api/problem:', err);
    if (err.name === 'MongoError' || err.name === 'MongoServerError') {
      return res.status(500).json({ success: false, message: 'Database error' });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============== 輔助 ==============
// 题目相关的 SQL 全部收敛在 lib/pgStore.js。
// solves（通过人数）仍来自 MongoDB 的 userstats，见上面的 getSolvesCountMap。

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);