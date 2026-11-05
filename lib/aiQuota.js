// lib/aiQuota.js —— 每日 AI 使用额度
//
// 每个账号每天最多花 400,000 token 在 AI 判题上。
// rating > 2200 的账号不受限制（给高手和教练留口子）。
// 额度按自然日（香港时间）重置。

export const DAILY_AI_LIMIT = 400000;
export const QUOTA_EXEMPT_RATING = 2200;

function hktToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

export async function getAiUsage(db, username) {
  const u = await db.collection('users').findOne({ username }, { projection: { aiDaily: 1 } });
  const today = hktToday();
  const rec = u && u.aiDaily;
  const used = (rec && rec.date === today) ? (Number(rec.used) || 0) : 0;
  return { date: today, used, limit: DAILY_AI_LIMIT };
}

/** 判分前调用：额度用完了就不让继续 */
export async function checkAiQuota(db, username) {
  const { used } = await getAiUsage(db, username);
  if (used < DAILY_AI_LIMIT) {
    return { allowed: true, used, remaining: DAILY_AI_LIMIT - used, limit: DAILY_AI_LIMIT };
  }

  // 只有真的超了才去取 rating（那边有缓存，但没必要每次都查）
  let rating = 0;
  try {
    const { getUserRating } = await import('./userRating.js');
    const r = await getUserRating(db, username);
    rating = Number(r && r.rating) || 0;
  } catch (e) { /* rating 取不到就按未豁免处理 */ }

  if (rating > QUOTA_EXEMPT_RATING) {
    return { allowed: true, used, limit: DAILY_AI_LIMIT, exempt: true, rating };
  }

  return {
    allowed: false,
    used,
    limit: DAILY_AI_LIMIT,
    rating,
    message: 'Daily AI budget reached (' + DAILY_AI_LIMIT.toLocaleString('en-US')
      + ' tokens). Please contact an administrator if you need a higher limit.'
      + ' Accounts rated above ' + QUOTA_EXEMPT_RATING + ' are exempt.',
  };
}

/** 扣费之后累加今日用量 */
export async function addAiUsage(db, username, amount) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (!n) return;
  const today = hktToday();
  const u = await db.collection('users').findOne({ username }, { projection: { aiDaily: 1 } });
  const rec = u && u.aiDaily;
  if (rec && rec.date === today) {
    await db.collection('users').updateOne({ username }, { $inc: { 'aiDaily.used': n } });
  } else {
    await db.collection('users').updateOne({ username }, { $set: { aiDaily: { date: today, used: n } } });
  }
}
