// api/login.js
import { connectToDatabase } from './db.js';
// import { auditLog } from '../lib/audit.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { applyRateLimit } from '../lib/rateLimit.js';
const rateLimitMap = new Map(); // IP → { count, firstAttempt }
const MAX_ATTEMPTS = 20;
const WINDOW_MS = 5 * 60 * 1000; // 5 分钟

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         'unknown';
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIP(req);
  const now = Date.now();

  // 速率限制检查
  const record = rateLimitMap.get(ip);
  if (record) {
    if (now - record.firstAttempt > WINDOW_MS) {
      rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    } else if (record.count >= MAX_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: 'Too many login attempts. Please try again later.'
      });
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
    const db = await connectToDatabase();
    const user = await db.collection('users').findOne({ username });

    if (!user || user.banned) {
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
      pfp: user.pfp || ''   // 新增
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