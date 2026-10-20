// lib/token.js
const DAILY_ALLOWANCE = 30000;
const INITIAL_GLOBAL = 100000;

function getTodayStr() {
  const now = new Date();
  const hkDate = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return hkDate.toISOString().split('T')[0];
}

export async function getTokenBalance(db, username) {
  const today = getTodayStr();
  let user = await db.collection('users').findOne({ username }, { projection: { token: 1 } });
  let token = user?.token || { daily: DAILY_ALLOWANCE, global: INITIAL_GLOBAL, lastReset: today, totalUsed: 0 };

  if (token.lastReset !== today) {
    let daily = DAILY_ALLOWANCE;
    let global = token.global;

    // 優先還清負債
    if (global < 0) {
      const repay = Math.min(daily, Math.abs(global));
      global += repay;
      daily -= repay;
    }
    token = { ...token, daily, global, lastReset: today };
    await db.collection('users').updateOne({ username }, { $set: { token } });
  }
  return token;
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
  // 可以在这里调整首 AC 的奖励，你之前说的 3000/20000，根据你的设计修改
  const reward = (difficulty >= 5) ? 5000 : 1000; 
  await db.collection('users').updateOne(
    { username },
    { $inc: { 'token.global': reward } }
  );
  return reward;
}