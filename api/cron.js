// api/cron.js
import { sqlDb } from '../lib/docStore.js';
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
  const db = sqlDb();

  try {
    // ─────────────────────────────────────────────────────────────
    // 全量备份 → GitHub Releases（替代原来的「逐文件 commit 到 repo」）
    //   · PostgreSQL：题目域（problems / tags / problem_tags / app_settings）
    //   · MongoDB   ：其余所有集合（users / submissions / userstats / ...）
    //
    // 为什么换：Contents API 每传一个文件就是一次 commit，几十个集合会把
    // 仓库历史刷爆。Release asset 不进提交历史，也能按 tag 找到某天的快照。
    //
    // 最终目标是全 SQL，届时 postgres 分支覆盖全部表、mongo 分支消失。
    // ─────────────────────────────────────────────────────────────
    if (action === 'dailyBackup') {
      const { publishBackupParts } = await import('../lib/github-release.js');
      const { getPgPool } = await import('./_pg.js');
      const { todayHK } = await import('../lib/time.js');

      const startedAt = Date.now();
      const dateStr = todayHK();
      const tag = 'backup-' + dateStr + '-' + String(startedAt).slice(-6);

      const items = [];
      const stats = [];

      // ① PostgreSQL：题目域
      const PG_TABLES = [
        'problems', 'tags', 'problem_tags', 'app_settings',
        'users', 'user_tokens', 'user_stats', 'user_achievements',
        'user_problem_status', 'user_ratings', 'user_favorites', 'user_preferences',
        'submissions',
      ];
      try {
        const pool = getPgPool();
        for (const table of PG_TABLES) {
          // 表名来自白名单常量，不是用户输入 —— 可以安全拼接
          const q = await pool.query('SELECT * FROM ' + table);
          items.push({ name: 'pg.' + table, source: 'postgres', data: q.rows });
          stats.push({ source: 'postgres', collection: table, count: q.rowCount });
        }
      } catch (e) {
        // PostgreSQL 不可用时至少把 MongoDB 那半边备下来
        stats.push({ source: 'postgres', collection: '*', error: e.message });
      }

      // ② MongoDB：其余集合（problems 已迁走，跳过，免得备份出一份过期副本）
      const SKIP = new Set(['problems']);
      const collections = await db.listCollections().toArray();
      for (const { name } of collections) {
        if (name.startsWith('system.') || SKIP.has(name)) continue;
        try {
          const docs = await db.collection(name).find({}).toArray();
          items.push({ name: 'mongo.' + name, source: 'mongo', data: docs });
          stats.push({ source: 'mongo', collection: name, count: docs.length });
        } catch (e) {
          stats.push({ source: 'mongo', collection: name, error: e.message });
        }
      }

      const bodyLines = [
        '自动备份 ' + new Date().toISOString() + '（Asia/Hong_Kong 日期 ' + dateStr + '）',
        '',
        'PostgreSQL：' + PG_TABLES.join(', '),
        'MongoDB：其余集合',
        '',
      ];
      for (const s of stats) {
        bodyLines.push('- ' + s.collection + '（' + s.source + '）：' +
          (s.error ? 'ERROR ' + s.error : s.count + ' 条'));
      }

      const result = await publishBackupParts({
        tag,
        name: 'Database backup ' + dateStr,
        body: bodyLines.join('\n'),
        items,
      });

      const totalRows = stats.reduce((s, x) => s + (x.count || 0), 0);
      await auditLog(db, 'cron_daily_backup', {
        tag: result.tag,
        assets: result.assets.map(a => a.name),
        totalRows,
        durationMs: Date.now() - startedAt,
      }, 'system', 'info').catch(() => {});

      return res.status(200).json({
        success: true,
        ...result,
        totalRows,
        durationMs: Date.now() - startedAt,
        stats,
      });
    }

    if (action === 'dailyOnlineSnapshot') {
  const { uploadJsonFile } = await import('../lib/github-upload.js');

  // 心跳间隔（跟前端 heartbeat.js 保持一致）
  const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;

  // ⭐ 账号与心跳在 PostgreSQL
  const { listUsersOnline } = await import('../lib/userStore.js');
  const users = await listUsersOnline();

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

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);