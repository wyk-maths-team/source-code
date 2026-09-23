// api/tr-problems.js
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';

// ── 權限設定（環境變數）──
function allowedUsers() {
  return String(process.env.TR_ALLOWED_USERS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}
function adminUsers() {
  return String(process.env.TR_ADMIN_USERS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}
function canView(decoded) {
  if (!decoded) return false;
  if (decoded.role === 'root') return true;
  return allowedUsers().includes(decoded.username);
}
function canManage(decoded) {
  if (!decoded) return false;
  if (decoded.role === 'root') return true;
  return adminUsers().includes(decoded.username) &&
         allowedUsers().includes(decoded.username);
}

function validateProblem(body, { partial = false } = {}) {
  const errors = [];
  const out = {};

  if (body.id !== undefined || !partial) {
    const id = String(body.id || '').trim();
    if (!id) errors.push('id required');
    if (id.length > 100) errors.push('id too long');
    out.id = id;
  }
  if (body.statement !== undefined || !partial) {
    const s = String(body.statement || '').trim();
    if (!s) errors.push('statement required');
    out.statement = s;
  }
  if (body.choice !== undefined || !partial) {
    const c = body.choice;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      errors.push('choice must be an object');
    } else {
      const cleaned = {};
      for (const k of Object.keys(c)) {
        if (!/^[A-Z]$/.test(k)) continue;
        const v = String(c[k] || '').trim();
        if (v) cleaned[k] = v;
      }
      if (Object.keys(cleaned).length < 2) errors.push('choice needs ≥2 options');
      out.choice = cleaned;
    }
  }
  if (body.ans !== undefined || !partial) {
    const a = String(body.ans || '').toUpperCase().trim();
    if (!/^[A-Z]$/.test(a)) errors.push('ans must be A-Z');
    out.ans = a;
  }
  if (body.level !== undefined || !partial) {
    const lv = parseInt(body.level, 10);
    if (!Number.isFinite(lv) || lv < 1 || lv > 9) errors.push('level must be 1-9');
    out.level = lv;
  }
  if (body.difficulty !== undefined || !partial) {
    const d = String(body.difficulty || '').toLowerCase();
    if (!['easy', 'medium', 'hard'].includes(d)) errors.push('difficulty must be easy|medium|hard');
    out.difficulty = d;
  }
  if (body.category !== undefined || !partial) {
    out.category = String(body.category || '').trim();
  }
  if (body.imageurl !== undefined || !partial) {
    out.imageurl = String(body.imageurl || '').trim();
    out.private = !!out.imageurl;
  }

  if (out.choice && out.ans && !out.choice[out.ans]) {
    errors.push(`ans "${out.ans}" not in choice`);
  }
  return { errors, value: out };
}

// 列表用的投影（不含 imageurl，只留 hasImage 標記）
const LIST_PROJECTION = {
  _id: 0,
  id: 1,
  statement: 1,
  choice: 1,
  ans: 1,
  level: 1,
  difficulty: 1,
  category: 1,
  private: 1,
  hasImage: { $gt: [{ $strLenCP: { $ifNull: ['$imageurl', ''] } }, 0] },
};

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const action = req.query.action || 'list';

  // ⭐ whoami 放在最前（讓無權限者也能查詢）
  if (action === 'whoami') {
    return res.status(200).json({
      success: true,
      username: decoded.username,
      role: decoded.role,
      canView: canView(decoded),
      canManage: canManage(decoded),
    });
  }

  // 非受邀用戶 → 404（不洩漏系統存在）
  if (!canView(decoded)) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  const db = await connectToDatabase();
  const col = db.collection('tr-problems');

  // ═══════════ LIST-ALL（一次性拉全部）═══════════
  if (action === 'list-all') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
      const items = await col.aggregate([
        { $sort: { id: 1 } },
        { $project: LIST_PROJECTION },
      ]).toArray();

      // 邊緣快取 5 分鐘、瀏覽器快取 5 分鐘
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.status(200).json({
        success: true,
        items,
        total: items.length,
        fetchedAt: Date.now(),
      });
    } catch (err) {
      console.error('tr-problems list-all error:', err);
      return res.status(500).json({ success: false, message: 'Internal error' });
    }
  }

  // ═══════════ LIST（分頁，保留相容）═══════════
  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { page = '1', limit = '50', category, difficulty, level, q } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(2000, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (category) filter.category = category;
    if (difficulty) filter.difficulty = String(difficulty).toLowerCase();
    if (level) filter.level = Number(level);
    if (q) {
      const safe = String(q).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      filter.$or = [
        { id: { $regex: safe, $options: 'i' } },
        { statement: { $regex: safe, $options: 'i' } },
      ];
    }

    const [total, items] = await Promise.all([
      col.countDocuments(filter),
      col.aggregate([
        { $match: filter },
        { $sort: { id: 1 } },
        { $skip: (pageNum - 1) * limitNum },
        { $limit: limitNum },
        { $project: LIST_PROJECTION },
      ]).toArray(),
    ]);

    return res.status(200).json({
      success: true,
      items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    });
  }

  // ═══════════ GET（單題，含 imageurl）═══════════
  if (action === 'get') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    const doc = await col.findOne({ id }, { projection: { _id: 0 } });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });

    // 有圖的題目短快取
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ success: true, problem: doc });
  }

  // ═══════════ STATS ═══════════
  if (action === 'stats') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const [result] = await col.aggregate([
      {
        $facet: {
          total: [{ $count: 'n' }],
          byLevel: [{ $group: { _id: '$level', count: { $sum: 1 } } }, { $sort: { _id: 1 } }],
          byDifficulty: [{ $group: { _id: '$difficulty', count: { $sum: 1 } } }],
          byCategory: [
            { $match: { category: { $ne: '' } } },
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 100 },
          ],
        },
      },
    ]).toArray();

    return res.status(200).json({
      success: true,
      total: result.total[0]?.n || 0,
      byLevel: result.byLevel,
      byDifficulty: result.byDifficulty,
      byCategory: result.byCategory,
    });
  }

  // ═══════════ 以下需管理員 ═══════════
  if (!canManage(decoded)) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { errors, value } = validateProblem(req.body || {}, { partial: false });
    if (errors.length) return res.status(400).json({ success: false, message: errors.join('; ') });

    const exist = await col.findOne({ id: value.id }, { projection: { _id: 1 } });
    if (exist) return res.status(409).json({ success: false, message: 'id already exists' });

    value.createdAt = new Date();
    value.createdBy = decoded.username;

    await col.insertOne(value);
    return res.status(201).json({ success: true, id: value.id });
  }

  if (action === 'update') {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    const { errors, value } = validateProblem(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ success: false, message: errors.join('; ') });
    if (Object.keys(value).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    if (value.ans && !value.choice) {
      const cur = await col.findOne({ id }, { projection: { choice: 1 } });
      if (!cur) return res.status(404).json({ success: false, message: 'Not found' });
      if (!cur.choice?.[value.ans]) {
        return res.status(400).json({ success: false, message: 'ans not in existing choice' });
      }
    }

    value.updatedAt = new Date();
    value.updatedBy = decoded.username;

    const result = await col.updateOne({ id }, { $set: value });
    if (result.matchedCount === 0) return res.status(404).json({ success: false, message: 'Not found' });

    return res.status(200).json({ success: true, message: 'Updated' });
  }

  if (action === 'delete') {
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
    const id = String(req.query.id || req.body?.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    const result = await col.deleteOne({ id });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Not found' });

    return res.status(200).json({ success: true, message: 'Deleted' });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}