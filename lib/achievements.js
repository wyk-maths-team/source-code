// lib/achievements.js
// 成就系统

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
  // ═══ A. Milestone (9) ═══
  'first-blood':  { name: 'First Blood',      desc: 'AC your first problem',       icon: '🩸', rarity: 'common',    category: 'milestone' },
  'solved-10':    { name: 'Getting Started',  desc: 'AC 10 problems',              icon: '🌱', rarity: 'common',    category: 'milestone' },
  'solved-25':    { name: 'Warming Up',       desc: 'AC 25 problems',              icon: '☕', rarity: 'common',    category: 'milestone' },
  'solved-50':    { name: 'Half Century',     desc: 'AC 50 problems',              icon: '🏃', rarity: 'uncommon',  category: 'milestone' },
  'solved-100':   { name: 'Centurion',        desc: 'AC 100 problems',             icon: '💯', rarity: 'rare',      category: 'milestone' },
  'solved-200':   { name: 'Double Century',   desc: 'AC 200 problems',             icon: '🏛️', rarity: 'rare',      category: 'milestone' },
  'solved-500':   { name: 'Five Hundred',     desc: 'AC 500 problems',             icon: '🗿', rarity: 'epic',      category: 'milestone' },
  'solved-1000':  { name: 'Millennium',       desc: 'AC 1000 problems',            icon: '🌌', rarity: 'epic',      category: 'milestone' },
  'solved-2000':  { name: 'Two Millenniums',  desc: 'AC 2000 problems',            icon: '🚀', rarity: 'legendary', category: 'milestone' },

  // ═══ B. Difficulty (5) ═══
  'hard-3':  { name: 'Beyond Easy',      desc: 'AC a problem with difficulty ≥ 3', icon: '🥉', rarity: 'common',   category: 'difficulty' },
  'hard-4':  { name: 'Rising Challenge', desc: 'AC a problem with difficulty ≥ 4', icon: '🥈', rarity: 'uncommon', category: 'difficulty' },
  'hard-5':  { name: 'Midway',           desc: 'AC a problem with difficulty ≥ 5', icon: '🥇', rarity: 'uncommon', category: 'difficulty' },
  'hard-6':  { name: 'Into the Deep',    desc: 'AC a problem with difficulty ≥ 6', icon: '🔥', rarity: 'rare',     category: 'difficulty' },
  'hard-7':  { name: 'Elite Solver',     desc: 'AC a problem with difficulty ≥ 7', icon: '💎', rarity: 'epic',     category: 'difficulty' },

  // ═══ C. Streak (4) ═══
  'streak-3':   { name: 'Hat Trick',        desc: 'Submit 3 days in a row',    icon: '🔥', rarity: 'common',   category: 'streak' },
  'streak-7':   { name: 'Week Warrior',     desc: 'Submit 7 days in a row',    icon: '⚡', rarity: 'uncommon', category: 'streak' },
  'streak-30':  { name: 'Monthly Devotion', desc: 'Submit 30 days in a row',   icon: '🌙', rarity: 'rare',     category: 'streak' },
  'streak-100': { name: 'Century Streak',   desc: 'Submit 100 days in a row',  icon: '🏆', rarity: 'epic',     category: 'streak' },

  // ═══ D. Efficiency (7) ═══
  'first-try':    { name: 'One Shot',        desc: 'First submission of a problem is AC', icon: '🎯', rarity: 'common',    category: 'efficiency' },
  'first-try-10': { name: 'Sharp Shooter',   desc: '10 problems solved on first try',     icon: '🔫', rarity: 'uncommon',  category: 'efficiency' },
  'first-try-50': { name: 'Perfect Aim',     desc: '50 problems solved on first try',     icon: '🏹', rarity: 'rare',      category: 'efficiency' },
  'daily-5':      { name: 'Daily Five',      desc: 'AC 5 problems in one day',            icon: '🌤️', rarity: 'uncommon',  category: 'efficiency' },
  'daily-10':     { name: 'Busy Bee',        desc: 'AC 10 problems in one day',           icon: '🐝', rarity: 'rare',      category: 'efficiency' },
  'daily-15':     { name: 'Fifteen Frenzy',  desc: 'AC 15 problems in one day',           icon: '🌀', rarity: 'epic',      category: 'efficiency' },
  'daily-20':     { name: 'Daily Marathon',  desc: 'AC 20 problems in one day',           icon: '🏅', rarity: 'legendary', category: 'efficiency' },

  // ═══ E. Fun (3) ═══
  'night-owl':   { name: 'Night Owl',     desc: 'Submit between 00:00-04:00 HKT',      icon: '🦉', rarity: 'uncommon', category: 'fun' },
  'early-bird':  { name: 'Early Bird',    desc: 'Submit between 05:00-07:00 HKT',      icon: '🐦', rarity: 'uncommon', category: 'fun' },
  'perfect-day': { name: 'Perfect Day',   desc: 'A day with ≥5 submissions, all AC',   icon: '✨', rarity: 'rare',     category: 'fun' },

  // ═══ F. Hidden (1) ═══
  'curious': { name: '???', desc: 'Hidden', icon: '❓', rarity: 'rare', category: 'hidden', hidden: true },

  // ═══ G. Accuracy (7) ═══
  'accuracy-30': { name: 'Steady Hand', desc: 'Accuracy ≥ 30% (min 20 submissions)', icon: '📊', rarity: 'common',    category: 'accuracy' },
  'accuracy-40': { name: 'Sharp',       desc: 'Accuracy ≥ 40% (min 20 submissions)', icon: '📈', rarity: 'common',    category: 'accuracy' },
  'accuracy-50': { name: 'Accurate',    desc: 'Accuracy ≥ 50% (min 20 submissions)', icon: '🎪', rarity: 'uncommon',  category: 'accuracy' },
  'accuracy-60': { name: 'Precise',     desc: 'Accuracy ≥ 60% (min 20 submissions)', icon: '🎨', rarity: 'uncommon',  category: 'accuracy' },
  'accuracy-70': { name: 'Meticulous',  desc: 'Accuracy ≥ 70% (min 20 submissions)', icon: '⚙️', rarity: 'rare',      category: 'accuracy' },
  'accuracy-80': { name: 'Surgical',    desc: 'Accuracy ≥ 80% (min 20 submissions)', icon: '🔬', rarity: 'epic',      category: 'accuracy' },
  'accuracy-90': { name: 'Flawless',    desc: 'Accuracy ≥ 90% (min 20 submissions)', icon: '💠', rarity: 'legendary', category: 'accuracy' },
};

// ═══════════════ HKT 时区工具 ═══════════════
function getHktToday() {
  const now = new Date();
  const hkt = new Date(now.getTime() + 8 * 3600_000);
  return hkt.toISOString().slice(0, 10);   // "2026-09-28"
}

function getHktYesterday() {
  const now = new Date();
  const hkt = new Date(now.getTime() + 8 * 3600_000 - 86400_000);
  return hkt.toISOString().slice(0, 10);
}

function getHktDayStartUtc() {
  // HKT 今天 00:00 对应的 UTC Date
  const today = getHktToday();
  return new Date(new Date(today + 'T00:00:00.000Z').getTime() - 8 * 3600_000);
}

function getHktHour() {
  const now = new Date();
  return (now.getUTCHours() + 8) % 24;
}

// ═══════════════ Streak 更新 ═══════════════
export async function updateStreak(db, username) {
  const user = await db.collection('users').findOne(
    { username },
    { projection: { lastActiveDate: 1, streakDays: 1, maxStreak: 1, activeDaysTotal: 1 } }
  );
  if (!user) return { changed: false, streakDays: 0 };

  const today = getHktToday();
  if (user.lastActiveDate === today) {
    return { changed: false, streakDays: user.streakDays || 0 };
  }

  const yesterday = getHktYesterday();
  const newStreak = (user.lastActiveDate === yesterday)
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

  return { changed: true, streakDays: newStreak, maxStreak: Math.max(newStreak, user.maxStreak || 0) };
}

// ═══════════════ 成就检查 ═══════════════
export async function checkAchievements(db, username, context = {}) {
  const user = await db.collection('users').findOne(
    { username },
    { projection: { achievements: 1, streakDays: 1 } }
  );
  if (!user) return [];

  const have = new Set(user.achievements || []);
  const unlocked = [];
  const add = (id) => {
    if (ACHIEVEMENTS[id] && !have.has(id)) {
      unlocked.push(id);
      have.add(id);
    }
  };

  // ─── 拉数据 ───
  const [states, allProblems] = await Promise.all([
    db.collection('userstats').findOne({ username }, { projection: { states: 1 } }),
    db.collection('problems').find({}, { projection: { id: 1, difficulty: 1 } }).toArray(),
  ]);

  const userStates = states?.states || {};
  const passedIds = Object.entries(userStates)
    .filter(([, v]) => v === 'passed')
    .map(([k]) => k);
  const solvedCount = passedIds.length;

  // ─── 难度 ───
  const problemMap = Object.fromEntries(allProblems.map(p => [String(p.id), p]));
  const solvedDiffs = passedIds.map(pid => {
    const p = problemMap[pid];
    if (!p) return 0;
    const d = Number(p.difficulty) || 0;
    return d === 0 ? 10 : d;
  });
  const maxDifficulty = solvedDiffs.length ? Math.max(...solvedDiffs) : 0;

  // ─── A. Milestone ───
  if (solvedCount >= 1)    add('first-blood');
  if (solvedCount >= 10)   add('solved-10');
  if (solvedCount >= 25)   add('solved-25');
  if (solvedCount >= 50)   add('solved-50');
  if (solvedCount >= 100)  add('solved-100');
  if (solvedCount >= 200)  add('solved-200');
  if (solvedCount >= 500)  add('solved-500');
  if (solvedCount >= 1000) add('solved-1000');
  if (solvedCount >= 2000) add('solved-2000');

  // ─── B. Difficulty ───
  if (maxDifficulty >= 3) add('hard-3');
  if (maxDifficulty >= 4) add('hard-4');
  if (maxDifficulty >= 5) add('hard-5');
  if (maxDifficulty >= 6) add('hard-6');
  if (maxDifficulty >= 7) add('hard-7');

  // ─── C. Streak ───
  const streak = user.streakDays || 0;
  if (streak >= 3)   add('streak-3');
  if (streak >= 7)   add('streak-7');
  if (streak >= 30)  add('streak-30');
  if (streak >= 100) add('streak-100');

  // ─── D. Efficiency ───
  // first-try：每题首次提交即 AC
  const firstSubs = await db.collection('submissions').aggregate([
    { $match: { username } },
    { $sort: { timestamp: 1 } },
    {
      $group: {
        _id: '$problemId',
        firstType: '$type',
        firstCorrect: '$correct',
        firstSystemError: '$systemError',
        firstMarked: '$marked',
        firstScore: '$score',
      },
    },
  ]).toArray();

  let firstTryCount = 0;
  for (const s of firstSubs) {
    const passed = (s.firstType === 'image')
      ? (s.firstMarked === true && s.firstScore === 100)
      : (s.firstCorrect === true && s.firstSystemError !== true);
    if (passed) firstTryCount++;
  }

  if (firstTryCount >= 1)  add('first-try');
  if (firstTryCount >= 10) add('first-try-10');
  if (firstTryCount >= 50) add('first-try-50');

  // daily-N：今天 AC 数
  const todayStart = getHktDayStartUtc();
  const todayAC = await db.collection('submissions').countDocuments({
    username,
    timestamp: { $gte: todayStart },
    $or: [
      { type: 'image', marked: true, score: 100 },
      { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
    ],
  });

  if (todayAC >= 5)  add('daily-5');
  if (todayAC >= 10) add('daily-10');
  if (todayAC >= 15) add('daily-15');
  if (todayAC >= 20) add('daily-20');

  // ─── E. Fun ───
  if (context.trigger === 'submit') {
    const hktHour = getHktHour();
    if (hktHour >= 0 && hktHour < 4) add('night-owl');
    if (hktHour >= 5 && hktHour < 7) add('early-bird');
  }

  // perfect-day：今天所有提交都 AC 且 ≥ 5
  const todayTotal = await db.collection('submissions').countDocuments({
    username,
    timestamp: { $gte: todayStart },
  });
  if (todayTotal >= 5 && todayTotal === todayAC) {
    add('perfect-day');
  }

  // ─── G. Accuracy ───
  const totalSubs = await db.collection('submissions').countDocuments({ username });
  if (totalSubs >= 20) {
    const acSubs = await db.collection('submissions').countDocuments({
      username,
      $or: [
        { type: 'image', marked: true, score: 100 },
        { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
      ],
    });
    const acc = acSubs / totalSubs;
    if (acc >= 0.30) add('accuracy-30');
    if (acc >= 0.40) add('accuracy-40');
    if (acc >= 0.50) add('accuracy-50');
    if (acc >= 0.60) add('accuracy-60');
    if (acc >= 0.70) add('accuracy-70');
    if (acc >= 0.80) add('accuracy-80');
    if (acc >= 0.90) add('accuracy-90');
  }
    // ─── F. Hidden ───
  // speed-demon：从打开题目页到提交 < 5 秒
  if (
    context.trigger === 'submit' &&
    typeof context.pageDwellMs === 'number' &&
    context.pageDwellMs >= 0 &&
    context.pageDwellMs < 5000
  ) {
    add('speed-demon');
  }

  // never-give-up：本题 AC，且本题总提交数 ≥ 20
  if (
    context.trigger === 'submit' &&
    context.justAC === true &&
    typeof context.problemSubmitCount === 'number' &&
    context.problemSubmitCount >= 20
  ) {
    add('never-give-up');
  }
  // ═══════════ 写回 ═══════════
  if (unlocked.length === 0) return [];

  await db.collection('users').updateOne(
    { username },
    { $addToSet: { achievements: { $each: unlocked } } }
  );

  await db.collection('achievements_log').insertMany(
    unlocked.map(id => ({
      username,
      achievementId: id,
      unlockedAt: new Date(),
      context: { solvedCount, maxDifficulty, streak },
    }))
  );

  return unlocked;
}

// ═══════════════ 手动解锁（用于 hidden 成就） ═══════════════
export async function unlockAchievement(db, username, achievementId) {
  if (!ACHIEVEMENTS[achievementId]) {
    return { ok: false, message: 'Unknown achievement' };
  }
  const r = await db.collection('users').updateOne(
    { username },
    { $addToSet: { achievements: achievementId } }
  );
  if (r.modifiedCount === 0) {
    // 已经解锁过
    return { ok: false, alreadyHave: true };
  }
  await db.collection('achievements_log').insertOne({
    username,
    achievementId,
    unlockedAt: new Date(),
    context: { manual: true },
  });
  return { ok: true };
}