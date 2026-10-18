// api/messages.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { ObjectId } from 'mongodb';
import { wrapHandler } from '../lib/errors.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
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