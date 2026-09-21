// lib/auth.js
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';

let client = null;
let db = null;

async function getDB() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'wyk_math';
  client = new MongoClient(uri, { maxPoolSize: 5 });
  await client.connect();
  db = client.db(dbName);
  return db;
}

const userCache = new Map(); // username -> { user, expireAt }
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

  // 1. 驗證 JWT 簽章
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
  if (!decoded || !decoded.username) return null;

  // 2. 查緩存（5 秒 TTL）
  const now = Date.now();
  const cached = userCache.get(decoded.username);
  if (cached && cached.expireAt > now) {
    if (!cached.user || cached.user.banned) return null;
    return buildUser(cached.user);
  }

  // 3. 查 DB
  try {
    const database = await getDB();
    const user = await database.collection('users').findOne(
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
    // ⭐ DB 掛掉 → 降級到 token payload（避免全站掛）
    console.error('[auth] DB check failed, falling back to token:', err);
    return {
      username: decoded.username,
      role: decoded.role || 'student',
      displayName: decoded.displayName || decoded.username,
      pfp: decoded.pfp || '',
    };
  }
}