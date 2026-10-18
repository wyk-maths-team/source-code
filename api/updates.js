// api/updates.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { sanitizeHTML } from '../lib/sanitize.js';
import { ObjectId } from 'mongodb';
import { wrapHandler } from '../lib/errors.js';

let _updatesCache = { data: null, expireAt: 0 };
const SERVER_CACHE_TTL = 30 * 60_000;

function isAdminUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const action = req.query.action;
  const isAdminAction = typeof action === 'string' && action.startsWith('admin');

  // 讀取類：無需登入
  if (!isAdminAction) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    res.setHeader(
      'Cache-Control',
      'public, max-age=60, s-maxage=600, stale-while-revalidate=86400'
    );

    if (_updatesCache.data && _updatesCache.expireAt > Date.now()) {
      return res.status(200).json({ success: true, updates: _updatesCache.data, cached: true });
    }

    try {
      const db = await connectToDatabase();
      const updates = await db.collection('updates').find({}).sort({ date: -1 }).toArray();
      _updatesCache.data = updates;
      _updatesCache.expireAt = Date.now() + SERVER_CACHE_TTL;
      return res.status(200).json({ success: true, updates });
    } catch (err) {
      console.error('Updates API error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ========== 管理端 ==========
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!isAdminUser(decoded)) return res.status(403).json({ success: false, message: 'Admin only' });

  const db = await connectToDatabase();

  // ----- GET：列表 / 單筆 -----
  if (action === 'adminList') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { id } = req.query;
    if (id) {
      let oid;
      try { oid = new ObjectId(id); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
      const update = await db.collection('updates').findOne({ _id: oid });
      if (!update) return res.status(404).json({ success: false, message: 'Update not found' });
      return res.status(200).json({ success: true, update });
    }
    const updates = await db.collection('updates').find({}).sort({ date: -1 }).toArray();
    return res.status(200).json({ success: true, updates });
  }

  // ----- POST：新增 -----
  if (action === 'adminCreate') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { badge, badgeText, time, title, content, locked } = req.body || {};
    if (!badge || !badgeText || !time || !content) {
      return res.status(400).json({ success: false, message: 'Missing fields (badge, badgeText, time, content are required)' });
    }
    const cleanedContent = sanitizeHTML(content);
    const newUpdate = {
      badge,
      badgeText,
      time,
      title: title ? sanitizeHTML(title) : '',
      content: cleanedContent,
      date: new Date(),
      locked: !!locked
    };
    await db.collection('updates').insertOne(newUpdate);
    _updatesCache = { data: null, expireAt: 0 };   // 清快取
    return res.status(201).json({ success: true, message: 'Update created' });
  }

  // ----- PUT：更新 -----
  if (action === 'adminUpdate') {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const { id, badge, badgeText, time, title, content, locked } = req.body || {};
    if (!id) return res.status(400).json({ success: false, message: 'Missing update ID' });
    let oid;
    try { oid = new ObjectId(id); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }

    const existing = await db.collection('updates').findOne({ _id: oid });
    if (!existing) return res.status(404).json({ success: false, message: 'Update not found' });
    if (existing.locked && decoded.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Only root can edit locked updates' });
    }

    const upd = {};
    if (badge !== undefined) upd.badge = badge;
    if (badgeText !== undefined) upd.badgeText = badgeText;
    if (title !== undefined) upd.title = sanitizeHTML(title);
    if (content !== undefined) upd.content = sanitizeHTML(content);
    if (locked !== undefined && decoded.role === 'root') upd.locked = (locked === true);

    if (Object.keys(upd).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    await db.collection('updates').updateOne({ _id: oid }, { $set: upd });
    _updatesCache = { data: null, expireAt: 0 };
    return res.status(200).json({ success: true, message: 'Update updated' });
  }

  // ----- DELETE：刪除 -----
  if (action === 'adminDelete') {
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, message: 'Missing update ID' });
    let oid;
    try { oid = new ObjectId(id); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }

    const update = await db.collection('updates').findOne({ _id: oid });
    if (!update) return res.status(404).json({ success: false, message: 'Update not found' });
    if (update.locked && decoded.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Only root can delete locked updates' });
    }

    await db.collection('updates').deleteOne({ _id: oid });
    _updatesCache = { data: null, expireAt: 0 };
    return res.status(200).json({ success: true, message: 'Update deleted' });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);