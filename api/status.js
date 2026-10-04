// api/status.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

const action = req.query.action || (req.body && req.body.action);

// ── 無 action 或 action=system：原有系統狀態 ──
if (!action || action === 'system') {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return systemStatus(req, res);
}

// ⭐ Vercel 用量
if (action === 'vercel') {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return vercelUsage(req, res);
}

  // ── OS 集成路由 ──
  try {
    return await handleOsAction(action, req, res, decoded);
  } catch (err) {
    console.error('OS action error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Internal error' });
  }
}

/* ============================================================
 * 原有系統狀態
 * ============================================================ */
async function systemStatus(req, res) {
  try {
    const db = await connectToDatabase();
    const stats = await db.stats();

    const allCollections = await db.listCollections().toArray();
    const collectionStats = [];

    for (const col of allCollections) {
      try {
        const colStats = await db.collection(col.name).stats();
        collectionStats.push({
          name: col.name,
          documentCount: colStats.count,
          storageSizeMB: (colStats.storageSize / 1024 / 1024).toFixed(2),
          avgObjSize: (colStats.avgObjSize || 0).toFixed(2)
        });
      } catch (e) {
        collectionStats.push({
          name: col.name,
          documentCount: 'N/A (view)',
          storageSizeMB: 'N/A',
          avgObjSize: 'N/A'
        });
      }
    }

    const dbSizeMB    = (stats.storageSize / 1024 / 1024).toFixed(2);
    const dataSizeMB  = (stats.dataSize    / 1024 / 1024).toFixed(2);
    const indexSizeMB = (stats.indexSize   / 1024 / 1024).toFixed(2);
    const quotaMB     = 512;
    const freeMB      = (quotaMB - parseFloat(dbSizeMB)).toFixed(2);

    let cloudinary = null;
    try {
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey    = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;

      if (cloudName && apiKey && apiSecret) {
        const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/usage`, {
          headers: { Authorization: `Basic ${auth}` }
        });

        if (!response.ok) {
          const errText = await response.text();
          cloudinary = { error: true, message: `HTTP ${response.status}: ${errText}` };
        } else {
          const usageData = await response.json();
          const toMB = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
          cloudinary = {
            plan: usageData.plan,
            usedMB: toMB(usageData.credits_usage).toFixed(2),
            limitMB: toMB(usageData.credits_limit).toFixed(2),
            storageUsedMB: toMB(usageData.resources).toFixed(2),
            bandwidthUsedMB: toMB(usageData.bandwidth).toFixed(2)
          };
        }
      } else {
        cloudinary = { error: true, message: 'Missing Cloudinary environment variables' };
      }
    } catch (err) {
      cloudinary = { error: true, message: err.message };
    }

    return res.status(200).json({
      success: true,
      dbSizeMB, dataSizeMB, indexSizeMB, freeMB,
      collections: collectionStats,
      serverTime: new Date().toISOString(),
      cloudinary,
      note: 'Vercel serverless platform; real-time load data unavailable.'
    });
  } catch (err) {
    console.error('Status API error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
/* ============================================================
 * Vercel Usage（Pro 用量）
 * ============================================================ */
/* ============================================================
 * Vercel Usage —— 走 /v1/billing/charges (FOCUS v1.3, JSONL)
 * ============================================================ */
const _vercelCache = { data: null, expireAt: 0 };
const VERCEL_CACHE_TTL = 60_000;

async function vercelUsage(req, res) {
  const token  = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !teamId) {
    return res.status(200).json({
      success: false,
      message: 'VERCEL_TOKEN / VERCEL_TEAM_ID not configured',
    });
  }

  // 缓存
  if (_vercelCache.data && _vercelCache.expireAt > Date.now()) {
    return res.status(200).json({ success: true, ..._vercelCache.data, cached: true });
  }

  try {
const nowMs  = Date.now();
const fromMs = nowMs - 30 * 86400_000;
const fromIso = new Date(fromMs).toISOString();
const toIso   = new Date(nowMs).toISOString();

const url = `https://api.vercel.com/v1/billing/charges` +
  `?teamId=${encodeURIComponent(teamId)}` +
  `&from=${encodeURIComponent(fromIso)}` +
  `&to=${encodeURIComponent(toIso)}`;

    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'gzip',
      },
    });

    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(200).json({
        success: false,
        message: `Vercel API ${r.status}: ${text.slice(0, 300)}`,
      });
    }

    // ⭐ 响应是 JSONL（每行一个 JSON），不是普通 JSON
    const text = await r.text();
    const lines = text.split('\n').filter(l => l.trim());
    const entries = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch (e) { /* 跳过坏行 */ }
    }

    // ⭐ 按 ServiceName + SkuId 聚合
    // ⭐ 按 ServiceName 聚合（忽略 SkuId / 日期）
    const grouped = new Map();
    for (const e of entries) {
      const serviceName = e.ServiceName || 'Unknown';
      const category    = e.ServiceCategory || '';
      const key = `${serviceName}::${category}`;

      const cost  = Number(e.EffectiveCost ?? e.BilledCost ?? 0) || 0;
      const usage = Number(e.ConsumedQuantity ?? e.PricingQuantity ?? 0) || 0;
      const unit  = e.ConsumedUnit || e.PricingUnit || '';

      if (!grouped.has(key)) {
        grouped.set(key, { serviceName, category, cost: 0, usage: 0, unit });
      }
      const g = grouped.get(key);
      g.cost  += cost;
      g.usage += usage;
      if (!g.unit && unit) g.unit = unit;
    }

    // ⭐ 过滤：cost=0 且 usage=0 的丢弃（9996 条里 90% 是这些）
    const metrics = [...grouped.values()]
      .filter(g => Math.abs(g.cost) > 1e-6 || Math.abs(g.usage) > 1e-6)
      .map(g => ({
        key: g.serviceName,
        label: g.serviceName,
        category: g.category,
        unit: mapVercelUnit(g.unit),
        rawUnit: g.unit,
        usage: g.usage,
        limit: null,
        cost: g.cost,
      }))
      .sort((a, b) => (b.cost || 0) - (a.cost || 0) || (b.usage || 0) - (a.usage || 0));

    // ⭐ 汇总
    const totalCost = metrics.reduce((s, m) => s + (m.cost || 0), 0);

    // 调试用：全部聚合后的 key 列表（包括零值）
    const allServiceNames = [...grouped.values()]
      .map(g => `${g.serviceName} [${g.category}] = ${g.usage} ${g.unit} / $${g.cost.toFixed(4)}`)
      .sort();
    const payload = {
      from: fromIso,
      to:   toIso,
      metrics,
      totalCost,
      entryCount: entries.length,
      allServiceNames,   // ⭐ 完整列表，不管有没有值
    };
    _vercelCache.data = payload;
    _vercelCache.expireAt = Date.now() + VERCEL_CACHE_TTL;

    return res.status(200).json({ success: true, ...payload });
  } catch (err) {
    console.error('[vercel usage]', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function mapVercelUnit(unit) {
  if (!unit) return 'count';
  const u = String(unit).toLowerCase().trim();

  // 时间
  if (u.startsWith('millisecond') || u === 'ms') return 'ms';
  if (u.startsWith('second') || u === 's')       return 'sec';
  if (u.startsWith('minute') || u === 'min')     return 'min';
  if (u.startsWith('hour') || u === 'hr')        return 'hr';

  // 存储
  if (u === 'byte' || u === 'bytes')             return 'bytes';
  if (u.startsWith('kilobyte') || u === 'kb')    return 'kb';
  if (u.startsWith('megabyte') || u === 'mb')    return 'mb';
  if (u === 'gigabyte' || u === 'gigabytes' || u === 'gb') return 'gb';
  if (u.includes('gigabyte-hour') || u === 'gb-hour' || u === 'gbhr') return 'gbhr';
  if (u.includes('gigabyte-month'))              return 'gbmonth';

  // 金额
  if (u === 'usd')                               return 'usd';

  // 计数（Events / Requests / Invocations / Operations / Seats / Projects / ...）
  return 'count';
}
/* ============================================================
 * OS 集成路由
 * ============================================================ */
async function handleOsAction(action, req, res, decoded) {
  const db = await connectToDatabase();
  const username = decoded.username;

  switch (action) {

    // ── 認證 ──
    case 'os.whoami':
      return res.status(200).json({
        success: true,
        user: {
          username,
          role: decoded.role,
          displayName: decoded.displayName || username,
        }
      });

    case 'os.ping':
      return res.status(200).json({ success: true, pong: Date.now() });

    // ── 壁紙 ──
    case 'os.getWallpaper': {
      const doc = await db.collection('userdata').findOne({ username });
      return res.status(200).json({ success: true, url: doc?.wallpaper || '' });
    }

    case 'os.uploadWallpaper': {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { image } = req.body || {};
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ success: false, message: 'Missing image data' });
      }

      // 粗略大小檢查（base64 解碼後 <= 2MB）
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const approxBytes = Math.floor(base64Data.length * 3 / 4);
      if (approxBytes > 2 * 1024 * 1024) {
        return res.status(400).json({ success: false, message: 'Image too large (max 2MB)' });
      }

      try {
        const { uploadImage } = await import('../lib/cloudinary.js');
        const url = await uploadImage(image, { folder: 'wallpapers' });
        await db.collection('userdata').updateOne(
          { username },
          { $set: { wallpaper: url, wallpaperUpdatedAt: new Date() } },
          { upsert: true }
        );
        return res.status(200).json({ success: true, url });
      } catch (err) {
        console.error('Wallpaper upload error:', err);
        return res.status(500).json({ success: false, message: 'Upload failed: ' + err.message });
      }
    }

    case 'os.clearWallpaper': {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      await db.collection('userdata').updateOne(
        { username },
        { $unset: { wallpaper: '' } }
      );
      return res.status(200).json({ success: true });
    }
        // ── 桌面圖標 ──
    case 'os.getDesktop': {
      const doc = await db.collection('userdata').findOne({ username });
      // 首次登入：給予默認圖標
      let icons = doc?.desktopIcons;
      if (!Array.isArray(icons)) {
        icons = [
          { id: 'd-problems',    title: 'Problems',    icon: 'fa-list-check',   type: 'app', appId: 'problems' },
          { id: 'd-submissions', title: 'Submissions', icon: 'fa-paper-plane',  type: 'app', appId: 'submissions' },
          { id: 'd-ranklist',    title: 'Leaderboard', icon: 'fa-ranking-star', type: 'app', appId: 'ranklist' },
          { id: 'd-bookmarked',  title: 'Bookmarks',   icon: 'fa-star',         type: 'app', appId: 'bookmarked' },
        ];
        await db.collection('userdata').updateOne(
          { username },
          { $set: { desktopIcons: icons } },
          { upsert: true }
        );
      }
      return res.status(200).json({ success: true, icons });
    }

    case 'os.saveDesktop': {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { icons } = req.body || {};
      if (!Array.isArray(icons)) {
        return res.status(400).json({ success: false, message: 'Invalid icons payload' });
      }
      // 基本字段校驗
      const sanitized = icons.slice(0, 100).map(it => ({
        id:    String(it.id || '').slice(0, 64) || ('i-' + Math.random().toString(36).slice(2, 10)),
        title: String(it.title || '').slice(0, 60) || 'Shortcut',
        icon:  String(it.icon  || 'fa-globe').slice(0, 60),
        type:  it.type === 'url' ? 'url' : 'app',
        appId: it.type === 'app' ? String(it.appId || '').slice(0, 60) : undefined,
        url:   it.type === 'url' ? String(it.url   || '').slice(0, 2000) : undefined,
      }));
      await db.collection('userdata').updateOne(
        { username },
        { $set: { desktopIcons: sanitized } },
        { upsert: true }
      );
      return res.status(200).json({ success: true, icons: sanitized });
    }
    default:
      return res.status(400).json({ success: false, message: 'Unknown action: ' + action });
  }
}