import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';

export default async function handler(req, res) {
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
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[heartbeat] failed:', err);
    return res.status(500).json({ success: false });
  }
}