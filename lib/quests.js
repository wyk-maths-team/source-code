// lib/quests.js — the single source of truth for Token Hub daily quests: definitions and evaluation
//
// Why these were extracted from api/token-hub.js:
//   1. The AC criterion must match the rest of the site. token-hub used to scan
//      submissions with `{ correct: true }`, which missed image answers
//      (type:'image', marked, score 100) and didn't exclude systemError —
//      inconsistent with the achievements system (AC_FILTER in lib/achievements.js).
//   2. Every GET did a full-table scan of that user's submissions for the day.
//      Now the result is cached for 30s, and claiming forces a fresh recompute.
//   3. Quest completion used to be displayed only on the frontend; the server
//      didn't validate anything on POST claim.
//
// Conventions:
//   - "Today" = the current day in HKT (UTC+8), starting at 00:00; no button press
//     is needed to start;
//   - Completion is computed server-side from submissions; the frontend has no say;
//   - Rewards always go to global (same semantics as lib/wallet.js#addTokens).

const HKT_OFFSET_MS = 8 * 3600_000;
const CACHE_TTL_MS = 5_000;   // Only absorbs concurrent jitter; students coming back from a problem must see fresh state immediately

// ═══════════════ Dates ═══════════════

export function hktToday() {
  return new Date(Date.now() + HKT_OFFSET_MS).toISOString().slice(0, 10);
}

export function hktDayStart(today = hktToday()) {
  return new Date(`${today}T00:00:00+08:00`);
}

// ═══════════════ Quest definitions ═══════════════

export const DAILY_QUEST_DEFS = [
  {
    id: 'login',
    title: 'Daily Login',
    icon: 'fa-bolt',
    color: '#f1c40f',
    desc: 'First visit to Token Hub today — just click to claim.',
    reward: 10000,
    link: null,
  },
  {
    id: 'daily',
    title: 'Daily Challenge',
    icon: 'fa-flag-checkered',
    color: '#3498db',
    desc: 'Solve the problem the system assigned to you today.',
    reward: 30000,
    link: 'daily',
  },
  {
    id: 'practice',
    title: 'Practice Five',
    icon: 'fa-dumbbell',
    color: '#e67e22',
    desc: 'Make 5 submissions today — wrong answers count too. Just give it a go.',
    reward: 5000,
    link: 'problems',
    goal: 5,
  },
  {
    id: 'firstTry',
    title: 'First-Try AC',
    icon: 'fa-crosshairs',
    color: '#9b59b6',
    desc: 'AC a problem on its very first submission today.',
    reward: 20000,
    link: 'problems',
  },
  {
    id: 'breakthrough',
    title: 'Breakthrough',
    icon: 'fa-mountain-sun',
    color: '#e74c3c',
    desc: 'AC a problem harder than your all-time highest difficulty today.',
    reward: 20000,
    link: 'problems',
  },
  {
    id: 'diverse',
    title: 'Versatile',
    icon: 'fa-shapes',
    color: '#1abc9c',
    desc: 'AC two problems from different topics today.',
    reward: 10000,
    link: 'problems',
  },
];

// Submit-streak milestones; not daily quests — granted as soon as they're reached.
export const STREAK_MILESTONES = [
  { days: 7, reward: 100000 },
  { days: 14, reward: 200000 },
  { days: 30, reward: 500000 },
];

// ═══════════════ Helpers ═══════════════

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// Keep in sync with AC_FILTER in lib/achievements.js:
// image answers use marked + score; text answers use correct and must not be a system error.
export function submissionPassed(s) {
  if (!s) return false;
  if (s.type === 'image') return s.marked === true && Number(s.score) === 100;
  return s.correct === true && s.systemError !== true;
}

// Rating → target difficulty (1..10). Uses the legacy mapping: 1000 → 2, 1500 → 3, 2500 → 7.
export function targetDifficultyFor(rating) {
  const r = Number(rating);
  if (!Number.isFinite(r)) return 2;
  return Math.max(1, Math.min(10, Math.floor((r - 1000) / 300) + 2));
}

// ═══════════════ Level bonus ═══════════════
//
// The higher the rating, the richer the daily rewards:
//   1000 → ×1.0, +0.1 every 250 points, capped at ×1.8 (3000+).
// Rounded to 0.1 so it is easy to display and to verify.
export function levelMultiplier(rating) {
  const r = Number(rating);
  const base = Number.isFinite(r) ? r : 1000;
  const m = 1 + Math.min(0.8, Math.max(0, (base - 1000) / 2500));
  return Math.round(m * 10) / 10;
}

// Reward scaled by level, rounded to the nearest 1000 so numbers stay tidy.
export function levelReward(baseReward, rating) {
  const n = Number(baseReward) || 0;
  const v = n * levelMultiplier(rating);
  return Math.round(v / 1000) * 1000;
}

// ═══════════════ Daily challenge problem selection ═══════════════
//
// Selection must be stable: the same person on the same day gets the same
// problem no matter how many times they refresh.
// Rules:
//   1. Only consider public problems with difficulty ≥ target difficulty;
//   2. Exclude problems already AC'd before today (keep ones AC'd today —
//      otherwise the candidate set changes as soon as you solve, the problem
//      jumps away, and the quest can never be completed);
//   3. Within the band closest to the target difficulty, pick one by hashing
//      username+date. Problem difficulties are decimals (2.83, 3.02…), so the
//      band is narrowed to 0.5 wide; otherwise the "lowest difficulty tier"
//      often ends up with a single problem and the hash is meaningless.
// All cleared → return null, and the quest degrades to "AC any problem with difficulty ≥ target".
function pickDailyProblem(pub, states, todayAC, username, today, target) {
  const list = pub.list || [];
  const candidates = (pool) => {
    const out = [];
    for (const p of list) {
      const id = p.id;
      if (!id) continue;
      const d = Number(p.difficulty) || 0;
      if (pool === 'target' && d < target) continue;
      if (states[id] === 'passed' && !todayAC.has(id)) continue;
      out.push({ id, d });
    }
    return out;
  };

  let pool = candidates('target');
  if (!pool.length) pool = candidates('any');   // Everything at the target difficulty is cleared — relax the filter
  if (!pool.length) return null;

  const band = pool.filter((p) => p.d < target + 0.5);
  if (band.length) pool = band;

  const idx = hash32(`${username}|${today}`) % pool.length;
  return pool[idx].id;
}

// ═══════════════ Main computation ═══════════════

const _cache = new Map();   // username -> { date, rating, state, expireAt }

export function invalidateQuestCache(username) {
  if (username) _cache.delete(username);
  else _cache.clear();
}

/**
 * Compute today's completion state for all of a user's quests.
 *
 * @param {object} db
 * @param {string} username
 * @param {{ rating?: number, fresh?: boolean, user?: object }} opts
 *        If user is provided, skip re-querying users (use when the caller just fetched it).
 */
export async function computeQuests(db, username, opts = {}) {
  const { rating = 1000, fresh = false, user: givenUser = null } = opts;
  const today = hktToday();

  if (!fresh) {
    const hit = _cache.get(username);
    if (hit && hit.date === today && hit.rating === rating && hit.expireAt > Date.now()) {
      return hit.state;
    }
  }

  const dayStart = hktDayStart(today);
  const usersCol = db.collection('users');
  const { getPublicProblems } = await import('./problemCache.js');

  const [user, statsDoc, pub, subs] = await Promise.all([
    givenUser || usersCol.findOne(
      { username },
      { projection: { token: 1, dailyQuests: 1, displayName: 1, streakDays: 1, streakClaimed: 1 } }
    ),
    db.collection('userstats').findOne({ username }, { projection: { states: 1 } }),
    getPublicProblems(db),
    db.collection('submissions').find(
      { username, timestamp: { $gte: dayStart } },
      { projection: { problemId: 1, correct: 1, systemError: 1, type: 1, marked: 1, score: 1, timestamp: 1 } }
    ).sort({ timestamp: 1 }).toArray(),
  ]);

  const states = statsDoc?.states || {};
  const diffOf = (pid) => Number(pub.diffMap[pid]) || 0;

  // ── Today's submissions: count, whether any first submission was AC, which problems were AC'd ──
  let submitCount = 0;
  const firstSeen = new Map();     // pid -> first submission of the day
  const todayAC = new Set();       // Problems AC'd today (deduped)

  for (const s of subs) {
    submitCount++;
    const pid = s.problemId;
    if (!pid) continue;
    if (!firstSeen.has(pid)) firstSeen.set(pid, s);
    if (submissionPassed(s)) todayAC.add(pid);
  }

  let firstTryAC = false;
  for (const s of firstSeen.values()) {
    if (submissionPassed(s)) { firstTryAC = true; break; }
  }

  // ── Highest difficulty before today (exclude today's ACs, or "breakthrough" would always be true) ──
  let maxBefore = 0;
  for (const pid in states) {
    if (states[pid] !== 'passed') continue;
    if (todayAC.has(pid)) continue;
    const d = diffOf(pid);
    if (d > maxBefore) maxBefore = d;
  }
  let maxToday = 0;
  for (const pid of todayAC) {
    const d = diffOf(pid);
    if (d > maxToday) maxToday = d;
  }

  const target = targetDifficultyFor(rating);

  // ── Breakthrough ──
  // The old rule required today's AC to be strictly harder than the personal best,
  // which is practically unreachable: students mostly solve problems below their own
  // ceiling (measured 0 completions in a day). New rule:
  //   first-time-AC a problem with difficulty >= max(target, personalBest - 1).
  // "First-time" means no AC for that problem before today, so redoing old problems
  // does not count.
  let firstTodayAC = [];
  if (todayAC.size) {
    const prior = await db.collection('submissions').aggregate([
      {
        $match: {
          username,
          problemId: { $in: [...todayAC] },
          timestamp: { $lt: dayStart },
          $or: [
            { type: 'image', marked: true, score: 100 },
            { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
          ],
        },
      },
      { $group: { _id: '$problemId' } },
    ]).toArray();
    const seenBefore = new Set(prior.map((x) => x._id));
    firstTodayAC = [...todayAC].filter((pid) => !seenBefore.has(pid));
  }
  const breakthroughBar = Math.max(target, maxBefore - 1);
  const breakthrough = firstTodayAC.some((pid) => diffOf(pid) >= breakthroughBar - 1e-9);

  // ── Daily challenge: which problem is assigned today (persist once computed) ──
  const dq = user?.dailyQuests;
  const sameDay = dq?.date === today;
  let dailyPid = sameDay ? (dq.pid || null) : null;
  let fallback = sameDay ? !!dq.fallback : false;

  if (!sameDay || (!dailyPid && !fallback)) {
    dailyPid = pickDailyProblem(pub, states, todayAC, username, today, target);
    if (dailyPid) {
      // Conditional update: under concurrency only one pid gets written; everyone reads the same one afterwards.
      // Await once here to guarantee the problem returned to the frontend is the same one persisted.
      await usersCol.updateOne(
        { username, 'dailyQuests.date': today, 'dailyQuests.pid': { $exists: false } },
        { $set: { 'dailyQuests.pid': dailyPid } }
      ).catch(() => {});
    } else {
      fallback = true;
      await usersCol.updateOne(
        { username, 'dailyQuests.date': today },
        { $set: { 'dailyQuests.fallback': true } }
      ).catch(() => {});
    }
  }

  const dailyCompleted = fallback
    ? [...todayAC].some((pid) => diffOf(pid) >= target)
    : (dailyPid ? todayAC.has(dailyPid) : false);

  // ── Problem metadata (name / tags): fetch only today's ACs + the daily problem ──
  const wantIds = new Set(todayAC);
  if (dailyPid) wantIds.add(dailyPid);
  let probInfo = new Map();
  if (wantIds.size) {
    const rows = await db.collection('problems').find(
      { id: { $in: [...wantIds] } },
      { projection: { id: 1, name: 1, tags: 1 } }
    ).toArray();
    probInfo = new Map(rows.map((r) => [r.id, r]));
  }

  // ── Versatile: today's ACs cover at least two different tags ──
  const tagSet = new Set();
  for (const pid of todayAC) {
    const tags = probInfo.get(pid)?.tags;
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      const s = String(t || '').trim().toLowerCase();
      if (s) tagSet.add(s);
    }
  }

  // ── Assemble quest list ──
  const claimedSet = new Set(sameDay && Array.isArray(dq?.claimed) ? dq.claimed : []);
  const levelMul = levelMultiplier(rating);

  const quests = DAILY_QUEST_DEFS.map((def) => {
    let completed = false;
    let progress = null;
    let desc = def.desc;

    switch (def.id) {
      case 'login':
        completed = true;
        break;
      case 'daily':
        completed = dailyCompleted;   // Problem info is already in the description; no 0/1 progress bar
        break;
      case 'practice':
        completed = submitCount >= def.goal;
        progress = { current: Math.min(submitCount, def.goal), target: def.goal };
        break;
      case 'firstTry':
        completed = firstTryAC;
        break;
      case 'breakthrough':
        completed = breakthrough;
        desc = maxBefore > 0
          ? `First-time AC a problem with difficulty ≥ ${round2(breakthroughBar)} today (your best so far: ${round2(maxBefore)}).`
          : `First-time AC a problem with difficulty ≥ ${round2(breakthroughBar)} today.`;
        break;
      case 'diverse':
        completed = tagSet.size >= 2;
        progress = { current: Math.min(tagSet.size, 2), target: 2 };
        break;
    }

    return {
      id: def.id,
      title: def.title,
      desc,
      icon: def.icon,
      color: def.color,
      reward: levelReward(def.reward, rating),
      baseReward: def.reward,
      link: def.link,
      completed,
      claimed: claimedSet.has(def.id),
      progress,
    };
  });

  const dailyProb = dailyPid ? probInfo.get(dailyPid) : null;
  const dailyProblem = dailyPid
    ? {
        id: dailyPid,
        title: dailyProb?.name || dailyPid,
        difficulty: diffOf(dailyPid),
        fallback: false,
      }
    : (fallback ? { id: null, title: null, difficulty: target, fallback: true } : null);

  // ── Streak milestones ──
  const streakDays = Number(user?.streakDays) || 0;
  const claimedStreaks = new Set(
    Array.isArray(user?.streakClaimed) ? user.streakClaimed.map(Number) : []
  );
  const milestones = STREAK_MILESTONES.map((m) => ({
    days: m.days,
    reward: m.reward,
    reached: streakDays >= m.days,
    claimed: claimedStreaks.has(m.days),
  }));

  const state = {
    date: today,
    targetDifficulty: target,
    level: { rating: Number(rating) || 1000, multiplier: levelMul },
    dailyProblem,
    stats: {
      submitCount,
      acCount: todayAC.size,
      firstTryAC,
      maxBefore,
      maxToday,
      tagCount: tagSet.size,
    },
    quests,
    streak: { days: streakDays, milestones },
  };

  _cache.set(username, { date: today, rating, state, expireAt: Date.now() + CACHE_TTL_MS });
  return state;
}