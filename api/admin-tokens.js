// api/admin-tokens.js
import { sqlDb } from '../lib/docStore.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import * as U from '../lib/userStore.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'root')) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const db = sqlDb();

  // ── GET: 查詢、搜尋、排序 ──
  if (req.method === 'GET') {
    try {
      const { search, sortBy, order } = req.query;
      // ⭐ 用户 + 钱包一次 JOIN 拿齐（搜索与排序在 SQL 里做，排序字段走白名单）
      const list = await U.listUsersWithTokens({ search, sortBy, order });
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

        const hasDaily = daily !== undefined && !isNaN(daily);
        const hasGlobal = global !== undefined && !isNaN(global);
        if (!hasDaily && !hasGlobal) {
          return res.status(400).json({ success: false, message: 'No valid fields to update' });
        }

        const cur = await U.getTokens(username);
        if (!cur) return res.status(404).json({ success: false, message: 'User not found' });

        // ⭐ 只覆盖传进来的那个桶，另一个保持原值
        await U.setTokens(username, {
          daily: hasDaily ? Number(daily) : cur.daily,
          global: hasGlobal ? Number(global) : cur.global,
        });

        return res.status(200).json({ success: true, message: 'User updated' });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    }

    // 2. 初始化历史记录（聚合 submissions）
    if (action === 'initHistory' || !action) {
      try {
        const usageRows = await S.sumTokenUsageByUser();
        const usageMap = Object.fromEntries(usageRows.map(a => [a.username, Number(a.total)]));

        // ⭐ 只回填 total_used 与 last_reset；daily/global 保持数据库里的现值
        const users = await U.listUsersForAdmin();
        for (const u of users) {
          await U.setTotalUsed(u.username, usageMap[u.username] || 0);
          await U.setLastResetToday(u.username);
        }

        return res.status(200).json({ success: true, message: `Initialized ${users.length} users.` });
      } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
      }
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

export default wrapHandler(handler);