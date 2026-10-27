// lib/wallet.js —— token 的唯一出入口
//
// 背景：token 有两个桶，语义完全不同：
//   daily  —— 每天重置的活跃额度，用来限制「今天能花多少」
//   global —— 攒下来的永久资产，换主题、PK 下注都靠它
//
// 曾经出过的漏洞：下注时按 daily→global 的顺序扣，退款时一律加回 global。
// daily 每天补满、global 不回退，于是「下注再取消」就能把每日额度洗成
// 永久额度，一天白拿一次。所以这里强制：
//
//   扣款返回 taken（各桶扣了多少），退款必须按 taken 原路返回。
//
// 任何涉及 token 增减的代码都应该走这个文件，不要再自己算。

const ZERO = { daily: 0, global: 0 };

function normalize(tokenObj) {
  return {
    daily: Number(tokenObj?.daily) || 0,
    global: Number(tokenObj?.global) || 0,
    lastReset: tokenObj?.lastReset,
    dailyLoginClaimed: tokenObj?.dailyLoginClaimed,
    dailyQuestClaimed: tokenObj?.dailyQuestClaimed,
  };
}

export function totalTokens(tokenObj) {
  return (Number(tokenObj?.daily) || 0) + (Number(tokenObj?.global) || 0);
}

/**
 * 扣款：先扣每日额度，再扣永久额度。
 * @returns {{ token, taken: {daily, global} } | null} 余额不足返回 null
 */
export function deductTokens(tokenObj, amount) {
  const need = Math.max(0, Math.round(Number(amount) || 0));
  const t = normalize(tokenObj);
  if (t.daily + t.global < need) return null;

  const fromDaily = Math.min(t.daily, need);
  const fromGlobal = need - fromDaily;
  t.daily -= fromDaily;
  t.global -= fromGlobal;

  return { token: t, taken: { daily: fromDaily, global: fromGlobal } };
}

/**
 * 退款：按原路返回。扣的是 daily 就退 daily，扣的是 global 就退 global。
 * 老记录没有 taken 时，保守地把整笔当作 daily —— 退进 global 就是那个洗钱口子。
 */
export function refundTokens(tokenObj, taken, fallbackAmount = 0) {
  const t = normalize(tokenObj);
  const src = (taken && typeof taken === 'object')
    ? { daily: Number(taken.daily) || 0, global: Number(taken.global) || 0 }
    : { daily: Math.max(0, Math.round(Number(fallbackAmount) || 0)), global: 0 };

  t.daily += src.daily;
  t.global += src.global;
  return t;
}

/**
 * 只扣永久额度（global），不碰 daily。
 *
 * 为什么 PK 必须用这个：
 *   daily 每天重置，不用就浪费；global 是攒下来的资产。
 *   如果允许用 daily 下注，而赢来的奖励又进 global（addTokens 的语义），
 *   那把 daily 洗成 global 就成了一门稳赚的生意 —— 即使扣除 20% 手续费，
 *   两人对刷也只是把「本来会过期的钱」换成「永久的钱」，净损失为零。
 *
 *   所以竞技下注只认 global：花的和赢的必须是同一种资产。
 *
 * @returns {{ token, taken: {daily, global} } | null} global 不足返回 null
 */
export function deductGlobalOnly(tokenObj, amount) {
  const need = Math.max(0, Math.round(Number(amount) || 0));
  const t = normalize(tokenObj);
  if (t.global < need) return null;

  t.global -= need;
  return { token: t, taken: { daily: 0, global: need } };
}

/**
 * 加币：一律进 global。
 * 奖励（成就、PK 奖池）和退款语义不同 —— 奖励是新产生的资产，
 * 不该计入「今天的活跃额度」，否则 daily 的限流就失去意义。
 */
export function addTokens(tokenObj, amount) {
  const t = normalize(tokenObj);
  t.global += Math.max(0, Math.round(Number(amount) || 0));
  return t;
}

export { ZERO };
