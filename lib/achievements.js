// lib/achievements.js
// 成就系统 v4
//
// 相比 v3 的变化：
//   1. 删除 curious / voyeur（一个触发点已失效，一个根本没有定义）
//   2. 阈值表（THRESHOLDS）并进成就定义，每个成就自带 metric + target。
//      以前「名字表」和「阈值表」是两份数据，加成就容易只改一处。
//   3. 每个成就带 reward，解锁即发 token（走 lib/wallet.js，进 global）
//   4. 新增 getProgress()，给前端画进度条
//   5. 统计数字集中在 collectStats()，解锁判定和进度展示共用一份逻辑，
//      避免「进度显示 90% 但没解锁」这种自相矛盾
//
// 计数据仍按 distinct problemId 统计（v3 修过的刷分漏洞，别退回去）。

import { addTokens } from './wallet.js';

// ═══════════════ 稀有度与奖励 ═══════════════
export const RARITY = {
  common:    { label: 'Common',    color: '#808080', reward: 5_000 },
  uncommon:  { label: 'Uncommon',  color: '#008000', reward: 15_000 },
  rare:      { label: 'Rare',      color: '#0000FF', reward: 40_000 },
  epic:      { label: 'Epic',      color: '#AA00AA', reward: 100_000 },
  legendary: { label: 'Legendary', color: '#FFAA00', reward: 250_000 },
};

export function rewardOf(id) {
  const a = ACHIEVEMENTS[id];
  return a ? (RARITY[a.rarity]?.reward || 0) : 0;
}

// ═══════════════ 成就定义 ═══════════════
//
// metric / target：进度用。current = stats[metric]，pct = current / target
// gate：额外的门槛（比如 accuracy 系列要求至少尝试 20 题）
// 没有 metric 的成就由事件触发（hidden / fun），不显示进度条
//
export const ACHIEVEMENTS = {
  // ── A. Milestone ──
  'first-blood':  { name: 'First Blood',     desc: 'AC your first problem',   icon: 'fa-droplet',        rarity: 'common',    category: 'milestone', metric: 'solvedCount', target: 1 },
  'solved-10':    { name: 'Getting Started', desc: 'AC 10 problems',          icon: 'fa-seedling',       rarity: 'common',    category: 'milestone', metric: 'solvedCount', target: 10 },
  'solved-25':    { name: 'Warming Up',      desc: 'AC 25 problems',          icon: 'fa-mug-hot',        rarity: 'common',    category: 'milestone', metric: 'solvedCount', target: 25 },
  'solved-50':    { name: 'Half Century',    desc: 'AC 50 problems',          icon: 'fa-person-running', rarity: 'uncommon',  category: 'milestone', metric: 'solvedCount', target: 50 },
  'solved-100':   { name: 'Centurion',       desc: 'AC 100 problems',         icon: 'fa-medal',          rarity: 'rare',      category: 'milestone', metric: 'solvedCount', target: 100 },
  'solved-200':   { name: 'Double Century',  desc: 'AC 200 problems',         icon: 'fa-landmark',       rarity: 'rare',      category: 'milestone', metric: 'solvedCount', target: 200 },
  'solved-500':   { name: 'Five Hundred',    desc: 'AC 500 problems',         icon: 'fa-mountain',       rarity: 'epic',      category: 'milestone', metric: 'solvedCount', target: 500 },
  'solved-1000':  { name: 'Millennium',      desc: 'AC 1000 problems',        icon: 'fa-meteor',         rarity: 'epic',      category: 'milestone', metric: 'solvedCount', target: 1000 },
  'solved-2000':  { name: 'Two Millenniums', desc: 'AC 2000 problems',        icon: 'fa-rocket',         rarity: 'legendary', category: 'milestone', metric: 'solvedCount', target: 2000 },

  // ── B. Difficulty ──
  'hard-3': { name: 'Beyond Easy',      desc: 'AC a problem with difficulty ≥ 3', icon: 'fa-shield-halved', rarity: 'common',   category: 'difficulty', metric: 'maxDifficulty', target: 3 },
  'hard-4': { name: 'Rising Challenge', desc: 'AC a problem with difficulty ≥ 4', icon: 'fa-award',         rarity: 'uncommon', category: 'difficulty', metric: 'maxDifficulty', target: 4 },
  'hard-5': { name: 'Midway',           desc: 'AC a problem with difficulty ≥ 5', icon: 'fa-trophy',        rarity: 'uncommon', category: 'difficulty', metric: 'maxDifficulty', target: 5 },
  'hard-6': { name: 'Into the Deep',    desc: 'AC a problem with difficulty ≥ 6', icon: 'fa-fire',          rarity: 'rare',     category: 'difficulty', metric: 'maxDifficulty', target: 6 },
  'hard-7': { name: 'Elite Solver',     desc: 'AC a problem with difficulty ≥ 7', icon: 'fa-gem',           rarity: 'epic',     category: 'difficulty', metric: 'maxDifficulty', target: 7 },
  'hard-8': { name: 'Deep Water',       desc: 'AC a problem with difficulty ≥ 8', icon: 'fa-water',         rarity: 'epic',     category: 'difficulty', metric: 'maxDifficulty', target: 8 },
  'hard-9': { name: 'The Summit',       desc: 'AC a problem with difficulty ≥ 9', icon: 'fa-mountain-sun',  rarity: 'legendary',category: 'difficulty', metric: 'maxDifficulty', target: 9 },
  'difficulty-hunter': { name: 'Difficulty Hunter', desc: 'AC problems from 5 different difficulty tiers', icon: 'fa-layer-group', rarity: 'rare', category: 'difficulty', metric: 'difficultyBands', target: 5 },

  // ── C. Streak ──
  'streak-3':   { name: 'Hat Trick',        desc: 'Submit 3 days in a row',   icon: 'fa-fire',  rarity: 'common',   category: 'streak', metric: 'streak', target: 3 },
  'streak-7':   { name: 'Week Warrior',     desc: 'Submit 7 days in a row',   icon: 'fa-bolt',  rarity: 'uncommon', category: 'streak', metric: 'streak', target: 7 },
  'streak-30':  { name: 'Monthly Devotion', desc: 'Submit 30 days in a row',  icon: 'fa-moon',  rarity: 'rare',     category: 'streak', metric: 'streak', target: 30 },
  'streak-100': { name: 'Century Streak',   desc: 'Submit 100 days in a row', icon: 'fa-crown', rarity: 'epic',     category: 'streak', metric: 'streak', target: 100 },

  // ── D. Efficiency ──
  'first-try':    { name: 'One Shot',      desc: 'First submission of a problem is AC', icon: 'fa-bullseye',   rarity: 'common',   category: 'efficiency', metric: 'firstTryCount', target: 1 },
  'first-try-10': { name: 'Sharp Shooter', desc: '10 problems solved on first try',     icon: 'fa-crosshairs', rarity: 'uncommon', category: 'efficiency', metric: 'firstTryCount', target: 10 },
  'first-try-50': { name: 'Perfect Aim',   desc: '50 problems solved on first try',     icon: 'fa-bullseye',   rarity: 'rare',     category: 'efficiency', metric: 'firstTryCount', target: 50 },
  'daily-5':      { name: 'Daily Five',    desc: 'AC 5 different problems in one day',  icon: 'fa-sun',        rarity: 'uncommon', category: 'efficiency', metric: 'todayAC', target: 5 },
  'daily-10':     { name: 'Busy Bee',      desc: 'AC 10 different problems in one day', icon: 'fa-bug',        rarity: 'rare',     category: 'efficiency', metric: 'todayAC', target: 10 },
  'daily-15':     { name: 'Fifteen Frenzy',desc: 'AC 15 different problems in one day', icon: 'fa-hurricane',  rarity: 'epic',     category: 'efficiency', metric: 'todayAC', target: 15 },
  'daily-20':     { name: 'Daily Marathon',desc: 'AC 20 different problems in one day', icon: 'fa-medal',      rarity: 'legendary',category: 'efficiency', metric: 'todayAC', target: 20 },

  // ── E. Fun（事件触发，无进度） ──
  'night-owl':   { name: 'Night Owl',    desc: 'Submit between 00:00-04:00 HKT',            icon: 'fa-feather-pointed', rarity: 'uncommon', category: 'fun' },
  'early-bird':  { name: 'Early Bird',   desc: 'Submit between 05:00-07:00 HKT',            icon: 'fa-dove',            rarity: 'uncommon', category: 'fun' },
  'perfect-day': { name: 'Perfect Day',  desc: 'A day with ≥5 different problems, all AC',  icon: 'fa-sparkles',        rarity: 'rare',     category: 'fun' },

  // ── F. Hidden（事件触发，无进度） ──
  'speed-demon':   { name: 'Speed Demon',   desc: 'Submit within 5s of opening the page', icon: 'fa-gauge-high', rarity: 'rare', category: 'hidden', hidden: true },
  'never-give-up': { name: 'Never Give Up', desc: 'AC a problem after ≥20 attempts',      icon: 'fa-hand-fist',  rarity: 'epic', category: 'hidden', hidden: true },

  // ── G. Accuracy ──
  'accuracy-30': { name: 'Steady Hand', desc: 'Solve ratio ≥ 30% (min 20 problems tried)', icon: 'fa-chart-simple', rarity: 'common',    category: 'accuracy', metric: 'accuracy', target: 0.30, gate: { metric: 'allTried', min: 20 } },
  'accuracy-40': { name: 'Sharp',       desc: 'Solve ratio ≥ 40% (min 20 problems tried)', icon: 'fa-chart-line',   rarity: 'common',    category: 'accuracy', metric: 'accuracy', target: 0.40, gate: { metric: 'allTried', min: 20 } },
  'accuracy-50': { name: 'Accurate',    desc: 'Solve ratio ≥ 50% (min 20 problems tried)', icon: 'fa-gauge',        rarity: 'uncommon',  category: 'accuracy', metric: 'accuracy', target: 0.50, gate: { metric: 'allTried', min: 20 } },
  'accuracy-60': { name: 'Precise',     desc: 'Solve ratio ≥ 60% (min 20 problems tried)', icon: 'fa-palette',      rarity: 'uncommon',  category: 'accuracy', metric: 'accuracy', target: 0.60, gate: { metric: 'allTried', min: 20 } },
  'accuracy-70': { name: 'Meticulous',  desc: 'Solve ratio ≥ 70% (min 20 problems tried)', icon: 'fa-gear',         rarity: 'rare',      category: 'accuracy', metric: 'accuracy', target: 0.70, gate: { metric: 'allTried', min: 20 } },
  'accuracy-80': { name: 'Surgical',    desc: 'Solve ratio ≥ 80% (min 20 problems tried)', icon: 'fa-microscope',   rarity: 'epic',      category: 'accuracy', metric: 'accuracy', target: 0.80, gate: { metric: 'allTried', min: 20 } },
  'accuracy-90': { name: 'Flawless',    desc: 'Solve ratio ≥ 90% (min 20 problems tried)', icon: 'fa-diamond',      rarity: 'legendary', category: 'accuracy', metric: 'accuracy', target: 0.90, gate: { metric: 'allTried', min: 20 } },

  // ── H. Community（由题解 / 点赞 / 讨论 / 提示触发） ──
  'preacher':     { name: 'Preacher',      desc: 'Publish your first solution',              icon: 'fa-book-open',    rarity: 'uncommon', category: 'community' },
  'prolific':     { name: 'Prolific',      desc: 'Publish 5 solutions',                      icon: 'fa-pen-nib',      rarity: 'rare',     category: 'community' },
  'well-liked':   { name: 'Well Liked',    desc: 'Receive 10 likes on your solutions',       icon: 'fa-heart',        rarity: 'epic',     category: 'community' },
  'patron':       { name: 'Patron',        desc: 'Like 10 solutions written by others',      icon: 'fa-thumbs-up',    rarity: 'uncommon', category: 'community' },
  'debater':      { name: 'Debater',       desc: 'Post 10 discussions',                      icon: 'fa-comments',     rarity: 'uncommon', category: 'community' },
  'curious-mind': { name: 'Curious Mind',  desc: 'Unlock 10 hints',                          icon: 'fa-lightbulb',    rarity: 'uncommon', category: 'community' },
  'self-reliant': { name: 'Self-Reliant',  desc: 'AC 50 problems without ever unlocking a hint', icon: 'fa-user-shield', rarity: 'rare', category: 'community' },
  'clicked':      { name: 'Clicked',       desc: 'Unlock a hint and AC that problem the same day', icon: 'fa-hand-pointer', rarity: 'common', category: 'community' },

  // ── I. Habits（时间 / 连续性） ──
  'weekend-warrior': { name: 'Weekend Warrior', desc: 'AC a problem on a Saturday or Sunday', icon: 'fa-calendar-day', rarity: 'common',   category: 'habits' },
  'lunch-break':     { name: 'Lunch Break',     desc: 'AC a problem between 12:00 and 14:00 HKT', icon: 'fa-utensils', rarity: 'common',   category: 'habits' },
  'last-light':      { name: 'Last Light',      desc: 'AC a problem between 23:00 and 24:00 HKT', icon: 'fa-moon',     rarity: 'uncommon', category: 'habits' },
  'comeback':        { name: 'Comeback',        desc: 'AC a problem again after more than 30 days away', icon: 'fa-rotate-left', rarity: 'rare', category: 'habits' },

  // ── J. Easter eggs ──
  'butterfingers':  { name: 'Butterfingers',  desc: 'Get 5 wrong answers in a row',              icon: 'fa-hand-sparkles', rarity: 'uncommon', category: 'hidden', hidden: true },
  'midnight-sharp': { name: 'Midnight Sharp', desc: 'Submit at exactly 00:00 HKT',               icon: 'fa-clock',         rarity: 'epic',     category: 'hidden', hidden: true },
  'rewind':         { name: 'Rewind',         desc: 'Get a problem wrong one day and AC it the next', icon: 'fa-arrow-rotate-left', rarity: 'rare', category: 'hidden', hidden: true },
};

export const ACHIEVEMENT_COUNT = Object.keys(ACHIEVEMENTS).length;

// ═══════════════ HKT 时区 ═══════════════
export function getHktToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}
function getHktYesterday() {
  return new Date(Date.now() + 8 * 3600_000 - 86400_000).toISOString().slice(0, 10);
}
function getHktDayStartUtc() {
  const today = getHktToday();
  return new Date(new Date(today + 'T00:00:00.000Z').getTime() - 8 * 3600_000);
}
function getHktHour() {
  return (new Date().getUTCHours() + 8) % 24;
}

// ═══════════════ Problems 缓存 ═══════════════
// 复用 lib/problemCache.js 的全量难度映射（同一份 60s 缓存），
// 不再在这里维护第二份 _problemCache。
async function getProblemDifficultyMap(db) {
  const { getDifficultyMap } = await import('./problemCache.js');
  return getDifficultyMap(db);
}

// ═══════════════ Streak ═══════════════
export async function updateStreak(db, username) {
  const user = await db.collection('users').findOne(
    { username },
    { projection: { lastActiveDate: 1, streakDays: 1 } }
  );
  if (!user) return { changed: false, streakDays: 0 };

  const today = getHktToday();
  if (user.lastActiveDate === today) {
    return { changed: false, streakDays: user.streakDays || 0 };
  }

  const newStreak = (user.lastActiveDate === getHktYesterday())
    ? (user.streakDays || 0) + 1
    : 1;

  await db.collection('users').updateOne(
    { username },
    {
      $set: { lastActiveDate: today, streakDays: newStreak },
      $inc: { activeDaysTotal: 1 },
      $max: { maxStreak: newStreak },
    }
  );

  return { changed: true, streakDays: newStreak };
}

// ═══════════════ 统计收集 ═══════════════
//
// v4 之前：每次提交都跑 4 个 distinct + 1 个聚合扫 submissions，
//          代价 O(Sᵤ log Sᵤ)，Sᵤ 是该用户的总提交数。
//
// v4 之后：计数物化在 userstats 上，读的时候只看一份文档。
//          solvedCount / allTried / allSolved 直接由 states 算出（O(|states|)），
//          firstTryCount / todayAC / todayTried 由 submit 时增量维护。
//          代价 O(|states|)，且不再触碰 submissions。
//
// 老用户没有这些字段时，backfillStats() 跑一次全量补齐，之后走快路径。
const STATS_VERSION = 2;
export { STATS_VERSION };

const _statsCache = new Map();   // username -> { stats, expireAt }
const STATS_TTL = 60_000;

function emptyStats() {
  return {
    solvedCount: 0, maxDifficulty: 0, firstTryCount: 0, streak: 0,
    todayAC: 0, todayTried: 0, allTried: 0, allSolved: 0,
    accuracy: 0, todayDate: getHktToday(),
  };
}

// 老用户一次性补齐计数。条件写 statsVersion 保证并发下只补一次。
async function backfillStats(db, username, doc) {
  const todayStart = getHktDayStartUtc();

  const AC_FILTER = {
    $or: [
      { type: 'image', marked: true, score: 100 },
      { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
    ],
  };

  const [firstSubs, todayACIds, todayTriedIds] = await Promise.all([
    db.collection('submissions').aggregate([
      { $match: { username } },
      { $sort: { timestamp: 1 } },
      { $group: {
        _id: '$problemId',
        firstType:        { $first: '$type' },
        firstCorrect:     { $first: '$correct' },
        firstSystemError: { $first: '$systemError' },
        firstMarked:      { $first: '$marked' },
        firstScore:       { $first: '$score' },
      }},
    ]).toArray(),
    db.collection('submissions').distinct('problemId', { username, timestamp: { $gte: todayStart }, ...AC_FILTER }),
    db.collection('submissions').distinct('problemId', { username, timestamp: { $gte: todayStart } }),
  ]);

  let firstTryCount = 0;
  for (const s of firstSubs) {
    const passed = (s.firstType === 'image')
      ? (s.firstMarked === true && s.firstScore === 100)
      : (s.firstCorrect === true && s.firstSystemError !== true);
    if (passed) firstTryCount++;
  }

  await db.collection('userstats').updateOne(
    { username, statsVersion: { $ne: STATS_VERSION } },
    {
      $set: {
        firstTryCount,
        todayDate: getHktToday(),
        todayTried: todayTriedIds,
        todayAC: todayACIds,
        statsVersion: STATS_VERSION,
      },
    }
  );
}

export async function collectStats(db, username, { fresh = false } = {}) {
  if (!fresh) {
    const hit = _statsCache.get(username);
    if (hit && hit.expireAt > Date.now()) return { ...hit.stats };
  }

  let [doc, diffMap] = await Promise.all([
    db.collection('userstats').findOne({ username }),
    getProblemDifficultyMap(db),
  ]);

  if (!doc) return emptyStats();

  // 老用户：补齐一次后重读
  if (doc.statsVersion !== STATS_VERSION) {
    await backfillStats(db, username, doc);
    doc = await db.collection('userstats').findOne({ username });
    if (!doc) return emptyStats();
  }

  const states = doc.states || {};

  // O(|states|)：从物化的 states 直接算，不再扫 submissions
  let solvedCount = 0;
  let maxDifficulty = 0;
  const difficultyBands = new Set();   // 已 AC 过的整数难度档（1..9）
  for (const pid in states) {
    if (states[pid] === 'passed') {
      solvedCount++;
      const d = diffMap[pid] || 0;
      if (d > maxDifficulty) maxDifficulty = d;
      if (d > 0) difficultyBands.add(Math.round(d));
    }
  }

  const allTried = Object.keys(states).length;
  const today = getHktToday();
  const sameDay = doc.todayDate === today;

  const stats = {
    solvedCount,
    maxDifficulty,
    firstTryCount: Number(doc.firstTryCount) || 0,
    difficultyBands: difficultyBands.size,
    consecutiveFail: Number(doc.consecutiveFail) || 0,
    streak: 0,                                   // 由调用方从 user 补上
    todayAC: sameDay ? (doc.todayAC || []).length : 0,
    todayTried: sameDay ? (doc.todayTried || []).length : 0,
    allTried,
    allSolved: solvedCount,
    accuracy: allTried > 0 ? solvedCount / allTried : 0,
    todayDate: today,
  };

  _statsCache.set(username, { stats, expireAt: Date.now() + STATS_TTL });
  return { ...stats };
}

// 进度百分比（0..1）。没有 metric 的成就返回 null（不画进度条）
export function progressOf(def, stats) {
  if (!def || !def.metric) return null;
  const gate = def.gate;
  const currentRaw = Number(stats?.[def.metric]) || 0;

  // 有门槛时，门槛没达成就显示门槛进度
  if (gate) {
    const gateCur = Number(stats?.[gate.metric]) || 0;
    if (gateCur < gate.min) {
      return { current: gateCur, target: gate.min, pct: Math.min(1, gateCur / gate.min), gated: true, label: `${gateCur}/${gate.min} tried` };
    }
  }

  const target = Number(def.target) || 1;
  const pct = Math.min(1, target > 0 ? currentRaw / target : 1);
  return { current: currentRaw, target, pct, gated: false };
}

// ═══════════════ 主检查 ═══════════════
export async function checkAchievements(db, username, context = {}) {
  const user = await db.collection('users').findOne(
    { username },
    { projection: { achievements: 1, streakDays: 1, token: 1 } }
  );
  if (!user) return { unlocked: [], rewarded: 0 };

  const have = new Set(user.achievements || []);
  const unlocked = [];
  const add = (id) => {
    if (ACHIEVEMENTS[id] && !have.has(id)) { unlocked.push(id); have.add(id); }
  };

  const stats = await collectStats(db, username, { fresh: true });
  stats.streak = user.streakDays || 0;

  // ── 阈值类：遍历定义即可，不再有第二张表 ──
  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    if (!def.metric) continue;
    const p = progressOf(def, stats);
    if (p && p.pct >= 1) add(id);
  }

  // ── Fun / Habits（事件触发） ──
  if (context.trigger === 'submit') {
    const hkt = new Date(Date.now() + 8 * 3600_000);   // HKT 墙上时间
    const h = hkt.getUTCHours();
    const m = hkt.getUTCMinutes();
    const wd = hkt.getUTCDay();                        // 0 = Sunday

    if (h >= 0 && h < 4) add('night-owl');
    if (h >= 5 && h < 7) add('early-bird');
    if (h === 0 && m <= 1) add('midnight-sharp');

    if (context.justAC) {
      if (wd === 0 || wd === 6) add('weekend-warrior');
      if (h >= 12 && h < 14) add('lunch-break');
      if (h === 23) add('last-light');
      if (context.longAbsence) add('comeback');
    }
  }

  // Butterfingers：连续 5 次答错（由 submit 增量维护）
  if (stats.consecutiveFail >= 5) add('butterfingers');

  // perfect-day：今天尝试过 ≥5 道不同题目且全部 AC
  if (stats.todayTried >= 5 && stats.todayTried === stats.todayAC) {
    add('perfect-day');
  }

  // ── Hidden（事件触发） ──
  if (context.trigger === 'submit'
      && typeof context.pageDwellMs === 'number'
      && context.pageDwellMs >= 0
      && context.pageDwellMs < 5000) {
    add('speed-demon');
  }
  if (context.trigger === 'submit'
      && context.justAC === true
      && typeof context.problemSubmitCount === 'number'
      && context.problemSubmitCount >= 20) {
    add('never-give-up');
  }

  // ── Community（题解 / 点赞 / 讨论 / hint）──
  // 只在还有未解锁项时才去查这几个集合，老用户不会再产生额外查询
  const communityIds = ['preacher', 'prolific', 'well-liked', 'patron', 'debater', 'curious-mind', 'self-reliant'];
  if ((context.trigger === 'submit' || context.trigger === 'action') && communityIds.some((id) => !have.has(id))) {
    const [solAgg, likesGiven, discussions, hintsBought] = await Promise.all([
      db.collection('solutions').aggregate([
        { $match: { username } },
        { $group: { _id: null, count: { $sum: 1 }, likes: { $sum: '$likes' } } },
      ]).toArray(),
      db.collection('solutionLikes').countDocuments({ username }),
      db.collection('discussions').countDocuments({ username }),
      db.collection('hintPurchases').countDocuments({ username }),
    ]);

    const solCount = solAgg[0]?.count || 0;
    const likesReceived = solAgg[0]?.likes || 0;

    if (solCount >= 1) add('preacher');
    if (solCount >= 5) add('prolific');
    if (likesReceived >= 10) add('well-liked');
    if (likesGiven >= 10) add('patron');
    if (discussions >= 10) add('debater');
    if (hintsBought >= 10) add('curious-mind');
    if (stats.solvedCount >= 50 && hintsBought === 0) add('self-reliant');
  }

  // ── Clicked / Rewind：只看这一次 AC 的题目 ──
  if (context.trigger === 'submit' && context.justAC && context.problemId) {
    const dayStart = getHktDayStartUtc();
    const [usedHint, failedBefore] = await Promise.all([
      db.collection('hintPurchases').findOne(
        { username, problemId: context.problemId, createdAt: { $gte: dayStart } },
        { projection: { _id: 1 } }
      ),
      db.collection('submissions').findOne(
        {
          username,
          problemId: context.problemId,
          timestamp: { $lt: dayStart },
          $or: [
            { type: 'image', score: { $lt: 100 } },
            { type: { $ne: 'image' }, correct: false, systemError: { $ne: true } },
          ],
        },
        { projection: { _id: 1 } }
      ),
    ]);
    if (usedHint) add('clicked');
    if (failedBefore) add('rewind');
  }

  if (unlocked.length === 0) return { unlocked: [], rewarded: 0 };

  // ── 写回 + 发奖 ──
  const rewards = unlocked.reduce((sum, id) => sum + rewardOf(id), 0);
  const now = new Date();

  await db.collection('users').updateOne(
    { username },
    { $addToSet: { achievements: { $each: unlocked } } }
  );

  if (rewards > 0) {
    const fresh = await db.collection('users').findOne({ username }, { projection: { token: 1 } });
    await db.collection('users').updateOne(
      { username },
      { $set: { token: addTokens(fresh?.token, rewards) } }
    );
  }

  await db.collection('achievements_log').insertMany(
    unlocked.map(id => ({
      username, achievementId: id, unlockedAt: now,
      reward: rewardOf(id),
      context: { solvedCount: stats.solvedCount, maxDifficulty: stats.maxDifficulty, streak: stats.streak, allTried: stats.allTried, allSolved: stats.allSolved },
    }))
  );

  return { unlocked, rewarded: rewards };
}

// ═══════════════ 前端数据 ═══════════════
// 注意 icon 的两种形态：
//   expandAchievementInfo → 完整 class（'fa-solid fa-droplet'），
//                            给 ach-toast 直接塞进 <i class="..."> 用
//   publicDefinitions     → 裸名（'fa-droplet'），
//                            给 user.js 自己拼 'fa-solid ' + icon
export function expandAchievementInfo(ids) {
  return ids.map(id => {
    const a = ACHIEVEMENTS[id] || {};
    return {
      id,
      name: a.name || id,
      desc: a.desc || '',
      icon: 'fa-solid ' + (a.icon || 'fa-trophy'),
      rarity: a.rarity || 'common',
    };
  });
}

// 完整定义表（前端画进度条需要），去掉内部字段
export function publicDefinitions() {
  const out = {};
  for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
    out[id] = {
      name: a.name,
      desc: a.desc,
      icon: a.icon,
      rarity: a.rarity,
      category: a.category || 'misc',
      hidden: !!a.hidden,
      reward: RARITY[a.rarity]?.reward || 0,
      hasProgress: !!a.metric,
    };
  }
  return out;
}

/**
 * 一次性给前端：定义表 + 每个成就的进度 + 汇总统计。
 * 走 60s 缓存（collectStats 非 fresh），profile 反复刷新不会打爆数据库。
 */
export async function getProgress(db, username) {
  const user = await db.collection('users').findOne(
    { username },
    { projection: { achievements: 1, streakDays: 1 } }
  );
  if (!user) return null;

  const stats = await collectStats(db, username);
  stats.streak = user.streakDays || 0;

  const progress = {};
  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    const p = progressOf(def, stats);
    if (p) progress[id] = p;
  }

  const unlocked = user.achievements || [];
  const rewardsEarned = unlocked.reduce((s, id) => s + rewardOf(id), 0);

  return {
    definitions: publicDefinitions(),
    progress,
    stats,
    unlocked,
    unlockedCount: unlocked.length,
    totalCount: ACHIEVEMENT_COUNT,
    rewardsEarned,
  };
}

// ═══════════════ 手动解锁（管理用） ═══════════════
export async function unlockAchievement(db, username, achievementId) {
  if (!ACHIEVEMENTS[achievementId]) {
    return { ok: false, message: 'Unknown achievement' };
  }
  const r = await db.collection('users').updateOne(
    { username },
    { $addToSet: { achievements: achievementId } }
  );
  if (r.modifiedCount === 0) return { ok: false, alreadyHave: true };

  await db.collection('achievements_log').insertOne({
    username, achievementId, unlockedAt: new Date(),
    reward: 0, context: { manual: true },
  });
  return { ok: true };
}
