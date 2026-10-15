// api/steps-grade.js
//
// Steps 模式：建立 AI 批改任務 + 輪詢結果
//
// ⭐ 流程：
//   1. POST 建任務 (status: 'pending')
//   2. 根據題目難度自動選模型，依次嘗試 fallback 鏈
//      - 成功 → status: 'done', handledBy: 'api'
//      - 全部失敗 → 保持 pending，交給 bridge
//   3. GET 輪詢 → done 時寫入 submissions + userstats

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';
import { askClaude } from '../lib/temp/claude-api.js';
import { buildStepsPrompt } from '../lib/grade-prompt.js';
// import { getModelChain, getModelInfo } from '../lib/model-router.js';
import { getModelChain, getModelInfo, pickThinkingEffort } from '../lib/model-router.js';
import crypto from 'crypto';

const MAX_STEPS_LEN = 1000;
const TASK_TTL_MS   = 30 * 60_000;

function genTaskId() {
  return 'SGT' + crypto.randomBytes(8).toString('hex');
}
function genSubid() {
  return 'SGS' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// ═══ 清洗 statement ═══
function cleanStatementForAI(raw) {
  let s = String(raw || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<div[^>]*\bdata-input\b[^>]*>[\s\S]*?<\/div>/gi, ' ');
  s = s.replace(/<([a-zA-Z][\w-]*)[^>]*\bdata-input\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<img[^>]*\balt=["']([^"']+)["'][^>]*>/gi, ' [FIGURE: $1] ');
  s = s.replace(/<img[^>]*>/gi, ' [FIGURE] ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&amp;/g, '&')
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ═══ JSON 解析 ═══
function escapeControlCharsInJsonStrings(str) {
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && code < 0x20) {
      switch (ch) {
        case '\n': out += '\\n'; break;
        case '\r': out += '\\r'; break;
        case '\t': out += '\\t'; break;
        case '\b': out += '\\b'; break;
        case '\f': out += '\\f'; break;
        default:   out += '\\u' + code.toString(16).padStart(4, '0');
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function parseReply(raw) {
  if (!raw) return null;
  let s = String(raw);
  s = s.replace(/[\uFEFF\u200B-\u200D\u2028\u2029]/g, '');
  s = s.replace(/[\u201C\u201D]/g, '"')
       .replace(/\uFF1A/g, ':')
       .replace(/\uFF0C/g, ',')
       .replace(/\uFF5B/g, '{')
       .replace(/\uFF5D/g, '}');
  s = s.trim();
  s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  const first = s.indexOf('{');
  const last  = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;

  let jsonStr = s.slice(first, last + 1);
  jsonStr = escapeControlCharsInJsonStrings(jsonStr);
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.comment === 'string') {
      parsed.comment = parsed.comment.replace(/[ \t]+/g, ' ').trim();
    }
    return parsed;
  } catch {
    return null;
  }
}

// ═══ 尝试单个模型 ═══
async function tryOneModel({ modelKey, prompt, db, taskId, problem, username, effort }) {
  const info = getModelInfo(modelKey);
  if (!info) throw new Error(`Unknown model key: ${modelKey}`);

  const t0 = Date.now();

  let reply;
  if (info.provider === 'claude') {
    reply = await askClaude(prompt, {
      model: modelKey,
      timeoutMs: 280_000,
      maxTokens: 8192,
      effort,   // ⭐ 传下去
    });
  } else if (info.provider === 'deepseek') {
    reply = await askDeepSeekAPI(prompt, {
      model: info.id,   // ⭐ 用 info.id（deepseek-flash 或 deepseek-v4-pro）
      timeoutMs: 50_000,
      effort,
    });
  }else {
    throw new Error(`Unknown provider: ${info.provider}`);
  }

  const elapsed = Date.now() - t0;
  const parsed = parseReply(reply);

  let scoreNum = NaN;
  if (parsed) {
    const v = parsed.score ?? parsed.Score ?? parsed.SCORE;
    scoreNum = typeof v === 'number' ? v : Number(v);
  }

  if (!parsed || !Number.isFinite(scoreNum)) {
    const err = new Error('JSON parse failed');
    err.parseFailed = true;
    throw err;
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(scoreNum))),
    comment: String(parsed.comment || '').slice(0, 3000),
    elapsed,
    rawReply: reply,
    modelKey,
  };
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

// ═══════════════ POST ═══════════════
async function handleCreate(req, res, db, decoded) {
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

  const problem = await db.collection('problems').findOne(
    { id: String(problemId) },
    { projection: { id: 1, statement: 1, ans: 1, difficulty: 1, _id: 0 } }
  );
  if (!problem) {
    return res.status(404).json({ success: false, message: 'Problem not found' });
  }

  const taskId = genTaskId();
  const now = new Date();

  await db.collection('steps_grading_tasks').insertOne({
    taskId,
    username: decoded.username,
    problemId: String(problemId),
    steps: trimmed,
    status: 'pending',
    handledBy: null,
    apiLockedAt: new Date(),   // ⭐ 给 bridge 看：这任务我锁了
    difficulty: Number(problem.difficulty) || 0,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TASK_TTL_MS),
  });

  // root 用户跳过 API，直接走 bridge
  if (decoded.role === 'root') {
    return res.status(202).json({ success: true, taskId, handledBy: 'bridge' });
  }

  // ⭐ 根据难度自动选模型链
  const chain = getModelChain(problem.difficulty);
  const errors = [];

  const statement = cleanStatementForAI(problem.statement);
  const prompt = buildStepsPrompt({
    statement,
    reference_answer: String(problem.ans ?? ''),
    student_steps: trimmed,
  });
    const effort = pickThinkingEffort(problem.difficulty);
  for (const modelKey of chain) {
    try {
      const result = await tryOneModel({
        modelKey,
        prompt,
        db,
        taskId,
        problem,
        username: decoded.username,
        effort,   // ⭐ 传下去
      });

      await db.collection('steps_grading_tasks').updateOne(
        { taskId },
        {
          $set: {
            status: 'done',
            handledBy: 'api',
            usedModel: modelKey,
            result: { score: result.score, comment: result.comment },
            rawReply: result.rawReply.slice(0, 4000),
            elapsedMs: result.elapsed,
            completedAt: new Date(),
          },
        }
      );

      auditLog(db, 'steps_grade', {
        problemId: problem.id,
        score: result.score,
        taskId,
        model: modelKey,
        difficulty: problem.difficulty,
        handledBy: 'api',
      }, decoded.username, 'info').catch(() => {});

      return res.status(202).json({ success: true, taskId, handledBy: 'api' });

    } catch (err) {
      const msg = String(err.message || err).slice(0, 200);
      errors.push(`${modelKey}: ${msg}`);

      // 永久错误（key 问题、余额不足）→ 不试下一个
      if (err.permanent) {
        await db.collection('steps_grading_tasks').updateOne(
          { taskId },
          { $set: {
              status: 'error',
              error: msg,
              completedAt: new Date(),
            } }
        );
        return res.status(202).json({
          success: true,
          taskId,
          handledBy: 'api',
          warn: 'AI service unavailable',
        });
      }
      // 暂时错误 → 试下一个模型
    }
  }

  // 全部失败 → 交给 bridge
  await db.collection('steps_grading_tasks').updateOne(
    { taskId },
    {
      $set:  { apiAttemptedAt: new Date(), apiErrors: errors },
      $unset: { apiLockedAt: '' },   // ⭐ 解锁，让 bridge 接手
    }
  );

  return res.status(202).json({ success: true, taskId, handledBy: 'bridge' });
}

// ═══════════════ GET（轮询） ═══════════════
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
    decoded.role !== 'admin' && decoded.role !== 'root'
  ) {
    return res.status(403).json({ success: false, message: 'Not yours' });
  }

  if (task.status === 'pending' || task.status === 'processing') {
    return res.status(200).json({
      success: true,
      status: task.status === 'processing' ? 'processing' : 'pending',
      handledBy: task.handledBy || null,
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
          markedAt: new Date(),
          aiGraded: true,
          handledBy: claimed.handledBy || 'unknown',
          usedModel: claimed.usedModel || null,
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

export const config = {
  maxDuration: 300,
  regions: ['iad1'],
};