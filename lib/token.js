// lib/token.js
//
// token 的两个桶：
//   daily  —— 每天（HKT）重置的活跃额度，用来限制「今天能花多少」
//   global —— 攒下来的永久资产，换主题、PK 下注都靠它
//
// ⚠️ 每日重置只能有这一处真源。
//
// 以前 api/token-hub.js 里还自己写了一份「跨天就把 daily 补满、把
// dailyLoginClaimed / dailyQuestClaimed 清掉」的逻辑，而这里只重置
// daily/global/lastReset 却不清领取标记。两套逻辑互相打架，结果就是：
//   学生今天先做了一题 → 这里先重置并落库（lastReset = 今天），
//   Token Hub 再读到时以为「今天已经重置过了」，跳过自己那段，
//   于是 dailyLoginClaimed 永远停在昨天的 true —— 每日登入再也领不到。
// 现在统一走 ensureDailyReset()：一次写清楚 daily、global、lastReset、
// 两个旧标记，以及 dailyQuests 的每日任务状态。

const DAILY_ALLOWANCE = 30000;
const INITIAL_GLOBAL = 100000;

export function getTodayStr() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 把用户的每日状态结算到「今天」。
 *
 * 幂等、并发安全：真正的重置用 `token.lastReset !== today` 做条件更新，
 * 多个请求同时到达也只有第一个会落库，其余直接读结果。
 *
 * @returns {Promise<object|null>} 结算后的 user 文档（含 token / dailyQuests /
 *          displayName / streakDays / streakClaimed），用户不存在返回 null。
 */
export async function ensureDailyReset(db, username) {
  const today = getTodayStr();
  const users = db.collection('users');
  const projection = {
    token: 1, dailyQuests: 1, displayName: 1, streakDays: 1, streakClaimed: 1,
  };

  const user = await users.findOne({ username }, { projection });
  if (!user) return null;

  const token = user.token || {};
  const tokenStale = token.lastReset !== today;
  const questsStale = !user.dailyQuests || user.dailyQuests.date !== today;

  if (!tokenStale && !questsStale) return user;

  const hasQuestDoc = !!user.dailyQuests && typeof user.dailyQuests === 'object';

  if (tokenStale) {
    let daily = DAILY_ALLOWANCE;
    let global = num(token.global, INITIAL_GLOBAL);

    // 优先还清负债：global 是负数时，今天的额度先拿去填坑
    if (global < 0) {
      const repay = Math.min(daily, Math.abs(global));
      global += repay;
      daily -= repay;
    }

    const set = {
      'token.daily': daily,
      'token.global': global,
      'token.lastReset': today,
      'token.dailyLoginClaimed': false,
      'token.dailyQuestClaimed': false,
    };
    const update = { $set: set };

    if (hasQuestDoc) {
      set['dailyQuests.date'] = today;
      set['dailyQuests.claimed'] = [];
      update.$unset = { 'dailyQuests.pid': '', 'dailyQuests.fallback': '' };
    } else {
      set.dailyQuests = { date: today, claimed: [] };
    }

    // 条件更新：并发下只有第一个请求真正结算
    await users.updateOne({ username, 'token.lastReset': { $ne: today } }, update);
  } else if (questsStale) {
    // 少见：token 已经结算过（例如别的接口先重置了），但任务状态还停在旧日期
    const update = hasQuestDoc
      ? {
          $set: { 'dailyQuests.date': today, 'dailyQuests.claimed': [] },
          $unset: { 'dailyQuests.pid': '', 'dailyQuests.fallback': '' },
        }
      : { $set: { dailyQuests: { date: today, claimed: [] } } };

    await users.updateOne({ username, 'dailyQuests.date': { $ne: today } }, update);
  }

  return users.findOne({ username }, { projection });
}

export async function getTokenBalance(db, username) {
  await ensureDailyReset(db, username);

  const user = await db.collection('users').findOne({ username }, { projection: { token: 1 } });
  if (!user) {
    return { daily: DAILY_ALLOWANCE, global: INITIAL_GLOBAL, lastReset: getTodayStr() };
  }

  const token = user.token || {};
  return {
    ...token,
    daily: num(token.daily, DAILY_ALLOWANCE),
    global: num(token.global, INITIAL_GLOBAL),
    lastReset: token.lastReset,
  };
}

export async function consumeTokens(db, username, amount) {
  const token = await getTokenBalance(db, username);
  let daily = token.daily;
  let global = token.global;

  // 先扣每日，不夠再扣全局
  if (daily >= amount) {
    daily -= amount;
  } else {
    const remain = amount - daily;
    daily = 0;
    global -= remain; // 全局可为负
  }

  await db.collection('users').updateOne(
    { username },
    { 
      $set: { 'token.daily': daily, 'token.global': global },
      $inc: { 'token.totalUsed': amount } // 记录总消耗
    }
  );
  return { daily, global };
}

export async function rewardAC(db, username, difficulty) {
  const d = Number(difficulty) || 1;
  
  // 公式：2000 + 500 * d^2.5
  // 1级: 2500
  // 4级 (DSE极限): 34000
  // 7级 (IMO Prelim): 173500
  // 8级 (TST入门): 258000
  // 9级 (TST极难): 366500
  const reward = 2000 + 500 * Math.round(Math.pow(d, 2.5));

  await db.collection('users').updateOne(
    { username },
    { $inc: { 'token.global': reward } }
  );
  
  return reward;
}
