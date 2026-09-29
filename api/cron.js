// api/cron.js
// 只给 Vercel Cron 调用，不走用户认证
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';

export default async function handler(req, res) {
  // ⭐ 1. 验证请求来自 Vercel Cron
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

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}