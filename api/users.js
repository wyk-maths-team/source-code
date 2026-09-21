// api/users.js
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import bcrypt from 'bcrypt';
import { applyRateLimit } from '../lib/rateLimit.js';
import { uploadImage } from '../lib/cloudinary.js';

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
      return res.status(200).json({ success: true, message: 'User updated' });
    }

    // ----- DELETE：刪除 -----
    if (action === 'adminDelete') {
      if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const user = await db.collection('users').findOne({ username });
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (user.role === 'root') {
        return res.status(403).json({ success: false, message: 'Cannot delete root user' });
      }
      if (decoded.role === 'admin' && user.role !== 'student') {
        return res.status(403).json({ success: false, message: 'Admin can only delete students' });
      }

      await db.collection('users').deleteOne({ username });
      await db.collection('submissions').deleteMany({ username });
      await db.collection('userstats').deleteOne({ username });
      return res.status(200).json({ success: true, message: 'User deleted' });
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
  // GET: 获取任意用户的头像
  if (req.method === 'GET') {
    const { username } = req.query;
    if (!username) return res.status(400).json({ success: false, message: 'Missing username' });
    const user = await db.collection('users').findOne({ username }, { projection: { pfp: 1 } });
    return res.status(200).json({ success: true, pfp: user?.pfp || '' });
  }

  // POST: 上传自己的头像（需要登录）
  if (req.method === 'POST') {
    const { image } = req.body;   // base64 数据，格式如 'data:image/jpeg;base64,...'
    if (!image) return res.status(400).json({ success: false, message: 'Missing image data' });

    // 服务端校验图片大小（粗略限制 1MB）
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 1 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image too large (max 1MB)' });
    }

    try {
      const imageUrl = await uploadImage(image);   // 调用 Cloudinary 上传
      await db.collection('users').updateOne(
        { username: decoded.username },
        { $set: { pfp: imageUrl } }
      );
      return res.status(200).json({ success: true, pfp: imageUrl });
    } catch (err) {
      console.error('PFP upload error:', err);
      return res.status(500).json({ success: false, message: 'Image upload failed' });
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