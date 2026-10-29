// lib/token.js —— 钱包的读写入口（薄封装，SQL 在 lib/userStore.js）
//
// 保留原来的函数签名 (db, username, ...)，调用方不用改。
// db 参数已经不再使用：users.token 迁到了 PostgreSQL 的 user_tokens 表。

import * as U from './userStore.js';

const DAILY_ALLOWANCE = 30000;
const INITIAL_GLOBAL = 100000;

/**
 * 读取余额。顺带做两件事：
 *   1. 老账号没有钱包行时补一行默认值
 *   2. 跨天时把 daily 补满（并优先偿还 global 的负值）
 */
export async function getTokenBalance(db, username) {
  await U.ensureTokens(username);
  return U.resetDailyIfNeeded(username);
}

/**
 * 扣费：先扣 daily，不够再扣 global（global 允许变负，历史行为）。
 * @returns {{daily:number, global:number}}
 */
export async function consumeTokens(db, username, amount) {
  await getTokenBalance(db, username);
  const r = await U.consumeTokens(username, amount);
  return { daily: r.daily, global: r.global };
}

/**
 * AC 奖励：按题目难度发币，一律进 global（不占每日额度）。
 * 公式保持原样：2000 + 500 * round(d^2.5)
 */
export async function rewardAC(db, username, difficulty) {
  const d = Number(difficulty) || 1;
  const reward = 2000 + 500 * Math.round(Math.pow(d, 2.5));
  await U.addTokens(username, reward);
  return reward;
}

export { DAILY_ALLOWANCE, INITIAL_GLOBAL };
