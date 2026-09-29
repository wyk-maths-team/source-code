// api/problem.js
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { sanitizeHTML } from '../lib/sanitize.js';
import { ObjectId } from 'mongodb';
//説明：所有的題目相關的操作都在這裏。
// ============== 輔助函數 ==============
// ============== 輔助函數 ==============
function isAdminUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
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

async function bumpProblemsVersion(db) {
  await db.collection('metadata').updateOne(
    { _key: 'problemsVersion' },
    { $set: { version: Date.now() } }
  );
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
export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const decoded = await verifyToken(req);
  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  req.user = { username: decoded.username, role: decoded.role };

  const db = await connectToDatabase();
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
          const problem = await db.collection('problems').findOne({ id: String(id) });
          if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
          return res.status(200).json({ success: true, problem });
        }
        const problems = await db.collection('problems').find({}).toArray();
        return res.status(200).json({ success: true, problems });
      }

      if (req.method === 'POST') {
        const { id, name, statement, ans, difficulty, tags, public: isPublic, logic } = req.body || {};
        if (!id || !name || !statement || ans === undefined) {
          return res.status(400).json({ success: false, message: 'Missing fields' });
        }
        const idStr = String(id);
        const exist = await db.collection('problems').findOne({ id: idStr });
        if (exist) return res.status(400).json({ success: false, message: 'Problem ID already exists' });

        const newProblem = {
          id: idStr,
          name,
          statement,
          ans: String(ans),
          difficulty: Number(difficulty) || 0,
          tags: Array.isArray(tags) ? tags : [],
          public: isPublic === false ? false : true,
          logic: logic || ''
        };
        await db.collection('problems').insertOne(newProblem);
        await bumpProblemsVersion(db);
        await auditLog(db, 'problem_create', {
          problemId: idStr,
          collection: 'problems',
          name: newProblem.name,
          after: newProblem,
        }, req.user.username, 'info');
        return res.status(201).json({ success: true, message: 'Problem created' });
      }

      if (req.method === 'PUT') {
        const { id, ids, name, statement, ans, difficulty, tags, public: isPublic, logic } = req.body || {};

        // 批量更新 public
        if (Array.isArray(ids) && ids.length && isPublic !== undefined) {
          const idStrs = ids.map(String);
          const target = isPublic === false ? false : true;
          const beforeList = await db.collection('problems').find({ id: { $in: idStrs } }).toArray();
          const result = await db.collection('problems').updateMany(
            { id: { $in: idStrs } },
            { $set: { public: target } }
          );
          for (const prob of beforeList) {
            await auditProblemChange(db, req.user.username, prob.id, { public: prob.public }, { public: target });
          }
          await bumpProblemsVersion(db);
          return res.status(200).json({ success: true, message: `Updated ${result.modifiedCount} problems` });
        }

        // 單題更新
        if (!id) return res.status(400).json({ success: false, message: 'Missing problem ID' });
        const idStr = String(id);
        const before = await db.collection('problems').findOne({ id: idStr });
        if (!before) return res.status(404).json({ success: false, message: 'Problem not found' });

        const upd = {};
        if (name !== undefined) upd.name = name;
        if (statement !== undefined) upd.statement = statement;
        if (ans !== undefined) upd.ans = String(ans);
        if (difficulty !== undefined) upd.difficulty = Number(difficulty) || 0;
        if (tags !== undefined) upd.tags = Array.isArray(tags) ? tags : [];
        if (isPublic !== undefined) upd.public = isPublic === false ? false : true;
        if (logic !== undefined) upd.logic = logic;

        if (Object.keys(upd).length === 0) {
          return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        await db.collection('problems').updateOne({ id: idStr }, { $set: upd });
        await bumpProblemsVersion(db);
        await auditProblemChange(db, req.user.username, idStr, before, { ...before, ...upd });
        return res.status(200).json({ success: true, message: 'Problem updated' });
      }

      if (req.method === 'DELETE') {
        const { id, ids } = req.body || {};
        if (!id && !ids) return res.status(400).json({ success: false, message: 'Missing id or ids' });

        if (id) {
          const idStr = String(id);
          const problem = await db.collection('problems').findOne({ id: idStr });
          if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
          await db.collection('problems').deleteOne({ id: idStr });
          await db.collection('userstats').updateMany({}, { $unset: { [`states.${idStr}`]: '' } });
          await auditProblemDelete(db, req.user.username, problem);
          await bumpProblemsVersion(db);
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
          const problems = await db.collection('problems').find({ id: { $in: idStrs } }).toArray();
          await db.collection('problems').deleteMany({ id: { $in: idStrs } });
          for (const pid of idStrs) {
            await db.collection('userstats').updateMany({}, { $unset: { [`states.${pid}`]: '' } });
          }

          // ⭐ 寫 N 筆 audit_logs（保持完整），但只發 1 條 webhook
          // ⭐ 每筆只寫 DB 不發通知（避免 Discord 被掃屏）
          for (const prob of problems) {
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
            ids: problems.map(p => p.id),
            count: problems.length,
            collection: 'problems',
          }, req.user.username, 'danger');

          await bumpProblemsVersion(db);
          return res.status(200).json({ success: true, message: `Deleted ${problems.length} problems` });
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

      const problem = await db.collection('problems').findOne({ id });
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

        const paper = await db.collection('problems').findOne({ id: paperId });
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

        const existing = await db.collection('problems')
          .find({ id: { $in: ids } },
                { projection: { id: 1, ans: 1, difficulty: 1, tags: 1, public: 1, _id: 0 } })
          .toArray();
        const map = Object.fromEntries(existing.map(q => [q.id, q]));

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

        const paper = await db.collection('problems').findOne({ id: paperId });
        if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });

        const prefix = paperId.slice(0, -2);
        const col = db.collection('problems');
        let created = 0, updated = 0;
        const errors = [];

        for (const q of questions) {
          const qid = String(q.id || '').trim();
          if (!qid || qid === paperId) continue;
          if (!qid.startsWith(prefix)) {
            errors.push(`${qid}: prefix mismatch (expected ${prefix}XX)`);
            continue;
          }

          const setObj = {};
          if (q.ans !== undefined) setObj.ans = String(q.ans);
          if (q.difficulty !== undefined) setObj.difficulty = Number(q.difficulty) || 0;
          if (Array.isArray(q.tags)) setObj.tags = q.tags;
          if (q.public !== undefined) setObj.public = q.public !== false;

          const exist = await col.findOne({ id: qid }, { projection: { _id: 1 } });
          if (exist) {
            await col.updateOne({ id: qid }, { $set: setObj });
            updated++;
          } else {
            await col.insertOne({
              id: qid,
              name: qid,
              statement: '',
              ans: String(q.ans || ''),
              difficulty: Number(q.difficulty) || 5,
              tags: Array.isArray(q.tags) ? q.tags : [],
              public: q.public !== false,
              logic: '',
            });
            created++;
          }
        }

        await db.collection('metadata').updateOne(
          { _key: 'problemsVersion' },
          { $set: { version: Date.now() } }
        );

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
      const statsDoc = await db.collection('userstats').findOne({ username: req.user.username });
      req.user.states = statsDoc ? (statsDoc.states || {}) : {};
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

    const currentFilter = adminUser ? { id: pid } : { id: pid, public: true };
    const current = await db.collection('problems').findOne(
      currentFilter,
      { projection: { id: 1, tags: 1, difficulty: 1, name: 1 } }
    );
    if (!current) return res.status(404).json({ success: false, message: 'Problem not found' });

    const curTags = Array.isArray(current.tags) ? current.tags.filter(Boolean) : [];
    const curDiff = Number(current.difficulty) || 0;

    const baseFilter = adminUser ? {} : { public: true };
    const excludeSelf = { ...baseFilter, id: { $ne: current.id } };

    const pipeline = [
      { $match: excludeSelf },
      {
        $addFields: {
          commonTags: {
            $size: { $setIntersection: [{ $ifNull: ['$tags', []] }, curTags] }
          },
          diffDelta: {
            $abs: { $subtract: [{ $ifNull: ['$difficulty', 0] }, curDiff] }
          }
        }
      }
    ];

    if (curTags.length > 0) {
      pipeline.push({ $match: { commonTags: { $gt: 0 } } });
      pipeline.push({
        $addFields: { score: { $subtract: [{ $multiply: ['$commonTags', 10] }, '$diffDelta'] } }
      });
      pipeline.push({ $sort: { score: -1, id: 1 } });
    } else {
      pipeline.push({ $sort: { diffDelta: 1, id: 1 } });
    }

    pipeline.push({ $limit: 15 });
    pipeline.push({
      $project: {
        id: 1, name: 1, tags: 1, difficulty: 1,
        commonTags: 1, diffDelta: 1, _id: 0
      }
    });

    const similar = await db.collection('problems').aggregate(pipeline).toArray();

    return res.status(200).json({
      success: true,
      current: { id: current.id, tags: curTags, difficulty: curDiff },
      similar
    });
  }

  // ==================== 舉報 ====================
  if (action === 'report') {
    if (req.method === 'POST') {
      const { problemId, reason } = req.body || {};
      if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });
      const pidStr = String(problemId);
      const problem = await db.collection('problems').findOne({ id: pidStr });
      if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

      const trimmedReason = String(reason || '').trim().slice(0, 1000);

      await db.collection('reports').insertOne({
        problemId: pidStr,
        username: req.user.username,
        reason: trimmedReason,
        resolved: false,
        timestamp: new Date()
      });
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

      const paper = await db.collection('problems').findOne({ id });
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
      const [questions, userStats] = await Promise.all([
        db.collection('problems')
          .find(
            { id: { $in: questionIds } },
            { projection: { id: 1, _id: 0 } }
          )
          .toArray(),
        db.collection('userstats').findOne(
          { username: req.user.username },
          { projection: { states: 1, _id: 0 } }
        ),
      ]);

      const existing = new Set(questions.map(q => q.id));
      const states = userStats?.states || {};

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

      // 三件事並行拉；userstats 只投影當前題的 state（states.<id>）
      const [problem, statsDoc, userdataDoc] = await Promise.all([
        db.collection('problems').findOne({ id }),
        db.collection('userstats').findOne(
          { username: req.user.username },
          { projection: { [`states.${id}`]: 1, _id: 0 } }
        ),
        db.collection('userdata').findOne(
          { username: req.user.username },
          { projection: { favorites: 1, _id: 0 } }
        )
      ]);

      if (!problem) {
        return res.status(404).json({ success: false, message: 'Problem not found' });
      }

            if (!adminUser) {
        let canView = problem.public;
        if (!canView) {
          const now = new Date();
          // ⭐ 检查是否属于某个进行中的 special contest 的队伍
          const team = await db.collection('teams').findOne({
            members: req.user.username,
            startTime: { $lte: now }   // 用 contests 的关联条件
          });
          
          // 常规检查
          const contest = await db.collection('contests').findOne({
            participants: req.user.username,
            startTime: { $lte: now },
            $expr: {
              $gte: [
                { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
                now
              ]
            },
            'problems.problemId': id
          });
          if (contest) canView = true;
          
          // ⭐ Team 检查
          if (!canView) {
            const activeSpecials = await db.collection('contests').find({
              special: true,
              startTime: { $lte: now },
              $expr: {
                $gte: [
                  { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
                  now
                ]
              }
            }, { projection: { id: 1, problems: 1 } }).toArray();
            
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

      // 剝離 ans + logic
      const { ans, logic, _id, ...safeProblem } = problem;

      // 只回傳當前題的狀態與收藏狀態
      const state = statsDoc?.states?.[id] || 'not_started';
      const favorited = Array.isArray(userdataDoc?.favorites) && userdataDoc.favorites.includes(id);

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

    // 版本號
    if (checkVersion === '1') {
      const meta = await db.collection('metadata').findOne({ _key: 'problemsVersion' });
      return res.status(200).json({ success: true, version: meta ? meta.version : 0 });
    }

    // 輕量 id 列表
    if (ids === '1') {
      // ⭐ 非管理員只能看到 public 題目
      const idFilter = adminUser ? {} : { public: true };
      const idList = await db.collection('problems')
        .find(idFilter, { projection: { id: 1, _id: 0 } })
        .toArray();
      return res.status(200).json({ success: true, ids: idList.map(p => p.id) });
    }

    // 全量列表（不含 ans / logic；可選包含 statement）
    if (req.query.all === '1') {
      const baseFilter = adminUser ? {} : { public: true };
      const withStatement = req.query.withStatement === '1';
      const projectFields = {
        id: 1, name: 1, difficulty: 1, tags: 1, public: 1, solves: 1, _id: 0
      };
      if (withStatement) projectFields.statement = 1;

      const pipeline = [
        { $match: baseFilter },
        {
          $lookup: {
            from: 'userstats',
            let: { pidStr: '$id' },
            pipeline: [
              { $project: { statesArray: { $objectToArray: '$states' } } },
              { $unwind: '$statesArray' },
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$statesArray.v', 'passed'] },
                      { $eq: ['$statesArray.k', '$$pidStr'] }
                    ]
                  }
                }
              },
              { $count: 'count' }
            ],
            as: 'solvesData'
          }
        },
        { $addFields: { solves: { $ifNull: [{ $arrayElemAt: ['$solvesData.count', 0] }, 0] } } },
        { $project: projectFields }
      ];

      pipeline.push({ $sort: { id: 1 } });

      const problems = await db.collection('problems').aggregate(pipeline).toArray();
      const allTags = await fetchAllTags(db, baseFilter);
      return res.status(200).json({ success: true, problems, allTags });
    }

    // 多個 ID（收藏夾）
    if (ids) {
      const idArray = String(ids).split(',').map(s => s.trim()).filter(Boolean);
      if (idArray.length === 0) {
        return res.status(200).json({ success: true, problems: [], allTags: [] });
      }
      const baseFilter = adminUser ? {} : { public: true };
      const filter = { ...baseFilter, id: { $in: idArray } };
      const problems = await fetchProblemsWithSolves(db, filter, sortBy, order);
      const allTags = await fetchAllTags(db, baseFilter);
      return res.status(200).json({ success: true, problems, allTags });
    }

    // 單題詳情
    if (id) {
      const idStr = String(id);
      const problem = await db.collection('problems').findOne({ id: idStr });
      if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

      if (!adminUser) {
        let canView = problem.public;
        if (!canView) {
          const now = new Date();
          const contest = await db.collection('contests').findOne(
            {
              participants: req.user.username,
              startTime: { $lte: now },
              $expr: {
                $gte: [
                  { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
                  now
                ]
              },
              'problems.problemId': idStr
            },
            { projection: { _id: 1 } }
          );
          if (contest) canView = true;
        }
        if (!canView) {
          return res.status(404).json({ success: false, message: 'Problem not found' });
        }
      }

      // 一律剝離 ans（用戶端永遠拿不到；admin 要 ans 請用 adminProblems / adminEditProblem）
      const { ans,logic, _id, ...safeProblem } = problem;
      return res.status(200).json({ success: true, problem: safeProblem });
    }

    // 分頁列表
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    const baseFilter = adminUser ? {} : { public: true };
    const filter = { ...baseFilter };
    if (tags) {
      const tagsArray = String(tags).split(',').map(t => t.trim()).filter(Boolean);
      if (tagsArray.length > 0) filter.tags = { $in: tagsArray };
    }

    const allowedSortFields = ['id', 'difficulty', 'solves'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'id';
    const sortOrderNum = (order === 'desc') ? -1 : 1;

    const pipeline = buildProblemListPipeline(filter, sortField, sortOrderNum, pageNum, limitNum);
    const problems = await db.collection('problems').aggregate(pipeline).toArray();

    const allTags = await fetchAllTags(db, baseFilter);
    const total = await db.collection('problems').countDocuments(filter);

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

// ============== 管線 / 輔助 ==============
function buildProblemListPipeline(filter, sortField, sortOrder, pageNum, limitNum) {
  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: 'userstats',
        let: { pidStr: '$id' },
        pipeline: [
          { $project: { statesArray: { $objectToArray: '$states' } } },
          { $unwind: '$statesArray' },
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$statesArray.v', 'passed'] },
                  { $eq: ['$statesArray.k', '$$pidStr'] }
                ]
              }
            }
          },
          { $count: 'count' }
        ],
        as: 'solvesData'
      }
    },
    { $addFields: { solves: { $ifNull: [{ $arrayElemAt: ['$solvesData.count', 0] }, 0] } } },
  ];

  if (sortField === 'id') {
    pipeline.push({
      $addFields: {
        _idParts: { $regexFind: { input: '$id', regex: /^([A-Za-z]*)(\d+)$/ } }
      }
    });
    pipeline.push({
      $addFields: {
        idPrefix: { $toLower: { $ifNull: [{ $arrayElemAt: ['$_idParts.captures', 0] }, ''] } },
        idNum: {
          $convert: {
            input: { $ifNull: [{ $arrayElemAt: ['$_idParts.captures', 1] }, '0'] },
            to: 'int', onError: 0, onNull: 0
          }
        }
      }
    });
    pipeline.push({ $sort: { idPrefix: sortOrder, idNum: sortOrder } });
  } else {
    pipeline.push({ $sort: { [sortField]: sortOrder } });
  }

  if (pageNum && limitNum) {
    pipeline.push({ $skip: (pageNum - 1) * limitNum });
    pipeline.push({ $limit: limitNum });
  }

  pipeline.push({
    $project: {
      statement: 0,
      ans: 0,
      logic: 0,
      solvesData: 0,
      idPrefix: 0,
      idNum: 0,
      _idParts: 0
    }
  });

  return pipeline;
}

async function fetchAllTags(db, baseFilter) {
  const tags = await db.collection('problems').distinct('tags', baseFilter);
  return tags.filter(t => t).sort();
}

async function fetchProblemsWithSolves(db, filter, sortBy, order) {
  const sortField = ['id', 'difficulty', 'solves'].includes(sortBy) ? sortBy : 'id';
  const sortOrder = (order === 'desc') ? -1 : 1;
  const pipe = [
    { $match: filter },
    {
      $lookup: {
        from: 'userstats',
        let: { pidStr: '$id' },
        pipeline: [
          { $project: { statesArray: { $objectToArray: '$states' } } },
          { $unwind: '$statesArray' },
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$statesArray.v', 'passed'] },
                  { $eq: ['$statesArray.k', '$$pidStr'] }
                ]
              }
            }
          },
          { $count: 'count' }
        ],
        as: 'solvesData'
      }
    },
    { $addFields: { solves: { $ifNull: [{ $arrayElemAt: ['$solvesData.count', 0] }, 0] } } },
  ];

  if (sortField === 'id') {
    pipe.push({
      $addFields: {
        _idParts: { $regexFind: { input: '$id', regex: /^([A-Za-z]*)(\d+)$/ } }
      }
    });
    pipe.push({
      $addFields: {
        idPrefix: { $toLower: { $ifNull: [{ $arrayElemAt: ['$_idParts.captures', 0] }, ''] } },
        idNum: {
          $convert: {
            input: { $ifNull: [{ $arrayElemAt: ['$_idParts.captures', 1] }, '0'] },
            to: 'int', onError: 0, onNull: 0
          }
        }
      }
    });
    pipe.push({ $sort: { idPrefix: sortOrder, idNum: sortOrder } });
  } else {
    pipe.push({ $sort: { [sortField]: sortOrder } });
  }
  pipe.push({
    $project: {
      statement: 0,
      ans: 0,
      logic: 0,
      solvesData: 0,
      idPrefix: 0,
      idNum: 0,
      _idParts: 0
    }
  });
  return await db.collection('problems').aggregate(pipe).toArray();
}