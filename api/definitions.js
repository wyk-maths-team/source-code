// api/definitions.js
//
// tutor 里 AI 给出的「定义」—— 学生点👍 才入库。
//
// 为什么只在点赞后存：模型每答一次都会顺手写出定义，全存下来就是一堆
// 重复的草稿。学生认可的那一条才有价值，也顺便当成一次质量信号。
//
//   POST /api/definitions  { body, problemId }   → 入库 / 递增
//   GET  /api/definitions?term=xxx               → 查已有定义

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { applyRateLimit } from '../lib/rateLimit.js';

const MAX_BODY = 1200;

function keyOf(body) {
  // 同一段定义去重：忽略空白与大小写
  return String(body || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!decoded) return sendError(req, res, 'UNAUTHORIZED', 'Unauthorized');
  const db = await connectToDatabase();

  if (req.method === 'GET') {
    const term = String((req.query && req.query.term) || '').trim();
    if (!term) return sendError(req, res, 'BAD_REQUEST', 'Missing term');
    const docs = await db.collection('definitions')
      .find({ key: { $regex: term.toLowerCase().replace(/[.*+?^\${}()|[\]\\]/g, '\\$&') } },
        { projection: { _id: 0, body: 1, upvotes: 1, at: 1, problemId: 1 } })
      .sort({ upvotes: -1 })
      .limit(5)
      .toArray();
    return res.status(200).json({ success: true, definitions: docs });
  }

  if (req.method !== 'POST') return sendError(req, res, 'BAD_REQUEST', 'Method not allowed');

  if (!(await applyRateLimit(req, res, {
    name: 'definitions',
    key: 'u:' + decoded.username,
    max: 20,
    windowMs: 60_000,
    banMs: 60_000,
  }))) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const text = String(body.body || '').trim().slice(0, MAX_BODY);
  if (text.length < 4) return sendError(req, res, 'BAD_REQUEST', 'Definition too short');

  const problemId = String(body.problemId || '').trim().slice(0, 40);
  const key = keyOf(text);
  const now = new Date();

  // 已有同一条 → 记一次赞，不重复存
  const existing = await db.collection('definitions').findOne({ key });
  if (existing) {
    await db.collection('definitions').updateOne(
      { key },
      { $inc: { upvotes: 1 }, $set: { lastAt: now }, $addToSet: { voters: decoded.username } }
    );
    return res.status(200).json({ success: true, duplicate: true, upvotes: (existing.upvotes || 1) + 1 });
  }

  await db.collection('definitions').insertOne({
    key,
    term,
    body: text,
    problemId,
    by: decoded.username,
    at: now,
    upvotes: 1,
    voters: [decoded.username],
  });

  return res.status(201).json({ success: true, created: true, upvotes: 1 });
}

export default wrapHandler(handler);
