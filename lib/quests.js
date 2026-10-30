// lib/quests.js —— Token Hub 每日任务的唯一定义与判定
//
// 为什么要把这些从 api/token-hub.js 里抽出来：
//   1. AC 口径必须和全站一致。以前 token-hub 用 `{ correct: true }` 扫
//      submissions，漏掉图片作答（type:'image', marked, score 100），
//      也没排除 systemError，判定和成就系统（lib/achievements.js 的
//      AC_FILTER）对不上。
//   2. 每次 GET 都全表扫该用户当天的 submissions。现在算一次缓存 30s，
//      领取时强制 fresh 重算。
//   3. 任务完成度以前只在前端显示，POST 领取时服务端根本不校验。
//
// 约定：
//   - 「今天」= HKT（UTC+8）当天，从 00:00 开始，不需要点按钮才开始；
//   - 完成度由服务端从 submissions 现算，前端说的不算；
//   - 奖励一律进 global（与 lib/wallet.js#addTokens 同语义）。

const HKT_OFFSET_MS = 8 * 3600_000;
const CACHE_TTL_MS = 5_000;   // 只挡并发抖动；学生做完题回来要能立刻看到新状态

// ═══════════════ 日期 ═══════════════

export function hktToday() {
  return new Date(Date.now() + HKT_OFFSET_MS).toISOString().slice(0, 10);
}

export function hktDayStart(today = hktToday()) {
  return new Date(`${today}T00:00:00+08:00`);
}

// ═══════════════ 任务定义 ═══════════════

export const DAILY_QUEST_DEFS = [
  {
    id: 'login',
    title: '每日登入',
    icon: 'fa-bolt',
    color: '#f1c40f',
    desc: '今天第一次来到 Token Hub，点一下就能领。',
    reward: 10000,
    link: null,
  },
  {
    id: 'daily',
    title: '每日挑战',
    icon: 'fa-flag-checkered',
    color: '#3498db',
    desc: '做完今天系统派给你的那道题。',
    reward: 30000,
    link: 'daily',
  },
  {
    id: 'practice',
    title: '练手五连',
    icon: 'fa-dumbbell',
    color: '#e67e22',
    desc: '今天提交满 5 次，做错也算 —— 敢写就行。',
    reward: 5000,
    link: 'problems',
    goal: 5,
  },
  {
    id: 'firstTry',
    title: '一眼 AC',
    icon: 'fa-crosshairs',
    color: '#9b59b6',
    desc: '今天有一道题首次提交就 AC。',
    reward: 20000,
    link: 'problems',
  },
  {
    id: 'breakthrough',
    title: '突破自我',
    icon: 'fa-mountain-sun',
    color: '#e74c3c',
    desc: '今天 AC 一道比你历史最高难度还高的题。',
    reward: 20000,
    link: 'problems',
  },
  {
    id: 'diverse',
    title: '多面手',
    icon: 'fa-shapes',
    color: '#1abc9c',
    desc: '今天 AC 两道分属不同知识点的题。',
    reward: 10000,
    link: 'problems',
  },
];

// 连续学习（submit streak）里程碑，不算每日任务，达到就给。
export const STREAK_MILESTONES = [
  { days: 7, reward: 100000 },
  { days: 14, reward: 200000 },
  { days: 30, reward: 500000 },
];

// ═══════════════ 小工具 ═══════════════

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// 与 lib/achievements.js 的 AC_FILTER 保持一致：
// 图片作答看 marked + score，文字作答看 correct 且非系统错误。
export function submissionPassed(s) {
  if (!s) return false;
  if (s.type === 'image') return s.marked === true && Number(s.score) === 100;
  return s.correct === true && s.systemError !== true;
}

// Rating → 目标难度（1..10）。沿用旧映射：1000 → 2，1500 → 3，2500 → 7。
export function targetDifficultyFor(rating) {
  const r = Number(rating);
  if (!Number.isFinite(r)) return 2;
  return Math.max(1, Math.min(10, Math.floor((r - 1000) / 300) + 2));
}

// ═══════════════ 每日挑战选题 ═══════════════
//
// 选题必须稳定：同一个人同一天刷新多少次都是同一道题。
// 规则：
//   1. 只考虑公开题，难度 ≥ 目标难度；
//   2. 排除「今天之前就已经 AC 过」的题（今天刚 AC 的不排除，
//      否则一做完题，候选集变了，题目就会跳走，任务永远完不成）；
//   3. 取难度最接近目标的那一档，用 username+date 哈希挑一道。
// 全做完了 → 返回 null，任务退化成「AC 任意一道难度 ≥ 目标的题」。
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
  if (!pool.length) pool = candidates('any');   // 目标难度全清完了，放宽
  if (!pool.length) return null;

  pool.sort((a, b) => a.d - b.d);
  const minD = pool[0].d;
  const tier = [];
  for (const p of pool) {
    if (p.d !== minD) break;
    tier.push(p);
  }
  const idx = hash32(`${username}|${today}`) % tier.length;
  return tier[idx].id;
}

// ═══════════════ 主计算 ═══════════════

const _cache = new Map();   // username -> { date, rating, state, expireAt }

export function invalidateQuestCache(username) {
  if (username) _cache.delete(username);
  else _cache.clear();
}

/**
 * 算出某人今天所有任务的完成度。
 *
 * @param {object} db
 * @param {string} username
 * @param {{ rating?: number, fresh?: boolean, user?: object }} opts
 *        user 传了就不再查一次 users（调用方刚查过时用）。
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

  // ── 今日提交：次数、首次提交是否 AC、AC 了哪些题 ──
  let submitCount = 0;
  const firstSeen = new Map();     // pid -> 当天第一次提交
  const todayAC = new Set();       // 今天 AC 过的题（去重）

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

  // ── 今天之前的最高难度（排除今天刚 AC 的，否则「突破」恒真）──
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
  const breakthrough = maxBefore > 0 && maxToday > maxBefore;

  // ── 每日挑战：今天派哪道题（算出来就落库固定）──
  const target = targetDifficultyFor(rating);
  const dq = user?.dailyQuests;
  const sameDay = dq?.date === today;
  let dailyPid = sameDay ? (dq.pid || null) : null;
  let fallback = sameDay ? !!dq.fallback : false;

  if (!sameDay || (!dailyPid && !fallback)) {
    dailyPid = pickDailyProblem(pub, states, todayAC, username, today, target);
    if (dailyPid) {
      // 条件更新：并发下只有一个 pid 能写进去，之后大家读同一个。
      // 这里 await 一次，保证返回给前端的题和落库的题是同一道。
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

  // ── 题目元数据（名称 / tags）：只查今天 AC 的 + 每日题 ──
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

  // ── 多面手：今天 AC 的题覆盖至少两个不同 tag ──
  const tagSet = new Set();
  for (const pid of todayAC) {
    const tags = probInfo.get(pid)?.tags;
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      const s = String(t || '').trim().toLowerCase();
      if (s) tagSet.add(s);
    }
  }

  // ── 组装任务列表 ──
  const claimedSet = new Set(sameDay && Array.isArray(dq?.claimed) ? dq.claimed : []);

  const quests = DAILY_QUEST_DEFS.map((def) => {
    let completed = false;
    let progress = null;

    switch (def.id) {
      case 'login':
        completed = true;
        break;
      case 'daily':
        completed = dailyCompleted;
        progress = { current: dailyCompleted ? 1 : 0, target: 1 };
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
        break;
      case 'diverse':
        completed = tagSet.size >= 2;
        progress = { current: Math.min(tagSet.size, 2), target: 2 };
        break;
    }

    return {
      id: def.id,
      title: def.title,
      desc: def.desc,
      icon: def.icon,
      color: def.color,
      reward: def.reward,
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

  // ── 连续学习里程碑 ──
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
