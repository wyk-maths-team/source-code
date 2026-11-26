// api/auth.js
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { toWyk } from '../lib/username.js';
import { invalidateUserCache } from '../lib/auth.js';
import { wrapHandler } from '../lib/errors.js';

/**
 * 從微軟回傳的 displayName 抽出真名。
 * 例：'2627-5Y16 Li Ching Shun' → 'Li Ching Shun'
 * 若無「數字開頭的學號前綴」，就把整串當真名。
 */
function extractRealName(msDisplayName) {
  if (!msDisplayName || typeof msDisplayName !== 'string') return '';
  const trimmed = msDisplayName.trim();
  if (!trimmed) return '';

  // 開頭是「數字開頭的 token（學號格式） + 空白 + 真名」
  const match = trimmed.match(/^\d[\w-]*\s+(.+)$/);
  if (match) return match[1].trim();

  // 沒有偵測到學號前綴，整串視為真名
  return trimmed;
}

// ⭐ Cookie 工具
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);

  const cookieStr = parts.join('; ');

  // ⭐ 累积已有 Set-Cookie，而不是覆盖
  const existing = res.getHeader('Set-Cookie');
  if (!existing) {
    res.setHeader('Set-Cookie', cookieStr);
  } else if (Array.isArray(existing)) {
    res.setHeader('Set-Cookie', [...existing, cookieStr]);
  } else {
    res.setHeader('Set-Cookie', [existing, cookieStr]);
  }
}

function getCookie(req, name) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  if (!match) return null;
  // decodeURIComponent 遇到孤立的 '%' 会直接抛异常，把整个回调打成 500。
  // cookie 只用来存 hex 的 state，解不开就按原样返回，让上层去比较。
  try {
    return decodeURIComponent(match[1]);
  } catch (e) {
    return match[1];
  }
}

/**
 * 把 jwt.verify 的失败翻译成「用户照着做就能过」的一句话。
 *
 * 两个坑叠在一起才会出现「Microsoft 登录后提示 invalid token」：
 *   1. jsonwebtoken 的 JsonWebTokenError.message 恰好就是 "invalid token"；
 *   2. 前端 auth.js 一看到 401 里含这句话就 logout()。
 * 所以这里既不回传原文，也不把四种完全不同的失败混成一句。
 */
function rejectToken(err, token, kind) {
  const raw = String(token || '');
  const len = raw.length;
  const hasSpace = raw.indexOf(' ') >= 0;
  const looksCut = len < 60 || hasSpace;
  const name = (err && err.name) || 'unknown';

  // 只记足以定位、又不泄漏凭据的信息
  console.warn('[auth] ' + kind + ' token rejected:', name, 'len=' + len, 'space=' + hasSpace);

  const what = kind === 'reset' ? 'reset link' : 'setup link';

  if (name === 'TokenExpiredError') {
    return {
      success: false,
      code: 'TOKEN_EXPIRED',
      message: 'That ' + what + ' has expired (links last 15 minutes). Start again from the sign-in page.',
    };
  }
  if (name === 'WrongTokenKindError') {
    return {
      success: false,
      code: 'TOKEN_WRONG_KIND',
      message: 'That link belongs to a different step. Start again from the sign-in page.',
    };
  }
  if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
    return {
      success: false,
      code: 'TOKEN_MALFORMED',
      message: looksCut
        ? 'That ' + what + ' is incomplete — open it from the sign-in page instead of pasting it.'
        : 'That ' + what + ' was not issued by this site. Start again from the sign-in page.',
    };
  }
  return {
    success: false,
    code: 'TOKEN_REJECTED',
    message: 'That link could not be used. Start again from the sign-in page.',
  };
}

function getBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'moj.wyk.edu.hk';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

async function handler(req, res) {
  // ⭐ 兼容性兜底：如果 URL 是纯斜杠形式 /api/auth/callback
  let action = req.query.action || (req.body && req.body.action);
  if (!action && req.url.includes('/api/auth/callback')) {
    action = 'callback';
  }

  // ===== 1. 發起微軟登入 =====
  if (action === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const tenant = process.env.MICROSOFT_TENANT || 'common';
    const baseUrl = getBaseUrl(req);
    
    // ⭐ 强制纯斜杠，不给微软报错的机会
    const redirectUri = `${baseUrl}/api/auth/callback`;
    const mode = req.query.mode === 'reset' ? 'reset' : 'login';

    const state = (await import('crypto')).randomBytes(16).toString('hex');
    setCookie(res, 'oauth_state', state, {
      path: '/', maxAge: 600, httpOnly: true, secure: true, sameSite: 'Lax',
    });
    setCookie(res, 'oauth_mode', mode, {
      path: '/', maxAge: 600, httpOnly: true, secure: true, sameSite: 'Lax',
    });

    const authUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?` +
      `client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_mode=query&scope=openid%20profile%20email%20User.Read&state=${state}` +
      `&prompt=select_account`;
    res.redirect(authUrl);
    return;
  }

  // ===== 2. 處理微軟回調 =====
  if (action === 'callback') {
    const { code, state } = req.query;
    const cookieState = getCookie(req, 'oauth_state');
    const mode = getCookie(req, 'oauth_mode') || 'login';

    // ⭐ 無論成功失敗，先清掉 cookie
    setCookie(res, 'oauth_state', '', { path: '/', maxAge: 0 });
    setCookie(res, 'oauth_mode',  '', { path: '/', maxAge: 0 });

    if (!code) return res.status(400).send('Missing code');
    if (!state || !cookieState || state !== cookieState) {
      return res.status(400).send('Invalid state parameter (CSRF blocked)');
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenant = process.env.MICROSOFT_TENANT || 'common';
    const allowedDomain = process.env.ALLOWED_DOMAIN || 'cloud.wyk.edu.hk';
    
    const baseUrl = getBaseUrl(req);
    // ⭐ 必须和上面的一字不差
    const redirectUri = `${baseUrl}/api/auth/callback`;

    try {
      const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri, 
          grant_type: 'authorization_code'
        })
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('No access token');

      const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const me = await meRes.json();
      const email = me.mail || me.userPrincipalName;
      const msDisplayName = (me.displayName || '').trim();
      const realName = extractRealName(msDisplayName);

      if (!email || !email.endsWith('@' + allowedDomain)) {
        if (mode === 'reset') {
          return res.redirect(`/auth/forgot-password?error=domain`);
        }
        return res.status(403).send(`Only @${allowedDomain} emails are allowed.`);
      }

      const rawUsername = email.split('@')[0];
      const username = toWyk(rawUsername);          // s22r42 → WYK22R42
      const db = await connectToDatabase();
      const existingUser = await db.collection('users').findOne({ username });
      
      if (mode === 'reset') {
        if (!existingUser) {
          return res.redirect(`/auth/forgot-password?error=not_registered`);
        }
        const resetToken = jwt.sign(
          { username, action: 'reset' },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );
        return res.redirect(`/auth/reset-password?token=${encodeURIComponent(resetToken)}`);
      }
      
      if (!existingUser) {
        const setupToken = jwt.sign(
          {
            username: toWyk(username),
            rawUsername,
            email,
            displayName: msDisplayName || username,
            realName,
            action: 'setup'
          },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );
        return res.redirect(`/auth/setup?token=${encodeURIComponent(setupToken)}`);
      } else {
        const updateFields = {};
        if (realName && existingUser.realName !== realName) {
          updateFields.realName = realName;
        }
        if (Object.keys(updateFields).length > 0) {
          await db.collection('users').updateOne({ username }, { $set: updateFields });
        }

        const loginToken = jwt.sign({
          username: existingUser.username,
          role: existingUser.role || 'student',
          displayName: existingUser.displayName || username,
          pfp: existingUser.pfp || '',
          tv: Number(existingUser.tokenVersion) || 0,
        }, process.env.JWT_SECRET, { expiresIn: '7d' });
        return res.redirect(`/?token=${encodeURIComponent(loginToken)}`);
      }
    } catch (err) {
      console.error('Callback error:', err);
      res.status(500).send('Authentication failed');
    }
    return;
  }

  // ===== 3. 完成密碼設置（新用戶）=====
  if (action === 'complete-setup') {
    if (req.method !== 'POST') return res.status(405).end();

    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ success: false, message: 'Missing fields' });
    if (String(password).length < 4) {
      return res.status(400).json({ success: false, message: 'Password too short (min 4 characters)' });
    }
    if (String(password).length > 128) {
      return res.status(400).json({ success: false, message: 'Password too long (max 128 chars)' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.action !== 'setup') {
        // 用独立的名字，别和 jsonwebtoken 自己的 "invalid token" 混在一起：
        // 两者的处理方式完全不同（一个是链接类型不对，一个是签名/格式坏）。
        const wrong = new Error('not a setup token');
        wrong.name = 'WrongTokenKindError';
        throw wrong;
      }
      const { email, displayName, realName } = decoded;
      const username = toWyk(decoded.username);     // 老链接也能落地成新格式

      const db = await connectToDatabase();
      const existing = await db.collection('users').findOne({ username });
      if (existing) return res.status(400).json({ success: false, message: 'Username already taken' });

      const hashedPassword = await bcrypt.hash(password, 10);
      await db.collection('users').insertOne({
        username,
        email,
        password: hashedPassword,
        role: 'student',
        displayName: displayName || username,
        realName: realName || '',
        tokenVersion: 0,
        createdAt: new Date(),
        token: {
          daily: 30000,
          global: 100000,
          lastReset: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10),
          dailyLoginClaimed: false,
          dailyQuestClaimed: false,
        },
      });

      // 设完密码直接登录，不再让用户手输一次
      const loginToken = jwt.sign({
        username,
        role: 'student',
        displayName: displayName || username,
        pfp: '',
        tv: 0,
      }, process.env.JWT_SECRET, { expiresIn: '7d' });

      res.json({ success: true, username, token: loginToken });
    } catch (err) {
      // 以前这里所有失败都回同一句 "Invalid token"，而 jsonwebtoken 的
      // JsonWebTokenError.message 恰好就是 "invalid token" —— 前端 auth.js
      // 一看到这句就 logout，用户从 Microsoft 回来只落得「被登出」，
      // 完全看不出是过期、截断、还是走的不是这条链接。现在按原因分开报。
      return res.status(401).json(rejectToken(err, token, 'setup'));
    }
    return;
  }

  // ===== 4. 完成密码重设 =====
  if (action === 'complete-reset') {
    if (req.method !== 'POST') return res.status(405).end();

    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }
    if (password.length < 4) {
      return res.status(400).json({ success: false, message: 'Password too short (min 4 chars)' });
    }
    if (password.length > 128) {
      return res.status(400).json({ success: false, message: 'Password too long (max 128 chars)' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.action !== 'reset') {
        const wrong = new Error('not a reset token');
        wrong.name = 'WrongTokenKindError';
        throw wrong;
      }

      const db = await connectToDatabase();
      const user = await db.collection('users').findOne({ username: toWyk(decoded.username) });
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const hashed = await bcrypt.hash(password, 10);
      const targetUsername = toWyk(decoded.username);

      // ⭐ 改密码必须同时撤销全部已签发的会话。
      //   tokenVersion + 1 之后，旧 token 里的 tv 对不上，verifyToken 直接判无效。
      //   以前改完密码旧 token 还能用满 7 天 —— 账号被盗时重置等于没重置。
      const bumped = await db.collection('users').findOneAndUpdate(
        { username: targetUsername },
        {
          $set: { password: hashed, passwordResetAt: new Date() },
          $inc: { tokenVersion: 1 },
        },
        { returnDocument: 'after', projection: { tokenVersion: 1 } }
      );
      const bumpedDoc = bumped && (bumped.value !== undefined ? bumped.value : bumped);
      const newTv = Number(bumpedDoc && bumpedDoc.tokenVersion) || 0;
      invalidateUserCache(targetUsername);

      await auditLog(db, 'password_reset_via_microsoft', {
        username: targetUsername,
        sessionsRevoked: true,
        tokenVersion: newTv,
      }, targetUsername, 'warn').catch(() => {});

      return res.json({ success: true });
    } catch (err) {
      return res.status(401).json(rejectToken(err, token, 'reset'));
    }
  }

  res.status(400).json({ error: 'Invalid action' });
}

// 统一错误兜底
export default wrapHandler(handler);