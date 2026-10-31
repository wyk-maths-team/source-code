// api/cron.js
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { wrapHandler } from '../lib/errors.js';
import zlib from 'zlib';

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
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET not configured' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

  const action = req.query.action;
  const db = await connectToDatabase();

  try {
    if (action === 'dailyBackup') {
      // ⭐ 读取 GitHub 环境变量
      const token = process.env.GITHUB_BACKUP_TOKEN || process.env.GITHUB_IMAGES_TOKEN || process.env.GITHUB_TOKEN;
      const owner = process.env.GITHUB_BACKUP_OWNER || process.env.GITHUB_IMAGES_OWNER || process.env.GITHUB_OWNER;
      const repo = process.env.GITHUB_BACKUP_REPO || 'backup';

      if (!token || !owner || !repo) throw new Error('GitHub backup credentials missing');

      const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      const tagName = `backup-${ts}`;

      // 1. 创建 Release
      const releaseRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tag_name: tagName,
          name: `DB Backup ${ts}`,
          body: 'Automated daily database backup.',
          draft: false,
          prerelease: true
        })
      });
      
      if (!releaseRes.ok) {
        const errText = await releaseRes.text();
        throw new Error(`Failed to create release: ${releaseRes.status} ${errText}`);
      }
      const releaseData = await releaseRes.json();

      // 2. 遍历上传
      const collections = await db.listCollections().toArray();
      const results = [];
      
      for (const { name } of collections) {
        if (name.startsWith('system.')) continue;
        try {
          const docs = await db.collection(name).find({}).toArray();
          
          // ⭐ 核心：转成 JSON 并压缩（gzip）
          const rawJson = JSON.stringify({ collection: name, count: docs.length, docs });
          const compressed = zlib.gzipSync(rawJson);
          
          // 上传 Asset 到当前 Release
          const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseData.id}/assets?name=${name}.json.gz`;
          
          const uploadRes = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Accept': 'application/vnd.github+json',
              'Content-Type': 'application/gzip', // 声明 gzip
              'Content-Length': compressed.length.toString()
            },
            body: compressed
          });

          if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
          
          results.push({ collection: name, count: docs.length, size: compressed.length });
        } catch (e) {
          results.push({ collection: name, error: e.message });
        }
      }

      await auditLog(db, 'cron_daily_backup', {
        release: tagName,
        totalCollections: results.length,
        totalDocs: results.reduce((s, r) => s + (r.count || 0), 0),
      }, 'system', 'info').catch(() => {});

      return res.status(200).json({ success: true, release: tagName, results });
    }

    // dailyOnlineSnapshot 逻辑不变...
    if (action === 'dailyOnlineSnapshot') {
      const { uploadJsonFile } = await import('../lib/github-upload.js');
      const HEARTBEAT_MS = Number(process.env.ONLINE_HEARTBEAT_MS) || 5 * 60 * 1000;
      const users = await db.collection('users').find({}, { projection: { username: 1, displayName: 1, realName: 1, role: 1, heartbeatCount: 1, lastSeenAt: 1, banned: 1, _id: 0 } }).toArray();
      const snapshot = { updatedAt: new Date().toISOString(), heartbeatMs: HEARTBEAT_MS, userCount: users.length, users: {} };
      
      for (const u of users) {
        if (u.banned === true || u.role === 'team') continue;
        const heartbeats = Number(u.heartbeatCount) || 0;
        snapshot.users[u.username] = {
          displayName: u.displayName || u.username,
          realName: u.realName || '',
          totalMs: heartbeats * HEARTBEAT_MS,
          totalHuman: formatDuration(heartbeats * HEARTBEAT_MS),
          heartbeats,
          lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
        };
      }
      const r = await uploadJsonFile('user/online/timestamp.json', snapshot, { message: `online snapshot`, overwrite: true });
      await auditLog(db, 'online_snapshot', { userCount: Object.keys(snapshot.users).length, file: r.path }, 'system', 'info').catch(() => {});
      return res.status(200).json({ success: true, userCount: Object.keys(snapshot.users).length, url: r.githubUrl });
    }

    // ── 题解点赞结算：每个赞给作者 +1,000 token，每天一次 ──
    if (action === 'settleSolutionLikes') {
      const LIKE_REWARD = 1000;
      const col = db.collection('solutionLikes');
      const pending = await col.find({ settled: { $ne: true } }).limit(5000).toArray();

      if (!pending.length) {
        return res.status(200).json({ success: true, likes: 0, authors: 0, paid: 0 });
      }

      const byAuthor = new Map();
      for (const l of pending) {
        if (!l.author) continue;
        byAuthor.set(l.author, (byAuthor.get(l.author) || 0) + 1);
      }

      let paid = 0;
      for (const [author, count] of byAuthor) {
        const amount = count * LIKE_REWARD;
        const r = await db.collection('users').updateOne(
          { username: author },
          { $inc: { 'token.global': amount } }
        );
        if (r.matchedCount) paid += amount;
      }

      await col.updateMany(
        { _id: { $in: pending.map((l) => l._id) } },
        { $set: { settled: true, settledAt: new Date() } }
      );

      await auditLog(db, 'settle_solution_likes', {
        likes: pending.length, authors: byAuthor.size, paid,
      }, 'system', 'info').catch(() => {});

      return res.status(200).json({ success: true, likes: pending.length, authors: byAuthor.size, paid });
    }

    // ── 每日 token 快照（财富榜的周/月/日榜靠它算增量）──
    if (action === 'snapshotTokens') {
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const users = await db.collection('users').find(
        {},
        { projection: { username: 1, token: 1 } }
      ).toArray();

      const ops = users
        .filter((u) => u.username && !/^\d+$/.test(u.username))
        .map((u) => ({
          updateOne: {
            filter: { _id: today + ':' + u.username },
            update: {
              $set: {
                date: today,
                username: u.username,
                total: (Number(u.token?.daily) || 0) + (Number(u.token?.global) || 0),
                at: new Date(),
              },
            },
            upsert: true,
          },
        }));

      let written = 0;
      for (let i = 0; i < ops.length; i += 500) {
        const r = await db.collection('tokenHistory').bulkWrite(ops.slice(i, i + 500), { ordered: false });
        written += (r.upsertedCount || 0) + (r.modifiedCount || 0);
      }

      await auditLog(db, 'snapshot_tokens', { date: today, users: ops.length, written }, 'system', 'info').catch(() => {});
      return res.status(200).json({ success: true, date: today, users: ops.length, written });
    }

    // ── 每日 rating 快照（rating 周/月/日榜靠它算提升）──
    if (action === 'snapshotRatings') {
      const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
      const stats = await db.collection('userstats').find(
        { rating: { $ne: null } },
        { projection: { username: 1, rating: 1 } }
      ).toArray();

      const ops = stats
        .filter((s) => s.username && !/^\d+$/.test(s.username) && Number.isFinite(Number(s.rating)))
        .map((s) => ({
          updateOne: {
            filter: { _id: today + ':' + s.username },
            update: {
              $set: {
                date: today,
                username: s.username,
                rating: Number(s.rating),
                at: new Date(),
              },
            },
            upsert: true,
          },
        }));

      let written = 0;
      for (let i = 0; i < ops.length; i += 500) {
        const r = await db.collection('ratingHistory').bulkWrite(ops.slice(i, i + 500), { ordered: false });
        written += (r.upsertedCount || 0) + (r.modifiedCount || 0);
      }

      await auditLog(db, 'snapshot_ratings', { date: today, users: ops.length, written }, 'system', 'info').catch(() => {});
      return res.status(200).json({ success: true, date: today, users: ops.length, written });
    }

    if (action === 'adjustDifficulty') {
      const { sweepDifficulties } = await import('../lib/difficulty-sweep.js');
      const summary = await sweepDifficulties(db);
      await auditLog(db, 'cron_adjust_difficulty', { total: summary.total, adjusted: summary.adjusted, skipped: summary.skipped }, 'system', 'info').catch(() => {});
      return res.status(200).json({ success: true, ...summary });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

export const config = { maxDuration: 600 }; // Release 上传可能较慢，延长超时
export default wrapHandler(handler);