// lib/time.js —— 全站唯一的时间基准
//
// 业务方（香港中学）的所有「今天」都以 Asia/Hong_Kong (UTC+8) 为准：
//   每日额度重置、连续打卡 streak、今日 AC、今日任务、在线状态。
//
// 以前这些地方散落着 new Date(Date.now() + 8 * 3600_000).toISOString().slice(0,10)
// 这类手工偏移，写法各不相同，也容易漏掉。统一收进这里。
//
// 注意：这里处理的是「业务日期」，不是「瞬间」。
// 瞬间一律用 Date / TIMESTAMPTZ，只有需要按天比较时才用 YYYY-MM-DD 字符串。

export const HK_TZ = 'Asia/Hong_Kong';

/** 香港没有夏令时，偏移恒定 +08:00 */
export const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

const _partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: HK_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 任意瞬间 -> 香港日期 'YYYY-MM-DD' */
export function todayHK(d = new Date()) {
  const parts = _partsFmt.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return get('year') + '-' + get('month') + '-' + get('day');
}

/** 香港日期 'YYYY-MM-DD' -> 该日香港零点对应的瞬间（UTC Date） */
export function startOfDayHK(dateStr) {
  return new Date(String(dateStr) + 'T00:00:00+08:00');
}

/** 今天香港零点 */
export function startOfTodayHK(now = new Date()) {
  return startOfDayHK(todayHK(now));
}

/** 昨天（香港日期字符串） */
export function yesterdayHK(now = new Date()) {
  return todayHK(new Date(now.getTime() - 86_400_000));
}

/** 判断一个 YYYY-MM-DD 是否就是香港的今天 */
export function isTodayHK(dateStr, now = new Date()) {
  return String(dateStr || '') === todayHK(now);
}

/** 香港时间的小时（0-23），用于按小时限流之类 */
export function hourHK(now = new Date()) {
  return Math.floor(((now.getTime() + HK_OFFSET_MS) % 86_400_000) / 3_600_000);
}
