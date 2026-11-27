import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false });

  const action = req.query.action;

  try {
    const db = await connectToDatabase();

    // ⭐ 显式下线（登出按钮触发）
    if (action === 'offline') {
      await db.collection('users').updateOne(
        { username: decoded.username },
        { $set: { lastSeenAt: new Date() ,explicitlyOffline: true  } }
      );
      return res.status(200).json({ success: true });
    }

    // 正常心跳
    await db.collection('users').updateOne(
      { username: decoded.username },
      { $set: { lastSeenAt: new Date() },$inc: { heartbeatCount: 1 },$unset: { explicitlyOffline: '' } }
    );
    
    // ⭐ 修复：这里用 decoded.username
    const unreadCount = await db.collection('messages').countDocuments({ 
      username: decoded.username, 
      read: false 
    });
    
    // 侧栏那个小红点：今天还有没有没领的任务。只查登录奖励，够用且便宜。
    let questsPending = 0;
    try {
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const u = await db.collection("users").findOne(
        { username: decoded.username },
        { projection: { dailyQuests: 1, _id: 0 } }
      );
      const dq = u && u.dailyQuests;
      const claimed = dq && dq.date === today && Array.isArray(dq.claimed) ? dq.claimed : [];
      if (!claimed.includes("login")) questsPending = 1;
    } catch (e) { /* 查不到就当没有，别让心跳失败 */ }

    return res.status(200).json({ success: true, unreadMessages: unreadCount, questsPending });
  } catch (err) {
    console.error('[heartbeat] failed:', err);
    return res.status(500).json({ success: false });
  }
}

export default wrapHandler(handler);