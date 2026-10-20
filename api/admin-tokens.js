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

  // ── GET: 查詢所有人的 Token 餘額與累計用量 ──
  if (req.method === 'GET') {
    try {
      const users = await db.collection('users')
        .find({}, { projection: { username: 1, displayName: 1, token: 1, _id: 0 } })
        .sort({ username: 1 })
        .toArray();

      // 整理資料，補齊沒有 token 欄位的人
      const list = users.map(u => {
        const t = u.token || { daily: 30000, global: 100000, totalUsed: 0 };
        return {
          username: u.username,
          displayName: u.displayName || u.username,
          daily: t.daily,
          global: t.global,
          totalUsed: t.totalUsed || 0,
        };
      });

      return res.status(200).json({ success: true, users: list });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ── POST: 初始化歷史資料（從 submissions 統計） ──
  if (req.method === 'POST') {
    try {
      // 1. 聚合所有有 tokenUsage 的提交記錄
      const agg = await db.collection('submissions').aggregate([
        { $match: { tokenUsage: { $gt: 0 } } },
        { $group: { _id: '$username', total: { $sum: '$tokenUsage' } } }
      ]).toArray();

      const usageMap = Object.fromEntries(agg.map(a => [a._id, a.total]));

      // 2. 取出所有用戶，準備批次更新
      const users = await db.collection('users').find({}, { projection: { username: 1 } }).toArray();
      const bulkOps = users.map(u => {
        const totalUsed = usageMap[u.username] || 0;
        return {
          updateOne: {
            filter: { username: u.username },
            update: {
              $set: {
                'token.totalUsed': totalUsed,
                // 如果他們沒有每日/全局 token，給他們初始化
                'token.daily': 30000,
                'token.global': 100000,
                'token.lastReset': new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0]
              }
            },
            upsert: false
          }
        };
      });

      if (bulkOps.length > 0) {
        await db.collection('users').bulkWrite(bulkOps);
      }

      return res.status(200).json({ 
        success: true, 
        message: `Initialized ${users.length} users. Total usage aggregated.` 
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

export default wrapHandler(handler);