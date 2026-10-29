// api/oplog.js
// ⚠️ 原来读取 MongoDB 副本集的 local.oplog.rs，随 MongoDB 下线已不可用。
//    保留 endpoint 让管理端自检不 404，统一返回空列表。
import { verifyToken } from '../lib/auth.js';
import { wrapHandler } from '../lib/errors.js';

async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'root')) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const action = req.query.action || 'list';
  if (action === 'stats') {
    return res.status(200).json({
      success: true, count: 0, size: 0,
      message: 'oplog 随 MongoDB 下线，已不可用',
    });
  }
  if (action === 'detail') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return res.status(200).json({
    success: true, list: [], total: 0,
    message: 'oplog 随 MongoDB 下线，已不可用',
  });
}

export default wrapHandler(handler);
