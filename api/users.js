// api/users.js
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import bcrypt from 'bcrypt';
import { applyRateLimit } from '../lib/rateLimit.js';
import { sendAuditNotification } from '../lib/webhook.js';
// ═══════════════ Audit helper ═══════════════
// action 命名統一：user_create / user_update / user_delete / pfp_upload
// 通知級別：
//   info   → 建立、頭像、其他低風險
//   warn   → 一般修改
//   danger → 刪除、提權、封禁

async function auditLog(db, action, details, operator, level = null) {
  try {
    await db.collection('audit_logs').insertOne({
      action,
      details,
      operator,
      timestamp: new Date(),
    });

    if (level && process.env.DISCORD_WEBHOOK_URL) {
      await sendAuditNotification(action, details, operator, level);
    }
  } catch (e) {
    console.error('[audit]', action, 'failed:', e);
  }
}

// ⭐ 排行榜內存緩存（30 秒）
let _leaderboardCache = { data: null, expireAt: 0 };
const LEADERBOARD_TTL = 30_000;
// ⭐ Charts 內存緩存（24 小時）
let _chartCache = { data: null, expireAt: 0 };
const CHART_CACHE_TTL = 24 * 60 * 60_000;
export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const { action } = req.query;
  let decoded = null;
  if (action !== 'leaderboard') {
    decoded = await verifyToken(req);
    if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
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

      // 提權 / 降級 → danger
      if (updateFields.role !== undefined && updateFields.role !== targetUser.role) {
        dangerFlags.push(`role: ${targetUser.role} → ${updateFields.role}`);
        level = 'danger';
      }
      // 封禁 → danger
      if (updateFields.banned !== undefined && updateFields.banned !== targetUser.banned) {
        dangerFlags.push(updateFields.banned ? 'banned' : 'unbanned');
        level = 'danger';
      }
      // 改密碼 → warn（等於可以登入該賬戶）
      if (updateFields.password) {
        dangerFlags.push('password reset');
      }
      // 改用戶名 → warn（影響 submissions / userstats）
      if (updateFields.username) {
        dangerFlags.push(`username: ${username} → ${updateFields.username}`);
      }

      // 記錄所有欄位變動（去掉密碼 hash，只記標記）
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

    // ----- DELETE：刪除 -----
        // ----- DELETE：刪除 -----
        // ----- DELETE：刪除（先備份到 GitHub backup repo） -----
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
        user,                                    // 完整 user 文檔（含 password hash）
        userstats: userstatsDoc || null,
        submissions,                             // 全部提交
      };

      // ⭐ 2. 上傳到 GitHub backup repo
      //    檔名：users/{username}-{YYYYMMDD-HHmmss}.json
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
          overwrite: false,   // 檔名有時間戳，不該覆蓋
        });
        console.log(`[user_delete] backup ok: ${backupResult.githubUrl}`);
      } catch (e) {
        backupError = e.message;
        console.error('[user_delete] backup failed:', e);
      }

      // ⭐ 3. 若備份失敗 → 除非 force，否則拒絕刪除
      if (backupError && !force) {
        // 寫 audit 記下失敗
        try {
          await db.collection('audit_logs').insertOne({
            action: 'user_delete_backup_failed',
            operator: decoded.username,
            details: { username, error: backupError },
            timestamp: new Date(),
          });
        } catch {}

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

      // ⭐ 5. 寫 audit（含備份連結，方便事後恢復）
      const auditDetails = {
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
      };

      // ⭐ 送 Discord 通知（若已有 webhook helper）
      try {
        const { sendAuditNotification } = await import('../lib/webhook.js');
        await sendAuditNotification(
          'user_delete',
          {
            username,
            count: submissions.length,
            backupUrl: backupResult?.githubUrl || '(failed)',
          },
          decoded.username,
          'danger'
        );
      } catch (e) {
        // 通知失敗不影響主流程
        console.warn('[user_delete] notify failed:', e.message);
      }

      // ⭐ 寫 audit_logs（若你沒整合 auditLog helper，這裡直接寫）
      try {
        await db.collection('audit_logs').insertOne({
          action: 'user_delete',
          operator: decoded.username,
          details: auditDetails,
          timestamp: new Date(),
        });
      } catch (e) {
        console.error('[user_delete] audit_logs failed:', e);
      }

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
  // 除 leaderboard 外都需要登录
  

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
        // ⭐ 批量：?action=pfp&usernames=a,b,c
        const batchParam = req.query.usernames;
        if (batchParam) {
          const list = String(batchParam)
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
            .slice(0, 100); // 上限 100 個

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

        // 單個
        const { username } = req.query;
        if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

        const user = await db.collection('users')
          .findOne({ username }, { projection: { pfp: 1, _id: 0 } });

        // ⭐ 若沒有 pfp，短快取（避免反覆查 DB）
        if (!user || !user.pfp) {
          res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
          return res.status(200).json({ success: true, pfp: '' });
        }

        // ⭐ 有 pfp 長快取
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

      // ⭐ 瀏覽器端緩存 60 秒（不經 Edge，避免權限穿透）
      res.setHeader('Cache-Control', 'private, max-age=60');

      // ⭐ 內存緩存命中 → 直接返回
      if (_chartCache.data && _chartCache.expireAt > Date.now()) {
        return res.status(200).json({ success: true, data: _chartCache.data, cached: true });
      }

      try {
        // 聚合：每位用戶對每題的最早 AC 時間 → 按日期累計
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

        // 補齊日期（從開服第一天到今天）
        const startDate = new Date(datesArray[0] + 'T00:00:00Z');
        const endDate = new Date();
        const allDates = [];
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
          allDates.push(d.toISOString().split('T')[0]);
        }

        // 按 user 重組
        const userMap = {};
        dailyData.forEach(d => {
          const username = d._id.username;
          const date = d._id.date;
          if (!userMap[username]) userMap[username] = {};
          userMap[username][date] = d.count;
        });

        const usernames = Object.keys(userMap);

        // 一次拉 realName / displayName
        const userDocs = await db.collection('users')
          .find(
            { username: { $in: usernames } },
            { projection: { username: 1, realName: 1, displayName: 1 } }
          )
          .toArray();
        const nameMap = Object.fromEntries(
          userDocs.map(u => [u.username, { realName: u.realName || '', displayName: u.displayName || '' }])
        );

        // 構建累計序列
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
      res.setHeader(
        'Cache-Control',
        'public, s-maxage=30, stale-while-revalidate=120'
      );

      // ⭐ 內存緩存：30 秒內直接返回，不打 DB
      const now = Date.now();
      if (_leaderboardCache.data && _leaderboardCache.expireAt > now) {
        return res.status(200).json(_leaderboardCache.data);
      }
      const leaderboardData = await db.collection('leaderboardView').find({}).toArray();
      const usernames = leaderboardData.map(e => e.username);

      // 一併取出 realName / displayName（給 hover tooltip 用）
      const users = await db.collection('users')
        .find(
          { username: { $in: usernames } },
          { projection: { username: 1, pfp: 1, displayName: 1, realName: 1, banned: 1 } }
        )
        .toArray();

      const userMap = Object.fromEntries(users.map(u => [u.username, u]));

      const leaderboard = leaderboardData
        .filter(entry => {
          const u = userMap[entry.username];
          if (u && u.banned === true) return false;
          if (u && u.role === 'team') return false;   // ⭐ 新增
          return true;
        })
        .map((entry, idx) => {
          const u = userMap[entry.username] || {};
          return {
            rank: idx + 1,
            username: entry.username,
            displayName: entry.displayName || u.displayName || entry.username,
            solves: entry.solves,
            pfp: u.pfp || '',
            realName: u.realName || ''   // ⭐ 新增
          };
        });
      const payload = { success: true, leaderboard };
      _leaderboardCache = { data: payload, expireAt: Date.now() + LEADERBOARD_TTL };
      return res.status(200).json(payload);
      // return res.status(200).json({ success: true, leaderboard });
    }
    

    if (action === 'profile') {
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const isAdminUser = decoded.role === 'admin' || decoded.role === 'root';
      const problemFilter = isAdminUser ? {} : { public: true };

      // 並行拉：題目清單、用戶狀態、用戶資料
      const [problems, userStats, user] = await Promise.all([
        db.collection('problems')
          .find(problemFilter, { projection: { id: 1, _id: 0 } })
          .toArray(),
        db.collection('userstats').findOne({ username }, { projection: { states: 1, _id: 0 } }),
        db.collection('users').findOne(
          { username },
          { projection: { pfp: 1, displayName: 1, realName: 1, _id: 0 } }
        )
      ]);

      // 依 id 數字升序排序（IP2 < IP10 < IP100）
      problems.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

      const states = userStats?.states || {};
      const attempted = [];
      let totalPassed = 0;
      for (const p of problems) {
        const state = states[p.id];
        if (state === 'passed') { totalPassed++; attempted.push({ id: p.id, state: 'passed' }); }
        else if (state === 'failed') attempted.push({ id: p.id, state: 'failed' });
      }

      return res.status(200).json({
        success: true,
        username,
        displayName: user?.displayName || username,
        realName: user?.realName || '',
        pfp: user?.pfp || '',
        totalPassed,
        totalProblems: problems.length,
        attempted,                             // [{id, state}]，已排序，只含 passed/failed
        allProblemIds: problems.map(p => p.id) // ⭐ 供前端渲染「所有題目」網格
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
  //

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { newname } = req.body;
  if (!newname || newname.trim() === '') {
    return res.status(400).json({ success: false, message: 'Display name cannot be empty' });
  }
  if (newname.length > 50) {
    return res.status(400).json({ success: false, message: 'Display name too long (max 50 characters)' });
  }
  try {
    await db.collection('users').updateOne(
      { username: decoded.username },
      { $set: { displayName: newname.trim() } }
    );
    return res.status(200).json({ success: true, message: 'Display name updated successfully' });
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

    // 关键：必须包含 password 字段
    const user = await db.collection('users').findOne(
      { username: decoded.username },
      { projection: { password: 1 } }  // 只取 password
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // 如果用户没有密码（如通过微软登录注册的），不允许用旧密码修改
    if (!user.password) {
      return res.status(400).json({ success: false, message: 'This account does not have a password set. Please use SSO or contact admin.' });
    }

    // 验证旧密码
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Old password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.collection('users').updateOne(
      { username: decoded.username },
      { $set: { password: hashed } }
    );
    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  }

    return res.status(400).json({ success: false, message: 'Invalid action' });
  } catch (err) {
    console.error('Users API error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}