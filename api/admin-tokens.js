// api/admin-tokens.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'root')) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const db = await connectToDatabase();

  // ── GET: 查詢、搜尋、排序 ──
  if (req.method === 'GET') {
    try {
      const { search, sortBy, order } = req.query;
      
      let filter = {};
      if (search) {
        const regex = new RegExp(search, 'i');
        filter = {
          $or: [
            { username: regex },
            { displayName: regex },
            { realName: regex }
          ]
        };
      }

      let sort = { username: 1 };
      const sortDir = order === 'asc' ? 1 : -1;
      if (sortBy === 'totalUsed') sort = { 'token.totalUsed': sortDir};
      else if (sortBy === 'global') sort = { 'token.global': sortDir };
      else if (sortBy === 'daily') sort = { 'token.daily': sortDir };

      const users = await db.collection('users')
        .find(filter, { projection: { username: 1, displayName: 1, realName: 1, token: 1, _id: 0 } })
        .sort(sort)
        .toArray();

      const list = users.map(u => {
        const t = u.token || { daily: 30000, global: 100000, totalUsed: 0 };
        return {
          username: u.username,
          displayName: u.displayName || u.username,
          realName: u.realName || '',
          daily: t.daily !== undefined ? t.daily : 30000,
          global: t.global !== undefined ? t.global : 100000,
          totalUsed: t.totalUsed || 0,
        };
      });

      return res.status(200).json({ success: true, users: list });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ── POST: 更新 Token 或 初始化 ──
  if (req.method === 'POST') {
    const { action } = req.query;
    
    // 1. 更新单个用户的 token
    if (action === 'updateUser') {
      try {
        const { username, daily, global } = req.body;
        if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

        const updateData = {};
        if (daily !== undefined && !isNaN(daily)) updateData['token.daily'] = Number(daily);
        if (global !== undefined && !isNaN(global)) updateData['token.global'] = Number(global);

        if (Object.keys(updateData).length === 0) {
           return res.status(400).json({ success: false, message: 'No valid fields to update' });
        }

        await db.collection('users').updateOne(
          { username },
          { $set: updateData }
        );

        return res.status(200).json({ success: true, message: 'User updated' });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    }

    // 2. 初始化历史记录（聚合 submissions）
    if (action === 'initHistory' || !action) {
      try {
        const agg = await db.collection('submissions').aggregate([
          { $match: { tokenUsage: { $gt: 0 } } },
          { $group: { _id: '$username', total: { $sum: '$tokenUsage' } } }
        ]).toArray();

        const usageMap = Object.fromEntries(agg.map(a => [a._id, a.total]));
        const users = await db.collection('users').find({}, { projection: { username: 1, token: 1 } }).toArray();
        
        const bulkOps = users.map(u => {
          const totalUsed = usageMap[u.username] || 0;
          // 保留原有的 daily/global，如果完全没有 token 字段才用默认值
          const currentDaily = u.token?.daily !== undefined ? u.token.daily : 30000;
          const currentGlobal = u.token?.global !== undefined ? u.token.global : 100000;

          return {
            updateOne: {
              filter: { username: u.username },
              update: {
                $set: {
                  'token.totalUsed': totalUsed,
                  'token.daily': currentDaily,
                  'token.global': currentGlobal,
                  'token.lastReset': new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0]
                }
              },
              upsert: false
            }
          };
        });

        if (bulkOps.length > 0) await db.collection('users').bulkWrite(bulkOps);

        return res.status(200).json({ success: true, message: `Initialized ${users.length} users.` });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

export default wrapHandler(handler);