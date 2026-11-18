// api/reports.js —— 学生反馈 / 报告
//
// 学生写一段文字，可以附最多 2 张图，管理员在 /admin/webreports 看。
// 图片走和试卷批改同一条 Cloudinary 通道，不额外引入上传服务。
//
// action=create  学生提交
// action=mine    学生看自己提交过的
// action=list    管理员看全部
// action=handle  管理员标记已处理

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { auditLog } from '../lib/audit.js';
import crypto from 'crypto';

const MAX_BODY = 4000;
// 现在是 2；以后放宽只改这个数字，前端按它渲染上传位
const MAX_IMAGES = 2;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function genId() {
  return 'RPT' + crypto.randomBytes(6).toString('hex');
}

function isAdminUser(u) {
  return u && (u.role === 'admin' || u.role === 'root');
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });
  req.user = { username: decoded.username, role: decoded.role };

  const db = await connectToDatabase();
  const action = req.query.action || 'create';

  // ── 学生提交 ──────────────────────────────────────────
  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

    const body = String((req.body && req.body.body) || '').trim();
    const rawImages = Array.isArray(req.body && req.body.images) ? req.body.images : [];

    if (!body) return res.status(400).json({ success: false, message: 'Please describe the problem.' });
    if (body.length > MAX_BODY) return res.status(400).json({ success: false, message: 'Message too long (max ' + MAX_BODY + ').' });
    if (rawImages.length > MAX_IMAGES) {
      return res.status(400).json({ success: false, message: 'At most ' + MAX_IMAGES + ' images.' });
    }

    // 图片：只接受 data:image/... ，逐个上传，任一失败就整体失败（不留半成品）
    const urls = [];
    if (rawImages.length) {
      let uploadImage;
      try {
        ({ uploadImage } = await import('../lib/cloudinary.js'));
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Image service unavailable.' });
      }
      for (const img of rawImages) {
        const s = String(img || '');
        if (!s.startsWith('data:image/')) {
          return res.status(400).json({ success: false, message: 'Invalid image data.' });
        }
        if (s.length > MAX_IMAGE_BYTES) {
          return res.status(400).json({ success: false, message: 'Image too large.' });
        }
        try {
          urls.push(await uploadImage(s));
        } catch (e) {
          return res.status(500).json({ success: false, message: 'Image upload failed.' });
        }
      }
    }

    const doc = {
      id: genId(),
      username: req.user.username,
      body,
      images: urls,
      status: 'open',
      createdAt: new Date(),
    };
    await db.collection('web_reports').insertOne(doc);

    auditLog(db, 'web_report_create', { id: doc.id, images: urls.length }, req.user.username, 'info').catch(() => {});

    return res.status(200).json({ success: true, id: doc.id });
  }

  // ── 学生看自己 ────────────────────────────────────────
  if (action === 'mine') {
    if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
    const rows = await db.collection('web_reports')
      .find({ username: req.user.username })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
    return res.status(200).json({ success: true, items: rows.map(publicRow) });
  }

  // 以下都要管理员
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  // ── 管理员列表 ────────────────────────────────────────
  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ success: false, message: 'Method not allowed' });
    const onlyOpen = req.query.status === 'open';
    const filter = onlyOpen ? { status: 'open' } : {};
    const rows = await db.collection('web_reports')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    return res.status(200).json({ success: true, items: rows.map(publicRow) });
  }

  // ── 标记已处理 ────────────────────────────────────────
  if (action === 'handle') {
    if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });
    const id = String((req.body && req.body.id) || '').trim();
    const handled = !(req.body && req.body.reopen);
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    const r = await db.collection('web_reports').updateOne(
      { id },
      {
        $set: {
          status: handled ? 'handled' : 'open',
          handledAt: handled ? new Date() : null,
          handledBy: handled ? req.user.username : null,
        },
      }
    );
    if (!r.matchedCount) return res.status(404).json({ success: false, message: 'Report not found' });

    auditLog(db, 'web_report_handle', { id, handled }, req.user.username, 'info').catch(() => {});
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

function publicRow(r) {
  return {
    id: r.id,
    username: r.username,
    body: r.body,
    images: r.images || [],
    status: r.status || 'open',
    createdAt: r.createdAt,
    handledAt: r.handledAt || null,
    handledBy: r.handledBy || null,
  };
}

export default wrapHandler(handler);
