// api/messages.js
import { sqlDb } from '../lib/docStore.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
// MongoDB 已下线：_id 现在就是字符串。
// 保留同名构造器，让 `new ObjectId(x)` 的旧写法继续可用（返回字符串包装对象）。
function ObjectId(v) {
  if (new.target) return new String(String(v));
  return String(v);
}
import { wrapHandler } from '../lib/errors.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = sqlDb();
  const collection = db.collection('messages');

  // GET：拉取未读消息
  if (req.method === 'GET') {
    const msgs = await collection.find({ username: decoded.username, read: false }).sort({ createdAt: -1 }).toArray();
    return res.status(200).json({ success: true, messages: msgs });
  }

  // POST：手动关闭（标记已读）
  if (req.method === 'POST') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });
    
    try {
      await collection.updateOne(
        { _id: new ObjectId(id), username: decoded.username },
        { $set: { read: true } }
      );
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid ID format' });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

export default wrapHandler(handler);