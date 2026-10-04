// api/admin-pkproblem.js
// 管理端：pkproblems 的读取 + 更新（无 create / delete / list）
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false });
  if (decoded.role !== 'admin' && decoded.role !== 'root') {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const db = await connectToDatabase();
  const action = req.query.action;
  const col = db.collection('pkproblems');
    // ── 列表 ──
  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { q, page = '1', limit = '100' } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));

    const filter = {};
    if (q) {
      const safe = String(q).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      filter.$or = [
        { id: { $regex: safe, $options: 'i' } },
        { statement: { $regex: safe, $options: 'i' } },
      ];
    }

    const [total, items] = await Promise.all([
      col.countDocuments(filter),
      col.find(filter, { projection: { _id: 0 } })
        .sort({ id: 1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .toArray(),
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
  // ── 读取单个 ──
  if (action === 'get') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const id = String(req.query.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    const doc = await col.findOne({ id }, { projection: { _id: 0 } });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    return res.status(200).json({ success: true, problem: doc });
  }

  // ── 更新 ──
  if (action === 'update') {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const { id, statement, choice, ans } = req.body || {};
    const idStr = String(id || '').trim();
    if (!idStr) return res.status(400).json({ success: false, message: 'Missing id' });

    const existing = await col.findOne({ id: idStr });
    if (!existing) return res.status(404).json({ success: false, message: 'Not found' });

    const upd = {};
    if (statement !== undefined) upd.statement = String(statement);
    if (choice !== undefined) {
      if (!Array.isArray(choice) || choice.length < 2) {
        return res.status(400).json({ success: false, message: 'choice must be array with ≥2 items' });
      }
      upd.choice = choice.map(c => String(c));
    }
    if (ans !== undefined) {
      const a = String(ans).trim().toUpperCase();
      const finalChoice = upd.choice || existing.choice || [];
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const validAns = letters.slice(0, finalChoice.length).split('');
      if (!validAns.includes(a)) {
        return res.status(400).json({ success: false, message: `ans must be one of ${validAns.join('/')}` });
      }
      upd.ans = a;
    }
    if (Object.keys(upd).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    await col.updateOne({ id: idStr }, { $set: upd });
    await auditLog(db, 'pkproblem_update', { id: idStr, fields: Object.keys(upd) },
      decoded.username, 'warn').catch(() => {});

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}