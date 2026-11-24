// api/login.js
//
// 用户名 + 密码登录。
//
// 这个端点的 500 全部来自「本可以判定、却抛了出来」的情况，逐个堵掉：
//   1. req.body 没被解析（缺 Content-Type / 坏 JSON）→ 读 body.username 抛 TypeError
//   2. 账号没有 password 字段（Microsoft OAuth 建的账号）→ bcrypt.compare 抛
//      "data and salt arguments required"
//   3. password 是老数据里的明文 / 非 bcrypt 串 → bcrypt.compare 抛
//      "Invalid salt version"
//   4. JWT_SECRET 没配 → jwt.sign 抛
//   5. 数据库冷启动 / 池繁忙 → 抛 DB_BUSY，这本来该是 503 可重试
//
// 以上都不该表现为 500：前四个是客户端或数据问题（400/401/503-CONFIG），
// 最后一个是背压（503 + Retry-After）。

import { connectToDatabase } from './_db.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { isRetryableDBError } from '../lib/mongo.js';

// ⭐ 登录尝试计数（IP 维度）：5 分钟内最多 20 次
const rateLimitMap = new Map();   // IP → { count, firstAttempt }
const MAX_ATTEMPTS = 20;
const WINDOW_MS = 5 * 60 * 1000;
const ENTRY_TTL_MS = 30 * 60 * 1000;   // 30 分鐘沒動就刪
const CLEANUP_INTERVAL_MS = 60_000;
let _lastCleanup = 0;

// 与注册/改密时的限制保持一致（auth.js: 4–128 字），这里只做上界防护
const USERNAME_MAX_LEN = 64;
const PASSWORD_MAX_LEN = 256;

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

/** 请求体可能压根没解析成功（缺 Content-Type、坏 JSON、空 body）—— 一律当空对象 */
function readBody(req) {
  const b = req && req.body;
  return (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
}

/** 用户不存在 / 没设密码 / 密码不匹配，对外统一成一句话（别泄漏账号是否存在） */
function invalidCredentials(res) {
  return res.status(401).json({ success: false, message: 'Invalid username or password' });
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // ── IP 维度：5 分钟 20 次 ──
  const ip = getClientIP(req);
  const now = Date.now();
  cleanupRateMap(now);
  const record = rateLimitMap.get(ip);
  if (record) {
    if (now - record.firstAttempt > WINDOW_MS) {
      rateLimitMap.set(ip, { count: 1, firstAttempt: now });
    } else if (record.count >= MAX_ATTEMPTS) {
      res.setHeader('Retry-After', String(Math.ceil((record.firstAttempt + WINDOW_MS - now) / 1000)));
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

  // ── 入参 ──（这一整段以前会抛 TypeError）
  const body = readBody(req);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return sendError(req, res, 'BAD_REQUEST', 'Missing fields');
  }
  if (username.length > USERNAME_MAX_LEN || password.length > PASSWORD_MAX_LEN) {
    return sendError(req, res, 'BAD_REQUEST', 'Invalid credentials');
  }

  // ── 用户名维度：每个账号 1 分钟 20 次 ──
  // 单个 IP 20 次/5 分钟的桶挡不住「很多 IP 打同一个账号」，这一层补上。
  // 按用户名分桶，同一间教室的真实学生各算各的，不会互相影响。
  //
  // 取 20 而不是 5：这个桶是粗闸门，不是精确的失败计数。定得太小，
  // 攻击者用你的用户名打 5 次就能把你锁在门外一分钟（账号锁死 DoS）。
  if (!(await applyRateLimit(req, res, {
    name: 'login-user',
    key: 'u:' + username,
    max: 20,
    windowMs: 60_000,
    banMs: 60_000,
  }))) return;

  // ── 部署配置 ──
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    console.error('[login] JWT_SECRET is not configured');
    return sendError(req, res, 'CONFIG', 'Login is temporarily unavailable');
  }

  try {
    const db = await connectToDatabase();
    const user = await db.collection('users').findOne({ username });

    if (!user) return invalidCredentials(res);

    const stored = user.password;
    if (typeof stored !== 'string' || !stored) {
      // Microsoft OAuth 建的账号没有本地密码；对外仍是「用户名或密码不对」
      console.error('[login] account has no password hash:', username);
      return invalidCredentials(res);
    }

    let match = false;
    try {
      match = await bcrypt.compare(password, stored);
    } catch (err) {
      // 数据问题（明文口令、旧哈希格式、截断的 hash）——不是用户输错了密码，
      // 但也不该让登录接口 500。记日志，按不匹配处理。
      console.error('[login] bcrypt compare failed:', username, err && err.message);
      return invalidCredentials(res);
    }
    if (!match) return invalidCredentials(res);

    const token = jwt.sign({
      username: user.username,
      role: user.role || 'student',
      displayName: user.displayName || user.username,
      pfp: user.pfp || '',
      tv: Number(user.tokenVersion) || 0,   // ⭐ 会话版本：改密码后旧 token 立即失效
    }, JWT_SECRET, { expiresIn: '7d' });

    // 封禁的人也能登进来 —— 但只有 index 能用，别的页面会被前端踢回去。
    // 这样他们能看到封禁原因和期限，而不是在登录页吃一个没有上下文的报错。
    const timedBanActive = user.bannedUntil && new Date(user.bannedUntil) > new Date();
    const isBanned = !!user.banned || !!timedBanActive;

    res.status(200).json({
      success: true,
      token,
      banned: isBanned,
      banType: isBanned ? (user.banned ? 'manually' : 'automatically') : null,
      banReason: isBanned ? (user.banReason || '') : '',
      bannedUntil: isBanned ? (user.bannedUntil || null) : null,
      user: {
        username: user.username,
        displayName: user.displayName || user.username,
        role: user.role || 'student',
        pfp: user.pfp || ''
      }
    });
  } catch (err) {
    // 冷启动 / 池繁忙 / 维护窗口：都是「过一会儿再来」，不是 500
    if (err && (err.code === 'DB_BUSY' || isRetryableDBError(err))) {
      res.setHeader('Retry-After', '2');
      return sendError(req, res, 'BUSY', 'Database is unavailable, please retry in a moment', err);
    }
    if (String((err && err.message) || '').includes('SERVICE_UNAVAILABLE')) {
      res.setHeader('Retry-After', '5');
      return sendError(req, res, 'BUSY', 'System is under maintenance', err);
    }
    // 缺 MONGODB_URI / 连接串写错这类部署问题：不是「服务器内部错误」，
    // 而是「这台实例根本没配好」，code 标成 CONFIG 才能在日志里一眼分出来。
    if (/not defined|missing|not configured/i.test(String((err && err.message) || ''))) {
      console.error('[login] database is not configured:', err && err.message);
      return sendError(req, res, 'CONFIG', 'Login is temporarily unavailable', err);
    }
    console.error('Login error:', err);
    return sendError(req, res, 'INTERNAL', 'Internal server error', err);
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);
