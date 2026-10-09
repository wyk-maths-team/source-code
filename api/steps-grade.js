// api/steps-grade.js
//
// Steps 模式：建立 AI 批改任務 + 輪詢結果
//
// POST { problemId, steps, model } → { success: true, taskId }
// GET  ?taskId=xxx                 → { success, status, result?, subid? }
//
// 任務由本機 bridge 處理（見 /grader/bridge.js）
// 結果寫回 steps_grading_tasks；GET 端點負責把 done 的結果
// 落到 submissions + userstats（用 consumed 標記避免重複）

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import crypto from 'crypto';

const MAX_STEPS_LEN = 1000;
const VALID_MODELS  = new Set(['r1', 'v3']);
const TASK_TTL_MS   = 30 * 60_000;   // 30 分鐘

function genTaskId() {
  return 'SGT' + crypto.randomBytes(8).toString('hex');
}
function genSubid() {
  return 'SGS' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

export default async function handler(req, res) {
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
  const { problemId, steps, model } = req.body || {};

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

  const useModel = VALID_MODELS.has(model) ? model : 'r1';

  // 題目存在
  const problem = await db.collection('problems').findOne(
    { id: String(problemId) },
    { projection: { id: 1, _id: 0 } }
  );
  if (!problem) {
    return res.status(404).json({ success: false, message: 'Problem not found' });
  }

  // 已通過 → 拒絕
  const stats = await db.collection('userstats').findOne(
    { username: decoded.username },
    { projection: { states: 1, _id: 0 } }
  );
  // if (stats?.states?.[problemId] === 'passed') {
  //   return res.status(400).json({
  //     success: false,
  //     message: 'You have already passed this problem',
  //   });
  // }

  // 若同一用戶同一題目已有 pending/processing，直接沿用
  // const existing = await db.collection('steps_grading_tasks').findOne(
  //   {
  //     username: decoded.username,
  //     problemId: String(problemId),
  //     status: { $in: ['pending', 'processing'] },
  //     createdAt: { $gt: new Date(Date.now() - TASK_TTL_MS) },
  //   },
  //   { sort: { createdAt: -1 } }
  // );
  // if (existing) {
  //   return res.status(200).json({ success: true, taskId: existing.taskId, reused: true });
  // }

  const taskId = genTaskId();
  const now = new Date();

  await db.collection('steps_grading_tasks').insertOne({
    taskId,
    username: decoded.username,
    problemId: String(problemId),
    steps: trimmed,
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

  // 未完成
  if (task.status === 'pending' || task.status === 'processing') {
    return res.status(200).json({
      success: true,
      status: task.status === 'processing' ? 'processing' : 'pending',
    });
  }

  // bridge 報錯
  if (task.status === 'error') {
    return res.status(200).json({
      success: true,
      status: 'error',
      message: task.error || 'Grading failed',
    });
  }

  // 完成
  if (task.status === 'done') {
    // 若已 consume 過，直接回傳
    if (task.consumed === true && task.subid) {
      return res.status(200).json({
        success: true,
        status: 'done',
        result: task.result,
        subid: task.subid,
        alreadyConsumed: true,
      });
    }

    // 原子搶佔 consume（v4/v5/v6 通用：updateOne 返回格式一致）
    const lockResult = await db.collection('steps_grading_tasks').updateOne(
      { taskId, status: 'done', consumed: { $ne: true } },
      { $set: { consumed: true, consumedAt: new Date() } }
    );

    // 沒搶到 → 別人先 consume 了，直接讀最新回傳
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

    // 搶到了 → 重新讀完整文檔
    const claimed = await db.collection('steps_grading_tasks').findOne({ taskId });
    if (!claimed) {
      return res.status(200).json({
        success: true,
        status: 'done',
        result: { score: -100, comment: 'AI error' },
        subid: null,
      });
    }

    // 我搶到了 → 寫 submissions + userstats
    const rawScoreRaw = claimed.result?.score;
    const comment  = String(claimed.result?.comment || '').slice(0, 500);

    // ⭐ 防禦：任何非有效數字都當 AI error
    const isAIError =
      rawScoreRaw === -100 ||
      typeof rawScoreRaw !== 'number' ||
      !Number.isFinite(rawScoreRaw);

    // 除錯：把原始資料寫到 Vercel log
    console.log('[steps-grade] poll claimed', {
      taskId,
      status: claimed.status,
      result: claimed.result,
      rawScoreRaw,
      isAIError,
    });

    const rawScore = isAIError ? -100 : rawScoreRaw;

    let subid = claimed.subid || null;

    if (!isAIError) {
      const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));
      subid = genSubid();

      try {
        await db.collection('submissions').insertOne({
          subid,
          username: claimed.username,
          problemId: claimed.problemId,
          type: 'steps',
          timestamp: new Date(),
          correct: finalScore === 100,
          systemError: false,
          marked: true,
          score: finalScore,
          comment,
          answer: claimed.steps,
          image: '',
          drawing: '',
          markedAt: new Date(),
          aiGraded: true,
          aiModel: claimed.model,
          taskId,
        });

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
        console.error('[steps-grade] write submissions failed:', e);
      }

      if (subid) {
        await db.collection('steps_grading_tasks').updateOne(
          { taskId },
          { $set: { subid } }
        );
      }

      auditLog(db, 'steps_grade', {
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

    // AI 錯誤：不寫 submissions
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