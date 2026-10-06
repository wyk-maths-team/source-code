// api/steps-grade.js
// AI 步驟批改 —— 非同步任務 + 輪詢
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import crypto from 'crypto';

const UPSTREAM_URL =
  process.env.STEPS_GRADE_UPSTREAM ||
  process.env.EX_GRADE_UPSTREAM ||
  'https://hartford-tion-angel-bet.trycloudflare.com';

const MAX_STEPS_LEN     = 1000;
const UPSTREAM_TIMEOUT  = 120_000;       // 2 分鐘
const TASK_TTL_MS       = 30 * 60_000;   // 任務保留 30 分鐘

function genTaskId() {
  return 'SGT' + crypto.randomBytes(8).toString('hex');
}

// 去 HTML 標籤，保留 $...$ 之類的 LaTeX
function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();

  // ═══════════════ POST：建立批改任務 ═══════════════
  if (req.method === 'POST') {
    const { problemId, steps } = req.body || {};

    if (!problemId || typeof problemId !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing problemId' });
    }
    if (!steps || typeof steps !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing steps' });
    }
    const trimmed = steps.trim();
    if (!trimmed) {
      return res.status(400).json({ success: false, message: 'Steps is empty' });
    }
    if (trimmed.length > MAX_STEPS_LEN) {
      return res.status(400).json({
        success: false,
        message: `Steps too long (${trimmed.length}/${MAX_STEPS_LEN})`,
      });
    }

    // 取題目（需含 statement + ans 才能批改）
    const problem = await db.collection('problems').findOne(
      { id: problemId },
      { projection: { id: 1, name: 1, statement: 1, ans: 1, _id: 0 } }
    );
    if (!problem) {
      return res.status(404).json({ success: false, message: 'Problem not found' });
    }

    // 已 AC 過的題目不允許重複批改
    // const stats = await db.collection('userstats').findOne(
    //   { username: decoded.username },
    //   { projection: { states: 1, _id: 0 } }
    // );
    // if (stats?.states?.[problemId] === 'passed') {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'You have already passed this problem',
    //   });
    // }

    const taskId = genTaskId();
    const now = new Date();

    await db.collection('steps_grading_tasks').insertOne({
      taskId,
      username: decoded.username,
      problemId,
      steps: trimmed,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + TASK_TTL_MS),
    });

    // 非阻塞觸發
    const work = runGrading(db, {
      taskId,
      username: decoded.username,
      problem,
      steps: trimmed,
    }).catch(e => console.error('[steps-grade] bg error:', e));

    // 盡量讓 Vercel 保留執行（需要 @vercel/functions）
    try {
      const { waitUntil } = await import('@vercel/functions');
      if (typeof waitUntil === 'function') waitUntil(work);
    } catch { /* 沒裝 → fire-and-forget */ }

    return res.status(202).json({ success: true, taskId });
  }

  // ═══════════════ GET：輪詢狀態 ═══════════════
  if (req.method === 'GET') {
    const { taskId } = req.query;
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Missing taskId' });
    }

    const task = await db.collection('steps_grading_tasks').findOne({ taskId });
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }
    if (task.username !== decoded.username &&
        decoded.role !== 'admin' && decoded.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Not yours' });
    }

    if (task.status === 'pending') {
      return res.status(200).json({ success: true, status: 'pending' });
    }
    if (task.status === 'error') {
      return res.status(200).json({
        success: true,
        status: 'error',
        message: task.error || 'Grading failed',
      });
    }
    return res.status(200).json({
      success: true,
      status: 'done',
      result: task.result,
      subid: task.subid || null,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ═══════════════ 背景批改流程 ═══════════════
async function runGrading(db, { taskId, username, problem, steps }) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);

    let upstream;
    try {
      upstream = await fetch(UPSTREAM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem_id: problem.id,
          statement: stripHtml(problem.statement),
          reference_answer: String(problem.ans ?? ''),
          student_steps: steps,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!upstream.ok) {
      const t = await upstream.text().catch(() => '');
      throw new Error(`Upstream ${upstream.status}: ${t.slice(0, 200)}`);
    }

    const data = await upstream.json();

    let score = Number(data.score);
    if (!Number.isFinite(score)) score = 0;
    score = Math.max(0, Math.min(100, Math.round(score)));

    const comment   = String(data.comment || '').slice(0, 500);
    const breakdown = data.breakdown || null;

    // 寫入 submissions
    const subid = 'SGS' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    await db.collection('submissions').insertOne({
      subid,
      username,
      problemId: problem.id,
      type: 'steps',
      timestamp: new Date(),
      correct: score === 100,
      systemError: false,
      marked: true,
      score,
      comment,
      answer: steps,
      image: '',
      drawing: '',
      markedAt: new Date(),
      aiGraded: true,
    });

    // 更新 userstats
    const statsCol = db.collection('userstats');
    await statsCol.updateOne(
      { username },
      { $setOnInsert: { username, states: {} } },
      { upsert: true }
    );
    if (score === 100) {
      await statsCol.updateOne(
        { username },
        { $set: { [`states.${problem.id}`]: 'passed' } }
      );
    } else {
      await statsCol.updateOne(
        { username, [`states.${problem.id}`]: { $ne: 'passed' } },
        { $set: { [`states.${problem.id}`]: 'failed' } }
      );
    }

    // 更新任務
    await db.collection('steps_grading_tasks').updateOne(
      { taskId },
      {
        $set: {
          status: 'done',
          completedAt: new Date(),
          subid,
          result: { score, comment, breakdown },
        },
      }
    );

    await auditLog(db, 'steps_grade', {
      problemId: problem.id,
      score,
      taskId,
    }, username, 'info').catch(() => {});

  } catch (err) {
    console.error('[steps-grade] failed:', err);
    await db.collection('steps_grading_tasks').updateOne(
      { taskId },
      {
        $set: {
          status: 'error',
          error: String(err.message || err).slice(0, 300),
          completedAt: new Date(),
        },
      }
    ).catch(() => {});
  }
}