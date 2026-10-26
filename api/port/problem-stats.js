// api/port/problem-stats.js
// GET /api/port/problem-stats?subject=m2
// 回傳 { stats: { "M2-001": { status, score, maxScore, submittedAt, attempts } } }
import { connectToDatabase } from '../_db.js';
import { portAuth } from './_auth.js';
import { wrapHandler } from '../../lib/errors.js';

async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { subject } = req.query;
  const db = await connectToDatabase();

  const match = { username: decoded.username };
  if (subject) match.subject = subject;

  const pipeline = [
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$problemId',
        submissionId:  { $first: '$submissionId' },
        status:        { $first: '$status' },
        score:         { $first: '$score' },
        maxScore:      { $first: '$maxScore' },
        submittedAt:   { $first: '$createdAt' },
        attempts:      { $sum: 1 },
      },
    },
  ];

  const results = await db.collection('port_submissions').aggregate(pipeline).toArray();

  const stats = {};
  for (const r of results) {
    stats[r._id] = {
      submissionId: r.submissionId,
      status: r.status,
      score: r.score,
      maxScore: r.maxScore,
      submittedAt: r.submittedAt,
      attempts: r.attempts,
    };
  }

  return res.status(200).json({ success: true, stats });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);