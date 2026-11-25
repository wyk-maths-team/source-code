// api/steps-grade.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';
import { askClaude } from '../lib/temp/claude-api.js';
import { buildStepsPrompt, buildM0Prompt, snapM0Score } from '../lib/grade-prompt.js';
import { getModelChain, getModelInfo, pickThinkingEffort, pickEffortForProblem } from '../lib/model-router.js';
import { effortForDifficulty, effortForLegacyDifficulty } from '../lib/thinking.js';
import { consumeTokens } from '../lib/token.js';
import crypto from 'crypto';
import { wrapHandler } from '../lib/errors.js';
import { encodeStatus } from '../lib/submission-status.js';
import {
  updateUserStats,
  rewardFirstAC,
  runPostSubmit,
  findActiveContestForProblem,
  applyContestScore,
} from '../lib/submission.js';
import {
  GIVE_UP_MESSAGE,
  AUTH_FAIL_MESSAGE,
  RETRY_DELAY_MS,
  DEADLINE_MS,
  MIN_ATTEMPT_MS,
  remainingMs,
  sleep,
  markTaskFailed,
} from '../lib/ai-fallback.js';
import { durationByDifficulty } from '../lib/grading-history.js';

const MAX_STEPS_LEN = 10000;
const TASK_TTL_MS   = 30 * 60_000;
const MAX_TOKEN_CONSUMPTION=120000;
function genTaskId() { return 'SGT' + crypto.randomBytes(8).toString('hex'); }
function genSubid() { return 'SGS' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); }

// ══════════ 预期耗时 ══════════
// 前端用它把进度条按真实节奏推进。这是全站共享的统计值，与具体某次批改无关，
// 所以进程内缓存 10 分钟 —— 每次批改都去聚合一遍 grading_history 没有意义。
let _etaCache = { at: 0, rows: null };
const ETA_TTL_MS = 10 * 60_000;
// 样本少于这个数就不给结论：两三条的 p50 不叫 p50。
const ETA_MIN_SAMPLES = 5;

async function getEta(db, difficulty) {
  const now = Date.now();
  if (!_etaCache.rows || now - _etaCache.at > ETA_TTL_MS) {
    try {
      _etaCache = { at: now, rows: await durationByDifficulty(db, { days: 30 }) };
    } catch {
      return null;                      // 统计失败不该影响批改本身
    }
  }

  const d = Math.round(Number(difficulty) || 0);
  const hit = (_etaCache.rows || []).find(r => r.difficulty === d);
  if (!hit || hit.n < ETA_MIN_SAMPLES) return null;

  return { difficulty: d, p50Ms: hit.p50Ms, p90Ms: hit.p90Ms, n: hit.n };
}

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

async function tryOneModel({ modelKey, prompt, effort, budgetMs }) {
  const info = getModelInfo(modelKey);
  const t0 = Date.now();
  // budgetMs 是这次批改剩下的时间。第二轮重试时它可能已经很薄，
  // 不把单模型的超时压下来，claude 那 280 秒的默认值会直接吃穿整个函数。
  const clampTo = (base) => Math.max(5_000, Math.min(base, Number(budgetMs) || base));
  let reply;
  if (info.provider === 'claude') {
    reply = await askClaude(prompt, { model: modelKey, timeoutMs: clampTo(280_000), maxTokens: 8192 });
  } else if (info.provider === 'deepseek') {
    reply = await askDeepSeekAPI(prompt, { model: info.id, timeoutMs: clampTo(50_000), effort, maxTokens: MAX_TOKEN_CONSUMPTION });
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

  // ══════════ 流式进度 ══════════
  // 一次批改要挂几十秒。以前浏览器只能盯着 "Waiting (37s)"，既看不出是在跑
  // 还是卡死了，也看不出模型已经换了第二个 —— 于是学生重新点提交，
  // 多扣一次 token、多写一条 submission。
  //
  // 这里在同一个端点上按 Accept 分流：要 SSE 的给事件流，不要的仍然拿
  // 一次性 JSON（course.js、mobile 走的是后者，行为完全不变）。
  //
  // 客户端断开后批改必须继续 —— submissions 要写、token 要扣，
  // 所以 streamClosed 只关推送，不中止业务。
  const wantsStream = String(req.headers.accept || '').includes('text/event-stream');
  const startedAt = Date.now();
  let streamOpen = false, streamClosed = false, hbTimer = null;

  function emit(event, data) {
    if (!streamOpen || streamClosed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { streamClosed = true; }
  }

  function stage(id, label, extra) {
    emit('stage', Object.assign({ id, label, elapsedMs: Date.now() - startedAt }, extra || {}));
  }

  function openStream() {
    if (!wantsStream || streamOpen) return;
    streamOpen = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',      // 不关掉中间层缓冲，事件会被攒到最后一起发
    });
    // 模型那一段可能几十秒没有任何事件，没心跳会被中间层当成空闲连接掐掉
    hbTimer = setInterval(() => emit('ping', { t: Date.now() }), 15000);
    if (hbTimer.unref) hbTimer.unref();
    req.on('close', () => { streamClosed = true; });
    res.on('close', () => { streamClosed = true; });
  }

  function closeStream() {
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    if (!streamOpen || streamClosed) return;
    try { res.end(); } catch { /* 已断开 */ }
  }

  /** 统一出口：流式发事件，非流式发 JSON */
  function respond(status, body) {
    const isError = status >= 400 || (body && body.success === false);
    if (streamOpen) {
      if (!streamClosed) emit(isError ? 'error' : 'result', Object.assign({ status }, body));
      closeStream();
      return;
    }
    return res.status(status).json(body);
  }

  openStream();
  stage('authorize', 'Checking your account…');
  stage('problem', 'Loading the problem…');

  let problem = await db.collection('problems').findOne({ id: String(problemId) }, { projection: { id: 1, statement: 1, ans: 1, difficulty: 1, tags: 1 } });

  // PDF 课程里的框允许用尚未建档的 ID：显式传 autoCreate 时现建一条占位题。
  // statement 用前端传来的该页文字，参考答案留空（AI 只能评推理质量）。
  //
  // 只有管理员能这么建题。之前任何登录用户只要塞一个 autoCreate:true 就能
  // 凭空造一条公开题目（statement 还是自己写的），等于把题库对所有学生开放写入。
  if (!problem) {
    const { autoCreate, statementHint } = req.body || {};
    const pid = String(problemId);
    const isAdmin = decoded.role === 'admin' || decoded.role === 'root';
    if (!autoCreate || !isAdmin || !/^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(pid)) {
      return respond(404, { success: false, message: 'Problem not found' });
    }
    const existing = await db.collection('problems').findOne({ id: pid }, { projection: { id: 1 } });
    if (!existing) {
      const doc = {
        id: pid,
        name: 'PDF 练习 ' + pid,
        statement: String(statementHint || '').slice(0, 4000) || '(PDF 页面 ' + pid + ')',
        ans: '',
        difficulty: 3,
        tags: ['PDF'],
        public: true,
        autoCreated: true,
        createdAt: new Date(),
        createdBy: decoded.username,
      };
      await db.collection('problems').insertOne(doc).catch(() => {});
      problem = await db.collection('problems').findOne({ id: pid }, { projection: { id: 1, statement: 1, ans: 1, difficulty: 1, tags: 1 } });
    } else {
      problem = await db.collection('problems').findOne({ id: pid }, { projection: { id: 1, statement: 1, ans: 1, difficulty: 1, tags: 1 } });
    }
    if (!problem) return respond(404, { success: false, message: 'Problem not found' });
  }
  // 每日 AI 额度（rating > 2200 豁免）
  stage('quota', "Checking today's AI quota…");
  const { checkAiQuota, addAiUsage } = await import('../lib/aiQuota.js');
  const quota = await checkAiQuota(db, decoded.username).catch(() => ({ allowed: true }));
  if (!quota.allowed) {
    return respond(429, {
      success: false,
      code: 'DAILY_AI_LIMIT',
      message: quota.message,
      used: quota.used,
      limit: quota.limit,
    });
  }

    // ⭐ 前置余额校验
  // 门槛 = 一次判题的大致最低消耗（不是最终扣费额）
  //   真正的扣费在判分结束后按 AI 返回的 usage 结算
  const tokenCost = Math.max(3000, Math.round((Number(problem.difficulty) || 1) * 1000));
  const { getTokenBalance } = await import('../lib/token.js');
  stage('tokens', 'Checking your token balance…');
  const currentToken = await getTokenBalance(db, decoded.username);
  const available = (currentToken.daily || 0) + (currentToken.global || 0);

  if (available < tokenCost) {
    return respond(400, {
      success: false,
      message: `Insufficient tokens. You need at least ${tokenCost.toLocaleString()} to run AI grading, but only have ${available.toLocaleString()}. Please solve easier problems to earn tokens.`
    });
  }
  const taskId = genTaskId();
  const now = new Date();
  // const tokenCost = (problem.difficulty >= 5) ? 30000 : 3000; // 预计成本

  // 写入任务记录
  stage('prepare', 'Building the grading prompt…');
  // 不 await：ETA 是为了让进度条好看，不值得在主路径上多等一次聚合。
  // 查不到就保持前端的 20 秒兜底，界面照样能走。
  getEta(db, problem.difficulty)
    .then(eta => { if (eta) emit('eta', eta); })
    .catch(() => {});
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
    : buildStepsPrompt({
        statement,
        reference_answer: String(problem.ans ?? ''),
        student_steps: steps.trim(),
        difficulty: problem.difficulty,        // 评分尺度按难度分档
      });
  // 主站题按难度分级：1-2 low，3-6 high，7-9 max；
  // M0 等特殊题库沿用旧阈值，不跟主站一起变。
  const effort = isM0
    ? effortForLegacyDifficulty(problem && problem.difficulty)
    : effortForDifficulty(problem && problem.difficulty);

  // 两轮：模型链跑一遍，全部失败就把整条链再跑一遍。
  // 不再交给本地 grader —— 它只会在几分钟后给出同样的结果，
  // 而学生已经关掉页面了。
  const ATTEMPTS = 2;
  let authRejected = false;

  for (let pass = 0; pass < ATTEMPTS; pass++) {
    if (pass > 0) {
      stage('retry', 'The grader did not answer — trying the whole chain once more…', { pass: pass + 1, total: ATTEMPTS });
      await sleep(RETRY_DELAY_MS);
    }

    for (let mi = 0; mi < chain.length; mi++) {
      const modelKey = chain[mi];

      // 剩余时间不够开一次调用了：别再试，直接落到下面的放弃分支
      const budget = remainingMs(startedAt);
      if (budget < MIN_ATTEMPT_MS) {
        errors.push(`${modelKey}#${pass + 1}: skipped (only ${Math.max(0, Math.round(budget / 1000))}s left)`);
        continue;
      }

      try {
        stage('model', `Grading with ${modelKey}…`, {
          model: modelKey, attempt: mi + 1, total: chain.length, pass: pass + 1,
        });
        // 给写库/扣费留 8 秒，剩下的才是模型可用的时间
        const result = await tryOneModel({ modelKey, prompt, effort, budgetMs: Math.max(MIN_ATTEMPT_MS, budget - 8_000) });
        if (isM0) result.score = snapM0Score(result.score);
        const subid = genSubid();

      // 成功：更新任务状态
      await db.collection('steps_grading_tasks').updateOne(
        { taskId },
        { $set: { status: 'done', handledBy: 'api', usedModel: modelKey, result: { score: result.score, comment: result.comment }, rawReply: result.rawReply.slice(0, 4000), elapsedMs: result.elapsed, completedAt: new Date(), subid } }
      );

      // 写入 submissions
      const finalScore = result.score;
      stage('save', 'Recording your result…');
      await db.collection('submissions').insertOne({
        subid, username: decoded.username, problemId: String(problemId), type: 'steps',
        timestamp: new Date(), status: encodeStatus({ score: finalScore }),
        comment: result.comment, answer: steps.trim(), markedAt: new Date(),
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
      await addAiUsage(db, decoded.username, charged).catch(() => {});

      auditLog(db, 'steps_grade', { problemId, score: finalScore, taskId, model: modelKey, handledBy: 'api' }, decoded.username, 'info').catch(() => {});

      // ⭐ 同步返回完成结果
      return respond(200, {
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
      errors.push(`${modelKey}#${pass + 1}: ${msg}`);

      const isLastModel = mi === chain.length - 1;
      const isLastPass = pass === ATTEMPTS - 1;
      // 本轮最后一个模型失败、且还有下一轮时，这条可以省掉 ——
      // 下一轮开头那句 "trying the whole chain once more" 已经说明了
      if (!(isLastModel && !isLastPass)) {
        stage('retry',
          isLastPass ? `${modelKey} did not answer`
            : `${modelKey} did not answer, trying the next model…`,
          { model: modelKey, error: msg, attempt: mi + 1, total: chain.length, pass: pass + 1 });
      }

      // 401/402/403 这类：不是"忙"，是"这条路走不通"，重试没有意义
      if (err.permanent) { authRejected = true; break; }
    }
    }

    if (authRejected) break;
  }

  // 两轮都失败：收尾并明确告知，不再交给本地 grader。
  // 必须把 task 标成 error —— bridge 只扫 pending，留一个 pending
  // 等于把已经放弃的任务重新排进队列。
  const detail = await markTaskFailed(db, taskId, errors, { apiAttempts: ATTEMPTS });
  console.warn(`[steps-grade] gave up on ${taskId} after ${ATTEMPTS} passes: ${detail}`);

  return respond(200, {
    success: false,
    status: 'error',
    code: 'AI_UNAVAILABLE',
    message: authRejected ? AUTH_FAIL_MESSAGE : GIVE_UP_MESSAGE,
    attempts: ATTEMPTS,
  });
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
          timestamp: new Date(), status: encodeStatus({ score: finalScore }), comment,
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
        const pollCharge = isPeakHour() ? baseCharge * 2 : baseCharge;
        await consumeTokens(db, claimed.username, pollCharge);
        await addAiUsagePoll(db, claimed.username, pollCharge).catch(() => {});
      } catch (e) { console.error('[steps-grade] poll write failed:', e); }

      if (subid) await db.collection('steps_grading_tasks').updateOne({ taskId }, { $set: { subid } });
      return res.status(200).json({ success: true, status: 'done', result: { score: finalScore, comment }, subid, contestScore });
    }
    return res.status(200).json({ success: true, status: 'done', result: { score: -100, comment: 'AI error' }, subid: null });
  }
  return res.status(200).json({ success: true, status: 'unknown' });
}

export const config = { maxDuration: 300, regions: ['hkg1'] };
// bridge 回传路径的用量累加（handlePoll 里没有 handleCreate 的闭包）
async function addAiUsagePoll(db, username, amount) {
  const { addAiUsage } = await import('../lib/aiQuota.js');
  return addAiUsage(db, username, amount);
}

// AI 批改可能跑几十秒：不参与并发闸门，否则会占着槽位饿死普通请求。
// 连接池上限（lib/mongo.js）仍然管着它的连接数，这里只是不排队。
export default wrapHandler(handler, { gate: false });