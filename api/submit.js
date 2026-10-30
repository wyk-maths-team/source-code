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
import { runCustomLogic } from '../lib/logic-runner.js';
import crypto from 'crypto';
import { json } from 'stream/consumers';
import { waitUntil } from '@vercel/functions';
import { wrapHandler } from '../lib/errors.js';

// ═══════════════ Constants ═══════════════
const RATE_MAX_PER_MIN = 10;
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

function checkUserRateLimit(username) {
  const t = Date.now();
  cleanupUserRateLimit(t);   // ⭐ 加這行
  const rec = userRateLimit.get(username);
  if (!rec) {
    userRateLimit.set(username, { count: 1, firstTime: t });
    return true;
  }
  if (t - rec.firstTime > RATE_WINDOW_MS) {
    rec.count = 1;
    rec.firstTime = t;
    return true;
  }
  if (rec.count >= RATE_MAX_PER_MIN) return false;
  rec.count++;
  return true;
}

// ═══════════════ Primitives ═══════════════
function generateSubid() {
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(6).toString('base64url').slice(0, 8);
  return ts + rnd;
}

function isValidNumericAnswer(value) {
  if (value === '' || value === null || value === undefined) return false;
  return Number.isFinite(Number(String(value).trim()));
}

function compareNumeric(ansStr, userAnswer) {
  const ans = Number(ansStr);
  if (!Number.isFinite(ans)) return { correct: false, systemError: true };
  const user = Number(userAnswer);
  if (!Number.isFinite(user)) return { correct: false, systemError: true };
  return { correct: Math.abs(user - ans) < 1e-6, systemError: false };
}

// 更新用户做题状态，同时增量维护成就系统需要的计数。
//
// 以前成就统计靠每次扫 submissions 现算（O(Sᵤ log Sᵤ)），现在在这里顺手累加：
//   firstTryCount —— 某道题第一次尝试就 AC
//   todayTried    —— 今天尝试过的题目（去重，跨天清空）
//   todayAC       —— 今天 AC 过的题目（去重，跨天清空）
// 读取端（lib/achievements.js collectStats）只看 userstats 就够，不再触碰 submissions。
async function updateUserStats(db, username, pid, correct) {
  const col = db.collection('userstats');
  const { getHktToday, STATS_VERSION } = await import('../lib/achievements.js');
  const today = getHktToday();

  let doc = await col.findOne({ username }, {
    projection: { states: 1, firstTryCount: 1, todayDate: 1, todayTried: 1, todayAC: 1, statsVersion: 1, _id: 1 },
  });

  // 老用户还没回填：先补齐一次，否则 firstTryCount 会从 0 开始算错
  if (doc && doc.statsVersion !== STATS_VERSION) {
    const { collectStats } = await import('../lib/achievements.js');
    await collectStats(db, username, { fresh: true });
    doc = await col.findOne({ username }, {
      projection: { states: 1, firstTryCount: 1, todayDate: 1, todayTried: 1, todayAC: 1, statsVersion: 1, _id: 1 },
    });
  }

  const states = doc?.states || {};
  const wasAttempted = Object.prototype.hasOwnProperty.call(states, pid);
  const wasPassed = states[pid] === 'passed';

  // 跨天重置
  const sameDay = doc?.todayDate === today;
  const todayTried = (sameDay && Array.isArray(doc.todayTried)) ? doc.todayTried.slice() : [];
  const todayAC = (sameDay && Array.isArray(doc.todayAC)) ? doc.todayAC.slice() : [];

  if (!todayTried.includes(pid)) todayTried.push(pid);
  if (correct && !todayAC.includes(pid)) todayAC.push(pid);

  const set = {
    todayDate: today,
    todayTried,
    todayAC,
    statsVersion: STATS_VERSION,
  };

  // firstTryCount 用 $inc 避免并发覆盖
  const inc = {};
  if (correct && !wasAttempted) inc.firstTryCount = 1;

  if (correct) {
    set[`states.${pid}`] = 'passed';
  } else if (!wasPassed) {
    set[`states.${pid}`] = 'failed';
  }

  const update = { $set: set, $setOnInsert: { username } };
  if (Object.keys(inc).length) update.$inc = inc;

  await col.updateOne({ username }, update, { upsert: true });

  // 新 AC 会让 rating 变化：清掉内存缓存，否则接下来 60 秒内 profile 会显示旧 rating
  if (correct && !wasPassed) {
    const { invalidateUserRating } = await import('../lib/userRating.js');
    invalidateUserRating(username);
  }

  // ⭐ 返回是否是新 AC（之前没 passed，现在 passed 了）
  return correct && !wasPassed;
}

// ═══════════════ Judging (pure — no DB writes) ═══════════════

/**
 * 判分（无论竞赛/非竞赛、logic/数值）
 * @returns {{ correct, systemError, score, comment, marked }}
 */
async function judge({ problem, answer }) {
  const hasLogic = typeof problem.logic === 'string' && problem.logic.trim() !== '';

  if (hasLogic) {
    const r = await runCustomLogic(problem.logic, problem.ans, answer);
    return {
      correct: !r.systemError && r.score === 100,
      systemError: !!r.systemError,
      score: r.systemError ? 0 : r.score,
      comment: r.comment || '',
      marked: true,
    };
  }

  const ansStr = String(problem.ans ?? '').trim();
  if (!isValidNumericAnswer(ansStr)) {
    return { correct: false, systemError: true, score: 0, comment: '', marked: false };
  }
  const cmp = compareNumeric(ansStr, answer);
  return {
    correct: cmp.correct,
    systemError: cmp.systemError,
    score: cmp.correct ? 100 : 0,
    comment: '',
    marked: false,
  };
}

// ═══════════════ Contest helpers ═══════════════

/** 检测用户是否在活跃的 special contest 队伍中 */
async function detectTeamContext(db, username, pid, now) {
  const specials = await db.collection('contests').find({
    special: true,
    startTime: { $lte: now },
    $expr: { $gte: [{ $add: ['$startTime', { $multiply: ['$duration', 60000] }] }, now] },
  }, { projection: { id: 1, problems: 1, _id: 0 } }).toArray();

  for (const c of specials) {
    const team = await db.collection('teams').findOne({
      contestId: c.id,
      members: username,
    });
    if (!team) continue;

    const inContest = (c.problems || []).some(p => {
      const id = (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p);
      return id === pid;
    });
    return { team, contest: c, inContest };
  }
  return null;
}

/** 查找用户参与的活跃竞赛（普通参赛者） */
async function findUserActiveContests(db, username, now) {
  return db.collection('contests').find({
    participants: username,
    startTime: { $lte: now },
    $expr: {
      $gte: [
        { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
        now,
      ],
    },
  }, { projection: { id: 1, problems: 1, special: 1 } }).toArray();
}

// ═══════════════ Achievements hook ═══════════════

/** 更新 streak + 检查成就。Team 虚拟用户（纯数字）跳过 */
async function finishSubmit(db, username, result, context = {}) {
  try {
    if (/^\d+$/.test(username)) return result;

    const { updateStreak, checkAchievements, expandAchievementInfo } =
      await import('../lib/achievements.js');

    await updateStreak(db, username);

    if (context.justAC && context.problemId && context.problemSubmitCount === undefined) {
      context.problemSubmitCount = await db.collection('submissions').countDocuments({
        username,
        problemId: context.problemId,
      });
    }

    const { unlocked, rewarded } = await checkAchievements(db, username, { trigger: 'submit', ...context });

    // ⭐ 展开成完整对象返回给前端
    if (unlocked.length) {
      result.unlockedAchievements = expandAchievementInfo(unlocked);
      result.achievementReward = rewarded;
    }
  } catch (e) {
    console.error('[achievements]', e);
  }
  return result;
}

async function sendSuccess(db, username, res, result, context = {}) {
  // 1) 立刻发响应
  res.status(200).json(result);

  // 2) 成就检查继续跑 —— Vercel 保证不 kill
  if (!/^\d+$/.test(username)) {
    const bg = (async () => {
      try {
        const { updateStreak, checkAchievements } = await import('../lib/achievements.js');
        await updateStreak(db, username);
        await checkAchievements(db, username, { trigger: 'submit', ...context });
      } catch (e) {
        console.error('[achievements bg]', e);
      }
    })();
    waitUntil(bg);
  }
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

  const db = await connectToDatabase();
  const now = new Date();
  const submitTime = resolveSubmitTime(req.body, now);

  const rawUsername = decoded.username;
  const role = decoded.role;

  // ── Role check ──
  if (!['student', 'admin', 'root'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Only active users can submit' });
  }

  // ── Batch mode (separate flow) ──
  if (req.query.action === 'batch') {
    return handleBatch(req, res, db, rawUsername, now);
  }

  // ── Rate limit (single submissions) ──
  if (!checkUserRateLimit(rawUsername)) {
    return res.status(429).json({
      success: false,
      message: 'Too many submissions. Please wait a minute.',
    });
  }

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
  const submissionData = {
    username: effectiveUsername,
    problemId: pid,
    type,
    timestamp: submitTime,
    correct: false,
    systemError: false,
    marked: false,
    score: 0,
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

    const alreadySolved = resultDoc?.solved === true;
    const prevWrong = resultDoc?.wrongAttempts || 0;

    // Image in contest → save & wait for manual marking
    if (type === 'image') {
      await db.collection('submissions').insertOne(submissionData);
      return sendSuccess(db, rawUsername, res, {
        success: true,
        subid: submissionData.subid,
        imageUrl: submissionData.image,
        correct: false,
        systemError: false,
        message: 'Image submitted',
      });
    }

    // Text in contest → auto-judge
    const jr = await judge({ problem, answer });

    submissionData.correct = jr.correct;
    submissionData.systemError = jr.systemError;
    submissionData.score = jr.score;
    submissionData.comment = jr.comment;
    submissionData.marked = jr.marked || !jr.systemError;

    await db.collection('submissions').insertOne(submissionData);

    let currentScore = resultDoc?.score || 0;

    if (!jr.systemError) {
      if (alreadySolved) {
        // Already AC'd → keep score, just bump time
        currentScore = resultDoc.score;
        await db.collection('contest_results').updateOne(
          { contestId: activeContest.id, username: effectiveUsername, problemId: pid },
          { $set: { lastSubmissionTime: now } }
        );
      } else if (jr.correct) {
        // First AC → apply penalty
        currentScore = Math.max(0, 100 * Math.pow(0.9, prevWrong));
        await db.collection('contest_results').updateOne(
          { contestId: activeContest.id, username: effectiveUsername, problemId: pid },
          { $set: { score: currentScore, solved: true, lastSubmissionTime: now } },
          { upsert: true }
        );
        await updateUserStats(db, effectiveUsername, pid, true);
      } else if (jr.score > 0) {
        // Partial
        currentScore = Math.max(resultDoc?.score || 0, jr.score);
        await db.collection('contest_results').updateOne(
          { contestId: activeContest.id, username: effectiveUsername, problemId: pid },
          { $set: { score: currentScore, solved: false, lastSubmissionTime: now } },
          { upsert: true }
        );
      } else {
        // WA
        const upd = {
          $inc: { wrongAttempts: 1 },
          $set: { lastSubmissionTime: now, solved: false },
          $setOnInsert: { score: 0 },
        };
        if (isSpecial) {
          upd.$set.score = 0;
          upd.$set.locked = true;
        }
        await db.collection('contest_results').updateOne(
          { contestId: activeContest.id, username: effectiveUsername, problemId: pid },
          upd,
          { upsert: true }
        );
      }
      submissionData.score = currentScore;
    }

    return sendSuccess(db, rawUsername, res, {
      success: true,
      subid: submissionData.subid,
      correct: jr.correct,
      systemError: jr.systemError,
      score: currentScore,         // 或 score: jr.score
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
      correct: false,
      systemError: false,
      message: 'Image submitted for marking',
    });
  }

  // Text → judge
  const jr = await judge({ problem, answer });

  submissionData.correct = jr.correct;
  submissionData.systemError = jr.systemError;
  submissionData.score = jr.score;
  submissionData.comment = jr.comment;
  submissionData.marked = jr.marked || !jr.systemError;

  await db.collection('submissions').insertOne(submissionData);

  if (!jr.systemError) {
    // ⭐ 接收返回值
    const isFirstAC = await updateUserStats(db, effectiveUsername, pid, jr.correct);
    
    // ⭐ 只有首次 AC 才发奖励
    if (isFirstAC ) {
      const guestRegex = /^G\d{3}$/;
      const { rewardAC } = await import('../lib/token.js');
      if(guestRegex.test(rawUsername))return res.status(403).json({error:'Guest account cannot earn tokens'});
      try {
        await rewardAC(db, effectiveUsername, problem.difficulty || 1);
      } catch(e) {
        console.error('[submit] reward failed:', e);
      }
    }
  }

    return sendSuccess(db, rawUsername, res, {
      success: true,
      subid: submissionData.subid,
      correct: jr.correct,
      systemError: jr.systemError,
      score: jr.score,         // 或 score: jr.score
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

async function handleBatch(req, res, db, username, now) {
  const { paperId, answers } = req.body || {};
  if (!paperId || !answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: 'Missing paperId or answers' });
  }

  const answerIds = Object.keys(answers).slice(0, BATCH_MAX);
  if (answerIds.length === 0) {
    return res.status(400).json({ success: false, message: 'No answers' });
  }

  try {
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

      const jr = await judge({ problem: prob, answer: userAnswer });

      const subid = generateSubid();
      inserts.push({
        username,
        problemId: pid,
        type: 'text',
        timestamp: now,
        correct: jr.correct,
        systemError: jr.systemError,
        marked: true,
        score: jr.score,
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
        correct: jr.correct,
        systemError: jr.systemError,
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
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);