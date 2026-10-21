// api/search.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // AGAINST INJECTION
}
//lol this function purely written by me
async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const action = req.query.action;
  
  const keyword = String(req.query.keyword || '').trim();
  if (!keyword) {
    return res.status(200).json({ success: true, data: [] });
  }

  const safeKeyword = escapeRegExp(keyword);
  const regex = new RegExp(safeKeyword, 'i');

  if (action === 'search_user') {
    const users = await db.collection('users').find({
      $or: [
        { username: regex }, 
        { realName: regex }, 
        { displayName: regex }
      ]
    }).project({ username: 1, realName: 1, displayName: 1, _id: 0 }).limit(6).toArray();
    
    return res.status(200).json({ success: true, data: users });
  }

  if (action === 'search_prob') {
    const problems = await db.collection('problems').find({
      $or: [
        { id: regex }, 
        { name: regex }
      ]
    }).project({ id: 1, name: 1, _id: 0 }).limit(6).toArray();
    
    return res.status(200).json({ success: true, data: problems });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}

export default wrapHandler(handler);