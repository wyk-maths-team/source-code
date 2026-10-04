// lib/achievements.js
// 成就系统 v3 —— 修复刷分漏洞：所有"计数"类成就按 distinct problemId 计算

// ═══════════════ 稀有度 ═══════════════
export const RARITY = {
  common:    { label: 'Common',    color: '#808080' },
  uncommon:  { label: 'Uncommon',  color: '#008000' },
  rare:      { label: 'Rare',      color: '#0000FF' },
  epic:      { label: 'Epic',      color: '#AA00AA' },
  legendary: { label: 'Legendary', color: '#FFAA00' },
};

// ═══════════════ 成就定义 ═══════════════
export const ACHIEVEMENTS = {
  // ── A. Milestone ──
  'first-blood':  { name: 'First Blood',      desc: 'AC your first problem',      icon: 'fa-solid fa-droplet',         rarity: 'common',    category: 'milestone' },
  'solved-10':    { name: 'Getting Started',  desc: 'AC 10 problems',             icon: 'fa-solid fa-seedling',        rarity: 'common',    category: 'milestone' },
  'solved-25':    { name: 'Warming Up',       desc: 'AC 25 problems',             icon: 'fa-solid fa-mug-hot',         rarity: 'common',    category: 'milestone' },
  'solved-50':    { name: 'Half Century',     desc: 'AC 50 problems',             icon: 'fa-solid fa-person-running',  rarity: 'uncommon',  category: 'milestone' },
  'solved-100':   { name: 'Centurion',        desc: 'AC 100 problems',            icon: 'fa-solid fa-medal',           rarity: 'rare',      category: 'milestone' },
  'solved-200':   { name: 'Double Century',   desc: 'AC 200 problems',            icon: 'fa-solid fa-landmark',        rarity: 'rare',      category: 'milestone' },
  'solved-500':   { name: 'Five Hundred',     desc: 'AC 500 problems',            icon: 'fa-solid fa-mountain',        rarity: 'epic',      category: 'milestone' },
  'solved-1000':  { name: 'Millennium',       desc: 'AC 1000 problems',           icon: 'fa-solid fa-meteor',          rarity: 'epic',      category: 'milestone' },
  'solved-2000':  { name: 'Two Millenniums',  desc: 'AC 2000 problems',           icon: 'fa-solid fa-rocket',          rarity: 'legendary', category: 'milestone' },

  // ── B. Difficulty ──
  'hard-3':  { name: 'Beyond Easy',      desc: 'AC a problem with difficulty ≥ 3', icon: 'fa-solid fa-medal',   rarity: 'common',   category: 'difficulty' },
  'hard-4':  { name: 'Rising Challenge', desc: 'AC a problem with difficulty ≥ 4', icon: 'fa-solid fa-award',   rarity: 'uncommon', category: 'difficulty' },
  'hard-5':  { name: 'Midway',           desc: 'AC a problem with difficulty ≥ 5', icon: 'fa-solid fa-trophy',  rarity: 'uncommon', category: 'difficulty' },
  'hard-6':  { name: 'Into the Deep',    desc: 'AC a problem with difficulty ≥ 6', icon: 'fa-solid fa-fire',    rarity: 'rare',     category: 'difficulty' },
  'hard-7':  { name: 'Elite Solver',     desc: 'AC a problem with difficulty ≥ 7', icon: 'fa-solid fa-gem',     rarity: 'epic',     category: 'difficulty' },

  // ── C. Streak ──
  'streak-3':   { name: 'Hat Trick',        desc: 'Submit 3 days in a row',   icon: 'fa-solid fa-fire',  rarity: 'common',   category: 'streak' },
  'streak-7':   { name: 'Week Warrior',     desc: 'Submit 7 days in a row',   icon: 'fa-solid fa-bolt',  rarity: 'uncommon', category: 'streak' },
  'streak-30':  { name: 'Monthly Devotion', desc: 'Submit 30 days in a row',  icon: 'fa-solid fa-moon',  rarity: 'rare',     category: 'streak' },
  'streak-100': { name: 'Century Streak',   desc: 'Submit 100 days in a row', icon: 'fa-solid fa-crown', rarity: 'epic',     category: 'streak' },

  // ── D. Efficiency ──
  'first-try':    { name: 'One Shot',       desc: 'First submission of a problem is AC', icon: 'fa-solid fa-bullseye',   rarity: 'common',    category: 'efficiency' },
  'first-try-10': { name: 'Sharp Shooter',  desc: '10 problems solved on first try',     icon: 'fa-solid fa-crosshairs', rarity: 'uncommon',  category: 'efficiency' },
  'first-try-50': { name: 'Perfect Aim',    desc: '50 problems solved on first try',     icon: 'fa-solid fa-bullseye',   rarity: 'rare',      category: 'efficiency' },
  'daily-5':      { name: 'Daily Five',     desc: 'AC 5 different problems in one day',  icon: 'fa-solid fa-sun',        rarity: 'uncommon',  category: 'efficiency' },
  'daily-10':     { name: 'Busy Bee',       desc: 'AC 10 different problems in one day', icon: 'fa-solid fa-bug',        rarity: 'rare',      category: 'efficiency' },
  'daily-15':     { name: 'Fifteen Frenzy', desc: 'AC 15 different problems in one day', icon: 'fa-solid fa-hurricane',  rarity: 'epic',      category: 'efficiency' },
  'daily-20':     { name: 'Daily Marathon', desc: 'AC 20 different problems in one day', icon: 'fa-solid fa-medal',      rarity: 'legendary', category: 'efficiency' },

  // ── E. Fun ──
  'night-owl':   { name: 'Night Owl',   desc: 'Submit between 00:00-04:00 HKT',                icon: 'fa-solid fa-feather-pointed', rarity: 'uncommon', category: 'fun' },
  'early-bird':  { name: 'Early Bird',  desc: 'Submit between 05:00-07:00 HKT',                icon: 'fa-solid fa-dove',            rarity: 'uncommon', category: 'fun' },
  'perfect-day': { name: 'Perfect Day', desc: 'A day with ≥5 different problems, all AC',     icon: 'fa-solid fa-sparkles',        rarity: 'rare',     category: 'fun' },

  // ── F. Hidden ──
  'curious':       { name: '???',           desc: 'Hidden',                              icon: 'fa-solid fa-question',   rarity: 'rare', category: 'hidden', hidden: true },
  'speed-demon':   { name: 'Speed Demon',   desc: 'Submit within 5s of opening the page', icon: 'fa-solid fa-gauge-high', rarity: 'rare', category: 'hidden', hidden: true },
  'never-give-up': { name: 'Never Give Up', desc: 'AC a problem after ≥20 attempts',     icon: 'fa-solid fa-hand-fist',  rarity: 'epic', category: 'hidden', hidden: true },

  // ── G. Accuracy ⭐ 语义改为「已解决题目 / 尝试过的题目」 ──
  'accuracy-30': { name: 'Steady Hand', desc: 'Solve ratio ≥ 30% (min 20 problems tried)', icon: 'fa-solid fa-chart-simple', rarity: 'common',    category: 'accuracy' },
  'accuracy-40': { name: 'Sharp',       desc: 'Solve ratio ≥ 40% (min 20 problems tried)', icon: 'fa-solid fa-chart-line',   rarity: 'common',    category: 'accuracy' },
  'accuracy-50': { name: 'Accurate',    desc: 'Solve ratio ≥ 50% (min 20 problems tried)', icon: 'fa-solid fa-gauge',        rarity: 'uncommon',  category: 'accuracy' },
  'accuracy-60': { name: 'Precise',     desc: 'Solve ratio ≥ 60% (min 20 problems tried)', icon: 'fa-solid fa-palette',      rarity: 'uncommon',  category: 'accuracy' },
  'accuracy-70': { name: 'Meticulous',  desc: 'Solve ratio ≥ 70% (min 20 problems tried)', icon: 'fa-solid fa-gear',         rarity: 'rare',      category: 'accuracy' },
  'accuracy-80': { name: 'Surgical',    desc: 'Solve ratio ≥ 80% (min 20 problems tried)', icon: 'fa-solid fa-microscope',   rarity: 'epic',      category: 'accuracy' },
  'accuracy-90': { name: 'Flawless',    desc: 'Solve ratio ≥ 90% (min 20 problems tried)', icon: 'fa-solid fa-diamond',      rarity: 'legendary', category: 'accuracy' },
};

// ═══════════════ 阈值表 ═══════════════
const THRESHOLDS = {
  milestone: [
    ['first-blood', 1], ['solved-10', 10], ['solved-25', 25],
    ['solved-50', 50], ['solved-100', 100], ['solved-200', 200],
    ['solved-500', 500], ['solved-1000', 1000], ['solved-2000', 2000],
  ],
  difficulty: [
    ['hard-3', 3], ['hard-4', 4], ['hard-5', 5], ['hard-6', 6], ['hard-7', 7],
  ],
  streak: [
    ['streak-3', 3], ['streak-7', 7], ['streak-30', 30], ['streak-100', 100],
  ],
  firstTry: [
    ['first-try', 1], ['first-try-10', 10], ['first-try-50', 50],
  ],
  daily: [
    ['daily-5', 5], ['daily-10', 10], ['daily-15', 15], ['daily-20', 20],
  ],
  accuracy: [
    ['accuracy-30', 0.30], ['accuracy-40', 0.40], ['accuracy-50', 0.50],
    ['accuracy-60', 0.60], ['accuracy-70', 0.70], ['accuracy-80', 0.80],
    ['accuracy-90', 0.90],
  ],
};

const ACCURACY_MIN_TRIED = 20;

function crossed(pairs, value) {
  return pairs.filter(([, n]) => value >= n).map(([id]) => id);
}

// ═══════════════ HKT 时区 ═══════════════
function getHktToday() {
  const hkt = new Date(Date.now() + 8 * 3600_000);
  return hkt.toISOString().slice(0, 10);
}
function getHktYesterday() {
  const hkt = new Date(Date.now() + 8 * 3600_000 - 86400_000);
  return hkt.toISOString().slice(0, 10);
}
function getHktDayStartUtc() {
  const today = getHktToday();
  return new Date(new Date(today + 'T00:00:00.000Z').getTime() - 8 * 3600_000);
}
function getHktHour() {
  return (new Date().getUTCHours() + 8) % 24;
}

// ═══════════════ Problems 缓存（60s TTL）═══════════════
let _problemCache = { map: null, expireAt: 0 };
const PROBLEM_TTL = 60_000;

async function getProblemDifficultyMap(db) {
  const now = Date.now();
  if (_problemCache.map && _problemCache.expireAt > now) return _problemCache.map;
  const docs = await db.collection('problems')
    .find({}, { projection: { id: 1, difficulty: 1, _id: 0 } })
    .toArray();
  const map = Object.create(null);
  for (const d of docs) map[String(d.id)] = Number(d.difficulty) || 0;
  _problemCache = { map, expireAt: now + PROBLEM_TTL };
  return map;
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

// ═══════════════ 主检查 ═══════════════
export async function checkAchievements(db, username, context = {}) {
  const user = await db.collection('users').findOne(
    { username },
    { projection: { achievements: 1, streakDays: 1 } }
  );
  if (!user) return [];

  const have = new Set(user.achievements || []);
  const unlocked = [];
  const add = (id) => {
    if (ACHIEVEMENTS[id] && !have.has(id)) { unlocked.push(id); have.add(id); }
  };

  const todayStart = getHktDayStartUtc();

  // ⭐ AC 判定条件，两处复用
  const AC_FILTER = {
    $or: [
      { type: 'image', marked: true, score: 100 },
      { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
    ],
  };

  const [
    statsDoc,
    diffMap,
    firstSubs,
    todayACProblems,
    todayTriedProblems,
    allSolvedProblems,
    allTriedProblems,
  ] = await Promise.all([
    // 1. userstats
    db.collection('userstats').findOne({ username }, { projection: { states: 1, _id: 0 } }),

    // 2. problems 难度表
    getProblemDifficultyMap(db),

    // 3. 每题首次提交（用于 first-try）
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

    // 4. 今天 AC 的**不同题目**
    db.collection('submissions').distinct('problemId', {
      username,
      timestamp: { $gte: todayStart },
      ...AC_FILTER,
    }),

    // 5. 今天尝试过的**不同题目**
    db.collection('submissions').distinct('problemId', {
      username,
      timestamp: { $gte: todayStart },
    }),

    // 6. 至今 AC 过的**不同题目**
    db.collection('submissions').distinct('problemId', {
      username,
      ...AC_FILTER,
    }),

    // 7. 至今尝试过的**不同题目**
    db.collection('submissions').distinct('problemId', { username }),
  ]);

  // ── 快照 ──
  const states = statsDoc?.states || {};
  const passedIds = Object.entries(states).filter(([, v]) => v === 'passed').map(([k]) => k);
  const solvedCount = passedIds.length;

  let maxDifficulty = 0;
  for (const pid of passedIds) {
    const d = diffMap[pid] || 0;
    if (d > maxDifficulty) maxDifficulty = d;
  }

  let firstTryCount = 0;
  for (const s of firstSubs) {
    const passed = (s.firstType === 'image')
      ? (s.firstMarked === true && s.firstScore === 100)
      : (s.firstCorrect === true && s.firstSystemError !== true);
    if (passed) firstTryCount++;
  }

  const streak = user.streakDays || 0;

  // ⭐ 关键：今天的 & 全时的 distinct 统计
  const todayAC    = todayACProblems.length;     // 今天 AC 的不同题目数
  const todayTried = todayTriedProblems.length;  // 今天尝试的不同题目数
  const allTried   = allTriedProblems.length;    // 至今尝试的不同题目数
  const allSolved  = allSolvedProblems.length;   // 至今 AC 的不同题目数

  const accuracy = allTried > 0 ? allSolved / allTried : 0;

  // ── 统一按阈值表计算 ──
  for (const id of crossed(THRESHOLDS.milestone, solvedCount)) add(id);
  for (const id of crossed(THRESHOLDS.difficulty, maxDifficulty)) add(id);
  for (const id of crossed(THRESHOLDS.streak, streak)) add(id);
  for (const id of crossed(THRESHOLDS.firstTry, firstTryCount)) add(id);
  for (const id of crossed(THRESHOLDS.daily, todayAC)) add(id);

  // ⭐ accuracy：用 distinct 尝试数作门槛
  if (allTried >= ACCURACY_MIN_TRIED) {
    for (const id of crossed(THRESHOLDS.accuracy, accuracy)) add(id);
  }

  // ── Fun ──
  if (context.trigger === 'submit') {
    const h = getHktHour();
    if (h >= 0 && h < 4) add('night-owl');
    if (h >= 5 && h < 7) add('early-bird');
  }

  // ⭐ perfect-day：今天尝试过 ≥5 **不同题目**且**全部** AC
  if (todayTried >= 5 && todayTried === todayAC) {
    add('perfect-day');
  }

  // ── Hidden ──
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

  if (unlocked.length === 0) return [];

  // ── 写回 ──
  await db.collection('users').updateOne(
    { username },
    { $addToSet: { achievements: { $each: unlocked } } }
  );
  const logAt = new Date();
  await db.collection('achievements_log').insertMany(
    unlocked.map(id => ({
      username, achievementId: id, unlockedAt: logAt,
      context: { solvedCount, maxDifficulty, streak, allTried, allSolved },
    }))
  );

  return unlocked;
}

// ═══════════════ 展开为前端可用对象 ═══════════════
export function expandAchievementInfo(ids) {
  return ids.map(id => {
    const a = ACHIEVEMENTS[id] || {};
    return {
      id,
      name: a.name || id,
      desc: a.desc || '',
      icon: a.icon || 'fa-solid fa-trophy',
      rarity: a.rarity || 'common',
    };
  });
}

// ═══════════════ 手动解锁 ═══════════════
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
    username, achievementId, unlockedAt: new Date(), context: { manual: true },
  });
  return { ok: true };
}