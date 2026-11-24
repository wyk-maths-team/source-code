// lib/rateLimit.js
//
// 固定窗口限流。一次调用 = 一个"桶"，桶按 key 隔离。
//
//   await applyRateLimit(req, res)                     // 默认桶：IP 维度 30 次/秒，超限封 30 秒
//   await applyRateLimit(req, res, {                   // 命名桶：各自计数，互不影响
//     name: 'batch', max: 3, windowMs: 60_000, banMs: 60_000,
//   })
//   await applyRateLimit(req, res, {                   // 显式 key：按用户而不是按 IP
//     name: 'user-quota', key: 'user:' + username, max: 10, windowMs: 60_000,
//   })
//
// 返回 false 表示已经写好 429 响应，调用方直接 return 即可。
//
// 注意：这是**实例内**限流。Vercel 每个实例各有自己的 Map，全局真实上限
// 是「单实例上限 × 活跃实例数」。它的用途是挡住单点刷接口，不是精确计费；
// 要跨实例的硬上限得落到 Mongo / 外部计数器（见 TODO）。

const buckets = new Map();

const DEFAULT_WINDOW_MS = 1000;       // 1 秒
const DEFAULT_MAX_REQ   = 30;         // 每秒 30 次（放寬）
const DEFAULT_BAN_MS    = 30_000;     // 封 30 秒（縮短）
const CLEANUP_MS        = 60_000;     // 每分鐘清一次舊 key
const ENTRY_TTL_MS      = 5 * 60_000; // 5 分鐘沒動就刪

let _lastCleanup = Date.now();

function cleanup(now) {
  if (now - _lastCleanup < CLEANUP_MS) return;
  _lastCleanup = now;
  for (const [key, entry] of buckets) {
    const last = entry.timestamps[entry.timestamps.length - 1] || 0;
    if (now - Math.max(last, entry.bannedUntil) > ENTRY_TTL_MS) {
      buckets.delete(key);
    }
  }
}

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export async function applyRateLimit(req, res, opts = {}) {
  const name     = String(opts.name || 'ip');
  const max      = positiveInt(opts.max, DEFAULT_MAX_REQ);
  const windowMs = positiveInt(opts.windowMs, DEFAULT_WINDOW_MS);
  const banMs    = positiveInt(opts.banMs, DEFAULT_BAN_MS);
  const rawKey   = opts.key === undefined || opts.key === null || opts.key === ''
    ? clientIp(req)
    : String(opts.key);
  const key = name + '|' + rawKey;

  const now = Date.now();
  cleanup(now);

  let entry = buckets.get(key);
  if (!entry) {
    entry = { timestamps: [], bannedUntil: 0 };
    buckets.set(key, entry);
  }

  if (entry.bannedUntil > now) {
    const retry = Math.ceil((entry.bannedUntil - now) / 1000);
    res.setHeader('Retry-After', String(retry));
    res.status(429).json({
      success: false,
      error: `Too many requests. Banned for ${retry} seconds.`,
      message: `Too many requests. Banned for ${retry} seconds.`,
      retryAfter: retry,
    });
    return false;
  }

  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= max) {
    entry.bannedUntil = now + banMs;
    entry.timestamps = [];
    const retry = Math.ceil(banMs / 1000);
    res.setHeader('Retry-After', String(retry));
    res.status(429).json({
      success: false,
      error: `Too many requests. Banned for ${retry} seconds.`,
      message: `Too many requests. Banned for ${retry} seconds.`,
      retryAfter: retry,
    });
    return false;
  }

  entry.timestamps.push(now);
  return true;
}

/** 测试/诊断用：当前正在跟踪的桶数量 */
export function bucketCount() {
  return buckets.size;
}
