// lib/submission.js —— 提交管线的共用部分
//
// api/submit.js（text / image）和 api/steps-grade.js（AI steps）要做的是同一件事：
//   判分 → 写 submissions → 更新 userstats → 竞赛计分 → 发奖 → 成就
// 以前两边各写一份，规则很容易走偏（例如 steps 判分只改 states，绕过了
// todayAC / firstTryCount / 竞赛计分 / token 奖励）。这里收成一份。

import crypto from 'crypto';
import { runCustomLogic } from './logic-runner.js';

export const GUEST_RE = /^G\d{3}$/;
export function isGuest(username) {
  return GUEST_RE.test(String(username || ''));
}

export function generateSubid() {
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(6).toString('base64url').slice(0, 8);
  return ts + rnd;
}

export function isValidNumericAnswer(value) {
  if (value === '' || value === null || value === undefined) return false;
  return Number.isFinite(Number(String(value).trim()));
}

export function compareNumeric(ansStr, userAnswer) {
  const ans = Number(ansStr);
  if (!Number.isFinite(ans)) return { correct: false, systemError: true };
  const user = Number(userAnswer);
  if (!Number.isFinite(user)) return { correct: false, systemError: true };
  return { correct: Math.abs(user - ans) < 1e-6, systemError: false };
}

/**
 * 判分（竞赛 / 非竞赛、logic / 数值都走这里）
 * @returns {{ correct, systemError, score, comment, marked }}
 */
export async function judge({ problem, answer }) {
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

// 更新做题状态，同时增量维护成就系统需要的计数。
//   firstTryCount —— 某道题第一次尝试就 AC
//   todayTried    —— 今天尝试过的题目（去重，跨天清空）
//   todayAC       —— 今天 AC 过的题目（去重，跨天清空）
export async function updateUserStats(db, username, pid, correct) {
  const col = db.collection('userstats');
  const { getHktToday, STATS_VERSION } = await import('./achievements.js');
  const today = getHktToday();

  let doc = await col.findOne({ username }, {
    projection: { states: 1, firstTryCount: 1, todayDate: 1, todayTried: 1, todayAC: 1, statsVersion: 1, _id: 1 },
  });

  if (doc && doc.statsVersion !== STATS_VERSION) {
    const { collectStats } = await import('./achievements.js');
    await collectStats(db, username, { fresh: true });
    doc = await col.findOne({ username }, {
      projection: { states: 1, firstTryCount: 1, todayDate: 1, todayTried: 1, todayAC: 1, statsVersion: 1, _id: 1 },
    });
  }

  const states = doc?.states || {};
  const wasAttempted = Object.prototype.hasOwnProperty.call(states, pid);
  const wasPassed = states[pid] === 'passed';

  const sameDay = doc?.todayDate === today;
  const todayTried = (sameDay && Array.isArray(doc.todayTried)) ? doc.todayTried.slice() : [];
  const todayAC = (sameDay && Array.isArray(doc.todayAC)) ? doc.todayAC.slice() : [];

  if (!todayTried.includes(pid)) todayTried.push(pid);
  if (correct && !todayAC.includes(pid)) todayAC.push(pid);

  const set = { todayDate: today, todayTried, todayAC, statsVersion: STATS_VERSION };
  const inc = {};
  if (correct && !wasAttempted) inc.firstTryCount = 1;

  if (correct) set[`states.${pid}`] = 'passed';
  else if (!wasPassed) set[`states.${pid}`] = 'failed';

  if (correct) set.consecutiveFail = 0;
  else inc.consecutiveFail = 1;

  const update = { $set: set, $setOnInsert: { username } };
  if (Object.keys(inc).length) update.$inc = inc;

  await col.updateOne({ username }, update, { upsert: true });

  if (correct && !wasPassed) {
    const { invalidateUserRating } = await import('./userRating.js');
    invalidateUserRating(username);
  }

  // 课程进度：某道题 AC 后，把所有引用了它的课程标记为做过
  // （幂等，重置进度后再次 AC 会重新记上）
  if (correct) {
    try {
      const courses = await db.collection('courses')
        .find({ pids: pid }, { projection: { track: 1, id: 1, _id: 0 } })
        .toArray();
      for (const c of courses) {
        await db.collection('courseProgress').updateOne(
          { username, track: c.track, courseId: c.id },
          { $addToSet: { solved: pid }, $set: { updatedAt: new Date() } },
          { upsert: true }
        );
      }
    } catch (e) {
      console.error('[course] progress update failed:', e);
    }
  }

  return correct && !wasPassed;
}

// ═══════════════ 竞赛 ═══════════════

export async function detectTeamContext(db, username, pid, now) {
  const specials = await db.collection('contests').find({
    special: true,
    startTime: { $lte: now },
    $expr: { $gte: [{ $add: ['$startTime', { $multiply: ['$duration', 60000] }] }, now] },
  }, { projection: { id: 1, problems: 1, _id: 0 } }).toArray();

  for (const c of specials) {
    const team = await db.collection('teams').findOne({ contestId: c.id, members: username });
    if (!team) continue;

    const inContest = (c.problems || []).some((p) => {
      const id = (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p);
      return id === pid;
    });
    return { team, contest: c, inContest };
  }
  return null;
}

export async function findUserActiveContests(db, username, now) {
  return db.collection('contests').find({
    participants: username,
    retired: { $ne: username },
    startTime: { $lte: now },
    $expr: { $gte: [{ $add: ['$startTime', { $multiply: ['$duration', 60000] }] }, now] },
  }, { projection: { id: 1, problems: 1, special: 1 } }).toArray();
}

/** 找出用户当前活跃、且包含这道题的竞赛 */
export async function findActiveContestForProblem(db, username, pid, now) {
  const list = await findUserActiveContests(db, username, now);
  for (const c of list) {
    const has = (c.problems || []).some((p) => {
      const id = (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p);
      return id === pid;
    });
    if (has) return c;
  }
  return null;
}

/**
 * 竞赛计分：服务器存的是「扣惩罚后的分数」（0.9^错题次数）。
 * 返回 { score, solved, locked }；locked 表示 special contest 里答错被锁。
 */
export async function applyContestScore(db, { contestId, username, problemId, correct, score, isSpecial, now }) {
  const col = db.collection('contest_results');
  const doc = await col.findOne(
    { contestId, username, problemId },
    { projection: { wrongAttempts: 1, score: 1, solved: 1, locked: 1 } }
  );

  if (doc?.locked === true) {
    return { locked: true, solved: false, score: Number(doc.score) || 0 };
  }

  const alreadySolved = doc?.solved === true;
  const prevWrong = Number(doc?.wrongAttempts) || 0;

  if (alreadySolved) {
    await col.updateOne({ contestId, username, problemId }, { $set: { lastSubmissionTime: now } });
    return { locked: false, solved: true, score: Number(doc.score) || 0 };
  }

  if (correct) {
    const final = Math.max(0, 100 * Math.pow(0.9, prevWrong));
    await col.updateOne(
      { contestId, username, problemId },
      { $set: { score: final, solved: true, lastSubmissionTime: now } },
      { upsert: true }
    );
    return { locked: false, solved: true, score: final };
  }

  if (Number(score) > 0) {
    const final = Math.max(Number(doc?.score) || 0, Number(score));
    await col.updateOne(
      { contestId, username, problemId },
      { $set: { score: final, solved: false, lastSubmissionTime: now } },
      { upsert: true }
    );
    return { locked: false, solved: false, score: final };
  }

  const upd = {
    $inc: { wrongAttempts: 1 },
    $set: { lastSubmissionTime: now, solved: false },
    $setOnInsert: { score: 0 },
  };
  if (isSpecial) {
    upd.$set.score = 0;
    upd.$set.locked = true;
  }
  await col.updateOne({ contestId, username, problemId }, upd, { upsert: true });
  return { locked: !!isSpecial, solved: false, score: 0 };
}

// ═══════════════ 奖励 ═══════════════

export async function rewardFirstAC(db, { username, rawUsername, problem }) {
  if (isGuest(rawUsername || username)) return 0;
  try {
    const { rewardAC } = await import('./token.js');
    return await rewardAC(db, username, problem?.difficulty || 1);
  } catch (e) {
    console.error('[submission] reward failed:', e);
    return 0;
  }
}

/**
 * 提交后的 side effect：streak + 成就。
 * 返回 { unlocked, rewarded, expand }；team 虚拟用户（纯数字）直接跳过。
 */
export async function runPostSubmit(db, username, context = {}) {
  if (/^\d+$/.test(String(username || ''))) return { unlocked: [], rewarded: 0, expand: () => [] };

  try {
    const { updateStreak, checkAchievements, expandAchievementInfo } = await import('./achievements.js');

    const prev = await db.collection('users').findOne({ username }, { projection: { lastActiveDate: 1 } });
    const longAbsence = (() => {
      const last = prev?.lastActiveDate;
      if (!last) return false;
      return (Date.now() - new Date(last).getTime()) / 86400000 > 30;
    })();

    await updateStreak(db, username);

    if (context.justAC && context.problemId && context.problemSubmitCount === undefined) {
      context.problemSubmitCount = await db.collection('submissions').countDocuments({
        username,
        problemId: context.problemId,
      });
    }

    const res = await checkAchievements(db, username, { trigger: 'submit', longAbsence, ...context });
    return { ...res, expand: expandAchievementInfo };
  } catch (e) {
    console.error('[submission] post-submit failed:', e);
    return { unlocked: [], rewarded: 0, expand: () => [] };
  }
}
