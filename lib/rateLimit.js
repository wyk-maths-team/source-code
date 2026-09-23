// lib/rateLimit.js
const rateLimitMap = new Map();

const WINDOW_MS    = 1000;      // 1 秒
const MAX_REQ      = 30;        // 每秒 30 個（放寬）
const BAN_MS       = 30_000;    // 封 30 秒（縮短）
const CLEANUP_MS   = 60_000;    // 每分鐘清一次舊 IP
const ENTRY_TTL_MS = 5 * 60_000;// 5 分鐘沒動就刪

let _lastCleanup = Date.now();

function cleanup(now) {
  if (now - _lastCleanup < CLEANUP_MS) return;
  _lastCleanup = now;
  for (const [ip, entry] of rateLimitMap) {
    const last = entry.timestamps[entry.timestamps.length - 1] || 0;
    if (now - Math.max(last, entry.bannedUntil) > ENTRY_TTL_MS) {
      rateLimitMap.delete(ip);
    }
  }
}

export async function applyRateLimit(req, res) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const now = Date.now();
  cleanup(now);

  let entry = rateLimitMap.get(ip);
  if (!entry) {
    entry = { timestamps: [], bannedUntil: 0 };
    rateLimitMap.set(ip, entry);
  }

  if (entry.bannedUntil > now) {
    const retry = Math.ceil((entry.bannedUntil - now) / 1000);
    res.setHeader('Retry-After', String(retry));
    res.status(429).json({ error: `Too many requests. Banned for ${retry} seconds.` });
    return false;
  }

  const cutoff = now - WINDOW_MS;
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  if (entry.timestamps.length >= MAX_REQ) {
    entry.bannedUntil = now + BAN_MS;
    entry.timestamps = [];
    rateLimitMap.set(ip, entry);
    res.setHeader('Retry-After', String(Math.ceil(BAN_MS / 1000)));
    res.status(429).json({ error: `Too many requests. Banned for ${Math.ceil(BAN_MS / 1000)} seconds.` });
    return false;
  }

  entry.timestamps.push(now);
  rateLimitMap.set(ip, entry);
  return true;
}