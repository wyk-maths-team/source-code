import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler } from '../lib/errors.js';
import { defaultTemplateShape, normalizeTemplateShape } from '../lib/mcq.js';

/**
 * api/mc-template.js —— 四个选项圈的「形状」模板
 *
 * 形状 = 框有多大 + 四个圈相对框左上角的偏移和半径。
 * 它不含「放在第几页、放在哪」，那是每道题自己的事。
 *
 *   GET  ?action=get   读当前模板（没有就返回内置默认）
 *   POST ?action=save  保存形状（管理员）
 */
async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const action = req.query.action || 'get';
  const col = db.collection('metadata');

  if (action === 'get') {
    const doc = await col.findOne({ _id: 'mcTemplate' });
    return res.status(200).json({
      success: true,
      shape: doc && doc.shape ? doc.shape : defaultTemplateShape(),
      updatedAt: doc && doc.updatedAt ? doc.updatedAt : null,
      isDefault: !doc,
    });
  }

  if (action === 'save') {
    const user = decoded;
    if (user.role !== 'admin' && user.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Admins only' });
    }
    const shape = normalizeTemplateShape(req.body && req.body.shape);
    if (!shape) return res.status(400).json({ success: false, message: 'Invalid template shape' });

    await col.updateOne(
      { _id: 'mcTemplate' },
      { $set: { shape, updatedAt: new Date(), updatedBy: user.username } },
      { upsert: true }
    );
    return res.status(200).json({ success: true, shape });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

export default wrapHandler(handler);
