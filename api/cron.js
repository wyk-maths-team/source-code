// api/cron.js
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { wrapHandler } from '../lib/errors.js';
function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const action = req.query.action;
  const db = await connectToDatabase();

  try {
    if (action === 'dailyBackup') {
      const { uploadJsonFile } = await import('../lib/github-upload.js');

      const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      const dir = `database/${ts}`;

      const collections = await db.listCollections().toArray();
      const results = [];
      for (const { name } of collections) {
        if (name.startsWith('system.')) continue;
        try {
          const docs = await db.collection(name).find({}).toArray();
          const r = await uploadJsonFile(
            `${dir}/${name}.json`,
            { collection: name, count: docs.length, docs },
            { message: `cron backup: ${name} (${docs.length} docs)` }
          );
          results.push({ collection: name, count: docs.length });
        } catch (e) {
          results.push({ collection: name, error: e.message });
        }
      }

      await auditLog(db, 'cron_daily_backup', {
        dir,
        totalCollections: results.length,
        totalDocs: results.reduce((s, r) => s + (r.count || 0), 0),
      }, 'system', 'info').catch(() => {});

      return res.status(200).json({ success: true, dir, results });
    }
    if (action === 'dailyOnlineSnapshot') {
  const { uploadJsonFile } = await import('../lib/github-upload.js');

  // 心跳间隔（跟前端 heartbeat.js 保持一致）
  const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;

  const users = await db.collection('users')
    .find({}, { projection: {
      username: 1, displayName: 1, realName: 1, role: 1,
      heartbeatCount: 1, lastSeenAt: 1, banned: 1,
      _id: 0,
    }})
    .toArray();

  const snapshot = {
    updatedAt: new Date().toISOString(),
    heartbeatMs: HEARTBEAT_MS,
    userCount: users.length,
    users: {},
  };

  for (const u of users) {
    if (u.banned === true) continue;
    if (u.role === 'team') continue;

    const heartbeats = Number(u.heartbeatCount) || 0;
    snapshot.users[u.username] = {
      displayName: u.displayName || u.username,
      realName:    u.realName || '',
      totalMs:     heartbeats * HEARTBEAT_MS,   // ⭐ 累计在线毫秒
      totalHuman:  formatDuration(heartbeats * HEARTBEAT_MS),
      heartbeats,
      lastSeenAt:  u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
    };
  }

  const r = await uploadJsonFile(
    'user/online/timestamp.json',
    snapshot,
    {
      message: `online snapshot: ${new Date().toISOString().slice(0,10)} (${Object.keys(snapshot.users).length} users)`,
      overwrite: true,   // ⭐ 覆盖，不是新增
    }
  );

  await auditLog(db, 'online_snapshot', {
    userCount: Object.keys(snapshot.users).length,
    file: r.path,
  }, 'system', 'info').catch(() => {});

  return res.status(200).json({
    success: true,
    userCount: Object.keys(snapshot.users).length,
    url: r.githubUrl,
  });
}

    if (action === 'adjustDifficulty') {
      const { sweepDifficulties } = await import('../lib/difficulty-sweep.js');

      const summary = await sweepDifficulties(db);

      await auditLog(db, 'cron_adjust_difficulty', {
        total: summary.total,
        adjusted: summary.adjusted,
        skipped: summary.skipped,
      }, 'system', 'info').catch(() => {});

      return res.status(200).json({ success: true, ...summary });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);