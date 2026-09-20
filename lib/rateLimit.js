// lib/rateLimit.js
const rateLimitMap = new Map();

export async function applyRateLimit(req, res) {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown';

  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry) {
    entry = { timestamps: [], bannedUntil: 0 };
    rateLimitMap.set(ip, entry);
  }

  if (entry.bannedUntil > now) {
    res.status(429).json({ error: 'Too many requests. Banned for 60 seconds.' });
    return false;
  }

  const oneSecondAgo = now - 1000;
  entry.timestamps = entry.timestamps.filter(t => t > oneSecondAgo);

  if (entry.timestamps.length >= 10) {
    entry.bannedUntil = now + 60000;
    entry.timestamps = [];
    rateLimitMap.set(ip, entry);
    res.status(429).json({ error: 'Too many requests. Banned for 60 seconds.' });
    return false;
  }

  entry.timestamps.push(now);
  rateLimitMap.set(ip, entry);
  return true;
}