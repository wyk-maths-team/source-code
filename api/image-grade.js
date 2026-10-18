// api/image-grade.js
//
// 圖片 AI 批改 —— 建立任務 + 輪詢結果
//
// POST { problemId, subid, imageUrl, model } → { success: true, taskId }
// GET  ?taskId=xxx                            → { success, status, result?, subid? }
//
// 任務由本機 bridge 處理（見 grader/bridge.js processImageTask）
// 結果寫回 submissions + userstats（用 consumed 標記避免重複）

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import crypto from 'crypto';
import { wrapHandler } from '../lib/errors.js';

const VALID_MODELS = new Set(['r1', 'v3']);
const TASK_TTL_MS  = 30 * 60_000;

function genTaskId() {
  return 'IGT' + crypto.randomBytes(8).toString('hex');
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const db = await connectToDatabase();

  if (req.method === 'POST') return handleCreate(req, res, db, decoded);
  if (req.method === 'GET')  return handlePoll(req, res, db, decoded);

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

// ═══════════════ POST：建立任務 ═══════════════
async function handleCreate(req, res, db, decoded) {
  const { problemId, subid, imageUrl, model } = req.body || {};

  if (!problemId || typeof problemId !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing problemId' });
  }
  if (!subid || typeof subid !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing subid' });
  }
  if (!imageUrl || typeof imageUrl !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing imageUrl' });
  }
  if (!/^https:\/\//.test(imageUrl)) {
    return res.status(400).json({ success: false, message: 'Invalid imageUrl' });
  }

  const useModel = VALID_MODELS.has(model) ? model : 'r1';

  const problem = await db.collection('problems').findOne(
    { id: String(problemId) },
    { projection: { id: 1, _id: 0 } }
  );
  if (!problem) {
    return res.status(404).json({ success: false, message: 'Problem not found' });
  }

  const sub = await db.collection('submissions').findOne(
    { subid, username: decoded.username, type: 'image' },
    { projection: { subid: 1, _id: 0 } }
  );
  if (!sub) {
    return res.status(404).json({ success: false, message: 'Submission not found' });
  }

  // 同一 submission 避免重複建立
  const existing = await db.collection('steps_grading_tasks').findOne(
    {
      subid,
      type: 'image',
      status: { $in: ['pending', 'processing'] },
      createdAt: { $gt: new Date(Date.now() - TASK_TTL_MS) },
    },
    { sort: { createdAt: -1 } }
  );
  if (existing) {
    return res.status(200).json({
      success: true,
      taskId: existing.taskId,
      reused: true,
    });
  }

  const taskId = genTaskId();
  const now = new Date();

  await db.collection('steps_grading_tasks').insertOne({
    taskId,
    type: 'image',
    username: decoded.username,
    problemId: String(problemId),
    subid,
    imageUrl,
    model: useModel,
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + TASK_TTL_MS),
  });

  return res.status(202).json({ success: true, taskId });
}

// ═══════════════ GET：輪詢 ═══════════════
async function handlePoll(req, res, db, decoded) {
  const { taskId } = req.query;
  if (!taskId) {
    return res.status(400).json({ success: false, message: 'Missing taskId' });
  }

  const task = await db.collection('steps_grading_tasks').findOne({ taskId });
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }
  if (
    task.username !== decoded.username &&
    decoded.role !== 'admin' &&
    decoded.role !== 'root'
  ) {
    return res.status(403).json({ success: false, message: 'Not yours' });
  }

  if (task.status === 'pending' || task.status === 'processing') {
    return res.status(200).json({
      success: true,
      status: task.status === 'processing' ? 'processing' : 'pending',
    });
  }

  if (task.status === 'error') {
    return res.status(200).json({
      success: true,
      status: 'error',
      message: task.error || 'Grading failed',
    });
  }

  if (task.status === 'done') {
    if (task.consumed === true && task.subid) {
      return res.status(200).json({
        success: true,
        status: 'done',
        result: task.result,
        subid: task.subid,
        alreadyConsumed: true,
      });
    }

    const lockResult = await db.collection('steps_grading_tasks').updateOne(
      { taskId, status: 'done', consumed: { $ne: true } },
      { $set: { consumed: true, consumedAt: new Date() } }
    );

    if (lockResult.modifiedCount === 0) {
      await new Promise(r => setTimeout(r, 300));
      const fresh = await db.collection('steps_grading_tasks').findOne({ taskId });
      return res.status(200).json({
        success: true,
        status: 'done',
        result: fresh?.result,
        subid: fresh?.subid || null,
      });
    }

    const claimed = await db.collection('steps_grading_tasks').findOne({ taskId });
    if (!claimed) {
      return res.status(200).json({
        success: true,
        status: 'done',
        result: { score: -100, comment: 'AI error' },
        subid: null,
      });
    }

    const rawScoreRaw = claimed.result?.score;
    const comment = String(claimed.result?.comment || '').slice(0, 3000);

    const isAIError =
      rawScoreRaw === -100 ||
      typeof rawScoreRaw !== 'number' ||
      !Number.isFinite(rawScoreRaw);

    const rawScore = isAIError ? -100 : rawScoreRaw;
    const subid = claimed.subid || null;

    if (!isAIError) {
      const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

      try {
        if (subid) {
          await db.collection('submissions').updateOne(
            { subid },
            {
              $set: {
                marked: true,
                score: finalScore,
                comment,
                correct: finalScore === 100,
                markedAt: new Date(),
                aiGraded: true,
                aiModel: claimed.model,
                taskId,
              },
            }
          );
        }

        const statsCol = db.collection('userstats');
        await statsCol.updateOne(
          { username: claimed.username },
          { $setOnInsert: { username: claimed.username, states: {} } },
          { upsert: true }
        );
        if (finalScore === 100) {
          await statsCol.updateOne(
            { username: claimed.username },
            { $set: { [`states.${claimed.problemId}`]: 'passed' } }
          );
        } else {
          await statsCol.updateOne(
            {
              username: claimed.username,
              [`states.${claimed.problemId}`]: { $ne: 'passed' },
            },
            { $set: { [`states.${claimed.problemId}`]: 'failed' } }
          );
        }
      } catch (e) {
        console.error('[image-grade] write failed:', e);
      }

      auditLog(db, 'image_grade', {
        problemId: claimed.problemId,
        score: finalScore,
        taskId,
        model: claimed.model,
      }, claimed.username, 'info').catch(() => {});

      return res.status(200).json({
        success: true,
        status: 'done',
        result: { score: finalScore, comment },
        subid,
      });
    }

    return res.status(200).json({
      success: true,
      status: 'done',
      result: { score: -100, comment: 'AI error' },
      subid: null,
    });
  }

  return res.status(200).json({
    success: true,
    status: 'unknown',
    message: `Unknown task status: ${task.status}`,
  });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);