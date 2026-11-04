// api/steps-grade.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';
import { askClaude } from '../lib/temp/claude-api.js';
import { buildStepsPrompt, buildM0Prompt, snapM0Score } from '../lib/grade-prompt.js';
import { getModelChain, getModelInfo, pickThinkingEffort, pickEffortForProblem } from '../lib/model-router.js';
import { consumeTokens } from '../lib/token.js';
import crypto from 'crypto';
import { wrapHandler } from '../lib/errors.js';
import {
  updateUserStats,
  rewardFirstAC,
  runPostSubmit,
  findActiveContestForProblem,
  applyContestScore,
} from '../lib/submission.js';

const MAX_STEPS_LEN = 10000;
const TASK_TTL_MS   = 30 * 60_000;
const MAX_TOKEN_CONSUMPTION=120000;
function genTaskId() { return 'SGT' + crypto.randomBytes(8).toString('hex'); }
function genSubid() { return 'SGS' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }

function cleanStatementForAI(raw) {
  let s = String(raw || '');
  return s.trim();
}

function escapeControlCharsInJsonStrings(str) {
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i], code = str.charCodeAt(i);
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && code < 0x20) {
      switch (ch) {
        case '\n': out += '\\n'; break; case '\r': out += '\\r'; break; case '\t': out += '\\t'; break;
        default: out += '\\u' + code.toString(16).padStart(4, '0');
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function parseReply(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[\uFEFF\u200B-\u200D\u2028\u2029]/g, '').replace(/[\u201C\u201D]/g, '"').replace(/\uFF1A/g, ':').replace(/\uFF0C/g, ',').replace(/\uFF5B/g, '{').replace(/\uFF5D/g, '}').trim();
  s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const first = s.indexOf('{'), last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;
  let jsonStr = escapeControlCharsInJsonStrings(s.slice(first, last + 1)).replace(/,(\s*[}\]])/g, '$1');
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.comment === 'string') parsed.comment = parsed.comment.replace(/[ \t]+/g, ' ').trim();
    return parsed;
  } catch { return null; }
}

async function tryOneModel({ modelKey, prompt, effort }) {
  const info = getModelInfo(modelKey);
  const t0 = Date.now();
  let reply;
  if (info.provider === 'claude') {
    reply = await askClaude(prompt, { model: modelKey, timeoutMs: 280_000, maxTokens: 8192 });
  } else if (info.provider === 'deepseek') {
    reply = await askDeepSeekAPI(prompt, { model: info.id, timeoutMs: 50_000, effort, maxTokens: MAX_TOKEN_CONSUMPTION });
  } else throw new Error(`Unknown provider`);

  const elapsed = Date.now() - t0;
  const parsed = parseReply(reply.content || reply); // 兼容新版返回对象
  
  let scoreNum = NaN;
  if (parsed) { const v = parsed.score ?? parsed.Score; scoreNum = typeof v === 'number' ? v : Number(v); }
  if (!parsed || !Number.isFinite(scoreNum)) { const err = new Error('JSON parse failed'); err.parseFailed = true; throw err; }

  return {
    score: Math.max(0, Math.min(100, Math.round(scoreNum))),
    comment: String(parsed.comment || '').slice(0, 3000),
    elapsed,
    tokenUsage: reply.usage?.total || 0,
    usage: reply.usage || null,
    rawReply: reply.content || reply,
    modelKey,
  };
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const db = await connectToDatabase();

  if (req.method === 'POST') return handleCreate(req, res, db, decoded);
  if (req.method === 'GET')  return handlePoll(req, res, db, decoded);
  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

async function handleCreate(req, res, db, decoded) {
  const { problemId, steps } = req.body || {};
  if (!problemId || !steps || !steps.trim()) return res.status(400).json({ success: false, message: 'Missing or empty steps' });
  if (steps.trim().length > MAX_STEPS_LEN) return res.status(400).json({ success: false, message: 'Steps too long' });

  const problem = await db.collection('problems').findOne({ id: String(problemId) }, { projection: { id: 1, statement: 1, ans: 1, difficulty: 1, tags: 1 } });
  if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
    // ⭐ 前置余额校验
  // 门槛 = 一次判题的大致最低消耗（不是最终扣费额）
  //   真正的扣费在判分结束后按 AI 返回的 usage 结算
  const tokenCost = Math.max(3000, Math.round((Number(problem.difficulty) || 1) * 1000));
  const { getTokenBalance } = await import('../lib/token.js');
  const currentToken = await getTokenBalance(db, decoded.username);
  const available = (currentToken.daily || 0) + (currentToken.global || 0);

  if (available < tokenCost) {
    return res.status(400).json({
      success: false,
      message: `Insufficient tokens. You need at least ${tokenCost.toLocaleString()} to run AI grading, but only have ${available.toLocaleString()}. Please solve easier problems to earn tokens.`
    });
  }
  const taskId = genTaskId();
  const now = new Date();
  // const tokenCost = (problem.difficulty >= 5) ? 30000 : 3000; // 预计成本

  // 写入任务记录
  await db.collection('steps_grading_tasks').insertOne({
    taskId, username: decoded.username, problemId: String(problemId), steps: steps.trim(),
    status: 'pending', handledBy: null, difficulty: Number(problem.difficulty) || 0,
    createdAt: now, expiresAt: new Date(now.getTime() + TASK_TTL_MS),
  });

  // Root 用户跳过后端 API，交给你本地的 Bridge
  // if (decoded.role === 'root') {
  //   return res.status(202).json({ success: true, taskId, handledBy: 'bridge' });
  // }

  // 非 Root：同步执行 API
  const chain = getModelChain(problem.difficulty);
  const errors = [];
  const statement = cleanStatementForAI(problem.statement);
  // M0 题库：走轻量 prompt，省 token，只给三档分
  const isM0 = Array.isArray(problem.tags) && problem.tags.includes('M0');
  const prompt = isM0
    ? buildM0Prompt({ statement, reference_answer: String(problem.ans ?? ''), student_steps: steps.trim() })
    : buildStepsPrompt({ statement, reference_answer: String(problem.ans ?? ''), student_steps: steps.trim() });
  const effort = pickEffortForProblem(problem);

  for (const modelKey of chain) {
    try {
      const result = await tryOneModel({ modelKey, prompt, effort });
      if (isM0) result.score = snapM0Score(result.score);
      const subid = genSubid();

      // 成功：更新任务状态
      await db.collection('steps_grading_tasks').updateOne(
        { taskId },
        { $set: { status: 'done', handledBy: 'api', usedModel: modelKey, result: { score: result.score, comment: result.comment }, rawReply: result.rawReply.slice(0, 4000), elapsedMs: result.elapsed, completedAt: new Date(), subid } }
      );

      // 写入 submissions
      const finalScore = result.score;
      await db.collection('submissions').insertOne({
        subid, username: decoded.username, problemId: String(problemId), type: 'steps',
        timestamp: new Date(), correct: finalScore === 100, systemError: false, marked: true,
        score: finalScore, comment: result.comment, answer: steps.trim(), markedAt: new Date(),
        aiGraded: true, handledBy: 'api', usedModel: modelKey, taskId,
        judgingMs: result.elapsed, judgingModel: modelKey, tokenUsage: result.tokenUsage || tokenCost
      });

      // 更新 userstats（统一管线：todayAC / firstTryCount / rating 缓存）
      const isFirstAC = await updateUserStats(db, decoded.username, String(problemId), finalScore === 100);
      if (isFirstAC) {
        await rewardFirstAC(db, { username: decoded.username, rawUsername: decoded.username, problem });
      }

      // 竞赛里也用 steps 作答时，一样计入竞赛成绩
      let contestScore = null;
      const contest = await findActiveContestForProblem(db, decoded.username, String(problemId), new Date());
      if (contest) {
        const applied = await applyContestScore(db, {
          contestId: contest.id,
          username: decoded.username,
          problemId: String(problemId),
          correct: finalScore === 100,
          score: finalScore,
          isSpecial: !!contest.special,
          now: new Date(),
        });
        contestScore = applied.score;
      }

      await runPostSubmit(db, decoded.username, { justAC: finalScore === 100, problemId: String(problemId) });

      // 扣除 Token：按加权用量折算（缓存命中 1 / 未缓存 50 / 输出 200，再除以常数）
      // 高峰时段（北京时间工作日 9-12 / 14-18）成本翻倍，收费同步翻倍
      const { computeAiCharge } = await import('../lib/submission.js');
      const { billingMultiplier, isPeakHour } = await import('../lib/pricing.js');
      const byUsage = computeAiCharge(result.usage);
      const base = byUsage > 0 ? byUsage : tokenCost;
      const peak = isPeakHour();
      const charged = peak ? base * 2 : base;
      const newTokens = await consumeTokens(db, decoded.username, charged);

      auditLog(db, 'steps_grade', { problemId, score: finalScore, taskId, model: modelKey, handledBy: 'api' }, decoded.username, 'info').catch(() => {});

      // ⭐ 同步返回完成结果
      return res.status(200).json({
        success: true,
        status: 'done',
        result: { score: finalScore, comment: result.comment },
        subid,
        tokens: newTokens,
        charged,
        peak,
        contestScore,
      });

    } catch (err) {
      const msg = String(err.message || err).slice(0, 200);
      errors.push(`${modelKey}: ${msg}`);
      if (err.permanent) {
        await db.collection('steps_grading_tasks').updateOne({ taskId }, { $set: { status: 'error', error: msg, completedAt: new Date() } });
        return res.status(200).json({ success: true, status: 'error', message: msg });
      }
    }
  }

  // 全部失败，让 bridge 接手
  await db.collection('steps_grading_tasks').updateOne({ taskId }, { $set: { apiAttemptedAt: new Date(), apiErrors: errors }, $unset: { apiLockedAt: '' } });
  return res.status(202).json({ success: true, taskId, handledBy: 'bridge' });
}

// handlePoll 保持完全不变（给 root 和 bridge 兜底用的）
async function handlePoll(req, res, db, decoded) {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ success: false, message: 'Missing taskId' });

  const task = await db.collection('steps_grading_tasks').findOne({ taskId });
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
  if (task.username !== decoded.username && decoded.role !== 'admin' && decoded.role !== 'root') return res.status(403).json({ success: false });

  if (task.status === 'pending' || task.status === 'processing') {
    return res.status(200).json({ success: true, status: task.status, handledBy: task.handledBy || null });
  }
  if (task.status === 'error') return res.status(200).json({ success: true, status: 'error', message: task.error || 'Grading failed' });

  if (task.status === 'done') {
    if (task.consumed === true) return res.status(200).json({ success: true, status: 'done', result: task.result, subid: task.subid });

    const lockResult = await db.collection('steps_grading_tasks').updateOne({ taskId, status: 'done', consumed: { $ne: true } }, { $set: { consumed: true, consumedAt: new Date() } });
    if (lockResult.modifiedCount === 0) {
      await new Promise(r => setTimeout(r, 300));
      const fresh = await db.collection('steps_grading_tasks').findOne({ taskId });
      return res.status(200).json({ success: true, status: 'done', result: fresh?.result, subid: fresh?.subid || null });
    }

    const claimed = await db.collection('steps_grading_tasks').findOne({ taskId });
    const rawScoreRaw = claimed.result?.score;
    const comment = String(claimed.result?.comment || '').slice(0, 3000);
    const isAIError = rawScoreRaw === -100 || typeof rawScoreRaw !== 'number' || !Number.isFinite(rawScoreRaw);
    let subid = claimed.subid || null;

    let contestScore = null;
    if (!isAIError) {
      let finalScore = Math.max(0, Math.min(100, Math.round(rawScoreRaw)));

      // M0 题只允许 0 / 50 / 100
      const m0Problem = await db.collection('problems').findOne(
        { id: String(claimed.problemId), tags: 'M0' }, { projection: { _id: 1 } }
      );
      if (m0Problem) finalScore = snapM0Score(finalScore);

      if (!subid) subid = genSubid();
      const tokenCost = Math.max(3000, Math.round((Number(claimed.difficulty) || 1) * 1000));

      try {
        await db.collection('submissions').insertOne({
          subid, username: claimed.username, problemId: claimed.problemId, type: 'steps',
          timestamp: new Date(), correct: finalScore === 100, systemError: false, marked: true, score: finalScore, comment,
          answer: claimed.steps, markedAt: new Date(), aiGraded: true, handledBy: claimed.handledBy || 'bridge',
          usedModel: claimed.usedModel || null, taskId, judgingMs: claimed.elapsedMs || null, tokenUsage: claimed.result?.tokenUsage || tokenCost
        });
        const pid = String(claimed.problemId);
        const isFirstAC = await updateUserStats(db, claimed.username, pid, finalScore === 100);
        if (isFirstAC) {
          const prob = await db.collection('problems').findOne({ id: pid }, { projection: { id: 1, difficulty: 1 } });
          await rewardFirstAC(db, { username: claimed.username, rawUsername: claimed.username, problem: prob });
        }

        // 競賽成績
        const contest = await findActiveContestForProblem(db, claimed.username, pid, new Date());
        if (contest) {
          const applied = await applyContestScore(db, {
            contestId: contest.id,
            username: claimed.username,
            problemId: pid,
            correct: finalScore === 100,
            score: finalScore,
            isSpecial: !!contest.special,
            now: new Date(),
          });
          contestScore = applied.score;
        }

        await runPostSubmit(db, claimed.username, { justAC: finalScore === 100, problemId: pid });

        const realUsage = Number(claimed.result?.tokenUsage) || 0;
        const { isPeakHour } = await import('../lib/pricing.js');
        const baseCharge = realUsage > 0 ? realUsage : tokenCost;
        await consumeTokens(db, claimed.username, isPeakHour() ? baseCharge * 2 : baseCharge);
      } catch (e) { console.error('[steps-grade] poll write failed:', e); }

      if (subid) await db.collection('steps_grading_tasks').updateOne({ taskId }, { $set: { subid } });
      return res.status(200).json({ success: true, status: 'done', result: { score: finalScore, comment }, subid, contestScore });
    }
    return res.status(200).json({ success: true, status: 'done', result: { score: -100, comment: 'AI error' }, subid: null });
  }
  return res.status(200).json({ success: true, status: 'unknown' });
}

export const config = { maxDuration: 300, regions: ['hkg1'] };
export default wrapHandler(handler);