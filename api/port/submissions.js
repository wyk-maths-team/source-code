// api/port/submissions.js
// GET /api/port/submissions?subject=m2&page=1&limit=30
// GET /api/port/submissions?id=PS-xxx
import { sqlDb } from '../../lib/docStore.js';
import { portAuth } from './_auth.js';
import { wrapHandler } from '../../lib/errors.js';

async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = sqlDb();
  const col = db.collection('port_submissions');

  const { id, subject, page = '1', limit = '30' } = req.query;

  if (id) {
    const doc = await col.findOne(
      { submissionId: String(id), username: decoded.username },
      { projection: { _id: 0 } }
    );
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    return res.status(200).json({ success: true, submission: doc });
  }

  const filter = { username: decoded.username };
  if (subject) filter.subject = subject;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 30));

  const [total, items] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter, { projection: { _id: 0, images: 1, steps: 1, comment: 1, score: 1, maxScore: 1, subject: 1, problemId: 1, submissionId: 1, status: 1, createdAt: 1, gradedAt: 1 } })
      .sort({ createdAt: -1 })
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
    totalPages: Math.ceil(total / limitNum),
  });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);