// api/submissions.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { runCustomLogic } from '../lib/logic-runner.js';
import { ObjectId } from 'mongodb';
import { wrapHandler } from '../lib/errors.js';
import { auditLog } from '../lib/audit.js';
// ⭐ 移除 executeCustomLogic 死函數（原使用 vm，但 import 被註釋 → 一旦被呼叫就 ReferenceError）

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

// =============== 共用 ===============
function isAdminUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

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
        .findOne(
          { username },
          { projection: { username: 1, displayName: 1, realName: 1, pfp: 1, _id: 0 } }
        )
        .then(u => {
          if (u) header.user = {
            username: u.username,
            displayName: u.displayName || u.username,
            realName: u.realName || '',
            pfp: u.pfp || '',
          };
        })
        .catch(() => {})
    );
  }
  await Promise.all(tasks);
  return header;
}

// =============== 主處理器 ===============
async function handler(req, res) {
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
            answer: 1, image: 1, markedAt: 1, _id: 0,
            // ⭐ 新增下面这三个
            judgingMs: 1,      // AI 耗时
            tokenUsage: 1,     // Token 消耗
            usedModel: 1       // 使用的模型
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
      markedAt: sub.markedAt || null,
      // ⭐ 返回给前端
      judgingMs: sub.judgingMs || null,
      tokenUsage: sub.tokenUsage || 0,
      usedModel: sub.usedModel || null
    };

    if (sub.type === 'image') {
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

    // 谁能举报这条提交：不是本人、且提交者不是 root
    // （管理员举报自己或 root 的提交没有意义，直接在前端隐藏、后端拒绝）
    const ownerDoc = await db.collection('users').findOne(
      { username: result.username },
      { projection: { role: 1 } }
    );
    const canReport = result.username !== decoded.username && ownerDoc?.role !== 'root';

    return res.status(200).json({
      success: true,
      submission: result,
      problemName,
      attempts,
      canSeeContent,
      isOwner,
      canReport,
      isAdmin,
    });
  }
  // ---------- 管理员：标记违规 (Flag) ----------
  if (req.query.action === 'flag') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Admin only' });

    const { subid, flagType } = req.body || {}; // flagType: 'red' | 'yellow'
    if (!subid || !flagType) return res.status(400).json({ success: false, message: 'Missing subid or flagType' });

    const sub = await db.collection('submissions').findOne({ subid });
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

    // 1. 标记违规状态
    await db.collection('submissions').updateOne(
      { subid },
      { 
        $set: { 
          marked: true, 
          score: 0, 
          status: 'Violation', // 前端 computeStatus 需要处理这个状态
          flagged: true,
          flagType: flagType,
          comment: `[${flagType.toUpperCase()} CARD] Flagged by Admin.`
        } 
      }
    );

    // 2. 清除用户在此题的状态 (如果是 passed 或 failed，直接 unset 掉，相当于回到未做状态)
    const statsCol = db.collection('userstats');
    await statsCol.updateOne(
      { username: sub.username },
      { $unset: { [`states.${sub.problemId}`]: '' } }
    );

    return res.status(200).json({ success: true });
  }

  // ---------- 举报一条提交 ----------
  // 前端只在「不是本人、且提交者不是 root」时显示按钮，这里再挡一次。
  if (req.query.action === 'report') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { subid, reason } = req.body || {};
    if (!subid) return res.status(400).json({ success: false, message: 'Missing subid', code: 'MISSING_PARAM' });

    const sub = await db.collection('submissions').findOne({ subid });
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found', code: 'SUBMISSION_NOT_FOUND' });

    // 加固 1：不能举报自己的提交
    if (sub.username === decoded.username) {
      return res.status(403).json({
        success: false, code: 'CANNOT_REPORT_SELF',
        message: "You cannot report your own submission",
      });
    }

    // 加固 2：不能举报 root 的提交
    const owner = await db.collection('users').findOne(
      { username: sub.username }, { projection: { role: 1 } }
    );
    if (owner?.role === 'root') {
      return res.status(403).json({
        success: false, code: 'CANNOT_REPORT_ROOT',
        message: "You cannot report a submission made by root",
      });
    }

    // 同一个人对同一条提交只记一次
    const dup = await db.collection('submission_reports').findOne({ subid, by: decoded.username });
    if (dup) {
      return res.status(409).json({
        success: false, code: 'ALREADY_REPORTED',
        message: 'You already reported this submission',
      });
    }

    await db.collection('submission_reports').insertOne({
      subid,
      problemId: sub.problemId,
      submissionOwner: sub.username,
      by: decoded.username,
      reason: String(reason || '').slice(0, 1000),
      createdAt: new Date(),
      resolved: false,
    });

    await auditLog(db, 'submission_report', {
      subid, problemId: sub.problemId, submissionOwner: sub.username,
    }, decoded.username, 'info').catch(() => {});

    return res.status(201).json({ success: true, message: 'Report submitted' });
  }

  // ---------- 管理员：删除一条提交 ----------
  if (req.query.action === 'delete') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Admin only', code: 'NOT_ADMIN' });

    const { subid } = req.body || {};
    if (!subid) return res.status(400).json({ success: false, message: 'Missing subid', code: 'MISSING_PARAM' });

    const sub = await db.collection('submissions').findOne({ subid });
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found', code: 'SUBMISSION_NOT_FOUND' });

    await db.collection('submissions').deleteOne({ subid });

    // 删完之后状态要重新判断：如果这题还有其他 AC，保持 passed；否则退回未做
    const stillAC = await db.collection('submissions').countDocuments({
      username: sub.username,
      problemId: sub.problemId,
      $or: [
        { type: 'image', marked: true, score: 100 },
        { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
      ],
    });

    if (stillAC === 0) {
      await db.collection('userstats').updateOne(
        { username: sub.username },
        { $unset: { [`states.${sub.problemId}`]: '' } }
      );
    }

    await auditLog(db, 'submission_delete', {
      subid, owner: sub.username, problemId: sub.problemId,
    }, decoded.username, 'warn').catch(() => {});

    return res.status(200).json({ success: true });
  }
  if (req.query.admin === '1') {
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Admin only' });

    // GET：列表
    if (req.method === 'GET') {
      const {
        problem_id, status,
        user, username: qUsername,     // ⭐ 保持 user 作為主鍵
        page = '1', limit = '50'
      } = req.query;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, parseInt(limit) || 50);

      const filter = {};
      // ⭐ FIX：用 user（不是 qUser）
      const targetUser = String(user || qUsername || '').trim().slice(0, 50);
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
        const r = await runCustomLogic(problem.logic, problem.ans, sub.answer);
        score = r.score;
        comment = r.comment;
        systemError = r.systemError;
        correct = !systemError && score === 100;
      } else {
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

      const username = sub.username;
      const problemId = sub.problemId;
      const statsCol = db.collection('userstats');

      const stats = await statsCol.findOne({ username }, { projection: { states: 1 } });
      const currentState = stats?.states?.[problemId];

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

    if (!isAdmin) {
      const allowedSet = await getPublicProblemIds(db);
      if (!allowedSet.size) {
        const header = includeHeader === '1' ? await buildHeader(db, targetProblem, targetUser) : null;
        return res.status(200).json({
          success: true, submissions: [], page: pageNum, limit: limitNum, hasMore: false,
          ...(header ? { header } : {})
        });
      }
      if (filter.problemId) {
        const requested = filter.problemId.$in.filter(id => allowedSet.has(String(id)));
        if (!requested.length) {
          const header = includeHeader === '1' ? await buildHeader(db, targetProblem, targetUser) : null;
          return res.status(200).json({
            success: true, submissions: [], page: pageNum, limit: limitNum, hasMore: false,
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

    // ⭐ 去掉 countDocuments（O(N)），改用 limit+1 判斷 hasMore
    const [rawSubs, userStats, header] = await Promise.all([
      db.collection('submissions').find(filter, {
        projection: {
          subid: 1, username: 1, problemId: 1, type: 1, timestamp: 1,
          correct: 1, systemError: 1, marked: 1, score: 1, answer: 1
        }
      }).sort({ timestamp: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum + 1)
        .toArray(),
      db.collection('userstats').findOne(
        { username: decoded.username },
        { projection: { states: 1, _id: 0 } }
      ),
      includeHeader === '1' ? buildHeader(db, targetProblem, targetUser) : Promise.resolve(null)
    ]);

    const hasMore = rawSubs.length > limitNum;
    const submissions = hasMore ? rawSubs.slice(0, limitNum) : rawSubs;

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
      page: pageNum,
      limit: limitNum,
      hasMore,
      ...(header ? { header } : {})
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);