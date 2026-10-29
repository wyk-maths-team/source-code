// api/igemreport.js
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { sqlDb } from '../lib/docStore.js';
import { wrapHandler } from '../lib/errors.js';

const FOLDER = 'static/reports/doc';
const MAX_BYTES = 25 * 1024 * 1024;
const RATE_MAX_PER_HOUR = 200;

const _counts = new Map();
function checkUploadRate(user) {
  const now = Date.now();
  const rec = _counts.get(user);
  if (!rec || now > rec.resetAt) {
    _counts.set(user, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (rec.count >= RATE_MAX_PER_HOUR) return false;
  rec.count++;
  return true;
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  // ═══════════════ LIST ═══════════════
  if (req.method === 'GET') {
    try {
      const { listFilesInFolder } = await import('../lib/github-upload.js');
      const names = await listFilesInFolder(FOLDER);

      const owner  = process.env.GITHUB_IMAGES_OWNER  || process.env.GITHUB_OWNER;
      const repo   = process.env.GITHUB_IMAGES_REPO   || process.env.GITHUB_REPO;
      const branch = process.env.GITHUB_IMAGES_BRANCH || process.env.GITHUB_BRANCH || 'main';
      const base = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${FOLDER}/`;

      const files = names
        .map(name => {
          const parts = name.split('_');
          return {
            name,
            url: base + encodeURIComponent(name).replace(/%2F/g, '/'),
            uploadedAt: Number(parts[0]) || 0,
            uploadedBy: (parts[1] || '').replace(/_/g, ' '),
            displayName: parts.slice(2).join('_') || name,
          };
        })
        .sort((a, b) => b.uploadedAt - a.uploadedAt);

      // ⭐ 加载已解决状态
      try {
        const db = sqlDb();
        const allNames = files.map(f => f.name);
        const metas = await db.collection('igem_reports')
          .find({ filename: { $in: allNames } })
          .toArray();
        const metaMap = Object.fromEntries(metas.map(m => [m.filename, m]));
        for (const f of files) {
          const m = metaMap[f.name];
          f.resolved = !!(m && m.resolved);
          f.resolvedBy = (m && m.resolvedBy) || '';
          f.resolvedAt = (m && m.resolvedAt) || null;
        }
      } catch (e) {
        console.warn('[igemreport] load resolved state failed:', e.message);
        for (const f of files) f.resolved = false;
      }

      res.setHeader('Cache-Control', 'private, max-age=15');
      return res.status(200).json({ success: true, files, count: files.length });
    } catch (err) {
      console.error('[igemreport] list failed:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ═══════════════ UPLOAD ═══════════════
  if (req.method === 'POST') {
    const { filename, dataUrl } = req.body || {};
    if (!filename || !dataUrl) {
      return res.status(400).json({ success: false, message: 'Missing filename or dataUrl' });
    }
    if (!checkUploadRate(decoded.username)) {
      return res.status(429).json({ success: false, message: 'Hourly limit reached (200/hr)' });
    }

    const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!m) return res.status(400).json({ success: false, message: 'Invalid data URL' });
    const mime = m[1];
    const base64 = m[2];
    const bytes = Math.floor(base64.length * 3 / 4);

    if (bytes > MAX_BYTES) {
      return res.status(413).json({
        success: false,
        message: `File too large (${(bytes / 1024 / 1024).toFixed(1)} MB, max ${MAX_BYTES / 1024 / 1024} MB)`,
      });
    }

    const ts = Date.now();
    const userSafe = String(decoded.username).replace(/[^A-Za-z0-9_-]/g, '_');
    const origExt = (String(filename).match(/\.([A-Za-z0-9]{1,10})$/) || [,''])[1].toLowerCase();
    const origBase = String(filename).replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'file';
    const finalName = `${ts}_${userSafe}_${origBase}${origExt ? '.' + origExt : ''}`;

    try {
      const { uploadAnyFile } = await import('../lib/github-upload.js');
      const r = await uploadAnyFile(base64, { folder: FOLDER, filename: finalName });

      // ⭐ 初始化 DB 记录
      try {
        const db = sqlDb();
        await db.collection('igem_reports').updateOne(
          { filename: finalName },
          {
            $setOnInsert: {
              filename: finalName,
              resolved: false,
              createdAt: new Date(),
              createdBy: decoded.username,
            },
          },
          { upsert: true }
        );
      } catch (e) {
        console.warn('[igemreport] init db failed:', e.message);
      }

      // 审计（异步）
      const igemDb = sqlDb();
      auditLog(igemDb, 'igem_report_upload', {
        filename: finalName, size: bytes, mime,
      }, decoded.username, 'info').catch(() => {});

      return res.status(200).json({
        success: true,
        file: {
          name: finalName,
          url: r.url,
          size: bytes,
          mime,
          uploadedAt: ts,
          uploadedBy: userSafe,
          displayName: filename,
          resolved: false,
        },
      });
    } catch (err) {
      console.error('[igemreport] upload failed:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ═══════════════ TOGGLE RESOLVED ═══════════════
  if (req.method === 'PUT') {
    const { filename, resolved } = req.body || {};
    if (!filename || typeof resolved !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Missing filename or resolved' });
    }

    try {
      const db = sqlDb();
      await db.collection('igem_reports').updateOne(
        { filename },
        {
          $set: {
            resolved,
            resolvedBy: decoded.username,
            resolvedAt: resolved ? new Date() : null,
          },
          $setOnInsert: { filename, createdAt: new Date() },
        },
        { upsert: true }
      );
      return res.status(200).json({ success: true, filename, resolved });
    } catch (err) {
      console.error('[igemreport] toggle failed:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);