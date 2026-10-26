// api/port/stats.js
// GET /api/port/stats?subject=m2
import { connectToDatabase } from '../_db.js';
import { portAuth } from './_auth.js';
import { wrapHandler } from '../../lib/errors.js';

async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const db = await connectToDatabase();
  const { subject } = req.query;

  const filter = { username: decoded.username };
  if (subject) filter.subject = subject;

  const stats = await db.collection('port_userstats')
    .find(filter, { projection: { _id: 0 } })
    .toArray();

  // 每個科目計算 passed / failed / total
  const summary = {};
  for (const s of stats) {
    const states = s.states || {};
    const passed = Object.values(states).filter(v => v === 'passed').length;
    const failed = Object.values(states).filter(v => v === 'failed').length;
    summary[s.subject] = { passed, failed, states };
  }

  return res.status(200).json({ success: true, summary });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);