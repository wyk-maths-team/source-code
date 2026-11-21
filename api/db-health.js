// api/db-health.js
//
// 连接池与并发闸门的运行时快照。
//
// 之所以要这个端点：连接池问题在 Vercel 上是**看不见**的 ——
// 每个实例各有一份池，日志里只有零散的 500。有了它，
// e2e 并发测试可以直接断言「clientsCreated 是不是恒等于 1」。
//
// 不参与并发闸门（gate: false）：服务器正忙的时候，
// 恰恰是最需要看这个端点的时候，它自己不能被 503 挡在门外。
//
// 也不查库：角色判定只解析 JWT，不为了一次健康检查去占连接。

import jwt from 'jsonwebtoken';
import { metricsSnapshot, resetMetrics } from '../lib/mongo.js';
import { ensureIndexes } from '../lib/indexes.js';
import { connectToDatabase } from './_db.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

function roleOf(req) {
  try {
    const raw = (req.headers && req.headers.authorization) || '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token || !process.env.JWT_SECRET) return null;
    const d = jwt.verify(token, process.env.JWT_SECRET);
    return d && d.role ? d.role : null;
  } catch {
    return null;
  }
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const role = roleOf(req);
  const privileged = role === 'admin' || role === 'root';

  if (req.method === 'POST' && req.query.action === 'reset') {
    if (!privileged) return res.status(403).json({ success: false, message: 'Admin only' });
    resetMetrics();
    return res.status(200).json({ success: true, message: 'Counters reset' });
  }

  // 部署后建索引：不用带本地 CLI 上来，admin 打一下就走幂等流程。
  if (req.method === 'POST' && req.query.action === 'indexes') {
    if (!privileged) return res.status(403).json({ success: false, message: 'Admin only' });
    const db = await connectToDatabase();
    const report = await ensureIndexes(db);
    return res.status(200).json({
      success: true,
      created: report.filter(r => r.created).map(r => ({ collection: r.collection, keys: r.keys })),
      skipped: report.filter(r => !r.created).map(r => ({ collection: r.collection, keys: r.keys })),
    });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const m = metricsSnapshot();

  const body = {
    success: true,
    healthy: m.clientsCreated <= 1,
    // 每个实例应当恰好创建一个 client。大于 1 说明有地方绕过了 lib/mongo.js
    clientsCreated: m.clientsCreated,
    connectAttempts: m.connectAttempts,
    connectFailures: m.connectFailures,
    retries: m.connectRetries,
    gate: m.gate,
    pool: m.pool,
    uptimeMs: m.uptimeMs,
    warnings: m.gateRejected > 0
      ? [`${m.gateRejected} request(s) rejected by the concurrency gate`]
      : [],
  };

  if (privileged) {
    body.driver = m.driver;          // 驱动内部每台服务器的连接明细
    body.lastError = m.lastError;
    body.lastErrorAt = m.lastErrorAt;
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(body);
}

export default wrapHandler(handler, { gate: false });
