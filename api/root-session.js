// api/root-session.js
// 用 root_persist cookie 換取新的短期 JWT；或用來登出（清除 cookie）
import jwt from 'jsonwebtoken';
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { applyRateLimit } from '../lib/rateLimit.js';

const COOKIE_NAME = 'root_persist';
const PERSIST_DAYS = 30;

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|; )${encodeURIComponent(name)}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function buildSetCookie(value, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  // 只有 production 才加 Secure（本地 http://localhost 不加）
  if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  // ═══ LOGOUT：清除 cookie ═══
  if (req.query.action === 'logout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    res.setHeader('Set-Cookie', buildSetCookie('', 0));
    return res.status(200).json({ success: true });
  }

  // ═══ 換取新 token ═══
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cookieVal = getCookie(req, COOKIE_NAME);
  if (!cookieVal) {
    return res.status(401).json({ success: false, reason: 'no_cookie' });
  }

  let payload;
  try {
    payload = jwt.verify(cookieVal, process.env.JWT_SECRET);
  } catch {
    // 過期 / 簽名錯 → 順手清掉 cookie
    res.setHeader('Set-Cookie', buildSetCookie('', 0));
    return res.status(401).json({ success: false, reason: 'invalid_cookie' });
  }

  if (payload.type !== 'root_persist' || payload.role !== 'root') {
    res.setHeader('Set-Cookie', buildSetCookie('', 0));
    return res.status(401).json({ success: false, reason: 'wrong_token_type' });
  }

  // 簽發新的短期 JWT（與 root-login 一致）
  const token = jwt.sign(
    { username: 'root', role: 'root', displayName: 'Root' },
    process.env.JWT_SECRET,
    { expiresIn: '365d' }
  );

  // 每次自動恢復都 roll cookie，滑動續期
  res.setHeader('Set-Cookie', buildSetCookie(cookieVal, PERSIST_DAYS * 24 * 60 * 60));

  // 記錄（不發 Discord，避免每次打開頁面都吵）
  connectToDatabase()
    .then(db => auditLog(db, 'root_session_restore', {
      ua: String(req.headers['user-agent'] || '').slice(0, 120),
    }, 'root', null))
    .catch(() => {});

  return res.status(200).json({ success: true, token });
}