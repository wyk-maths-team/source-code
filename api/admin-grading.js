// api/admin-grading.js
//
// 只读：AI 批改队列的观察面板。
//
// 为什么需要它：批改失败现在会留下一条 error 记录，但没有任何地方能看到。
// 模型换了、额度打光了、上游在抽风——都得等学生抱怨才知道。
//
// 不提供任何写操作。重试逻辑在批改端点里，收尸在 cron 里，
// 这里只负责让人看见发生了什么。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

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
  const col = db.collection('steps_grading_tasks');
  const action = req.query.action || 'list';

  // ── 列表 ──
  if (action === 'list') {
    const limit = clampInt(req.query.limit, 50, 1, MAX_LIMIT);
    const filter = {};

    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.username) filter.username = String(req.query.username).slice(0, 40);
    if (req.query.problemId) filter.problemId = String(req.query.problemId).slice(0, 40);

    if (req.query.since) {
      const d = new Date(req.query.since);
      if (!Number.isNaN(d.getTime())) filter.createdAt = { $gte: d };
    }

    // 游标分页：比 skip 便宜，且翻页时不会因为新数据进来而错位
    if (req.query.before) {
      const d = new Date(req.query.before);
      if (!Number.isNaN(d.getTime())) filter.createdAt = { ...(filter.createdAt || {}), $lt: d };
    }

    const rows = await col
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

    const nextBefore = rows.length === limit && rows.length
      ? new Date(rows[rows.length - 1].createdAt).toISOString()
      : null;

    return res.status(200).json({ success: true, items: rows, nextBefore, limit });
  }

  // ── 统计 ──
  if (action === 'stats') {
    const since24 = new Date(Date.now() - 24 * 3600_000);
    const since7d = new Date(Date.now() - 7 * 86400_000);

    const [byStatus, last24h, last7d, slowest, topErrors] = await Promise.all([
      col.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]).toArray(),
      col.aggregate([
        { $match: { createdAt: { $gte: since24 } } },
        { $group: {
            _id: '$status',
            n: { $sum: 1 },
            avgMs: { $avg: '$elapsedMs' },
        } },
      ]).toArray(),
      col.aggregate([
        { $match: { createdAt: { $gte: since7d } } },
        { $group: {
            _id: { status: '$status', difficulty: { $ifNull: ['$difficulty', 0] } },
            n: { $sum: 1 },
            avgMs: { $avg: '$elapsedMs' },
        } },
      ]).toArray(),
      col.aggregate([
        { $match: { status: 'done', elapsedMs: { $gt: 0 }, createdAt: { $gte: since7d } } },
        { $sort: { elapsedMs: -1 } },
        { $limit: 5 },
        { $project: { taskId: 1, username: 1, problemId: 1, elapsedMs: 1, usedModel: 1, _id: 0 } },
      ]).toArray(),
      col.aggregate([
        { $match: { status: 'error', createdAt: { $gte: since7d } } },
        { $project: { first: { $arrayElemAt: [{ $split: [{ $ifNull: ['$error', 'unknown'] }, ':'] }, 0] } } },
        { $group: { _id: '$first', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 6 },
      ]).toArray(),
    ]);

    const flat = (arr, key = '_id') => Object.fromEntries(arr.map(a => [a[key], a.n]));
    const d24 = byStatus.reduce((n, s) => n + s.n, 0);
    const d24map = flat(last24h);

    return res.status(200).json({
      success: true,
      totals: flat(byStatus),
      last24h: {
        total: last24h.reduce((n, s) => n + s.n, 0),
        byStatus: d24map,
        avgMsDone: Math.round((last24h.find(s => s._id === 'done') || {}).avgMs || 0),
        avgMsError: Math.round((last24h.find(s => s._id === 'error') || {}).avgMs || 0),
      },
      last7d_byDifficulty: last7d
        .filter(r => r._id.difficulty != null)
        .map(r => ({
          difficulty: r._id.difficulty,
          status: r._id.status,
          n: r.n,
          avgMs: Math.round(r.avgMs || 0),
        }))
        .sort((a, b) => a.difficulty - b.difficulty || a.status.localeCompare(b.status)),
      slowest,
      topErrors,
      allTime: d24,
    });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

// 只读面板：不参与并发闸门，服务器忙的时候恰恰最需要看它
export default wrapHandler(handler, { gate: false });
