// lib/auth.js
import jwt from 'jsonwebtoken';
import { connectToDatabase } from '../api/_db.js';   // ⭐ 复用同一个连接

const userCache = new Map();
const USER_CACHE_TTL = 5000;

function buildUser(user) {
  return {
    username: user.username,
    role: user.role || 'student',
    displayName: user.displayName || user.username,
    pfp: user.pfp || '',
  };
}

export async function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded || !decoded.username) return null;

  const now = Date.now();
  const cached = userCache.get(decoded.username);
  if (cached && cached.expireAt > now) {
    if (!cached.user || cached.user.banned) return null;
    return buildUser(cached.user);
  }

  try {
    const db = await connectToDatabase();          // ⭐ 用共享连接
    const user = await db.collection('users').findOne(
      { username: decoded.username },
      { projection: { username: 1, role: 1, banned: 1, displayName: 1, pfp: 1 } }
    );

    userCache.set(decoded.username, {
      user,
      expireAt: now + USER_CACHE_TTL,
    });

    if (!user || user.banned) return null;
    return buildUser(user);
  } catch (err) {
    console.error('[auth] DB check failed, falling back to token:', err);
    return {
      username: decoded.username,
      role: decoded.role || 'student',
      displayName: decoded.displayName || decoded.username,
      pfp: decoded.pfp || '',
    };
  }
}