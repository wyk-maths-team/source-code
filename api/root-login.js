// api/root-login.js
// 專用 root 登入 —— 使用預共享密鑰，避開 Microsoft OAuth
import jwt from 'jsonwebtoken';
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { timingSafeEqual, createHash } from 'crypto';

// 暴力破解保護（in-memory，per-instance）
const _attempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function checkRate(ip) {
  const now = Date.now();
  const rec = _attempts.get(ip);
  if (!rec || now - rec.first > WINDOW_MS) {
    _attempts.set(ip, { count: 1, first: now });
    return true;
  }
  if (rec.count >= MAX_ATTEMPTS) return false;
  rec.count++;
  return true;
}

// 常數時間比較，防止 timing attack
function safeEqual(a, b) {
  const ah = createHash('sha256').update(String(a)).digest();
  const bh = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ah, bh);
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = (req.headers['x-forwarded-for']?.split(',')[0]?.trim())
          || req.socket?.remoteAddress
          || 'unknown';

  if (!checkRate(ip)) {
    return res.status(429).json({ success: false, message: 'Too many attempts. Try again later.' });
  }

  const { secret } = req.body || {};
  if (!secret || typeof secret !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing secret' });
  }

  const allowed = String(process.env.ROOT_LOGIN_SECRETS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (allowed.length === 0) {
    return res.status(500).json({
      success: false,
      message: 'Root login not configured on server (ROOT_LOGIN_SECRETS missing)',
    });
  }

  const db = await connectToDatabase();
  const matched = allowed.some(a => safeEqual(a, secret));

  if (!matched) {
    await auditLog(db, 'root_login_failed', {
      ip,
      ua: String(req.headers['user-agent'] || '').slice(0, 120),
    }, 'unknown', 'danger').catch(() => {});

    return res.status(401).json({ success: false, message: 'Invalid secret' });
  }

  // 簽發 365 天長效 token
  const token = jwt.sign(
    { username: 'root', role: 'root', displayName: 'Root' },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );
  const persistToken = jwt.sign(
    { username: 'root', role: 'root', type: 'root_persist' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  const cookieParts = [
    `root_persist=${encodeURIComponent(persistToken)}`,
    'Path=/',
    `Max-Age=${30 * 24 * 60 * 60}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProd) cookieParts.push('Secure');
  res.setHeader('Set-Cookie', cookieParts.join('; '));

  await auditLog(db, 'root_login', {
    ip,
    ua: String(req.headers['user-agent'] || '').slice(0, 120),
  }, 'root', 'warn').catch(() => {});

  return res.status(200).json({ success: true, token });
}