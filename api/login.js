// api/login.js
// 用户数据在 PostgreSQL（lib/userStore.js）。
import { getUserForAuth } from '../lib/userStore.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

const rateLimitMap = new Map();
const MAX_ATTEMPTS = 20;
const WINDOW_MS = 5 * 60 * 1000;
const ENTRY_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;
let _lastCleanup = 0;

function cleanupRateMap(now) {
  if (now - _lastCleanup < CLEANUP_INTERVAL_MS) return;
  _lastCleanup = now;
  for (const [ip, rec] of rateLimitMap) {
    if (now - rec.firstAttempt > ENTRY_TTL_MS) {
      rateLimitMap.delete(ip);
    }
  }
}

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         'unknown';
}
async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIP(req);
  const now = Date.now();
  cleanupRateMap(now);
  
  // 速率限制检查 (保持不变)
  const record = rateLimitMap.get(ip);
  if (record) {
    if (now - record.firstAttempt > WINDOW_MS) {
      rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    } else if (record.count >= MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many login attempts.' });
    } else {
      record.count++;
    }
  } else {
    rateLimitMap.set(ip, { count: 1, firstAttempt: now });
  }

  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }

  try {
    const user = await getUserForAuth(username);

    if (!user || user.banned) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    if (!user.password) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const token = jwt.sign({
      username: user.username,
      role: user.role || 'student',
      displayName: user.displayName || user.username,
      pfp: user.pfp || ''
    }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.status(200).json({
      success: true,
      token,
      user: {
        username: user.username,
        displayName: user.displayName || user.username,
        role: user.role || 'student',
        pfp: user.pfp || ''
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default wrapHandler(handler);