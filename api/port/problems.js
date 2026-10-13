// api/port/problems.js
// GET /api/port/problems?subject=m2&chapter=3&page=1&limit=50
// GET /api/port/problems?id=M2-001
import { connectToDatabase } from '../_pdb.js';
import { portAuth } from './_auth.js';

const SUBJECTS = ['chin', 'eng', 'maths', 'phy', 'chem', 'bio', 'm2'];

export default async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = await connectToDatabase();
  const col = db.collection('port_problems');

  const { id, subject, chapter, page = '1', limit = '50' } = req.query;

  // ── 單題 ──
  if (id) {
    const doc = await col.findOne({ id: String(id) }, { projection: { _id: 0 } });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    return res.status(200).json({ success: true, problem: doc });
  }

  // ── 列表 ──
  const filter = {};
  if (subject) {
    if (!SUBJECTS.includes(subject)) {
      return res.status(400).json({ success: false, message: 'Invalid subject' });
    }
    filter.subject = subject;
  }
  if (chapter !== undefined && chapter !== '') {
    const c = Number(chapter);
    if (Number.isFinite(c)) filter.chapter = c;
  }

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));

  const [total, items, chapterAgg] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter, { projection: { _id: 0 } })
      .sort({ chapter: 1, id: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .toArray(),
    // 該科目下的所有 chapter 值
    subject
      ? col.distinct('chapter', { subject })
      : Promise.resolve([]),
  ]);

  return res.status(200).json({
    success: true,
    items,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
    chapters: chapterAgg.filter(c => Number.isFinite(c)).sort((a, b) => a - b),
  });
}