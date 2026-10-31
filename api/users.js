// api/users.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import bcrypt from 'bcrypt';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';   // ⭐ 唯一来源，不再本地重复定义
import { calculateUserRating, getTier } from '../lib/rating.js';
import { wrapHandler } from '../lib/errors.js';
// ⭐ 排行榜內存緩存（30 秒）
let _leaderboardCache = { data: null, expireAt: 0 };
const _tokenBoardCache = new Map();   // 财富榜缓存：key -> { data, expireAt }
const LEADERBOARD_TTL = 10_000;
// ⭐ Charts 內存緩存（24 小時）
let _chartCache = { data: null, expireAt: 0 };
const CHART_CACHE_TTL = 24 * 60 * 60_000;

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const { action } = req.query;
  let decoded = null;
    decoded = await verifyToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const guestRegex = /^G\d{3}$/;
  // ========== 管理端 ==========
  if (typeof action === 'string' && action.startsWith('admin')) {
    const isAdminUser = decoded && (decoded.role === 'admin' || decoded.role === 'root');
    if (!isAdminUser) return res.status(403).json({ success: false, message: 'Admin only' });

    // ----- GET：列表 / 單筆 -----
    if (action === 'adminList') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const { username } = req.query;
      if (username) {
        const user = await db.collection('users').findOne({ username });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const { password, ...safeUser } = user;
        return res.status(200).json({ success: true, user: safeUser });
      }
      const users = await db.collection('users').find({}).project({ password: 0 }).toArray();
      return res.status(200).json({ success: true, users });
    }

    // ----- POST：新增 -----
    if (action === 'adminCreate') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { username, password, displayName, realName, role } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required' });
      }
      const existing = await db.collection('users').findOne({ username });
      if (existing) return res.status(400).json({ success: false, message: 'Username already exists' });

      let finalRole;
      if (decoded.role === 'root') {
        finalRole = (role === 'admin') ? 'admin' : 'student';
      } else {
        finalRole = 'student';
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = {
        username,
        password: hashedPassword,
        displayName: displayName || username,
        realName: realName || '',
        role: finalRole,
        banned: false,
        createdAt: new Date(),
        // 新账号的初始余额：daily 30,000（每日重置）+ global 100,000（永久）
        token: {
          daily: 30000,
          global: 100000,
          lastReset: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10),
          dailyLoginClaimed: false,
          dailyQuestClaimed: false,
        },
      };
      await db.collection('users').insertOne(newUser);
      await db.collection('userstats').updateOne(
        { username },
        { $setOnInsert: { username, states: {} } },
        { upsert: true }
      );

      await auditLog(db, 'user_create', {
        username,
        displayName: newUser.displayName,
        role: finalRole,
      }, decoded.username, 'info');

      return res.status(201).json({ success: true, message: 'User created' });
    }

    // ----- PUT：更新 -----
    if (action === 'adminUpdate') {
      if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const targetUser = await db.collection('users').findOne({ username });
      if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });
      if (targetUser.role === 'root') {
        return res.status(400).json({ success: false, message: 'Cannot modify root user' });
      }
      if (decoded.role === 'admin' && targetUser.role !== 'student') {
        return res.status(400).json({ success: false, message: 'Admin can only edit students' });
      }

      const updateFields = {};
      if (req.body.realName !== undefined) {
        updateFields.realName = String(req.body.realName).trim().slice(0, 60);
      }
      if (req.body.displayName !== undefined) {
        updateFields.displayName = req.body.displayName;
      }
      if (req.body.newUsername !== undefined && req.body.newUsername !== username) {
        const existingNew = await db.collection('users').findOne({ username: req.body.newUsername });
        if (existingNew) return res.status(400).json({ success: false, message: 'New username already exists' });
        updateFields.username = req.body.newUsername;
      }
      if (req.body.password !== undefined && req.body.password.trim() !== '') {
        updateFields.password = await bcrypt.hash(req.body.password, 10);
      }
      if (req.body.role !== undefined) {
        if (decoded.role === 'root') {
          if (req.body.role === 'root') {
            return res.status(400).json({ success: false, message: 'Cannot promote to root' });
          }
          updateFields.role = req.body.role;
        } else {
          return res.status(400).json({ success: false, message: 'Admins cannot change user roles' });
        }
      }
      if (req.body.banned !== undefined) {
        if (decoded.role === 'root') {
          updateFields.banned = !!req.body.banned;
        } else if (decoded.role === 'admin' && targetUser.role === 'student') {
          updateFields.banned = !!req.body.banned;
        } else {
          return res.status(400).json({ success: false, message: 'Admin can only ban students' });
        }
      }

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      if (updateFields.username && updateFields.username !== username) {
        await db.collection('users').updateOne({ username }, { $set: updateFields });
        await db.collection('submissions').updateMany({ username }, { $set: { username: updateFields.username } });
        await db.collection('userstats').updateOne({ username }, { $set: { username: updateFields.username } });
      } else {
        await db.collection('users').updateOne({ username }, { $set: updateFields });
      }

      // ⭐ 依「改了什麼」決定通知級別
      const changedKeys = Object.keys(updateFields);
      let level = 'warn';
      const dangerFlags = [];

      if (updateFields.role !== undefined && updateFields.role !== targetUser.role) {
        dangerFlags.push(`role: ${targetUser.role} → ${updateFields.role}`);
        level = 'danger';
      }
      if (updateFields.banned !== undefined && updateFields.banned !== targetUser.banned) {
        dangerFlags.push(updateFields.banned ? 'banned' : 'unbanned');
        level = 'danger';
      }
      if (updateFields.password) {
        dangerFlags.push('password reset');
      }
      if (updateFields.username) {
        dangerFlags.push(`username: ${username} → ${updateFields.username}`);
      }

      const details = {
        username,
        fields: changedKeys,
        notes: dangerFlags,
        before: {
          displayName: targetUser.displayName,
          realName: targetUser.realName,
          role: targetUser.role,
          banned: targetUser.banned,
        },
        after: {
          displayName: updateFields.displayName ?? targetUser.displayName,
          realName: updateFields.realName ?? targetUser.realName,
          role: updateFields.role ?? targetUser.role,
          banned: updateFields.banned ?? targetUser.banned,
        },
      };

      await auditLog(db, 'user_update', details, decoded.username, level);

      return res.status(200).json({ success: true, message: 'User updated' });
    }

    // ----- DELETE：刪除（先備份到 GitHub backup repo）-----
    if (action === 'adminDelete') {
      if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
      const { username } = req.query;
      const force = req.query.force === '1' || req.body?.force === true;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const user = await db.collection('users').findOne({ username });
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (user.role === 'root') {
        return res.status(403).json({ success: false, message: 'Cannot delete root user' });
      }
      if (decoded.role === 'admin' && user.role !== 'student') {
        return res.status(403).json({ success: false, message: 'Admin can only delete students' });
      }

      // ⭐ 1. 收集要備份的全部資料
      const [userstatsDoc, submissions] = await Promise.all([
        db.collection('userstats').findOne({ username }),
        db.collection('submissions').find({ username }).toArray(),
      ]);

      const backupPayload = {
        _meta: {
          backupAt: new Date().toISOString(),
          backupBy: decoded.username,
          backupByRole: decoded.role,
          targetUsername: username,
          reason: 'user_delete',
          schemaVersion: 1,
          counts: {
            submissions: submissions.length,
            hasUserstats: !!userstatsDoc,
          },
        },
        user,
        userstats: userstatsDoc || null,
        submissions,
      };

      // ⭐ 2. 上傳到 GitHub backup repo
      const ts = (() => {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
      })();
      const safeUser = String(username).replace(/[^A-Za-z0-9._-]/g, '_');
      const backupPath = `users/${safeUser}-${ts}.json`;

      let backupResult = null;
      let backupError = null;
      try {
        const { uploadJsonFile } = await import('../lib/github-upload.js');
        backupResult = await uploadJsonFile(backupPath, backupPayload, {
          message: `backup: user delete — ${username} (by ${decoded.username})`,
          overwrite: false,
        });
        console.log(`[user_delete] backup ok: ${backupResult.githubUrl}`);
      } catch (e) {
        backupError = e.message;
        console.error('[user_delete] backup failed:', e);
      }

      // ⭐ 3. 備份失敗 → 除非 force，否則拒絕刪除
      if (backupError && !force) {
        await auditLog(db, 'user_delete_backup_failed', {
          username,
          error: backupError,
        }, decoded.username, 'danger');

        return res.status(500).json({
          success: false,
          message: 'Backup failed, delete aborted. Retry or use ?force=1 to skip backup.',
          error: backupError,
        });
      }

      // ⭐ 4. 執行刪除
      await db.collection('users').deleteOne({ username });
      await db.collection('submissions').deleteMany({ username });
      await db.collection('userstats').deleteOne({ username });

      // ⭐ 5. 統一走 auditLog（會自動寫 DB + 發 webhook）
      await auditLog(db, 'user_delete', {
        username,
        displayName: user.displayName,
        realName: user.realName,
        role: user.role,
        submissionsDeleted: submissions.length,
        backup: backupResult
          ? {
              path: backupResult.path,
              url: backupResult.githubUrl,
              size: backupResult.size,
              sha: backupResult.sha,
            }
          : null,
        backupFailed: backupError || undefined,
        forcedWithoutBackup: !!(backupError && force),
      }, decoded.username, 'danger');

      return res.status(200).json({
        success: true,
        message: 'User deleted',
        backup: backupResult
          ? { url: backupResult.githubUrl, size: backupResult.size }
          : null,
        submissionsDeleted: submissions.length,
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid admin action' });
  }

  // ═══════════════ 以下為非 admin action ═══════════════
  try {
    // ---------- 用户状态 ----------
    if (action === 'stats') {
      const stats = await db.collection('userstats').findOne({ username: decoded.username });
      return res.status(200).json({ success: true, states: stats?.states || {} });
    }

    if (action === 'preload') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const [stats, userdata] = await Promise.all([
        db.collection('userstats').findOne({ username: decoded.username }),
        db.collection('userdata').findOne({ username: decoded.username })
      ]);
      return res.status(200).json({
        success: true,
        states: stats?.states || {},
        favorites: userdata?.favorites || []
      });
    }

    if (action === 'pfp') {
      // ── GET：拿單個或批量頭像 ──
      if (req.method === 'GET') {
        const batchParam = req.query.usernames;
        if (batchParam) {
          const list = String(batchParam)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 100);

          if (list.length === 0) {
            res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
            return res.status(200).json({ success: true, pfps: {} });
          }

          const docs = await db.collection('users')
            .find(
              { username: { $in: list } },
              { projection: { username: 1, pfp: 1, _id: 0 } }
            )
            .toArray();

          const map = {};
          for (const u of docs) map[u.username] = u.pfp || '';

          res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
          return res.status(200).json({ success: true, pfps: map });
        }

        const { username } = req.query;
        if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

        const user = await db.collection('users')
          .findOne({ username }, { projection: { pfp: 1, _id: 0 } });

        if (!user || !user.pfp) {
          res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
          return res.status(200).json({ success: true, pfp: '' });
        }

        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).json({ success: true, pfp: user.pfp });
      }

      // ── POST：上傳自己的頭像 ──
      if (req.method === 'POST') {
        const { image } = req.body;
        if(guestRegex.test(decoded.username))return res.status(403).json({error:'Guest account cannot change profile picture'});
        if (!image) return res.status(400).json({ success: false, message: 'Missing image data' });

        const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        if (buffer.length > 2 * 1024 * 1024) {
          return res.status(400).json({ success: false, message: 'Image too large (max 2MB)' });
        }

        try {
          const { uploadTimestampedImage } = await import('../lib/github-upload.js');
          const imageUrl = await uploadTimestampedImage(image, {
            folder: 'images/pfp',
            baseName: decoded.username,
          });
          await db.collection('users').updateOne(
            { username: decoded.username },
            { $set: { pfp: imageUrl, pfpUpdatedAt: new Date() } }
          );

          await auditLog(db, 'pfp_upload', {
            username: decoded.username,
            url: imageUrl,
            size: buffer.length,
          }, decoded.username, 'info');

          return res.status(200).json({ success: true, pfp: imageUrl });
        } catch (err) {
          console.error('PFP upload error:', err);
          return res.status(500).json({ success: false, message: 'Image upload failed: ' + err.message });
        }
      }

      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ---------- 解題進度圖（所有人可見）----------
    if (action === 'charts') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      res.setHeader('Cache-Control', 'private, max-age=60');

      if (_chartCache.data && _chartCache.expireAt > Date.now()) {
        return res.status(200).json({ success: true, data: _chartCache.data, cached: true });
      }

      try {
        const pipeline = [
          { $match: { correct: true, systemError: false } },
          {
            $group: {
              _id: { username: '$username', problemId: '$problemId' },
              firstCorrect: { $min: '$timestamp' }
            }
          },
          {
            $addFields: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$firstCorrect' } }
            }
          },
          {
            $group: {
              _id: { username: '$_id.username', date: '$date' },
              count: { $sum: 1 }
            }
          },
          { $sort: { '_id.date': 1 } }
        ];

        const dailyData = await db.collection('submissions').aggregate(pipeline).toArray();

        const dateSet = new Set();
        dailyData.forEach(d => dateSet.add(d._id.date));
        const datesArray = Array.from(dateSet).sort();

        if (datesArray.length === 0) {
          return res.status(200).json({ success: true, data: { dates: [], users: [] } });
        }

        const startDate = new Date(datesArray[0] + 'T00:00:00Z');
        const endDate = new Date();
        const allDates = [];
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
          allDates.push(d.toISOString().split('T')[0]);
        }

        const userMap = {};
        dailyData.forEach(d => {
          const username = d._id.username;
          const date = d._id.date;
          if (!userMap[username]) userMap[username] = {};
          userMap[username][date] = d.count;
        });

        const usernames = Object.keys(userMap);

        const userDocs = await db.collection('users')
          .find(
            { username: { $in: usernames } },
            { projection: { username: 1, realName: 1, displayName: 1 } }
          )
          .toArray();
        const nameMap = Object.fromEntries(
          userDocs.map(u => [u.username, { realName: u.realName || '', displayName: u.displayName || '' }])
        );

        const users = usernames.map(username => {
          const dailyMap = userMap[username];
          let cumulative = 0;
          const daily = allDates.map(date => {
            cumulative += (dailyMap[date] || 0);
            return cumulative;
          });
          const meta = nameMap[username] || {};
          return {
            username,
            realName: meta.realName || '',
            displayName: meta.displayName || '',
            daily
          };
        });

        users.sort((a, b) => a.username.localeCompare(b.username));

        const payload = { dates: allDates, users };
        _chartCache = { data: payload, expireAt: Date.now() + CHART_CACHE_TTL };
        return res.status(200).json({ success: true, data: payload });
      } catch (err) {
        console.error('Charts API error:', err);
        return res.status(500).json({ success: false, message: err.message });
      }
    }

    if (action === 'leaderboard') {
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
      const period = String(req.query.period || 'overall').toLowerCase();
const VALID_PERIODS = new Set(['daily', 'weekly', 'monthly']);
const isPeriodMode = VALID_PERIODS.has(period);

// ─────────── 财富榜（tokens）───────────
// overall：直接按当前 daily + global 排
// daily/weekly/monthly：用 tokenHistory 的每日快照算增量
if (String(req.query.sort || '').toLowerCase() === 'tokens') {
  const TTL = 30_000;
  const key = 'tokens:' + (isPeriodMode ? period : 'overall');
  const hit = _tokenBoardCache.get(key);
  if (hit && hit.expireAt > Date.now()) {
    return res.status(200).json(hit.data);
  }

  const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
  const TIMEOUT_MS = Number(process.env.ONLINE_TIMEOUT_MS) || HEARTBEAT_MS * 2;
  const serverNow = Date.now();

  const users = await db.collection('users').find(
    {},
    {
      projection: {
        username: 1, displayName: 1, realName: 1, pfp: 1, role: 1, banned: 1,
        lastSeenAt: 1, explicitlyOffline: 1, token: 1,
      },
    }
  ).toArray();

  const base = users
    .filter((u) => u.banned !== true && u.role !== 'team' && !/^\d+$/.test(u.username))
    .map((u) => {
      const daily = Number(u.token?.daily) || 0;
      const global = Number(u.token?.global) || 0;
      const lastSeenMs = u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : 0;
      return {
        username: u.username,
        displayName: u.displayName || u.username,
        realName: u.realName || '',
        pfp: u.pfp || '',
        daily,
        global,
        total: daily + global,
        online: !u.explicitlyOffline && lastSeenMs > 0 && (serverNow - lastSeenMs) < TIMEOUT_MS,
        lastSeenAt: u.lastSeenAt || null,
        explicitlyOffline: !!u.explicitlyOffline,
      };
    });

  let rows;

  if (!isPeriodMode) {
    rows = base
      .sort((a, b) => (b.total - a.total) || a.username.localeCompare(b.username))
      .map((u, i) => ({ ...u, tokens: u.total, rank: i + 1, change: null }));
  } else {
    // 周期榜 = 当前值 − 期初快照
    const daysBack = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
    const startDate = new Date(Date.now() + 8 * 3600_000 - daysBack * 86400_000)
      .toISOString().slice(0, 10);

    const snaps = await db.collection('tokenHistory')
      .find({ date: startDate }, { projection: { username: 1, total: 1 } })
      .toArray();
    const snapMap = new Map(snaps.map((s) => [s.username, Number(s.total) || 0]));

    rows = base
      .map((u) => {
        const start = snapMap.get(u.username);
        return { ...u, tokens: start === undefined ? 0 : u.total - start, startTotal: start };
      })
      .filter((u) => u.tokens !== 0)
      .sort((a, b) => (b.tokens - a.tokens) || a.username.localeCompare(b.username))
      .map((u, i) => ({ ...u, rank: i + 1, change: null }));
  }

  const payload = {
    success: true,
    sort: 'tokens',
    period: isPeriodMode ? period : 'overall',
    leaderboard: rows,
    serverNow,
    heartbeatMs: HEARTBEAT_MS,
    timeoutMs: TIMEOUT_MS,
  };
  _tokenBoardCache.set(key, { data: payload, expireAt: Date.now() + TTL });
  return res.status(200).json(payload);
}

// ─────────── 周期 Rating 榜（按提升幅度）───────────
// overall 用当前 rating；daily/weekly/monthly 用 ratingHistory 的期初快照算涨幅，
// 颜色取「涨完之后」的 rating 对应的段位色。
if (isPeriodMode && String(req.query.sort || '').toLowerCase() === 'rating') {
  const daysBack = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;
  const startDate = new Date(Date.now() + 8 * 3600_000 - daysBack * 86400_000)
    .toISOString().slice(0, 10);

  const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
  const TIMEOUT_MS = Number(process.env.ONLINE_TIMEOUT_MS) || HEARTBEAT_MS * 2;
  const serverNow = Date.now();

  const [snaps, stats, users] = await Promise.all([
    db.collection('ratingHistory')
      .find({ date: startDate }, { projection: { username: 1, rating: 1 } })
      .toArray(),
    db.collection('userstats')
      .find({ rating: { $ne: null } }, { projection: { username: 1, rating: 1 } })
      .toArray(),
    db.collection('users').find({}, {
      projection: {
        username: 1, displayName: 1, realName: 1, pfp: 1, role: 1, banned: 1,
        lastSeenAt: 1, explicitlyOffline: 1,
      },
    }).toArray(),
  ]);

  const snapMap = new Map(snaps.map((s) => [s.username, Number(s.rating)]));
  const userMap = new Map(users.map((u) => [u.username, u]));

  const rows = [];
  for (const st of stats) {
    const u = userMap.get(st.username);
    if (!u || u.banned === true || u.role === 'team' || /^\d+$/.test(st.username)) continue;

    const current = Number(st.rating);
    const start = snapMap.get(st.username);
    if (!Number.isFinite(current) || start === undefined) continue;

    const gain = Math.round(current - start);
    if (gain === 0) continue;

    const tier = getTier(current);
    const lastSeenMs = u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : 0;

    rows.push({
      username: st.username,
      displayName: u.displayName || st.username,
      realName: u.realName || '',
      pfp: u.pfp || '',
      rating: current,          // 涨完之后的 rating
      gain,                     // 这段时间涨了多少
      tierColor: tier.color,
      tierGlow: tier.glow,
      online: !u.explicitlyOffline && lastSeenMs > 0 && (serverNow - lastSeenMs) < TIMEOUT_MS,
      lastSeenAt: u.lastSeenAt || null,
      explicitlyOffline: !!u.explicitlyOffline,
    });
  }

  rows.sort((a, b) => (b.gain - a.gain) || a.username.localeCompare(b.username));

  return res.status(200).json({
    success: true,
    sort: 'rating',
    period,
    leaderboard: rows.map((u, i) => ({ ...u, rank: i + 1 })),
    serverNow,
    heartbeatMs: HEARTBEAT_MS,
    timeoutMs: TIMEOUT_MS,
  });
}


// ─────────── 缓存 key 也要按 period 区分 ───────────
// 现有 _leaderboardCache 是单槽，用 Map 更稳：
//   _leaderboardCache = new Map();  // key: period → { data, expireAt }

// ─────────── 周期榜分支 ───────────
if (isPeriodMode) {
  const nowMs = Date.now();
  const windowMs = period === 'daily'   ? 24 * 3600_000
                 : period === 'weekly'  ? 7 * 24 * 3600_000
                 :                        30 * 24 * 3600_000;
  const since = new Date(nowMs - windowMs);

  // 1) 聚合：窗口内每个用户 AC 的不同题目
  const AC_FILTER = {
    $or: [
      { type: 'image', marked: true, score: 100 },
      { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
    ],
  };

  const rows = await db.collection('submissions').aggregate([
    { $match: { timestamp: { $gte: since }, ...AC_FILTER } },
    { $group: { _id: { u: '$username', p: '$problemId' } } },
    { $group: { _id: '$_id.u', solves: { $sum: 1 } } },
    { $sort: { solves: -1, _id: 1 } },
  ]).toArray();

  if (rows.length === 0) {
    const empty = {
      success: true,
      leaderboard: [],
      period,
      serverNow: nowMs,
      heartbeatMs: Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000,
      timeoutMs: (Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000) * 2,
    };
    return res.status(200).json(empty);
  }

  const usernames = rows.map(r => r._id);

  // 2) 拉用户资料（保持和 overall 同样的字段）
  const users = await db.collection('users')
    .find(
      { username: { $in: usernames } },
      { projection: { username: 1, pfp: 1, displayName: 1, realName: 1,
                      banned: 1, role: 1, lastSeenAt: 1, explicitlyOffline: 1 } }
    )
    .toArray();
  const userMap = Object.fromEntries(users.map(u => [u.username, u]));

  const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
  const TIMEOUT_MS   = Number(process.env.ONLINE_TIMEOUT_MS)   || HEARTBEAT_MS * 2;
  const serverNow    = Date.now();

  const leaderboard = rows
    .filter(r => {
      const u = userMap[r._id];
      if (u && u.banned === true) return false;
      if (u && u.role === 'team')  return false;
      return true;
    })
    .map((r, idx) => {
      const u = userMap[r._id] || {};
      const lastSeenMs = u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : 0;
      const online = !u.explicitlyOffline && lastSeenMs > 0 &&
                     (serverNow - lastSeenMs) < TIMEOUT_MS;
      return {
        rank: idx + 1,
        username: r._id,
        displayName: u.displayName || r._id,
        solves: r.solves,
        pfp: u.pfp || '',
        realName: u.realName || '',
        online,
        lastSeenAt: u.lastSeenAt || null,
        explicitlyOffline: !!u.explicitlyOffline,
        // 周期榜不带 rating 字段（前端会跳过 ratingBadge）
      };
    });

  return res.status(200).json({
    success: true,
    leaderboard,
    period,
    serverNow,
    heartbeatMs: HEARTBEAT_MS,
    timeoutMs: TIMEOUT_MS,
  });
}
      const now = Date.now();
      if (_leaderboardCache.data && _leaderboardCache.expireAt > now) {
        return res.status(200).json(_leaderboardCache.data);
      }
      // ─────────── 判定期望周期 ───────────


// ─────────── 以下保持原本 overall 逻辑不变 ───────────
// （原代码里 "const leaderboardData = await db.collection('leaderboardView')..."）
      const leaderboardData = await db.collection('leaderboardView').find({}).toArray();
      const usernames = leaderboardData.map(e => e.username);

      // ⭐ 多取 lastSeenAt
      const users = await db.collection('users')
        .find(
          { username: { $in: usernames } },
          { projection: { username: 1, pfp: 1, displayName: 1, realName: 1, banned: 1, role: 1, lastSeenAt: 1, explicitlyOffline: 1 } }
        )
        .toArray();

      const userMap = Object.fromEntries(users.map(u => [u.username, u]));

      // ⭐ 在线判定阈值
      const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
      const TIMEOUT_MS   = Number(process.env.ONLINE_TIMEOUT_MS)   || HEARTBEAT_MS * 2;
      const serverNow    = Date.now();

      const leaderboard = leaderboardData
        .filter(entry => {
          const u = userMap[entry.username];
          if (u && u.banned === true) return false;
          if (u && u.role === 'team') return false;
          return true;
        })
        .map((entry, idx) => {
          const u = userMap[entry.username] || {};
          const lastSeenMs = u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : 0;
          const online = !u.explicitlyOffline && lastSeenMs > 0 && (serverNow - lastSeenMs) < TIMEOUT_MS;
          return {
            rank: idx + 1,
            username: entry.username,
            displayName: entry.displayName || u.displayName || entry.username,
            solves: entry.solves,
            pfp: u.pfp || '',
            realName: u.realName || '',
            online,
            lastSeenAt: u.lastSeenAt || null,
            explicitlyOffline: !!u.explicitlyOffline,   // ⭐ 新增
          };
        });
              // ⭐ 計算 Rating（三步算法 + σ 調節）
      const statsDocs = await db.collection('userstats')
        .find({ username: { $in: leaderboard.map(u => u.username) } })
        .toArray();

      const allPids = new Set();
      statsDocs.forEach(s => Object.keys(s.states || {}).forEach(pid => allPids.add(pid)));

      const problemDocs = allPids.size > 0
        ? await db.collection('problems')
            .find({ id: { $in: [...allPids] } }, { projection: { id: 1, difficulty: 1, _id: 0 } })
            .toArray()
        : [];
      const diffMap = Object.fromEntries(problemDocs.map(p => [String(p.id), Number(p.difficulty) || 0]));

      const statsMap = Object.fromEntries(statsDocs.map(s => [s.username, s]));

      // ⭐ Rating：优先用 userstats 上的物化值。
      //    以前是 U 个用户各跑一遍 sort + 加权（O(U·n log n)）；
      //    现在 solvedCount 没变就直接读缓存，只有真正变化的少数用户才重算。
      const RATING_MAX_AGE_MS = 7 * 24 * 3600_000;

      for (const u of leaderboard) {
        const doc = statsMap[u.username];
        const states = doc?.states || {};

        // 只在难度表里存在的已解题才算（题目被删掉的不计入）
        const solvedDiffs = [];
        for (const [pid, st] of Object.entries(states)) {
          if (st === 'passed' && diffMap[pid] !== undefined) {
            solvedDiffs.push(diffMap[pid]);
          }
        }
        const solvedCount = solvedDiffs.length;

        const cached = doc?.rating;
        const cachedCount = doc?.ratingSolvedCount;
        const updatedAt = doc?.ratingUpdatedAt ? new Date(doc.ratingUpdatedAt).getTime() : 0;
        const cacheFresh = updatedAt > 0 && (Date.now() - updatedAt) < RATING_MAX_AGE_MS;

        if (cached != null && cachedCount === solvedCount && cacheFresh && doc?.ratingMeta) {
          const tier = getTier(cached);
          u.rating = cached;
          u.tierColor = tier.color;
          u.tierGlow = tier.glow;
          u.maxDifficulty = doc.ratingMeta.effectiveMax;
          continue;
        }

        const r = calculateUserRating({ solvedDifficulties: solvedDiffs });
        u.rating = r.rating;
        u.tierColor = r.tier.color;
        u.tierGlow = r.tier.glow;
        u.maxDifficulty = r.effectiveMax;   // ← 原来是 r.maxPR，字段名不存在，永远是 undefined
      }
      const payload = { success: true, leaderboard, serverNow, heartbeatMs: HEARTBEAT_MS, timeoutMs: TIMEOUT_MS };
      _leaderboardCache = { data: payload, expireAt: Date.now() + LEADERBOARD_TTL };
      return res.status(200).json(payload);
    }

    if (action === 'profile') {
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const isAdminUser = decoded.role === 'admin' || decoded.role === 'root';

      // 题库元数据走 60s 缓存（lib/problemCache.js），不再每个请求拉 2400 行。
      // 同时把「遍历全部题目」改成「遍历用户做过的题目」，两者都省一个数量级。
      const { getPublicProblems, getAllProblems } = await import('../lib/problemCache.js');
      const problemData = isAdminUser ? await getAllProblems(db) : await getPublicProblems(db);

      const [userStats, user, userdata] = await Promise.all([
        db.collection('userstats').findOne({ username }, { projection: { states: 1, _id: 0 } }),
        db.collection('users').findOne(
          { username },
          { projection: { pfp: 1, displayName: 1, realName: 1, heartbeatCount: 1, lastSeenAt: 1, _id: 0 } }
        ),
        db.collection('userdata').findOne({ username }, { projection: { theme: 1, _id: 0 } }) // ⭐ 新增
      ]);

      const states = userStats?.states || {};
      const attempted = [];
      let totalPassed = 0;

      // 只遍历用户做过的题，不再扫全库
      for (const pid of Object.keys(states)) {
        if (!problemData.idSet.has(pid)) continue;           // 非 public 的题不计入（非管理员视角）
        const state = states[pid];
        if (state === 'passed') {
          totalPassed++;
          attempted.push({ id: pid, state: 'passed' });
        } else if (state === 'failed') {
          attempted.push({ id: pid, state: 'failed' });
        }
      }

      // ⭐ Rating 走物化缓存，不再这里重算 O(n log n)
      const { getUserRating } = await import('../lib/userRating.js');
      const ratingResult = await getUserRating(db, username);

      const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
      const TIMEOUT_MS   = Number(process.env.ONLINE_TIMEOUT_MS)   || HEARTBEAT_MS + 2 * 60 * 1000;
      const heartbeats   = Number(user?.heartbeatCount) || 0;
      const totalOnlineMs = heartbeats * HEARTBEAT_MS;
      const lastSeenMs   = user?.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0;
      const online       = lastSeenMs > 0 && (Date.now() - lastSeenMs) < TIMEOUT_MS;

      return res.status(200).json({
        success: true,
        username,
        displayName: user?.displayName || username,
        realName: user?.realName || '',
        pfp: user?.pfp || '',
        totalPassed,
        totalProblems: problemData.list.length,
        attempted,
        allProblemIds: problemData.ids,
        online,
        totalOnlineMs,
        lastSeenAt: user?.lastSeenAt || null,
        // ⭐ Rating
        rating: ratingResult.rating,
        tierColor: ratingResult.tier.color,
        tierGlow: ratingResult.tier.glow,
        maxDifficulty: ratingResult.effectiveMax,
        solvedCount: ratingResult.solvedCount,
        theme: userdata?.theme || 'default'
      });
    }

    // ========== 收藏/取消收藏 ==========
    if (action === 'favorite') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { problemId } = req.body;
      if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });

      const userdata = await db.collection('userdata').findOne({ username: decoded.username });
      let favorites = userdata?.favorites || [];
      if (favorites.includes(problemId)) {
        favorites = favorites.filter(id => id !== problemId);
      } else {
        favorites.push(problemId);
      }
      await db.collection('userdata').updateOne(
        { username: decoded.username },
        { $set: { favorites } },
        { upsert: true }
      );
      return res.status(200).json({ success: true, favorites });
    }

    // ========== 获取收藏列表 ==========
    if (action === 'favorites') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const userdata = await db.collection('userdata').findOne({ username: decoded.username });
      const favorites = userdata?.favorites || [];
      return res.status(200).json({ success: true, favorites });
    }
    if (action === 'changename') {
      if(guestRegex.test(decoded.username))return res.status(403).json({error:'Guest account cannot change name'});
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { newname } = req.body || {};

      // ⭐ 用 name-filter 檢查
      const { checkDisplayName } = await import('../lib/name-filter.js');
      const check = checkDisplayName(newname);
      if (!check.ok) {
        return res.status(400).json({ success: false, message: check.reason });
      }

      const trimmed = newname.trim();

      // ⭐ 檢查是否已被別人使用
      const existing = await db.collection('users').findOne({
        displayName: trimmed,
        username: { $ne: decoded.username },
      });
      if (existing) {
        return res.status(400).json({ success: false, message: 'This name is used' });
      }

      // ⭐ 檢查改名頻率（防刷）
      const user = await db.collection('users').findOne(
        { username: decoded.username },
        { projection: { lastRenameAt: 1, renameCount: 1 } }
      );

      const now = Date.now();
      const lastRename = user?.lastRenameAt ? new Date(user.lastRenameAt).getTime() : 0;
      const RENAME_COOLDOWN = 1 * 60_000;   // 1 min

      if (lastRename && now - lastRename < RENAME_COOLDOWN) {
        const remainMs = RENAME_COOLDOWN - (now - lastRename);
        const remainHr = Math.ceil(remainMs / 60_000);
        return res.status(429).json({
          success: false,
          message: `Too frequent, wait ${remainHr} mins`,
        });
      }

      try {
        await db.collection('users').updateOne(
          { username: decoded.username },
          {
            $set: {
              displayName: trimmed,
              lastRenameAt: new Date(),
            },
            $inc: { renameCount: 1 },
          }
        );
        return res.status(200).json({
          success: true,
          message: 'Display name updated successfully',
          displayName: trimmed,
        });
      } catch (err) {
        console.error('Update display name error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }
    }

    if (action === 'changepassword') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      if(guestRegex.test(decoded.username))return res.status(403).json({error:'Guest account cannot change password'});
      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Missing fields' });
      }
      if (newPassword.length < 4) {
        return res.status(400).json({ success: false, message: 'New password too short (min 4 characters)' });
      }
      if (newPassword.length > 128) {
        return res.status(400).json({ success: false, message: 'Password too long (max 128 chars)' });
      }

      const user = await db.collection('users').findOne(
        { username: decoded.username },
        { projection: { password: 1 } }
      );
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      if (!user.password) {
        return res.status(400).json({ success: false, message: 'This account does not have a password set. Please use SSO or contact admin.' });
      }

      const match = await bcrypt.compare(oldPassword, user.password);
      if (!match) return res.status(400).json({ success: false, message: 'Old password is incorrect' });

      const hashed = await bcrypt.hash(newPassword, 10);
      await db.collection('users').updateOne(
        { username: decoded.username },
        { $set: { password: hashed } }
      );
      return res.status(200).json({ success: true, message: 'Password updated successfully' });
    }
    // ========== 成就相关 ==========

    // GET：拉当前用户的成就
    if (action === 'achievements') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const targetUsername = req.query.username || decoded.username;

      const [user, logs] = await Promise.all([
        db.collection('users').findOne(
          { username: targetUsername },
          { projection: { achievements: 1, streakDays: 1, maxStreak: 1, activeDaysTotal: 1 } }
        ),
        db.collection('achievements_log')
          .find({ username: targetUsername }, { projection: { achievementId: 1, unlockedAt: 1, reward: 1, _id: 0 } })
          .sort({ unlockedAt: 1 })
          .toArray(),
      ]);

      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const unlockedMap = Object.fromEntries(
        logs.map(l => [l.achievementId, l.unlockedAt])
      );

      // 进度 + 定义表：前端不再自己维护一份成就元数据
      let definitions = null, progress = null, rewardsEarned = 0;
      try {
        const { getProgress } = await import('../lib/achievements.js');
        const p = await getProgress(db, targetUsername);
        if (p) {
          definitions = p.definitions;
          progress = p.progress;
          rewardsEarned = p.rewardsEarned;
        }
      } catch (e) {
        console.error('[achievements progress]', e);
      }

      return res.status(200).json({
        success: true,
        username: targetUsername,
        achievements: user.achievements || [],
        unlockedAt: unlockedMap,
        definitions,
        progress,
        rewardsEarned,
        streak: {
          current: user.streakDays || 0,
          max: user.maxStreak || 0,
          activeDays: user.activeDaysTotal || 0,
        },
      });
    }

    // GET：全站成就统计（每个成就多少用户解锁）
    if (action === 'achievementsStats') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

      const stats = await db.collection('users').aggregate([
        { $match: { banned: { $ne: true } } },
        { $unwind: { path: '$achievements', preserveNullAndEmptyArrays: false } },
        { $group: { _id: '$achievements', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray();

      const totalUsers = await db.collection('users').countDocuments({ banned: { $ne: true } });
      const map = Object.fromEntries(stats.map(s => [s._id, s.count]));

      return res.status(200).json({
        success: true,
        totalUsers,
        counts: map,
      });
    }

    // markAdminVisit / markAchievement 已移除：
    // 前者解锁的 curious 已删除，后者白名单里的 voyeur 从未在 ACHIEVEMENTS 里定义过，
    // 上报只会静默失败。客户端不再有任何「自己给自己发成就」的通道。

    return res.status(400).json({ success: false, message: 'Invalid action' });
  } catch (err) {
    console.error('Users API error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);