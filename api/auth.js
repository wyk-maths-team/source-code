// api/auth.js
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
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
  return match ? decodeURIComponent(match[1]) : null;
}
function getBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'moj.wyk.edu.hk';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
async function handler(req, res) {
  const action = req.query.action || (req.body && req.body.action);

  // ===== 1. 發起微軟登入 =====
  if (action === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    
    const tenant = process.env.MICROSOFT_TENANT || 'common';
    const baseUrl = getBaseUrl(req);//dynamic change
    const redirectUri = `${baseUrl}/api/auth/callback`;
    // ⭐ 新增：区分登录 / 重置模式
    const mode = req.query.mode === 'reset' ? 'reset' : 'login';

    const state = (await import('crypto')).randomBytes(16).toString('hex');
    setCookie(res, 'oauth_state', state, {
      path: '/', maxAge: 600, httpOnly: true, secure: true, sameSite: 'Lax',
    });
    // ⭐ 新增：记住这次 OAuth 是哪种用途
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
    const mode = getCookie(req, 'oauth_mode') || 'login';   // ⭐

    // ⭐ 無論成功失敗，先清掉 cookie
    setCookie(res, 'oauth_state', '', { path: '/', maxAge: 0 });
    setCookie(res, 'oauth_mode',  '', { path: '/', maxAge: 0 });   // ⭐

    if (!code) return res.status(400).send('Missing code');
    if (!state || !cookieState || state !== cookieState) {
      return res.status(400).send('Invalid state parameter (CSRF blocked)');
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    
    const tenant = process.env.MICROSOFT_TENANT || 'common';
    const allowedDomain = process.env.ALLOWED_DOMAIN || 'cloud.wyk.edu.hk';
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/api/auth/callback`;//sim actions
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
      // ⭐ 從微軟的 displayName 抽出真名（如 'Li Ching Shun'）
      const realName = extractRealName(msDisplayName);

      if (!email || !email.endsWith('@' + allowedDomain)) {
        if (mode === 'reset') {
          return res.redirect(`/auth/forgot-password?error=domain`);
        }
        return res.status(403).send(`Only @${allowedDomain} emails are allowed.`);
      }

      const username = email.split('@')[0];
      const db = await connectToDatabase();
      const existingUser = await db.collection('users').findOne({ username });
      // ⭐ Reset 模式：走专用分支，不登录
      if (mode === 'reset') {
        if (!existingUser) {
          return res.redirect(`/auth/forgot-password?error=not_registered`);
        }
        const resetToken = jwt.sign(
          { username, action: 'reset' },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );
        return res.redirect(`/auth/reset-password?token=${resetToken}`);
      }
      if (!existingUser) {
        // 新用戶：帶上 displayName 與 realName 到 setup 頁面
        const setupToken = jwt.sign(
          {
            username,
            email,
            displayName: msDisplayName || username,
            realName,
            action: 'setup'
          },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );
        return res.redirect(`/auth/setup?token=${setupToken}`);
      } else {
        // 老用戶：同步 displayName 與 realName（微軟是權威來源）
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
          pfp: existingUser.pfp || ''
        }, process.env.JWT_SECRET, { expiresIn: '7d' });
        return res.redirect(`/?token=${loginToken}`);
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

    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ success: false, message: 'Missing fields' });

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.action !== 'setup') throw new Error('Invalid token');
      const { username, email, displayName, realName } = decoded;

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
        realName: realName || '',      // ⭐ 存入真名
        createdAt: new Date(),
        // 新账号的初始余额：daily 30,000（每日重置）+ global 100,000（永久）
        token: {
          daily: 30000,
          global: 100000,
          lastReset: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10),
          dailyLoginClaimed: false,
          dailyQuestClaimed: false,
        },
      });

      res.json({ success: true });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Setup link expired' });
      }
      res.status(401).json({ success: false, message: 'Invalid token' });
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
    if (decoded.action !== 'reset') throw new Error('Invalid token');

    const db = await connectToDatabase();
    const user = await db.collection('users').findOne({ username: decoded.username });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const hashed = await bcrypt.hash(password, 10);
    await db.collection('users').updateOne(
      { username: decoded.username },
      { $set: { password: hashed, passwordResetAt: new Date() } }
    );

    // 审计（用 warn 级，Discord 会通知）
    await auditLog(db, 'password_reset_via_microsoft', {
      username: decoded.username,
    }, decoded.username, 'warn').catch(() => {});

    return res.json({ success: true });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Reset link expired. Try again.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

  res.status(400).json({ error: 'Invalid action' });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);