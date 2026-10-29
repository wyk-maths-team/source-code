// api/search.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import * as P from '../lib/pgStore.js';
import * as U from '../lib/userStore.js';

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
    // ⭐ 用户表在 PostgreSQL：ILIKE 模糊匹配
    const users = await U.searchUsers(keyword, 6);
    return res.status(200).json({ success: true, data: users });
  }

  if (action === 'search_prob') {
    // ⭐ 题库在 PostgreSQL：ILIKE 模糊匹配 id / name
    const problems = await P.searchProblems(keyword, 6);
    return res.status(200).json({ success: true, data: problems });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}

export default wrapHandler(handler);