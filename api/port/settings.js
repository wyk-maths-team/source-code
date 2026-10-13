// api/port/settings.js
// GET /api/port/settings  → { currentChatUrl }
// PUT /api/port/settings  { currentChatUrl }
import { connectToDatabase } from '../_pdb.js';
import { portAuth } from './_auth.js';

export default async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;

  const db = await connectToDatabase();
  const col = db.collection('port_settings');

  if (req.method === 'GET') {
    const doc = await col.findOne({ _key: 'currentChatUrl' });
    return res.status(200).json({ success: true, currentChatUrl: doc?.value || '' });
  }

  if (req.method === 'PUT') {
    const { currentChatUrl } = req.body || {};
    const v = String(currentChatUrl || '').trim();
    if (v && !/^https:\/\/chat\.deepseek\.com\//.test(v)) {
      return res.status(400).json({ success: false, message: 'Must be a chat.deepseek.com URL' });
    }
    await col.updateOne(
      { _key: 'currentChatUrl' },
      { $set: { value: v, updatedAt: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ success: true, currentChatUrl: v });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}