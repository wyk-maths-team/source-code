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

/**
 * 会话版本。老文档没有这个字段，一律按 0 处理。
 * token 里没带 tv 的（本次上线前签发的）也按 0，所以上线不会踢人。
 */
function tvOf(doc) {
  const n = Number(doc && doc.tokenVersion);
  return Number.isFinite(n) ? n : 0;
}

export function tvFromDoc(doc) {
  return tvOf(doc);
}

/** 让某个用户的内存缓存立即失效 */
export function invalidateUserCache(username) {
  if (username) userCache.delete(username);
  else userCache.clear();
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

  const tokenTv = tvOf(decoded);

  const now = Date.now();
  const cached = userCache.get(decoded.username);
  if (cached && cached.expireAt > now) {
    if (!cached.user || cached.user.banned) return null;
    if (tvOf(cached.user) !== tokenTv) return null;      // ⭐ 会话已被撤销
    return buildUser(cached.user);
  }

  try {
    const db = await connectToDatabase();          // ⭐ 用共享连接
    const user = await db.collection('users').findOne(
      { username: decoded.username },
      { projection: { username: 1, role: 1, banned: 1, displayName: 1, pfp: 1, tokenVersion: 1 } }
    );

    userCache.set(decoded.username, {
      user,
      expireAt: now + USER_CACHE_TTL,
    });

    if (!user || user.banned) return null;
    if (tvOf(user) !== tokenTv) return null;             // ⭐ 会话已被撤销
    return buildUser(user);
  } catch (err) {
    console.error('[auth] DB check failed, falling back to token:', err);
    return null;
  }
}

/**
 * 撤销某用户的全部会话：tokenVersion 加一。
 * 之后签发的 token 带新的 tv，旧 token 在 verifyToken 里一律被判无效。
 *
 * 注意：多实例部署下其他实例的内存缓存最多滞后 USER_CACHE_TTL（5 秒），
 * 因为缓存里也存了 tokenVersion 并参与比对，不会无限期放行。
 *
 * @returns {Promise<number>} 新的 tokenVersion
 */
export async function revokeSessions(db, username) {
  const res = await db.collection('users').findOneAndUpdate(
    { username },
    { $inc: { tokenVersion: 1 } },
    { returnDocument: 'after', projection: { tokenVersion: 1 } }
  );
  invalidateUserCache(username);
  // mongodb v4 返回 { value }，v6 直接返回文档
  const doc = res && (res.value !== undefined ? res.value : res);
  return tvOf(doc);
}
