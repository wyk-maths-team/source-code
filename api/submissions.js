// api/submissions.js
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { ObjectId } from 'mongodb';
import vm from 'vm';

// =============== 快取 ===============
let _publicIdsCache = { ids: null, expireAt: 0 };
async function getPublicProblemIds(db) {
  const now = Date.now();
  if (_publicIdsCache.ids && _publicIdsCache.expireAt > now) return _publicIdsCache.ids;
  const publicProblems = await db.collection('problems')
    .find({ public: true }, { projection: { id: 1, _id: 0 } })
    .toArray();
  _publicIdsCache.ids = new Set(publicProblems.map(p => String(p.id)));
  _publicIdsCache.expireAt = now + 300_000;
  return _publicIdsCache.ids;
}
// ⭐ 執行題目的自訂 logic
function executeCustomLogic(logicStr, ans, userAnswer) {
  try {
    const result = vm.runInNewContext(
      `(${logicStr})(${JSON.stringify(ans)}, ${JSON.stringify(userAnswer)})`
    );
    if (typeof result === 'number') {
      return {
        score: Math.min(100, Math.max(0, result)),
        comment: '',
        systemError: false,
      };
    }
    if (result && typeof result === 'object' && typeof result.score === 'number') {
      return {
        score: Math.min(100, Math.max(0, result.score)),
        comment: result.comment || '',
        systemError: false,
      };
    }
    return { score: 0, comment: 'Invalid logic return value', systemError: true };
  } catch (err) {
    return { score: 0, comment: 'Logic error: ' + err.message, systemError: true };
  }
}
// =============== 共用 ===============
function isAdminUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

// 支援字串 + 數字雙軌查詢（兼容舊資料）
function buildProblemIdFilter(rawIds) {
  const out = [];
  for (const id of rawIds) {
    const s = String(id);
    out.push(s);
    const n = Number(s);
    if (!isNaN(n)) out.push(n);
  }
  return out;
}

// 統一狀態推導
function deriveStatus(s) {
  if (s.marked && s.score !== undefined) {
    if (s.score === 100) return 'Accepted';
    if (s.score === 0) return 'Wrong Answer';
    return `Partial Score (${s.score})`;
  }
  if (s.type === 'image' && !s.marked) return 'Pending';
  if (s.systemError) return 'System Error';
  if (typeof s.correct === 'boolean') return s.correct ? 'Accepted' : 'Wrong Answer';
  return 'Pending';
}

// status → Mongo filter
function buildStatusFilter(status) {
  switch (status) {
    case 'accepted':
      return { $or: [{ marked: true, score: 100 }, { type: 'text', systemError: false, correct: true }] };
    case 'wrong':
      return { $or: [{ marked: true, score: 0 }, { type: 'text', systemError: false, correct: false }] };
    case 'partial':
      return { marked: true, score: { $gt: 0, $lt: 100 } };
    case 'pending':
      return { type: 'image', marked: false };
    case 'system':
      return { systemError: true };
    default:
      return null;
  }
}

// 一次拉 header 用的 problem + user
async function buildHeader(db, problemId, username) {
  const header = {};
  const tasks = [];

  if (problemId) {
    tasks.push(
      db.collection('problems')
        .findOne({ id: String(problemId) }, { projection: { id: 1, name: 1, difficulty: 1, _id: 0 } })
        .then(p => { if (p) header.problem = p; })
        .catch(() => {})
    );
  }
  if (username) {
    tasks.push(
      db.collection('users')
        .findOne({ username }, { projection: { username: 1, displayName: 1, pfp: 1, _id: 0 } })
        .then(u => {
          if (u) header.user = { username: u.username, displayName: u.displayName || u.username, pfp: u.pfp || '' };
        })
        .catch(() => {})
    );
  }
  await Promise.all(tasks);
  return header;
}

// =============== 主處理器 ===============
export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const isAdmin = isAdminUser(decoded);

  // ---------- 詳情 ----------
  if (req.query.action === 'detail') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { subid } = req.query;
    if (!subid) return res.status(400).json({ success: false, message: 'Missing subid' });

    const [sub, userStats] = await Promise.all([
      db.collection('submissions').findOne(
        { subid },
        {
          projection: {
            subid: 1, username: 1, problemId: 1, type: 1, timestamp: 1,
            correct: 1, systemError: 1, marked: 1, score: 1, comment: 1,
            answer: 1, image: 1, markedAt: 1, _id: 0
          }
        }
      ),
      db.collection('userstats').findOne(
        { username: decoded.username },
        { projection: { states: 1, _id: 0 } }
      )
    ]);

    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });
    const isOwner = sub.username === decoded.username;

    const [problem, attempts] = await Promise.all([
      db.collection('problems').findOne(
        { id: sub.problemId },
        { projection: { name: 1, public: 1, _id: 0 } }
      ),
      db.collection('submissions').countDocuments({ username: sub.username, problemId: sub.problemId })
    ]);

    if (!isOwner && !isAdmin) {
      if (!problem || problem.public !== true) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    const hasPassed = userStats?.states?.[String(sub.problemId)] === 'passed';
    const canSeeContent = isAdmin || isOwner || hasPassed;
    const problemName = problem ? problem.name : `Problem #${sub.problemId}`;

    const result = {
      subid: sub.subid,
      username: sub.username,
      problemId: sub.problemId,
      type: sub.type,
      timestamp: sub.timestamp,
      marked: !!sub.marked,
      score: sub.score,
      correct: sub.correct,
      systemError: !!sub.systemError,
      markedAt: sub.markedAt || null
    };
        if (sub.type === 'image') {
      // ⭐ 圖片提交：只有本人和管理員能看，防止競賽抄襲
      if (isOwner || isAdmin) {
        result.image = sub.image || '';
      } else {
        result.imageHidden = true;
      }
    } else if (canSeeContent) {
      result.answer = sub.answer || '';
    } else {
      result.answerHidden = true;
    }

    if (canSeeContent) result.comment = sub.comment || '';
    else result.commentHidden = true;

    return res.status(200).json({ success: true, submission: result, problemName, attempts, canSeeContent, isOwner });
  }

  // ---------- 管理員模式 ----------
  if (req.query.admin === '1') {
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Admin only' });

    // GET：列表
    if (req.method === 'GET') {
      const {
        problem_id, status,
        user, username: qUsername,
        page = '1', limit = '50'
      } = req.query;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, parseInt(limit) || 50);

      const filter = {};
      // ⭐ 用戶過濾
      const targetUser = user || qUsername;
      if (targetUser) filter.username = targetUser;

      if (problem_id) filter.problemId = { $in: buildProblemIdFilter([problem_id]) };
      const sf = status ? buildStatusFilter(status) : null;
      if (sf) Object.assign(filter, sf);

      const [total, toMark, subs] = await Promise.all([
        db.collection('submissions').countDocuments(filter),
        db.collection('submissions').countDocuments({ type: 'image', marked: false }),
        db.collection('submissions').find(filter, { projection: { image: 0 } })
          .sort({ timestamp: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .toArray()
      ]);

      const pids = [...new Set(subs.map(s => s.problemId))];
      const usernames = [...new Set(subs.map(s => s.username))];
      const [probs, users] = await Promise.all([
        db.collection('problems').find({ id: { $in: pids } }, { projection: { id: 1, name: 1, _id: 0 } }).toArray(),
        db.collection('users').find({ username: { $in: usernames } }, { projection: { username: 1, displayName: 1, _id: 0 } }).toArray()
      ]);
      const nameMap = Object.fromEntries(probs.map(p => [p.id, p.name]));
      const dispMap = Object.fromEntries(users.map(u => [u.username, u.displayName || u.username]));

      const enriched = subs.map(s => ({
        ...s,
        displayName: dispMap[s.username] || s.username,
        problemName: nameMap[s.problemId] || `Problem #${s.problemId}`,
        status: deriveStatus(s),
        answer: s.type === 'image' ? '[Image]' : s.answer
      }));

      return res.status(200).json({
        success: true,
        submissions: enriched,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        toMark
      });
    }

    // DELETE：刪除
    if (req.method === 'DELETE') {
      const { submissionId } = req.body || {};
      if (!submissionId) return res.status(400).json({ success: false, message: 'Missing submission ID' });
      let oid;
      try { oid = new ObjectId(submissionId); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
      const result = await db.collection('submissions').deleteOne({ _id: oid });
      if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Submission not found' });
      return res.status(200).json({ success: true, message: 'Submission deleted' });
    }

        // PUT：rejudge
    if (req.method === 'PUT') {
      const { submissionId } = req.body || {};
      if (!submissionId) return res.status(400).json({ success: false, message: 'Missing submission ID' });
      let oid;
      try { oid = new ObjectId(submissionId); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }

      const sub = await db.collection('submissions').findOne({ _id: oid });
      if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });
      const problem = await db.collection('problems').findOne({ id: sub.problemId });
      if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

      // ⭐ 圖片提交不能 rejudge（要人工批改）
      if (sub.type === 'image') {
        return res.status(400).json({ success: false, message: 'Cannot rejudge image submissions (manual marking)' });
      }

      let correct = false;
      let systemError = false;
      let score = 0;
      let comment = '';

      const ansStr = String(problem.ans ?? '');
      const userAns = String(sub.answer ?? '');
      const hasLogic = typeof problem.logic === 'string' && problem.logic.trim() !== '';

      if (hasLogic) {
        // ⭐ 有 logic → 用 logic 判定
        const r = executeCustomLogic(problem.logic, problem.ans, sub.answer);
        score = r.score;
        comment = r.comment;
        systemError = r.systemError;
        correct = !systemError && score === 100;
      } else {
        // 無數值比對（原邏輯）
        const isValid = s => s !== '' && Number.isFinite(Number(s));
        if (!isValid(ansStr.trim())) systemError = true;
        else if (!isValid(userAns.trim())) systemError = true;
        else {
          const ansNum = Number(ansStr);
          const userNum = Number(userAns);
          correct = Math.abs(userNum - ansNum) < 1e-6;
          score = correct ? 100 : 0;
        }
      }

      // ⭐ 更新 submission：marked、score、comment、correct、systemError 一起寫
      await db.collection('submissions').updateOne(
        { _id: oid },
        {
          $set: {
            correct,
            systemError,
            marked: true,
            score,
            comment,
            markedAt: new Date()
          }
        }
      );

      // ⭐ 更新 userstats（用點號路徑原子寫，避免並發覆蓋）
      const username = sub.username;
      const problemId = sub.problemId;
      const statsCol = db.collection('userstats');

      const stats = await statsCol.findOne({ username }, { projection: { states: 1 } });
      const currentState = stats?.states?.[problemId];

      // 只有「未 passed」才更新（避免降級已 AC 的狀態）
      if (currentState !== 'passed') {
        const newState = correct ? 'passed' : 'failed';
        await statsCol.updateOne(
          { username },
          { $set: { [`states.${problemId}`]: newState } },
          { upsert: true }
        );
      }

      return res.status(200).json({
        success: true,
        correct,
        systemError,
        score,
        comment,
        message: 'Rejudged'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---------- 學生模式（預設） ----------
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const {
    page = '1',
    limit = '50',
    user: qUser,
    username: qUsername,
    problem: qProblem,
    problem_id: qProblemId,
    result: qResult,
    all,
    includeHeader
  } = req.query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, parseInt(limit) || 50);

  try {
    const isAllMode = all === '1' || (!qUser && !qUsername && !qProblem && !qProblemId);
    const filter = {};

    const targetUser = qUser || qUsername;
    if (targetUser) filter.username = targetUser;
    else if (!isAllMode) filter.username = decoded.username;

    const targetProblem = qProblem || qProblemId;
    if (targetProblem) filter.problemId = { $in: buildProblemIdFilter([targetProblem]) };

    if (qResult) {
      const sf = buildStatusFilter(qResult);
      if (sf) Object.assign(filter, sf);
    }

    // 公開題目權限
    if (!isAdmin) {
      const allowedSet = await getPublicProblemIds(db);
      if (!allowedSet.size) {
        const header = includeHeader === '1' ? await buildHeader(db, targetProblem, targetUser) : null;
        return res.status(200).json({
          success: true, submissions: [], total: 0, page: pageNum, limit: limitNum, totalPages: 0,
          ...(header ? { header } : {})
        });
      }
      if (filter.problemId) {
        const requested = filter.problemId.$in.filter(id => allowedSet.has(String(id)));
        if (!requested.length) {
          const header = includeHeader === '1' ? await buildHeader(db, targetProblem, targetUser) : null;
          return res.status(200).json({
            success: true, submissions: [], total: 0, page: pageNum, limit: limitNum, totalPages: 0,
            ...(header ? { header } : {})
          });
        }
        filter.problemId = { $in: buildProblemIdFilter(requested) };
      } else {
        const allIds = [];
        allowedSet.forEach(id => {
          allIds.push(id);
          if (!isNaN(Number(id))) allIds.push(Number(id));
        });
        filter.problemId = { $in: allIds };
      }
    }

    // 並行：count + list + userstats + header
    const [total, submissions, userStats, header] = await Promise.all([
      db.collection('submissions').countDocuments(filter),
      db.collection('submissions').find(filter, {
        projection: {
          subid: 1, username: 1, problemId: 1, type: 1, timestamp: 1,
          correct: 1, systemError: 1, marked: 1, score: 1, answer: 1
        }
      }).sort({ timestamp: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).toArray(),
      db.collection('userstats').findOne(
        { username: decoded.username },
        { projection: { states: 1, _id: 0 } }
      ),
      includeHeader === '1' ? buildHeader(db, targetProblem, targetUser) : Promise.resolve(null)
    ]);

    // 並行：題目名稱 + displayName
    const problemIds = [...new Set(submissions.map(s => s.problemId))];
    const usernames = [...new Set(submissions.map(s => s.username))];
    const [problems, users] = await Promise.all([
      db.collection('problems').find({ id: { $in: problemIds } }, { projection: { id: 1, name: 1, _id: 0 } }).toArray(),
      db.collection('users').find({ username: { $in: usernames } }, { projection: { username: 1, displayName: 1, _id: 0 } }).toArray()
    ]);
    const nameMap = Object.fromEntries(problems.map(p => [p.id, p.name]));
    const displayMap = Object.fromEntries(users.map(u => [u.username, u.displayName || u.username]));

    const passedSet = new Set();
    if (userStats?.states) {
      Object.entries(userStats.states).forEach(([pid, state]) => {
        if (state === 'passed') passedSet.add(pid);
      });
    }

    const enriched = submissions.map(s => {
      const status = deriveStatus(s);
      const isOwn = s.username === decoded.username;
      const isPassed = passedSet.has(String(s.problemId));

      let answerDisplay = '';
      let answerHidden = false;
      if (s.type === 'image') {
        answerDisplay = '';
      } else if (isAdmin || isOwn || isPassed) {
        answerDisplay = s.answer;
      } else {
        answerDisplay = 'Hidden';
        answerHidden = true;
      }

      return {
        subid: s.subid,
        username: s.username,
        displayName: displayMap[s.username] || s.username,
        problemId: s.problemId,
        problemName: nameMap[s.problemId] || `Problem #${s.problemId}`,
        type: s.type,
        timestamp: s.timestamp,
        answer: answerDisplay,
        answerHidden,
        status
      };
    });

    return res.status(200).json({
      success: true,
      submissions: enriched,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      ...(header ? { header } : {})
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
}