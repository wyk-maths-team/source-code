// api/admin-lab.js
//
// /admin/lab 的后端：给评测模块提供「随机样本」与「结果存档」。
//
// 为什么不在这里串行跑 N 次模型调用：一次难度评估要 5-10 秒，N=20 就会
// 撞上函数时限，而且中间没有任何进度反馈。所以这里只负责抽样，前端逐题
// 调 /api/admin-difficulty，进度和统计都在浏览器里算，随时可中断。
//
// 目前支持的模块：
//   difficulty  —— 抽样题目，逐题让 AI 重估难度，与人工标定对拍
//   similarity  —— 抽样题目，取 similar 前几名，看共享技能覆盖率（不烧 token）

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler, sendError } from '../lib/errors.js';

const MAX_SAMPLE = 100;

function adminOnly(req, res, decoded) {
  if (!decoded) { sendError(req, res, 'UNAUTHORIZED', 'Unauthorized'); return false; }
  if (!['admin', 'root'].includes(decoded.role)) {
    sendError(req, res, 'FORBIDDEN', 'Administrators only');
    return false;
  }
  return true;
}

async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!adminOnly(req, res, decoded)) return;

  const db = await connectToDatabase();
  const action = (req.query && req.query.action) || 'sample';

  // ── 随机抽样 ──
  if (action === 'sample' && req.method === 'GET') {
    const n = Math.max(1, Math.min(MAX_SAMPLE, Number(req.query.n) || 10));
    const module = String(req.query.module || 'difficulty');

    const match = {};
    if (module === 'difficulty') {
      // 0 分是「未标定」不是「最容易」，对拍时不能当参照
      match.difficulty = { $gt: 0 };
      if (req.query.answer === '1') match.ans = { $nin: ['', null] };
    }
    const band = String(req.query.band || '');
    if (/^b[0-8]$/.test(band)) {
      const idx = Number(band.slice(1));
      match.difficulty = { $gte: idx, $lt: Math.min(9.31, idx + 1) };
    }
    const source = String(req.query.source || '').trim();
    if (source) match.tags = source;

    const docs = await db.collection('problems').aggregate([
      { $match: match },
      { $sample: { size: n } },
      { $project: { id: 1, name: 1, difficulty: 1, tags: 1, aws: 1, ans: 1, _id: 0 } },
    ]).toArray();

    return res.status(200).json({
      success: true,
      module,
      problems: docs.map((d) => ({
        id: d.id,
        name: d.name || '',
        difficulty: Number(d.difficulty) || 0,
        tags: Array.isArray(d.tags) ? d.tags.slice(0, 8) : [],
        hasAnswer: String(d.ans ?? '').trim().length > 0,
      })),
    });
  }

  // ── 存档一次评测结果（便于以后对比不同 prompt / 模型）──
  if (action === 'save' && req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
    const module = String(body.module || 'difficulty').slice(0, 40);
    const stats = body.stats && typeof body.stats === 'object' ? body.stats : null;
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_SAMPLE) : [];
    if (!stats || !rows.length) return sendError(req, res, 'BAD_REQUEST', 'Nothing to save');

    await db.collection('lab_runs').insertOne({
      module,
      stats,
      rows,
      n: rows.length,
      by: decoded.username,
      at: new Date(),
    });
    const total = await db.collection('lab_runs').countDocuments({ module });
    return res.status(200).json({ success: true, saved: true, total });
  }

  // ── 历史记录 ──
  if (action === 'history' && req.method === 'GET') {
    const module = String(req.query.module || 'difficulty');
    const rows = await db.collection('lab_runs')
      .find({ module }, { projection: { rows: 0 } })
      .sort({ at: -1 })
      .limit(20)
      .toArray();
    return res.status(200).json({ success: true, runs: rows });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

export default wrapHandler(handler);
