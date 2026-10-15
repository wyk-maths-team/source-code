// api/steps-grade.js
//
// Steps 模式：建立 AI 批改任務 + 輪詢結果
//
// POST { problemId, steps, model } → { success: true, taskId }
// GET  ?taskId=xxx                 → { success, status, result?, subid? }
//
// ⭐ 流程：
//   1. POST 建任務到 steps_grading_tasks (status: 'pending')
//   2. 立刻嘗試直接呼叫 DeepSeek API（≤ 50 秒）
//      - 成功 → status: 'done', handledBy: 'api'
//      - 失敗 → status 保持 'pending'，交給 bridge 處理
//   3. GET 輪詢 → done 時寫入 submissions + userstats
//
// Bridge 端不變（它仍然從 steps_grading_tasks 搶 pending 任務）

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';
import { buildStepsPrompt } from '../lib/grade-prompt.js';
import crypto from 'crypto';

const MAX_STEPS_LEN = 1000;
const VALID_MODELS  = new Set(['r1', 'v3']);
const TASK_TTL_MS   = 30 * 60_000;

// ⭐ API 直連超時（Vercel Pro maxDuration 上限內留餘量）
const API_TIMEOUT_MS = 50_000;

function genTaskId() {
  return 'SGT' + crypto.randomBytes(8).toString('hex');
}
function genSubid() {
  return 'SGS' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// ═══ 清洗 statement（與 bridge 相同邏輯） ═══
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

// ═══ 解析 AI 回覆（與 bridge 相同邏輯） ═══
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

function compactShortNewlines(text) {
  if (!text) return text;
  let prev;
  do {
    prev = text;
    text = text.replace(/\n([^\n])\n/g, '$1');
  } while (text !== prev);
  text = text.replace(/\n([^\n])$/g, '$1');
  text = text.replace(/^([^\n])\n/g, '$1');
  return text;
}

function parseReply(raw) {
  if (!raw) return null;
  const original = String(raw);
  let s = original;

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
      parsed.comment = compactShortNewlines(parsed.comment);
      parsed.comment = parsed.comment.replace(/[ \t]+/g, ' ').trim();
    }
    return parsed;
  } catch {
    return null;
  }
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

// ═══════════════ POST：建立任務 + 嘗試 API ═══════════════
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

  const problem = await db.collection('problems').findOne(
    { id: String(problemId) },
    { projection: { id: 1, statement: 1, ans: 1, _id: 0 } }
  );
  if (!problem) {
    return res.status(404).json({ success: false, message: 'Problem not found' });
  }

  const taskId = genTaskId();
  const now = new Date();

  // 建任務（status: pending）—— bridge 也會搶 pending 的
  await db.collection('steps_grading_tasks').insertOne({
    taskId,
    username: decoded.username,
    problemId: String(problemId),
    steps: trimmed,
    model: useModel,
    status: 'pending',
    handledBy: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TASK_TTL_MS),
  });
    // ⭐ root 用户跳过 API，直接交给 bridge（省 token）
  if (decoded.role === 'root') {
    return res.status(202).json({
      success: true,
      taskId,
      handledBy: 'bridge',
    });
  }

  // ⭐ 立刻嘗試直連 DeepSeek API
  const apiResult = await tryApiDirect({
    problem, trimmed, useModel, taskId, db, username: decoded.username,
  });

  if (apiResult.ok) {
    return res.status(202).json({ success: true, taskId, handledBy: 'api' });
  }

  // 永久性失敗（key 問題、余额不足）—— 直接報錯，不 fallback
  if (apiResult.permanent) {
    await db.collection('steps_grading_tasks').updateOne(
      { taskId },
      {
        $set: {
          status: 'error',
          error: apiResult.error || 'API permanent error',
          completedAt: new Date(),
        },
      }
    );
    return res.status(202).json({
      success: true,
      taskId,
      handledBy: 'api',
      warn: 'AI service unavailable',
    });
  }

  // 暫時性失敗 → 保持 pending，讓 bridge 接手
  return res.status(202).json({ success: true, taskId, handledBy: 'bridge' });
}

// ═══════════════ 嘗試 API 直連 ═══════════════
async function tryApiDirect({ problem, trimmed, useModel, taskId, db, username }) {
  const statement = cleanStatementForAI(problem.statement);
  const prompt = buildStepsPrompt({
    statement,
    reference_answer: String(problem.ans ?? ''),
    student_steps: trimmed,
  });

  const t0 = Date.now();

  try {
    const reply = await askDeepSeekAPI(prompt, {
      model: useModel,
      timeoutMs: API_TIMEOUT_MS,
    });
    const elapsed = Date.now() - t0;

    const parsed = parseReply(reply);
    let scoreNum = NaN;
    if (parsed) {
      const v = parsed.score ?? parsed.Score ?? parsed.SCORE;
      scoreNum = typeof v === 'number' ? v : Number(v);
    }

    if (!parsed || !Number.isFinite(scoreNum)) {
      // 解析失敗 → 讓 bridge 試一次（可能 R1 格式不同）
      await db.collection('steps_grading_tasks').updateOne(
        { taskId },
        {
          $set: {
            apiAttemptedAt: new Date(),
            apiError: 'JSON parse failed',
          },
        }
      );
      return { ok: false, permanent: false, error: 'JSON parse failed' };
    }

    const score = Math.max(0, Math.min(100, Math.round(scoreNum)));
    const comment = String(parsed.comment || '').slice(0, 3000);

    // 標記為 done
    await db.collection('steps_grading_tasks').updateOne(
      { taskId },
      {
        $set: {
          status: 'done',
          handledBy: 'api',
          result: { score, comment },
          rawReply: reply.slice(0, 4000),
          elapsedMs: elapsed,
          completedAt: new Date(),
        },
      }
    );

    // 審計
    auditLog(db, 'steps_grade', {
      problemId: problem.id,
      score,
      taskId,
      model: useModel,
      handledBy: 'api',
    }, username, 'info').catch(() => {});

    return { ok: true, elapsed };

  } catch (err) {
    const elapsed = Date.now() - t0;

    await db.collection('steps_grading_tasks').updateOne(
      { taskId },
      {
        $set: {
          apiAttemptedAt: new Date(),
          apiError: String(err.message || err).slice(0, 200),
          apiElapsedMs: elapsed,
        },
      }
    );

    return {
      ok: false,
      permanent: !!err.permanent,
      error: String(err.message || err).slice(0, 200),
    };
  }
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
      handledBy: task.handledBy || null,
    });
  }

  // 錯誤
  if (task.status === 'error') {
    return res.status(200).json({
      success: true,
      status: 'error',
      message: task.error || 'Grading failed',
    });
  }

  // 完成
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

    // 原子搶佔
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
          aiModel: claimed.model,
          handledBy: claimed.handledBy || 'unknown',
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

// ⭐ Vercel Pro 需要這個才能跑超過 10 秒
export const config = {
  maxDuration: 60,
};
