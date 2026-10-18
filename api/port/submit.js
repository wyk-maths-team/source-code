// api/port/submit.js
// POST /api/port/submit
// body: { problemId, subject, steps, images: [...] }
import { connectToDatabase } from '../_pdb.js';
import { portAuth } from './_auth.js';
import crypto from 'crypto';
import { wrapHandler } from '../../lib/errors.js';

const MAX_STEPS = 10_000;
const MAX_IMAGES = 10;
const TASK_TTL_MS = 30 * 60_000;

function genId(prefix) {
  return prefix + crypto.randomBytes(8).toString('hex');
}

async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { problemId, subject, steps = '', images = [] } = req.body || {};

  if (!problemId || !subject) {
    return res.status(400).json({ success: false, message: 'Missing problemId or subject' });
  }
  if (!Array.isArray(images) || images.length > MAX_IMAGES) {
    return res.status(400).json({ success: false, message: `Max ${MAX_IMAGES} images` });
  }
  const stepsStr = String(steps).slice(0, MAX_STEPS);
  if (!stepsStr.trim() && images.length === 0) {
    return res.status(400).json({ success: false, message: 'Provide steps or images' });
  }

  const db = await connectToDatabase();

  // 題目必須存在
  const problem = await db.collection('port_problems').findOne(
    { id: String(problemId) },
    { projection: { _id: 0 } }
  );
  if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

  // 讀 chatUrl 快照
  const setting = await db.collection('port_settings').findOne({ _key: 'currentChatUrl' });
  const chatUrl = setting?.value || '';

  const taskId = genId('PT');
  const submissionId = genId('PS');
  const now = new Date();

  // 建 task
  await db.collection('port_tasks').insertOne({
    taskId,
    submissionId,
    username: decoded.username,
    subject: String(subject),
    problemId: String(problemId),
    statement: problem.statement || '',
    answer: String(problem.answer || ''),
    maxScore: Number.isFinite(problem.maxScore) ? problem.maxScore : null,
    steps: stepsStr,
    images: images.map(String),
    status: 'pending',
    result: null,
    chatUrl,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TASK_TTL_MS),
  });

  // 預建 submission（status: pending）
  await db.collection('port_submissions').insertOne({
    submissionId,
    username: decoded.username,
    subject: String(subject),
    problemId: String(problemId),
    steps: stepsStr,
    images: images.map(String),
    score: null,
    maxScore: Number.isFinite(problem.maxScore) ? problem.maxScore : null,
    comment: '',
    details: null,
    taskId,
    status: 'pending',
    createdAt: now,
    gradedAt: null,
  });

  return res.status(202).json({ success: true, taskId, submissionId });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);