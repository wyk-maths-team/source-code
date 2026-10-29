// api/port/problem-stats.js
// GET /api/port/problem-stats?subject=m2
// 回傳 { stats: { "M2-001": { status, score, maxScore, submittedAt, attempts } } }
import { sqlDb } from '../../lib/docStore.js';
import { portAuth } from './_auth.js';
import { wrapHandler } from '../../lib/errors.js';

async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { subject } = req.query;
  const db = sqlDb();

  const match = { username: decoded.username };
  if (subject) match.subject = subject;

  // 每个 (用户, 题目) 取最新一条 + 尝试次数（原来是一条 Mongo 聚合）
  const docs = await db.collection('port_submissions')
    .find(match).sort({ createdAt: -1 }).toArray();

  const stats = {};
  for (const d of docs) {
    const key = d.problemId;
    if (!stats[key]) {
      stats[key] = {
        submissionId: d.submissionId,
        status: d.status,
        score: d.score,
        maxScore: d.maxScore,
        submittedAt: d.createdAt,
        attempts: 1,
      };
    } else {
      stats[key].attempts++;
    }
  }

  return res.status(200).json({ success: true, stats });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);