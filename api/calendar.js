// api/calendar.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { ObjectId } from 'mongodb';

const MAX_TITLE_LEN   = 100;
const MAX_DETAILS_LEN = 2000;
const MAX_RANGE_DAYS  = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const col = db.collection('calendar_tasks');
  const username = decoded.username;
  const action = req.query.action || 'list';

  // ═══════════ LIST ═══════════
  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { from, to } = req.query;
    if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
      return res.status(400).json({ success: false, message: 'Invalid from/to' });
    }
    const days = (new Date(to) - new Date(from)) / 86400000;
    if (days < 0 || days > MAX_RANGE_DAYS) {
      return res.status(400).json({ success: false, message: 'Range out of bounds' });
    }

    const tasks = await col
      .find({ username, date: { $gte: from, $lte: to } })
      .sort({ date: 1, createdAt: 1 })
      .toArray();

    return res.status(200).json({
      success: true,
      tasks: tasks.map(t => ({
        _id: String(t._id),
        date: t.date,
        title: t.title,
        details: t.details || '',
        done: !!t.done,
      })),
    });
  }

  // ═══════════ CREATE ═══════════
  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { date, title, details } = req.body || {};
    if (!DATE_RE.test(date || '')) {
      return res.status(400).json({ success: false, message: 'Invalid date' });
    }
    const t = String(title || '').trim();
    if (!t || t.length > MAX_TITLE_LEN) {
      return res.status(400).json({ success: false, message: 'Invalid title' });
    }
    const det = String(details || '').trim().slice(0, MAX_DETAILS_LEN);

    const now = new Date();
    const r = await col.insertOne({
      username, date, title: t, details: det,
      done: false, createdAt: now, updatedAt: now,
    });

    return res.status(200).json({ success: true, id: String(r.insertedId) });
  }

  // ═══════════ UPDATE ═══════════
  if (action === 'update') {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

    const { id, title, details, done } = req.body || {};
    let oid;
    try { oid = new ObjectId(id); } catch {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const $set = { updatedAt: new Date() };
    if (title !== undefined) {
      const t = String(title).trim();
      if (!t || t.length > MAX_TITLE_LEN) {
        return res.status(400).json({ success: false, message: 'Invalid title' });
      }
      $set.title = t;
    }
    if (details !== undefined) {
      $set.details = String(details).trim().slice(0, MAX_DETAILS_LEN);
    }
    if (typeof done === 'boolean') $set.done = done;

    const r = await col.updateOne({ _id: oid, username }, { $set });
    if (r.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return res.status(200).json({ success: true });
  }

  // ═══════════ DELETE ═══════════
  if (action === 'delete') {
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

    const { id } = req.body || {};
    let oid;
    try { oid = new ObjectId(id); } catch {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    const r = await col.deleteOne({ _id: oid, username });
    if (r.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}