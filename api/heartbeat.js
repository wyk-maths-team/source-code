import { sqlDb } from '../lib/docStore.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import * as U from '../lib/userStore.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false });

  const action = req.query.action;

  try {
    const db = sqlDb();

    // ⭐ 显式下线（登出按钮触发）
    if (action === 'offline') {
      // ⭐ 在线状态在 PostgreSQL 的 user_stats
      await U.markOffline(decoded.username);
      return res.status(200).json({ success: true });
    }

    // 正常心跳：heartbeat_count +1，last_seen 刷新，清掉显式下线标记
    await U.touchHeartbeat(decoded.username);
    
    // ⭐ 修复：这里用 decoded.username
    const unreadCount = await db.collection('messages').countDocuments({ 
      username: decoded.username, 
      read: false 
    });
    
    return res.status(200).json({ success: true, unreadMessages: unreadCount });
  } catch (err) {
    console.error('[heartbeat] failed:', err);
    return res.status(500).json({ success: false });
  }
}

export default wrapHandler(handler);