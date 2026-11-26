// api/submit.js
// ═══════════════════════════════════════════════════════════
//  Submission pipeline
//  1. Auth & rate limit
//  2. Resolve team context (special contest)
//  3. Validate payload
//  4. Judge (numeric or logic, contest or non-contest)
//  5. Persist (submission + userstats + contest_results)
//  6. Hook achievements & respond
// ═══════════════════════════════════════════════════════════

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { waitUntil } from '@vercel/functions';
import { wrapHandler } from '../lib/errors.js';
import { isRetryableDBError } from '../lib/mongo.js';
import { encodeStatus } from '../lib/submission-status.js';
import { guestBlockedFromProblem } from '../lib/guestGuard.js';
import { maybeNeko } from '../lib/neko.js';
import {
  generateSubid,
  judge,
  updateUserStats,
  detectTeamContext,
  findUserActiveContests,
  applyContestScore,
  rewardFirstAC,
  runPostSubmit,
} from '../lib/submission.js';

// ═══════════════ Constants ═══════════════
// 三个桶，都按用户名计：
//   单题   RATE_MAX_PER_MIN     10 次/分钟（维持原有行为）
//   批量   BATCH_MAX_PER_MIN     3 批/分钟（以前批量完全不受限）
//   题量   PROBLEMS_MAX_PER_MIN 120 题/分钟（总闸，单题与批量合计）
// 分成三个而不是一个，是因为 100 题的答题卡和 100 次单题点击成本完全不同：
// 前者一次请求、后者一百次往返。总闸只负责挡住「批量刷题」这种放大用法。
const RATE_MAX_PER_MIN = 10;
const BATCH_MAX_PER_MIN = 3;
const PROBLEMS_MAX_PER_MIN = 120;
const RATE_WINDOW_MS = 60_000;
const CLIENT_TS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANSWER_MAX_LEN = 500;
const PID_MAX_LEN = 12;
const BATCH_MAX = 100;

// ═══════════════ Rate limit (in-memory) ═══════════════
const userRateLimit = new Map();
const RATE_ENTRY_TTL_MS = 5 * 60_000;   // 5 分鐘沒動就刪
const RATE_CLEANUP_MS = 60_000;
let _lastRateCleanup = 0;

function cleanupUserRateLimit(now) {
  if (now - _lastRateCleanup < RATE_CLEANUP_MS) return;
  _lastRateCleanup = now;
  for (const [user, rec] of userRateLimit) {
    if (now - rec.firstTime > RATE_ENTRY_TTL_MS) {
      userRateLimit.delete(user);
    }
  }
}

/**
 * 扣用户配额。
 *
 * units 是这次请求的题数：单题 1，批量等于本批题数（上限 BATCH_MAX）。
 *
 * 以前批量提交在 checkUserRateLimit 之前就 `return` 了 —— 一条 100 题的
 * 批量请求判 100 次、写 100 行，却连一次计数都不花，等于一条完全免费的放大器。
 *
 * @param {string} username
 * @param {number} units
 * @param {{batch?: boolean}} [opts]
 * @returns {{ok: true} | {ok: false, retryAfter: number, message: string}}
 */
function consumeUserQuota(username, units = 1, opts = {}) {
  const t = Date.now();
  cleanupUserRateLimit(t);

  const cost = Math.max(1, Math.min(Math.floor(Number(units)) || 1, BATCH_MAX));

  let rec = userRateLimit.get(username);
  if (!rec || t - rec.firstTime > RATE_WINDOW_MS) {
    rec = { singles: 0, batches: 0, problems: 0, firstTime: t };
    userRateLimit.set(username, rec);
  }
  if (!Number.isFinite(rec.singles)) rec.singles = 0;
  if (!Number.isFinite(rec.batches)) rec.batches = 0;
  if (!Number.isFinite(rec.problems)) rec.problems = 0;

  const retryAfter = Math.max(1, Math.ceil((rec.firstTime + RATE_WINDOW_MS - t) / 1000));

  if (opts.batch && rec.batches >= BATCH_MAX_PER_MIN) {
    return {
      ok: false,
      retryAfter,
      message: `Too many batch submissions (${BATCH_MAX_PER_MIN}/min). Please wait ${retryAfter}s.`,
    };
  }
  if (!opts.batch && rec.singles >= RATE_MAX_PER_MIN) {
    return {
      ok: false,
      retryAfter,
      message: `Too many submissions (${RATE_MAX_PER_MIN}/min). Please wait ${retryAfter}s.`,
    };
  }
  if (rec.problems + cost > PROBLEMS_MAX_PER_MIN) {
    return {
      ok: false,
      retryAfter,
      message: `Too many problems submitted (${PROBLEMS_MAX_PER_MIN}/min). Please wait ${retryAfter}s.`,
    };
  }

  if (opts.batch) rec.batches += 1;
  else rec.singles += 1;
  rec.problems += cost;
  return { ok: true };
}

/** 配额用尽时统一回 429 —— 带 Retry-After，客户端可以据此自动退避 */
function rejectQuota(res, quota) {
  res.setHeader('Retry-After', String(quota.retryAfter));
  return res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: quota.message,
    retryAfter: quota.retryAfter,
  });
}

// ═══════════════ Achievements hook ═══════════════

/** 更新 streak + 检查成就，并把解锁结果写回响应体（共用 lib/submission.js） */
async function finishSubmit(db, username, result, context = {}) {
  const { unlocked, rewarded, expand } = await runPostSubmit(db, username, context);
  if (unlocked && unlocked.length) {
    result.unlockedAchievements = expand(unlocked);
    result.achievementReward = rewarded;
  }
  return result;
}

async function sendSuccess(db, username, res, result, context = {}) {
  // 这里必须真的跑一次成就检查。
  //
  // 以前这块注释写着「已经由 finishSubmit 跑过」，但 finishSubmit 从头到尾
  // 没有任何调用点，于是普通提交的成就从来没被检查、也没被广播过 ——
  // 只有课程画板和论文页因为自己有独立的调用才正常。
  try {
    const out = await runPostSubmit(db, username, context);
    if (out.unlocked && out.unlocked.length) {
      result.unlockedAchievements = out.expand(out.unlocked);
      result.achievementReward = out.rewarded;
    }
  } catch (e) {
    // 成就坏了不能把判分结果一起拖下水
    console.error('[submit] achievement check failed:', e);
  }

  // 全局 token 计数：原子 $inc，失败不影响本次提交
  try {
    const used = Number(result.tokenUsage) || 0;
    if (used > 0) {
      const { addTokensUsed } = await import('../lib/token-meter.js');
      await addTokensUsed(db, used);
    }
  } catch (e) {
    console.error('[submit] token meter failed:', e);
  }

  // 小群体的彩蛋：开了 nekos 的人，提交成功时顺手带一张猫娘图。
  // 只有 smallGroup 成员能开这个开关；任何异常都静默，绝不影响提交结果。
  try {
    if (result && result.success !== false) {
      const neko = await maybeNeko(db, username);
      if (neko) result.neko = neko;
    }
  } catch (e) {
    console.error('[submit] neko failed:', e && e.message);
  }

  res.status(200).json(result);
}



// ═══════════════ Validation ═══════════════
function validateSingleSubmission(body) {
  const { problemId, answer, type = 'text', image = '' } = body || {};

  if (typeof answer === 'string' && answer.length > ANSWER_MAX_LEN) {
    return { error: `Answer length exceeds ${ANSWER_MAX_LEN}` };
  }
  if (typeof problemId !== 'string' || problemId.length > PID_MAX_LEN) {
    return { error: 'Invalid problem id' };
  }
  if (!problemId) return { error: 'Missing problemId' };
  if (type === 'text' && answer === undefined) return { error: 'Missing answer' };
  if (type === 'image' && !image) return { error: 'Missing image data' };

  return { problemId: String(problemId).trim(), answer, type, image };
}

function resolveSubmitTime(body, now) {
  const ct = body && body.clientTimestamp;
  if (!ct) return now;
  try {
    const t = new Date(ct);
    if (isNaN(t.getTime())) return now;
    const age = now.getTime() - t.getTime();
    if (age >= 0 && age <= CLIENT_TS_MAX_AGE_MS) return t;
  } catch {}
  return now;
}

// ═══════════════ Main handler ═══════════════
async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const now = new Date();
  const submitTime = resolveSubmitTime(req.body, now);

  const rawUsername = decoded.username;
  const role = decoded.role;

  // ── Role check ──
  if (!['student', 'admin', 'root'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Only active users can submit' });
  }

  // ── Batch mode (separate flow) ──
  // 入参校验与配额都在 handleBatch 里先做完，超限的批量请求连数据库都不会碰。
  if (req.query?.action === 'batch') {
    return handleBatch(req, res, rawUsername, now);
  }

  // ── Rate limit (single submissions) ──
  // 同样放在连接之前：被限流的请求不该再花一次握手和一条连接。
  const singleQuota = consumeUserQuota(rawUsername, 1);
  if (!singleQuota.ok) return rejectQuota(res, singleQuota);

  const db = await connectToDatabase();

  // ── Validate ──
  const v = validateSingleSubmission(req.body);
  const pageDwellMs =
  typeof req.body?.pageDwellMs === 'number' && req.body.pageDwellMs >= 0
    ? Math.min(req.body.pageDwellMs, 3600_000)   // 上限 1 小时
    : undefined;
  if (v.error) return res.status(400).json({ success: false, message: v.error });
  const { problemId: pid, answer, type, image } = v;

  // ═══════════════ Team context (special contest) ═══════════════
  const teamContext = await detectTeamContext(db, rawUsername, pid, now);
  let effectiveUsername = rawUsername;
  let teamMeta = null;

  if (teamContext) {
    if (!teamContext.inContest) {
      return res.status(403).json({
        success: false,
        message: 'You cannot submit other problems during a special contest',
      });
    }

    const { team, contest } = teamContext;
    const teamUsername = String(team.id);

    // Lock check
    const locked = await db.collection('contest_results').findOne({
      contestId: contest.id, username: teamUsername, problemId: pid,
    });
    if (locked?.locked) {
      return res.status(400).json({
        success: false,
        message: 'Problem is WA-locked (0 pts permanent)',
      });
    }

    // Mode 1 + non-captain → suggestion only
    if (team.mode === 1 && rawUsername !== team.captain) {
      const ans = String(answer || '').trim();
      if (!ans) return res.status(400).json({ success: false, message: 'Empty answer' });

      const existing = (team.suggestions || []).findIndex(
        s => s.username === rawUsername && s.problemId === pid
      );
      const suggestion = { username: rawUsername, problemId: pid, answer: ans, ts: now };

      if (existing >= 0) {
        await db.collection('teams').updateOne(
          { id: team.id },
          { $set: { [`suggestions.${existing}`]: suggestion } }
        );
      } else {
        await db.collection('teams').updateOne(
          { id: team.id },
          { $push: { suggestions: suggestion } }
        );
      }
      return res.status(200).json({ success: true, suggested: true, message: 'Suggestion sent' });
    }

    // Mode 2 or captain → submit as team
    effectiveUsername = teamUsername;
    teamMeta = {
      teamUsername,
      contestId: contest.id,
      submittedBy: rawUsername,
    };
  }

  // ═══════════════ Single submit ═══════════════
  try {
    await handleSingleSubmit({
      db, res,
      now, submitTime,
      rawUsername,
      effectiveUsername,
      role,
      pid, answer, type, image,
      teamContext, teamMeta,
      pageDwellMs,   
    });
  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════ Single submission flow ═══════════════

async function handleSingleSubmit(ctx) {
  const {
    db, res, now, submitTime,
    rawUsername, effectiveUsername, role,
    pid, answer, type, image,
    teamContext, teamMeta,
    pageDwellMs,
  } = ctx;

  // ── Load problem + user's active contests ──
  const [problem, activeContests] = await Promise.all([
    db.collection('problems').findOne({ id: pid }),
    teamContext
      ? Promise.resolve([])                          // team: use teamContext.contest
      : findUserActiveContests(db, effectiveUsername, now),
  ]);

  if (!problem) {
    return res.status(404).json({ success: false, message: 'Problem not found' });
  }
  // 访客不能提交华夏杯（HX）的题
  if (guestBlockedFromProblem({ username: effectiveUsername, role }, pid)) {
    return res.status(404).json({ success: false, message: 'Problem not found' });
  }
  // ⭐ FS（forced steps）：禁止 text 提交（admin/root 例外，方便测试）
  if (problem.FS === true && type === 'text'
      && role !== 'admin' && role !== 'root') {
    return res.status(400).json({
      success: false,
      message: 'This problem requires the AI-graded steps mode or image submission. Please use the Steps tab.',
    });
  }

  // ── Determine contest membership ──
  let activeContest = null;
  let contestProblem = null;

  for (const c of activeContests) {
    const cp = c.problems?.find(p => p.problemId === pid);
    if (cp) {
      activeContest = c;
      contestProblem = cp;
      break;
    }
  }

  // Team fallback: force team contest
  if (!activeContest && teamMeta && teamContext) {
    activeContest = teamContext.contest;
    const cp = (activeContest.problems || []).find(p => {
      const id = (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p);
      return id === pid;
    });
    contestProblem = cp
      ? { problemId: pid, evalType: cp.evalType || 'numeric' }
      : { problemId: pid, evalType: 'numeric' };
  }
  const inContest = !!activeContest;

  // ── Access control ──
  if (role === 'student' && !inContest && problem.public === false) {
    return res.status(404).json({ success: false, message: 'Problem not found' });
  }

  // ── Image upload (needed before persist) ──
  let imageUrl = '';
  if (type === 'image') {
    try {
      const { uploadImage } = await import('../lib/cloudinary.js');
      imageUrl = await uploadImage(image);
    } catch {
      return res.status(500).json({ success: false, message: 'Image upload failed' });
    }
  }

  // ── Base submission doc ──
  // 结果只存一个 status（见 lib/submission-status.js）。
  // 图片提交此刻还没批分，所以先不写 status —— 那正是「Pending」的含义。
  const submissionData = {
    username: effectiveUsername,
    problemId: pid,
    type,
    timestamp: submitTime,
    comment: '',
    subid: generateSubid(),
    answer: type === 'text' ? String(answer) : '',
    image: imageUrl,
  };
  if (teamMeta) {
    submissionData.submittedBy = teamMeta.submittedBy;
    submissionData.approvedBy = teamMeta.submittedBy;
  }

  // ── Contest evalType validation ──
  if (inContest) {
    const evalType = contestProblem.evalType || 'numeric';
    if (evalType === 'numeric' && type !== 'text') {
      return res.status(400).json({
        success: false,
        message: 'This problem requires a numeric answer',
      });
    }
    if (evalType === 'image_model' && type !== 'image') {
      return res.status(400).json({
        success: false,
        message: 'This problem requires a photo answer',
      });
    }
    submissionData.contestId = activeContest.id;
  }

  // ═══════════════════════════════════════════════════
  //  Contest submission
  // ═══════════════════════════════════════════════════
  if (inContest) {
    const isSpecial = !!activeContest.special;

    // Load existing contest result
    const resultDoc = await db.collection('contest_results').findOne(
      { contestId: activeContest.id, username: effectiveUsername, problemId: pid },
      { projection: { wrongAttempts: 1, score: 1, solved: 1, locked: 1 } }
    );
    if (resultDoc?.locked === true) {
      return res.status(400).json({ success: false, message: 'Problem is WA-locked' });
    }


    // Image in contest → save & wait for manual marking
    if (type === 'image') {
      await db.collection('submissions').insertOne(submissionData);
      return sendSuccess(db, rawUsername, res, {
        success: true,
        subid: submissionData.subid,
        imageUrl: submissionData.image,
        status: 'Pending',
        message: 'Image submitted',
      });
    }

    // Text in contest → auto-judge
    const jr = await judge({ problem, answer });

    // 结果只存 status；这五条旧字段在状态重构后已经不该再写
    submissionData.status = encodeStatus({ score: jr.score, correct: jr.correct, systemError: jr.systemError });
    submissionData.comment = jr.comment;

    await db.collection('submissions').insertOne(submissionData);

    let currentScore = resultDoc?.score || 0;

    if (!jr.systemError) {
      // 计分（惩罚、partial、special 锁定）统一在 lib/submission.js 里算
      const applied = await applyContestScore(db, {
        contestId: activeContest.id,
        username: effectiveUsername,
        problemId: pid,
        correct: jr.correct,
        score: jr.score,
        isSpecial,
        now,
      });

      currentScore = applied.score;

      if (jr.correct) {
        const isFirstAC = await updateUserStats(db, effectiveUsername, pid, true);
        if (isFirstAC) {
          await rewardFirstAC(db, { username: effectiveUsername, rawUsername, problem });
        }
      }

      // 注意：不要把 submissionData.score 改成衰减后的分数 ——
      // 提交记录保留真实判分，衰减只作用于 contest_results 里的排名分
    }

    return sendSuccess(db, rawUsername, res, {
      success: true,
      subid: submissionData.subid,
      status: encodeStatus({ score: jr.score, correct: jr.correct, systemError: jr.systemError }),
      score: jr.score,             // 给客户端的是真实分数
      contestScore: currentScore,  // 服务器计分（带惩罚）另外给一份，便于调试/展示排名
      message: jr.systemError
        ? 'Logic execution failed'
        : (jr.marked ? 'Judged by custom logic' : undefined),
    }, {
      justAC: jr.correct,
      problemId: pid,
      pageDwellMs,
    });
  }

  // ═══════════════════════════════════════════════════
  //  Non-contest submission
  // ═══════════════════════════════════════════════════

  // Image outside contest → wait for marking
  if (type === 'image') {
    await db.collection('submissions').insertOne(submissionData);
    return sendSuccess(db, rawUsername, res, {
      success: true,
      subid: submissionData.subid,
      imageUrl: submissionData.image,
      status: 'Pending',
      message: 'Image submitted for marking',
    });
  }

  // Text → judge
  const jr = await judge({ problem, answer });

  submissionData.comment = jr.comment;
  submissionData.status = encodeStatus({ score: jr.score, correct: jr.correct, systemError: jr.systemError });

  await db.collection('submissions').insertOne(submissionData);

  if (!jr.systemError) {
    const isFirstAC = await updateUserStats(db, effectiveUsername, pid, jr.correct);
    if (isFirstAC) {
      await rewardFirstAC(db, { username: effectiveUsername, rawUsername, problem });
    }
  }

    return sendSuccess(db, rawUsername, res, {
      success: true,
      subid: submissionData.subid,
      status: encodeStatus({ score: jr.score, correct: jr.correct, systemError: jr.systemError }),
      score: jr.score,
      // 答题卡要拿这句话画逐题对错，必须带出去
      comment: jr.comment || '',
      message: jr.systemError
        ? 'Logic execution failed'
        : (jr.marked ? 'Judged by custom logic' : undefined),
    }, {
      justAC: jr.correct,
      problemId: pid,
      pageDwellMs,
    });
}

// ═══════════════ Batch submission flow ═══════════════

async function handleBatch(req, res, username, now) {
  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const { paperId, answers } = body;
  if (!paperId || !answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: 'Missing paperId or answers' });
  }
  if (String(paperId).length > PID_MAX_LEN) {
    return res.status(400).json({ success: false, message: 'Invalid paper id' });
  }

  const answerIds = Object.keys(answers).slice(0, BATCH_MAX);
  if (answerIds.length === 0) {
    return res.status(400).json({ success: false, message: 'No answers' });
  }

  // 批量走自己的桶（3 批/分钟），题数另外计入 120 题/分钟的总闸。
  // 计费按 key 数而不是「成功判了几题」，所以塞一堆假 ID 一样要付钱。
  const quota = consumeUserQuota(username, answerIds.length, { batch: true });
  if (!quota.ok) return rejectQuota(res, quota);

  try {
    const db = await connectToDatabase();

    const paper = await db.collection('problems').findOne(
      { id: String(paperId) },
      { projection: { id: 1, _id: 0 } }
    );
    if (!paper) {
      return res.status(404).json({ success: false, message: 'Paper not found' });
    }

    const problems = await db.collection('problems')
      .find({ id: { $in: answerIds } })
      .toArray();
    const problemMap = Object.fromEntries(problems.map(p => [p.id, p]));

    const statsDoc = await db.collection('userstats').findOne(
      { username },
      { projection: { states: 1, _id: 0 } }
    );
    const userStates = statsDoc?.states || {};

    const results = [];
    const inserts = [];
    const setObj = {};
    let submittedCount = 0;

    for (const pid of answerIds) {
      // 题号是客户端给的 key，先卡长度再拿来查库/入库，否则它可以被写成任意长字符串
      if (typeof pid !== 'string' || !pid || pid.length > PID_MAX_LEN) {
        results.push({ problemId: String(pid).slice(0, 32), error: 'Invalid problem id', skipped: true });
        continue;
      }

      const prob = problemMap[pid];
      if (!prob) {
        results.push({ problemId: pid, error: 'Problem not found', skipped: true });
        continue;
      }
      if (userStates[pid] === 'passed') {
        results.push({ problemId: pid, alreadyAC: true, skipped: true });
        continue;
      }

      const userAnswer = String(answers[pid] ?? '').trim();
      if (!userAnswer) {
        results.push({ problemId: pid, error: 'Empty answer', skipped: true });
        continue;
      }
      // 和单题同一条上限：单题在 validateSingleSubmission 里卡 500 字，
      // 批量原来完全不卡，等于留了一条把任意大字符串写进 submissions 的路。
      if (userAnswer.length > ANSWER_MAX_LEN) {
        results.push({ problemId: pid, error: `Answer length exceeds ${ANSWER_MAX_LEN}`, skipped: true });
        continue;
      }

      // 单题判题抛错不该让整批 500：客户端会把已经判好的结果一起丢掉，
      // 用户重试又会对那些题重复提交。这里降级成该题失败，其余照常。
      let jr;
      try {
        jr = await judge({ problem: prob, answer: userAnswer });
      } catch (err) {
        console.error('[submit] batch judge failed:', pid, err);
        results.push({ problemId: pid, error: 'Judge failed', systemError: true, skipped: true });
        continue;
      }

      const subid = generateSubid();
      inserts.push({
        username,
        problemId: pid,
        type: 'text',
        timestamp: now,
        status: encodeStatus({ score: jr.score, correct: jr.correct, systemError: jr.systemError }),
        comment: jr.comment,
        subid,
        answer: userAnswer,
        image: '',
        paperId: String(paperId),
      });

      if (!jr.systemError) {
        if (jr.correct) setObj[`states.${pid}`] = 'passed';
        else if (userStates[pid] !== 'passed') setObj[`states.${pid}`] = 'failed';
      }

      results.push({
        problemId: pid,
        subid,
        status: encodeStatus({ score: jr.score, correct: jr.correct, systemError: jr.systemError }),
        score: jr.score,
        comment: jr.comment,
      });
      submittedCount++;
    }

    if (inserts.length > 0) {
      await db.collection('submissions').insertMany(inserts, { ordered: false });
    }
    if (Object.keys(setObj).length > 0) {
      const col = db.collection('userstats');
      await col.updateOne(
        { username },
        { $setOnInsert: { username, states: {} } },
        { upsert: true }
      );
      await col.updateOne({ username }, { $set: setObj });
    }

    return sendSuccess(db, username, res, {
      success: true,
      results,
      submittedCount,
    });
  } catch (err) {
    console.error('Batch submit error:', err);
    // 冷启动 / 池繁忙 / 维护窗口：过两秒再来，不是 500
    if (err && (err.code === 'DB_BUSY' || isRetryableDBError(err))) {
      res.setHeader('Retry-After', '2');
      return res.status(503).json({
        success: false,
        code: 'BUSY',
        message: 'Database is unavailable, please retry in a moment',
      });
    }
    // 不要把 err.message 直接回给客户端 —— 里面的路径、主机名、驱动报错
    // 只有 admin/root 该看到（wrapHandler 的 sendCatch 就是这么做的）。
    return res.status(500).json({ success: false, message: 'Batch submission failed' });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);