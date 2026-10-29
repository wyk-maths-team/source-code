// api/users.js
import { sqlDb } from '../lib/docStore.js';
import { verifyToken } from '../lib/auth.js';
import bcrypt from 'bcrypt';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';   // ⭐ 唯一来源，不再本地重复定义
import { calculateUserRating, getTier } from '../lib/rating.js';
import { wrapHandler } from '../lib/errors.js';
import * as P from '../lib/pgStore.js';
import { todayHK } from '../lib/time.js';
import * as U from '../lib/userStore.js';
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

  const db = sqlDb();

  // ========== 管理端 ==========
  if (typeof action === 'string' && action.startsWith('admin')) {
    const isAdminUser = decoded && (decoded.role === 'admin' || decoded.role === 'root');
    if (!isAdminUser) return res.status(403).json({ success: false, message: 'Admin only' });

    // ----- GET：列表 / 單筆 -----
    if (action === 'adminList') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const { username } = req.query;
      if (username) {
        const user = await U.getUser(username);          // 不含 password
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        return res.status(200).json({ success: true, user });
      }
      const users = await U.listUsersForAdmin();
      return res.status(200).json({ success: true, users });
    }

    // ----- POST：新增 -----
    if (action === 'adminCreate') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { username, password, displayName, realName, role } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required' });
      }
      if (await U.usernameExists(username)) {
        return res.status(400).json({ success: false, message: 'Username already exists' });
      }

      let finalRole;
      if (decoded.role === 'root') {
        finalRole = (role === 'admin') ? 'admin' : 'student';
      } else {
        finalRole = 'student';
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      // ⭐ users + user_tokens + user_stats 在同一个事务里建
      await U.createUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        realName: realName || '',
        role: finalRole,
      });

      await auditLog(db, 'user_create', {
        username,
        displayName: displayName || username,
        role: finalRole,
      }, decoded.username, 'info');

      return res.status(201).json({ success: true, message: 'User created' });
    }

    // ----- PUT：更新 -----
    if (action === 'adminUpdate') {
      if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const targetUser = await U.getUser(username);
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
        if (await U.usernameExists(req.body.newUsername)) {
          return res.status(400).json({ success: false, message: 'New username already exists' });
        }
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

      const { username: newUsername, ...fieldPatch } = updateFields;
      let effectiveUsername = username;

      if (newUsername && newUsername !== username) {
        // ⭐ 外键都带 ON UPDATE CASCADE，token/stats/状态/收藏会自动跟随
        await U.renameUser(username, newUsername);
        effectiveUsername = newUsername;
        // submissions 仍在 MongoDB，用户名是冗余存的
        await S.updateMany(
          { username }, { $set: { username: newUsername } });
      }
      if (Object.keys(fieldPatch).length > 0) {
        await U.updateUser(effectiveUsername, fieldPatch);
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

      const user = await U.getUser(username);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (user.role === 'root') {
        return res.status(403).json({ success: false, message: 'Cannot delete root user' });
      }
      if (decoded.role === 'admin' && user.role !== 'student') {
        return res.status(403).json({ success: false, message: 'Admin can only delete students' });
      }

      // ⭐ 1. 收集要備份的全部資料
      const [userstatsDoc, userStates, submissions] = await Promise.all([
        U.getUserStats(username),
        U.getStates(username),
        S.find({ username }).toArray(),
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
        userstats: userstatsDoc ? { ...userstatsDoc, states: userStates } : { states: userStates },
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
      // ⭐ 用户与其子表（token / stats / 状态 / 成就 / 收藏 / 设置）由 PostgreSQL 级联删除
      await U.deleteUser(username);
      await S.deleteMany({ username });

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
      const states = await U.getStates(decoded.username);
      return res.status(200).json({ success: true, states });
    }

    if (action === 'preload') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const [states, favorites] = await Promise.all([
        U.getStates(decoded.username),
        U.getFavorites(decoded.username),
      ]);
      return res.status(200).json({ success: true, states, favorites });
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

          const map = await U.getBatchPfps(list);

          res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
          return res.status(200).json({ success: true, pfps: map });
        }

        const { username } = req.query;
        if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

        const user = await U.getUser(username);

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
          await U.updateUser(decoded.username, { pfp: imageUrl, pfpUpdatedAt: new Date() });

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
        // 按天统计首次 AC（SQL 见 submissionStore.dailyFirstAC）
        const dailyData = await S.dailyFirstAC();

        const dateSet = new Set();
        dailyData.forEach(d => dateSet.add(d.date));
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
          const username = d.username;
          const date = d.date;
          if (!userMap[username]) userMap[username] = {};
          userMap[username][date] = d.count;
        });

        const usernames = Object.keys(userMap);

        const userDocs = await U.getUsersByNames(usernames);
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
  const days = period === 'daily' ? 1 : period === 'weekly' ? 7 : 30;

  const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
  const TIMEOUT_MS   = Number(process.env.ONLINE_TIMEOUT_MS)   || HEARTBEAT_MS * 2;
  const serverNow    = Date.now();

  // 用户与提交仍在 MongoDB。周期榜 = 窗口内 AC 的不同题目数，
  // 聚合完再与 users 合并、过滤 banned / team。
  const rows = await computePeriodLeaderboard(db, days, 200);

  if (rows.length === 0) {
    const empty = {
      success: true,
      leaderboard: [],
      period,
      serverNow: nowMs,
      heartbeatMs: HEARTBEAT_MS,
      timeoutMs: TIMEOUT_MS,
    };
    return res.status(200).json(empty);
  }

  const leaderboard = rows.map((r, idx) => {
    const lastSeenMs = r.lastSeenAt ? new Date(r.lastSeenAt).getTime() : 0;
    const online = lastSeenMs > 0 && (serverNow - lastSeenMs) < TIMEOUT_MS;
    return {
      rank: idx + 1,
      username: r.username,
      displayName: r.displayName || r.username,
      solves: r.solves,
      pfp: r.pfp || '',
      realName: r.realName || '',
      online,
      lastSeenAt: r.lastSeenAt || null,
      explicitlyOffline: false,
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

      // ⭐ 总榜直接从 PostgreSQL 聚合（user_problem_status 的 passed 就是权威 AC 记录）
      const rows = await U.getLeaderboardOverall(500);

      const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
      const TIMEOUT_MS   = Number(process.env.ONLINE_TIMEOUT_MS)   || HEARTBEAT_MS * 2;
      const serverNow    = Date.now();

      // ⭐ Rating 仍走 Mongo 的物化缓存（userstats.rating / ratingSolvedCount）。
      //    那份缓存还没迁到 PG，所以这里保留 Mongo 读取；
      //    榜单本身已经来自 PG，两边的 solvedCount 由同一套 states 派生，不会不一致。
      const usernames = rows.map(r => r.username);

      // ⭐ 已解题目难度 + rating 缓存，批量从 PostgreSQL 取（两条查询，避免 N+1）
      const [solvedDiffByUser, ratingRows] = await Promise.all([
        U.getSolvedDifficultyMapByUser(usernames),
        U.getRatingRows(usernames),
      ]);

      const RATING_MAX_AGE_MS = 7 * 24 * 3600_000;

      const leaderboard = rows.map(u => {
        const lastSeenMs = u.lastSeenAt ? new Date(u.lastSeenAt).getTime() : 0;
        const online = lastSeenMs > 0 && (serverNow - lastSeenMs) < TIMEOUT_MS;

        // 只统计题目表里仍然存在、且有难度的已解题（题目被删掉的不计入）
        const solvedDiffs = solvedDiffByUser[u.username] || [];
        const solvedCount = solvedDiffs.length;

        const cachedRow = ratingRows[u.username];
        const cached = cachedRow?.rating;
        const cachedCount = cachedRow?.solvedCount;
        const updatedAt = cachedRow?.updatedAt ? new Date(cachedRow.updatedAt).getTime() : 0;
        const cacheFresh = updatedAt > 0 && (Date.now() - updatedAt) < RATING_MAX_AGE_MS;

        let rating, tier, effectiveMax;
        if (cached != null && cachedCount === solvedCount && cacheFresh && cachedRow?.meta) {
          rating = cached;
          tier = getTier(cached);
          effectiveMax = cachedRow.meta.effectiveMax;
        } else {
          const r = calculateUserRating({ solvedDifficulties: solvedDiffs });
          rating = r.rating;
          tier = r.tier;
          effectiveMax = r.effectiveMax;
        }

        return {
          rank: u.rank,
          username: u.username,
          displayName: u.displayName,
          solves: u.solves,
          pfp: u.pfp,
          realName: u.realName,
          online,
          lastSeenAt: u.lastSeenAt || null,
          explicitlyOffline: false,
          rating,
          tierColor: tier.color,
          tierGlow: tier.glow,
          maxDifficulty: effectiveMax,
        };
      });

      const payload = { success: true, leaderboard, serverNow, heartbeatMs: HEARTBEAT_MS, timeoutMs: TIMEOUT_MS };
      _leaderboardCache = { data: payload, expireAt: Date.now() + LEADERBOARD_TTL };
      return res.status(200).json(payload);
    }

    if (action === 'profile') {
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const isAdminUser = decoded.role === 'admin' || decoded.role === 'root';

      // ⭐ 用户域全部在 PostgreSQL；publicOnly 交给 SQL 的 JOIN 处理
      const [user, attempted, statsCache, allIds, prefs] = await Promise.all([
        U.getUser(username),
        U.getStatusList(username, { publicOnly: !isAdminUser }),
        U.getUserStats(username),
        isAdminUser ? P.getAllProblemIds() : P.getPublicProblemIds(),
        U.getPreferences(username),
      ]);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const totalPassed = attempted.filter(s => s.state === 'passed').length;

      // ⭐ Rating 仍走原实现（lib/userRating.js 读的是 Mongo 的物化缓存）。
      //    等那份缓存也迁过来再换掉。
      const { getUserRating } = await import('../lib/userRating.js');
      const ratingResult = await getUserRating(db, username);

      const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
      const TIMEOUT_MS   = Number(process.env.ONLINE_TIMEOUT_MS)   || HEARTBEAT_MS + 2 * 60 * 1000;
      const heartbeats   = statsCache?.heartbeatCount || 0;
      const totalOnlineMs = heartbeats * HEARTBEAT_MS;
      const lastSeenMs   = statsCache?.lastSeenAt ? new Date(statsCache.lastSeenAt).getTime() : 0;
      const online       = lastSeenMs > 0 && (Date.now() - lastSeenMs) < TIMEOUT_MS;

      return res.status(200).json({
        success: true,
        username,
        displayName: user.displayName || username,
        realName: user.realName || '',
        pfp: user.pfp || '',
        totalPassed,
        totalProblems: allIds.length,
        attempted,
        allProblemIds: allIds,
        online,
        totalOnlineMs,
        lastSeenAt: statsCache?.lastSeenAt || null,
        // ⭐ Rating
        rating: ratingResult.rating,
        tierColor: ratingResult.tier.color,
        tierGlow: ratingResult.tier.glow,
        maxDifficulty: ratingResult.effectiveMax,
        solvedCount: ratingResult.solvedCount,
        theme: prefs?.theme || 'default'
      });
    }

    // ========== 收藏/取消收藏 ==========
    if (action === 'favorite') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { problemId } = req.body;
      if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });

      const favorites = await U.toggleFavorite(decoded.username, problemId);
      return res.status(200).json({ success: true, favorites });
    }

    // ========== 获取收藏列表 ==========
    if (action === 'favorites') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const favorites = await U.getFavorites(decoded.username);
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
      if (await U.displayNameTaken(trimmed, decoded.username)) {
        return res.status(400).json({ success: false, message: 'This name is used' });
      }

      // ⭐ 檢查改名頻率（防刷）
      const user = await U.getUser(decoded.username);

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
        await U.updateUser(decoded.username, {
          displayName: trimmed,
          lastRenameAt: new Date(),
          renameCount: (user?.renameCount || 0) + 1,
        });
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

      const user = await U.getUserForAuth(decoded.username);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      if (!user.password) {
        return res.status(400).json({ success: false, message: 'This account does not have a password set. Please use SSO or contact admin.' });
      }

      const match = await bcrypt.compare(oldPassword, user.password);
      if (!match) return res.status(400).json({ success: false, message: 'Old password is incorrect' });

      const hashed = await bcrypt.hash(newPassword, 10);
      await U.updateUser(decoded.username, { password: hashed });
      return res.status(200).json({ success: true, message: 'Password updated successfully' });
    }
    // ========== 成就相关 ==========

    // GET：拉当前用户的成就
    if (action === 'achievements') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const targetUsername = req.query.username || decoded.username;

      const [user, stats, achs] = await Promise.all([
        U.getUser(targetUsername),
        U.getUserStats(targetUsername),
        U.getAchievements(targetUsername),
      ]);

      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const unlockedMap = Object.fromEntries(achs.map(a => [a.id, a.unlockedAt]));

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
        achievements: achs.map(a => a.id),
        unlockedAt: unlockedMap,
        definitions,
        progress,
        rewardsEarned,
        streak: {
          current: stats?.streakDays || 0,
          max: stats?.maxStreak || 0,
          activeDays: stats?.activeDaysTotal || 0,
        },
      });
    }

    // GET：全站成就统计（每个成就多少用户解锁）
    if (action === 'achievementsStats') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

      // ⭐ 一条 GROUP BY 取代原来的 unwind 聚合
      const { totalUsers, counts } = await U.getAchievementUnlockCounts();
      return res.status(200).json({ success: true, totalUsers, counts });
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

// ═══════════════ 排行榜（数据源：MongoDB） ═══════════════
// 用户与提交本轮还没迁到 PostgreSQL，所以这里仍是 Mongo 聚合。
// 返回形状与原来 PostgreSQL 版一致，上层渲染逻辑不用改。


/** 周期榜：时间窗口内 AC 的不同题目数（同一题交十次只算一次） */
async function computePeriodLeaderboard(db, days, limit) {
  const since = new Date(Date.now() - days * 86_400_000);

  // 窗口内 AC 的不同题目数（同一题交十次只算一次）
  const agg = await S.solvedCountByUser(since);

  if (!agg.length) return [];

  // ⭐ 用户资料与 banned / team 过滤在 PostgreSQL
  const infoMap = await U.getLeaderboardUsers(agg.map(x => x.username));

  const rows = [];
  for (const x of agg) {
    const u = infoMap[x.username];
    if (!u) continue;
    rows.push({ ...u, solves: x.solved });
  }
  rows.sort((a, b) => b.solves - a.solves || a.username.localeCompare(b.username));
  return rows.slice(0, limit);
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);