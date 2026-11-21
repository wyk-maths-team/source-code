// api/admin-grading.js
//
// 只读：AI 批改的观察面板。
//
// 两个数据源，用途不同：
//   grading_history   —— 永久记录，只存元数据（耗时 / 模型 / 分数 / 难度）。
//                        回答「这类题通常批多久」，也是将来算预期时间的依据。
//   steps_grading_tasks —— 实时队列，带失败信息和重试次数，会被 reaper 收尸。
//                        回答「现在有什么卡住了」。
//
// 默认给 history：它不会丢，而且条目多得多（1898 vs 现在的几条）。
//
// 不提供任何写操作。重试属于批改端点，收尸属于 cron。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { COLLECTION as HISTORY, durationByDifficulty } from '../lib/grading-history.js';

const MAX_LIMIT = 200;
const STATUSES = ['pending', 'processing', 'done', 'error'];

function isAdmin(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

function clampInt(v, def, min, max) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

async function listHistory(db, req, limit) {
  const filter = { durationMs: { $gt: 0 } };

  if (req.query.username) filter.username = String(req.query.username).slice(0, 40);
  if (req.query.problemId) filter.problemId = String(req.query.problemId).slice(0, 40);
  if (req.query.type) filter.type = String(req.query.type).slice(0, 20);

  if (req.query.since) {
    const d = new Date(req.query.since);
    if (!Number.isNaN(d.getTime())) filter.submittedAt = { $gte: d };
  }
  if (req.query.before) {
    const d = new Date(req.query.before);
    if (!Number.isNaN(d.getTime())) filter.submittedAt = { ...(filter.submittedAt || {}), $lt: d };
  }

  const rows = await db.collection(HISTORY)
    .find(filter, {
      projection: {
        _id: 0, subid: 1, username: 1, problemId: 1, type: 1, difficulty: 1,
        model: 1, durationMs: 1, score: 1, status: 1, tokenUsage: 1, submittedAt: 1,
      },
    })
    .sort({ submittedAt: -1 })
    .limit(limit)
    .toArray();

  const items = rows.map(r => ({
    id: r.subid,
    username: r.username,
    problemId: r.problemId,
    type: r.type,
    difficulty: r.difficulty,
    status: 'done',
    model: r.model,
    elapsedMs: r.durationMs,
    score: r.score,
    createdAt: r.submittedAt,
    source: 'history',
  }));

  const nextBefore = rows.length === limit && rows.length
    ? new Date(rows[rows.length - 1].submittedAt).toISOString()
    : null;

  return { items, nextBefore };
}

async function listQueue(db, req, limit) {
  const filter = {};
  if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
  if (req.query.username) filter.username = String(req.query.username).slice(0, 40);
  if (req.query.problemId) filter.problemId = String(req.query.problemId).slice(0, 40);

  if (req.query.since) {
    const d = new Date(req.query.since);
    if (!Number.isNaN(d.getTime())) filter.createdAt = { $gte: d };
  }
  if (req.query.before) {
    const d = new Date(req.query.before);
    if (!Number.isNaN(d.getTime())) filter.createdAt = { ...(filter.createdAt || {}), $lt: d };
  }

  const rows = await db.collection('steps_grading_tasks')
    .find(filter, {
      projection: {
        taskId: 1, username: 1, problemId: 1, status: 1, type: 1,
        difficulty: 1, apiAttempts: 1, elapsedMs: 1, usedModel: 1, handledBy: 1,
        error: 1, createdAt: 1, completedAt: 1, reapedAt: 1, subid: 1, _id: 0,
      },
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  const items = rows.map(r => ({
    id: r.taskId,
    username: r.username,
    problemId: r.problemId,
    type: r.type || 'steps',
    difficulty: r.difficulty,
    status: r.status,
    model: r.usedModel || r.handledBy,
    elapsedMs: r.elapsedMs,
    attempts: r.apiAttempts,
    error: r.error,
    reaped: !!r.reapedAt,
    createdAt: r.createdAt,
    source: 'queue',
  }));

  const nextBefore = rows.length === limit && rows.length
    ? new Date(rows[rows.length - 1].createdAt).toISOString()
    : null;

  return { items, nextBefore };
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const user = await verifyToken(req);
  if (!isAdmin(user)) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const db = await connectToDatabase();
  const action = req.query.action || 'list';

  // ── 列表 ──
  if (action === 'list') {
    const limit = clampInt(req.query.limit, 50, 1, MAX_LIMIT);
    const source = req.query.source === 'queue' ? 'queue' : 'history';
    const out = source === 'queue'
      ? await listQueue(db, req, limit)
      : await listHistory(db, req, limit);
    return res.status(200).json({ success: true, source, ...out, limit });
  }

  // ── 统计 ──
  if (action === 'stats') {
    const since24 = new Date(Date.now() - 24 * 3600_000);

    const [histTotal, hist7d, byDifficulty, queueTotals, queue24, topErrors] = await Promise.all([
      db.collection(HISTORY).estimatedDocumentCount(),
      db.collection(HISTORY).countDocuments({ submittedAt: { $gte: new Date(Date.now() - 7 * 86400_000) } }),
      durationByDifficulty(db, { days: 30 }).catch(async () => {
        // $percentile 需要 MongoDB 7；拿不到就退回平均值
        const rows = await db.collection(HISTORY).aggregate([
          { $match: { submittedAt: { $gte: new Date(Date.now() - 30 * 86400_000) }, durationMs: { $gt: 0 }, difficulty: { $ne: null } } },
          { $group: { _id: '$difficulty', n: { $sum: 1 }, avgMs: { $avg: '$durationMs' } } },
          { $sort: { _id: 1 } },
        ]).toArray();
        return rows.map(r => ({ difficulty: r._id, n: r.n, avgMs: Math.round(r.avgMs), p50Ms: null, p90Ms: null }));
      }),
      db.collection('steps_grading_tasks').aggregate([
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]).toArray(),
      db.collection('steps_grading_tasks').aggregate([
        { $match: { createdAt: { $gte: since24 } } },
        { $group: { _id: '$status', n: { $sum: 1 }, avgMs: { $avg: '$elapsedMs' } } },
      ]).toArray(),
      db.collection('steps_grading_tasks').aggregate([
        { $match: { status: 'error', createdAt: { $gte: since24 } } },
        { $project: { first: { $arrayElemAt: [{ $split: [{ $ifNull: ['$error', 'unknown'] }, ':'] }, 0] } } },
        { $group: { _id: '$first', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 6 },
      ]).toArray(),
    ]);

    const q24 = Object.fromEntries(queue24.map(r => [r._id, r.n]));
    const qDone = q24.done || 0;
    const qErr = q24.error || 0;
    const judged = qDone + qErr;

    return res.status(200).json({
      success: true,
      history: {
        total: histTotal,
        last7d: hist7d,
        byDifficulty,
      },
      queue: {
        totals: Object.fromEntries(queueTotals.map(r => [r._id, r.n])),
        last24h: {
          total: queue24.reduce((n, r) => n + r.n, 0),
          done: qDone,
          error: qErr,
          successRate: judged ? Math.round((qDone / judged) * 100) : null,
          avgMsDone: Math.round((queue24.find(r => r._id === 'done') || {}).avgMs || 0),
        },
        topErrors,
      },
    });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

// 只读面板：不参与并发闸门，服务器忙的时候恰恰最需要看它
export default wrapHandler(handler, { gate: false });
