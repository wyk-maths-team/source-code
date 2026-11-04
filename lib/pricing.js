// lib/pricing.js —— DeepSeek 峰谷时段（北京时间）
//
// 官方定价（2026-08-17 起）：
//   高峰：周一至周五 09:00-12:00、14:00-18:00
//   空闲：其余时间（含周末全天），价格为高峰的一半
// 所以同一份用量，高峰时段的花费是空闲的两倍。

export const PEAK_MULTIPLIER = 2;

/** 该时刻是否处于高峰计费时段 */
export function isPeakHour(date = new Date()) {
  const hkt = new Date(date.getTime() + 8 * 3600_000);
  const day = hkt.getUTCDay();                 // 0 = Sunday
  if (day === 0 || day === 6) return false;    // 周末全天半价
  const minutes = hkt.getUTCHours() * 60 + hkt.getUTCMinutes();
  return (minutes >= 9 * 60 && minutes < 12 * 60)
      || (minutes >= 14 * 60 && minutes < 18 * 60);
}

/** 结算倍率：高峰 2，空闲 1 */
export function billingMultiplier(date = new Date()) {
  return isPeakHour(date) ? PEAK_MULTIPLIER : 1;
}

/** 距离下一次切换还有多少分钟（给 admin 页面用） */
export function minutesUntilRateChange(date = new Date()) {
  const hkt = new Date(date.getTime() + 8 * 3600_000);
  const day = hkt.getUTCDay();
  const minutes = hkt.getUTCHours() * 60 + hkt.getUTCMinutes();

  const peaks = [[9 * 60, 12 * 60], [14 * 60, 18 * 60]];
  const weekend = day === 0 || day === 6;

  let next = -1;
  if (!weekend) {
    for (const [from, to] of peaks) {
      if (minutes < from) { next = from; break; }
      if (minutes >= from && minutes < to) { next = to; break; }
    }
  }
  if (next < 0) {
    // 今天没有更晚的切换点了 → 明天 09:00（或下周一）
    next = 24 * 60 + 9 * 60; // 粗略：明天 9 点
    if (weekend) next = 24 * 60 + 9 * 60;
  }
  return Math.max(0, next - minutes);
}
