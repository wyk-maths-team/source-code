// api/users.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import bcrypt from 'bcrypt';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';   // ⭐ 唯一来源，不再本地重复定义
import { calculateUserRating } from '../lib/rating.js';
import { wrapHandler } from '../lib/errors.js';
// ⭐ 排行榜內存緩存（30 秒）
let _leaderboardCache = { data: null, expireAt: 0 };
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
        createdAt: new Date()
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

      for (const u of leaderboard) {
        const states = statsMap[u.username]?.states || {};
        const solvedDiffs = [];
        for (const [pid, st] of Object.entries(states)) {
          if (st === 'passed' && diffMap[pid] !== undefined) {
            solvedDiffs.push(diffMap[pid]);
          }
        }
        const r = calculateUserRating({ solvedDifficulties: solvedDiffs });
        u.rating = r.rating;
        u.tierColor = r.tier.color;
        u.tierGlow = r.tier.glow;
        u.maxDifficulty = r.maxPR;
      }
      const payload = { success: true, leaderboard, serverNow, heartbeatMs: HEARTBEAT_MS, timeoutMs: TIMEOUT_MS };
      _leaderboardCache = { data: payload, expireAt: Date.now() + LEADERBOARD_TTL };
      return res.status(200).json(payload);
    }

    if (action === 'profile') {
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const isAdminUser = decoded.role === 'admin' || decoded.role === 'root';
      const problemFilter = isAdminUser ? {} : { public: true };

      const [problems, userStats, user, userdata] = await Promise.all([
        db.collection('problems').find(problemFilter, { projection: { id: 1, difficulty: 1, _id: 0 } }).toArray(),
        db.collection('userstats').findOne({ username }, { projection: { states: 1, _id: 0 } }),
        db.collection('users').findOne(
          { username },
          { projection: { pfp: 1, displayName: 1, realName: 1, heartbeatCount: 1, lastSeenAt: 1, _id: 0 } }
        ),
        db.collection('userdata').findOne({ username }, { projection: { theme: 1, _id: 0 } }) // ⭐ 新增
      ]);

      problems.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

      const states = userStats?.states || {};
      const attempted = [];
      let totalPassed = 0;
      const solvedDifficulties = [];                          // ⭐ 收集已通過的題目難度

      for (const p of problems) {
        const state = states[p.id];
        if (state === 'passed') {
          totalPassed++;
          attempted.push({ id: p.id, state: 'passed' });
          solvedDifficulties.push(Number(p.difficulty) || 0);  // ⭐
        }
        else if (state === 'failed') {
          attempted.push({ id: p.id, state: 'failed' });
        }
      }

      // ⭐ 計算 rating
      const ratingResult = calculateUserRating({ solvedDifficulties });

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
        totalProblems: problems.length,
        attempted,
        allProblemIds: problems.map(p => p.id),
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
          .find({ username: targetUsername }, { projection: { achievementId: 1, unlockedAt: 1, _id: 0 } })
          .sort({ unlockedAt: 1 })
          .toArray(),
      ]);

      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const unlockedMap = Object.fromEntries(
        logs.map(l => [l.achievementId, l.unlockedAt])
      );

      return res.status(200).json({
        success: true,
        username: targetUsername,
        achievements: user.achievements || [],
        unlockedAt: unlockedMap,
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

    // POST：标记访问过 admin 页面（unlock "curious"）
    if (action === 'markAdminVisit') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { unlockAchievement } = await import('../lib/achievements.js');
      const r = await unlockAchievement(db, decoded.username, 'curious');
      return res.status(200).json({ success: true, unlocked: r.ok });
    }
    // POST: 客户端上报的成就（白名单）
    if (action === 'markAchievement') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { id } = req.body || {};

      // ⭐ 只允许客户端触发的成就
      const CLIENT_TRIGGERABLE = new Set(['voyeur', 'curious']);
      if (!CLIENT_TRIGGERABLE.has(id)) {
        return res.status(400).json({ success: false, message: 'Achievement not client-triggerable' });
      }

      const { unlockAchievement } = await import('../lib/achievements.js');
      const r = await unlockAchievement(db, decoded.username, id);
      return res.status(200).json({
        success: true,
        unlocked: r.ok,
        alreadyHave: r.alreadyHave || false,
      });
    }

    return res.status(400).json({ success: false, message: 'Invalid action' });
  } catch (err) {
    console.error('Users API error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);