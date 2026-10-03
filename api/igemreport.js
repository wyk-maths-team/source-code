// api/igemreport.js
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { connectToDatabase } from './_db.js';

const FOLDER = 'static/reports/doc';
const MAX_BYTES = 25 * 1024 * 1024;      // 25 MB
const RATE_MAX_PER_HOUR = 200;            // 每用户每小时

// 进程内计数（Vercel 多实例会各自计数，但够用）
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

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  // ═══ LIST ═══
  if (req.method === 'GET') {
    try {
      const { listFilesInFolder } = await import('../lib/github-upload.js');
      const names = await listFilesInFolder(FOLDER);

      const owner  = process.env.GITHUB_IMAGES_OWNER  || process.env.GITHUB_OWNER;
      const repo   = process.env.GITHUB_IMAGES_REPO   || process.env.GITHUB_REPO;
      const branch = process.env.GITHUB_IMAGES_BRANCH || process.env.GITHUB_BRANCH || 'main';
      const base = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${FOLDER}/`;

      const files = names
        .map(name => ({
          name,
          url: base + encodeURIComponent(name).replace(/%2F/g, '/'),
          // 时间戳前缀：{ts}_{user}_{name}
          uploadedAt: Number(name.split('_')[0]) || 0,
          uploadedBy: (name.split('_')[1] || '').replace(/_/g, ' '),
          displayName: name.split('_').slice(2).join('_'),
        }))
        .sort((a, b) => b.uploadedAt - a.uploadedAt);

      res.setHeader('Cache-Control', 'private, max-age=30');
      return res.status(200).json({ success: true, files, count: files.length });
    } catch (err) {
      console.error('[igemreport] list failed:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ═══ UPLOAD ═══
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

    // 生成安全文件名：{ts}_{user}_{原名}
    const ts = Date.now();
    const userSafe = String(decoded.username).replace(/[^A-Za-z0-9_-]/g, '_');
    const origExt = (String(filename).match(/\.([A-Za-z0-9]{1,10})$/) || [,''])[1].toLowerCase();
    const origBase = String(filename).replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'file';
    const finalName = `${ts}_${userSafe}_${origBase}${origExt ? '.' + origExt : ''}`;

    try {
      const { uploadAnyFile } = await import('../lib/github-upload.js');
      const r = await uploadAnyFile(base64, { folder: FOLDER, filename: finalName });

      // 审计（异步，不阻塞响应）
      connectToDatabase()
        .then(db => auditLog(db, 'igem_report_upload', {
          filename: finalName, size: bytes, mime,
        }, decoded.username, 'info'))
        .catch(() => {});

      return res.status(200).json({
        success: true,
        file: {
          name: finalName,
          url: r.url,
          size: bytes,
          mime,
          uploadedAt: ts,
          uploadedBy: userSafe,
        },
      });
    } catch (err) {
      console.error('[igemreport] upload failed:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}