// api/tr-problems.js
// ⚠️ 功能已下线（MongoDB 迁移后不再维护 tr-problems 数据）。
//    保留这个 endpoint 只是为了让管理端自检与旧页面不 404，统一返回空集。
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const action = req.query.action || 'list';
  const empty = { success: true, items: [], total: 0 };

  if (action === 'whoami') {
    return res.status(200).json({
      success: true,
      username: decoded.username,
      role: decoded.role,
      canView: true,
      canManage: decoded.role === 'root',
      retired: true,
    });
  }
  if (action === 'list-all') {
    return res.status(200).json({ ...empty, fetchedAt: Date.now() });
  }
  if (action === 'stats') {
    return res.status(200).json({
      success: true, total: 0, byLevel: [], byDifficulty: [], byCategory: [],
    });
  }
  if (action === 'get') {
    return res.status(404).json({ success: false, message: 'Not found (feature retired)' });
  }
  return res.status(200).json(empty);
}

export default wrapHandler(handler);
