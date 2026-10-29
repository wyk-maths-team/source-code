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

import { todayHK, yesterdayHK, startOfTodayHK, hourHK } from './time.js';
import * as U from './userStore.js';

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
};

export const ACHIEVEMENT_COUNT = Object.keys(ACHIEVEMENTS).length;

// ═══════════════ HKT 时区（统一走 lib/time.js） ═══════════════
// 以前是手工 +8 小时的换算，几处写法还不一致，容易漏。现在只有一份实现。
export function getHktToday() {
  return todayHK();
}
function getHktYesterday() {
  return yesterdayHK();
}
function getHktDayStartUtc() {
  return startOfTodayHK();
}
function getHktHour() {
  return hourHK();
}

// ═══════════════ Streak ═══════════════
export async function updateStreak(db, username) {
  // ⭐ 规则在 lib/userStore.updateStreak 里：同一天不重复计数，
  //    昨天来过就 +1，否则从 1 重新开始。
  return U.updateStreak(username);
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
// ⚠️ 首答统计的唯一数据源仍是 MongoDB 的 submissions（提交记录本轮没迁），
//    这里跑完就写进 PostgreSQL，之后不再触碰。
async function backfillStats(db, username) {
  const todayStart = getHktDayStartUtc();

  // ⭐ 首答统计与今日集合都改成 SQL（见 submissionStore）
  const [firstSubs, todayACIds, todayTriedIds] = await Promise.all([
    S.firstAttemptsByUser(username),
    S.distinctACSince(username, todayStart),
    S.distinctTriedSince(username, todayStart),
  ]);

  let firstTryCount = 0;
  for (const s of firstSubs) {
    const passed = (s.type === 'image')
      ? (s.marked === true && s.score === 100)
      : (s.correct === true && s.system_error !== true);
    if (passed) firstTryCount++;
  }

  await U.setStatsBackfill(username, {
    firstTryCount,
    todayTried: todayTriedIds,
    todayAC: todayACIds,
    statsVersion: STATS_VERSION,
  });
}

export async function collectStats(db, username, { fresh = false } = {}) {
  if (!fresh) {
    const hit = _statsCache.get(username);
    if (hit && hit.expireAt > Date.now()) return { ...hit.stats };
  }

  const statsDoc = await U.getUserStats(username);
  if (!statsDoc) return emptyStats();

  // 老用户：补齐一次（只写 PG，之后走快路径）
  if (statsDoc.statsVersion !== STATS_VERSION) {
    await backfillStats(db, username);
  }

  // ⭐ 一次 SQL 拿齐：已解数 / 最大难度 / 尝试数 / firstTry / today 集合
  const c = await U.getAchievementCounters(username);

  const stats = {
    solvedCount: c.solvedCount,
    maxDifficulty: c.maxDifficulty,
    firstTryCount: c.firstTryCount,
    streak: 0,                                   // 由调用方从 user_stats 补上
    todayAC: c.todayAC,
    todayTried: c.todayTried,
    allTried: c.allTried,
    allSolved: c.solvedCount,
    accuracy: c.accuracy,
    todayDate: getHktToday(),
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
  const [user, statsDoc, achIds] = await Promise.all([
    U.getUser(username),
    U.getUserStats(username),
    U.getAchievementIds(username),
  ]);
  if (!user) return { unlocked: [], rewarded: 0 };

  const have = new Set(achIds);
  const unlocked = [];
  const add = (id) => {
    if (ACHIEVEMENTS[id] && !have.has(id)) { unlocked.push(id); have.add(id); }
  };

  const stats = await collectStats(db, username, { fresh: true });
  stats.streak = statsDoc?.streakDays || 0;

  // ── 阈值类：遍历定义即可，不再有第二张表 ──
  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    if (!def.metric) continue;
    const p = progressOf(def, stats);
    if (p && p.pct >= 1) add(id);
  }

  // ── Fun（事件触发） ──
  if (context.trigger === 'submit') {
    const h = getHktHour();
    if (h >= 0 && h < 4) add('night-owl');
    if (h >= 5 && h < 7) add('early-bird');
  }

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

  if (unlocked.length === 0) return { unlocked: [], rewarded: 0 };

  // ── 写回 + 发奖 ──
  const rewards = unlocked.reduce((sum, id) => sum + rewardOf(id), 0);
  const now = new Date();

  // ⭐ 复合主键 + ON CONFLICT DO NOTHING 等价于原来的 $addToSet
  const granted = await U.unlockAchievements(username, unlocked, rewardOf);

  if (rewards > 0 && granted.length > 0) {
    await U.addTokens(username, rewards);   // 奖励一律进 global
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
  const [user, statsDoc, unlockedList] = await Promise.all([
    U.getUser(username),
    U.getUserStats(username),
    U.getAchievementIds(username),
  ]);
  if (!user) return null;

  const stats = await collectStats(db, username);
  stats.streak = statsDoc?.streakDays || 0;

  const progress = {};
  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    const p = progressOf(def, stats);
    if (p) progress[id] = p;
  }

  const unlocked = unlockedList;
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
  const granted = await U.unlockAchievements(username, [achievementId], () => 0);
  if (!granted.length) return { ok: false, alreadyHave: true };

  await db.collection('achievements_log').insertOne({
    username, achievementId, unlockedAt: new Date(),
    reward: 0, context: { manual: true },
  });
  return { ok: true };
}