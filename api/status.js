// api/status.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

const action = req.query.action || (req.body && req.body.action);

  // ══ 运维信息仅限管理员 ══
  // system 暴露数据库集合大小/文档数，vercel 暴露团队账单用量，
  // 这两类都不该给普通学生看。handleOsAction 是用户自己的数据，不受此限制。
  const isAdminUser = decoded.role === 'admin' || decoded.role === 'root';
  const isOpsAction = !action || action === 'system' || action === 'vercel' || action === 'mongoio';
  if (isOpsAction && !isAdminUser) {
    return res.status(403).json({
      success: false,
      message: 'Only administrators can view system status',
      code: 'FORBIDDEN',
    });
  }

// ── 無 action 或 action=system：原有系統狀態 ──
if (!action || action === 'system') {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return systemStatus(req, res);
}

// ⭐ Vercel 用量
// MongoDB 七天 IO（Atlas Admin API）
if (action === 'mongoio') {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return mongoIO(req, res);
}

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
    // Atlas 免费档 512MB 的口径是 storageSize + indexSize；dataSize 是逻辑大小，不算配额
    const usedMB      = ((stats.storageSize + stats.indexSize) / 1024 / 1024).toFixed(2);
    const quotaMB     = 512;
    const freeMB      = Math.max(0, quotaMB - parseFloat(usedMB)).toFixed(2);
    const usedPercent = Math.min(100, parseFloat(usedMB) / quotaMB * 100).toFixed(1);

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
          // Cloudinary 的 /usage 返回的是分组对象，不是裸数字：
          //   bandwidth: { usage: 1747755665, credits_usage: 1.63 }   ← usage 单位是字节
          //   credits:   { usage: 2.34, limit: 25, used_percent: 9.36 }
          // 旧代码 toMB(usageData.bandwidth) 对对象取 Number 得 NaN，所以流量永远显示 0。
          const grp = o => (o && typeof o === 'object') ? o : { usage: Number(o) || 0 };
          const bw = grp(usageData.bandwidth), st = grp(usageData.storage), cr = grp(usageData.credits), tx = grp(usageData.transformations);
          const toMB = b => (Number(b) || 0) / 1024 / 1024;
          cloudinary = {
            plan: usageData.plan || '?',
            bandwidthUsedMB: toMB(bw.usage).toFixed(2),
            bandwidthCredits: Number(bw.credits_usage) || 0,
            storageUsedMB: toMB(st.usage).toFixed(2),
            storageCredits: Number(st.credits_usage) || 0,
            transformations: Number(tx.usage) || 0,
            transformationCredits: Number(tx.credits_usage) || 0,
            creditsUsed: Number(cr.usage) || 0,
            creditsLimit: Number(cr.limit) || 0,
            creditsPercent: Number(cr.used_percent) || 0,
            resources: Number(usageData.resources) || 0,
            requests: Number(usageData.requests) || 0,
            lastUpdated: usageData.last_updated || '',
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
      dbSizeMB, dataSizeMB, indexSizeMB, freeMB, usedMB, usedPercent, quotaMB,
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
 * MongoDB 七天 IO
 *
 * Atlas 的时序指标只能从 Admin API 取；普通连接的 serverStatus 只有累计值，
 * 没有历史。所以需要 Atlas 服务账号密钥：
 *   MONGODB_ATLAS_PUBLIC_KEY / MONGODB_ATLAS_PRIVATE_KEY
 *   MONGODB_ATLAS_PROJECT_ID / MONGODB_ATLAS_HOST
 * 缺任何一个都返回说得清的提示，而不是空数据。
 * ============================================================ */
const _ioCache = { data: null, expireAt: 0 };
const IO_CACHE_TTL = 10 * 60_000;

/**
 * 从 SRV 记录里挑一个节点名。取优先级最高的那台，Admin API 的 measurements
 * 对副本集里任意一台都能查到集群级指标。
 */
async function resolveMongoHost() {
  const uri = process.env.MONGODB_URI || '';
  const m = /@([^/?]+)/.exec(uri);
  const domain = m ? m[1] : '';
  if (!domain) throw new Error('cannot derive domain from MONGODB_URI');
  const dns = await import('node:dns/promises');
  const recs = await dns.resolveSrv('_mongodb._tcp.' + domain);
  if (!recs.length) throw new Error('no SRV records');
  recs.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  return recs[0].name;
}
async function mongoIO(req, res) {
  const pub = process.env.MONGODB_ATLAS_PUBLIC_KEY;
  const prv = process.env.MONGODB_ATLAS_PRIVATE_KEY;
  const pid = process.env.MONGODB_ATLAS_PROJECT_ID;
  let host = process.env.MONGODB_ATLAS_HOST;
  // Atlas 控制台只给 SRV 连接串（csli.x78ref9.mongodb.net），不给具体节点名。
  // Admin API 要的是 ac-yqjfzo0-shard-00-00.x78ref9.mongodb.net 这种，
  // 所以没配 HOST 时自己查一次 SRV 记录。
  if (!host) {
    try { host = await resolveMongoHost(); } catch (e) { host = ''; }
  }
  if (!pub || !prv || !pid) {
    return res.status(200).json({
      success: false,
      message: 'MongoDB Atlas API keys not configured',
      missing: {
        MONGODB_ATLAS_PUBLIC_KEY: !pub,
        MONGODB_ATLAS_PRIVATE_KEY: !prv,
        MONGODB_ATLAS_PROJECT_ID: !pid,
      },
    });
  }

  if (_ioCache.data && _ioCache.expireAt > Date.now()) {
    return res.status(200).json({ success: true, ..._ioCache.data, cached: true });
  }

  try {
    const auth = Buffer.from(pub + ':' + prv).toString('base64');
    const end = new Date();
    const start = new Date(Date.now() - 7 * 86400_000);
    const metrics = [
      'DISK_PARTITION_IOPS_READ',
      'DISK_PARTITION_IOPS_WRITE',
      'OPCOUNTER_QUERY',
      'OPCOUNTER_INSERT',
      'OPCOUNTER_UPDATE',
      'OPCOUNTER_DELETE',
    ].join(',');
    const qs = 'granularity=PT6H&periodStart=' + encodeURIComponent(start.toISOString()) +
      '&periodEnd=' + encodeURIComponent(end.toISOString()) + '&m=' + encodeURIComponent(metrics);
    const url = 'https://cloud.mongodb.com/api/atlas/v1.0/groups/' + encodeURIComponent(pid) +
      '/processes/' + encodeURIComponent(host) + '/measurements?' + qs;

    const r = await fetch(url, {
      headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(200).json({ success: false, message: 'Atlas API ' + r.status + ': ' + text.slice(0, 300) });
    }
    const json = await r.json();
    const series = (json.measurements || []).map((m) => ({
      name: m.name,
      unit: m.units,
      points: (m.dataPoints || []).map((d) => ({ t: d.timestamp, v: d.value })),
    }));
    const payload = { from: start.toISOString(), to: end.toISOString(), series };
    _ioCache.data = payload;
    _ioCache.expireAt = Date.now() + IO_CACHE_TTL;
    return res.status(200).json({ success: true, ...payload });
  } catch (err) {
    return res.status(200).json({ success: false, message: String((err && err.message) || err) });
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
      const pricing  = e.PricingCategory || 'Other';   // Committed = 套餐内含额度，Other = 超额按需
      const key = `${serviceName}::${category}::${pricing}`;

      const cost  = Number(e.EffectiveCost ?? e.BilledCost ?? 0) || 0;
      const usage = Number(e.ConsumedQuantity ?? e.PricingQuantity ?? 0) || 0;
      const unit  = e.ConsumedUnit || e.PricingUnit || '';

      if (!grouped.has(key)) {
        grouped.set(key, { serviceName, category, pricing, cost: 0, usage: 0, unit });
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
        pricing: g.pricing,
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
    // Vercel 每条 charge 标 PricingCategory：Committed 吃套餐额度，Other 是超额按需。
    // 只看合计会误判 —— Pro 月费一部分算 included，额外席位与超额都算 on-demand。
    const includedCost = metrics.filter((m) => m.pricing === 'Committed').reduce((s, m) => s + (m.cost || 0), 0);
    const onDemandCost = metrics.filter((m) => m.pricing !== 'Committed').reduce((s, m) => s + (m.cost || 0), 0);
    // 调试用：全部聚合后的 key 列表（包括零值）
    const allServiceNames = [...grouped.values()]
      .map(g => `${g.serviceName} [${g.category}] = ${g.usage} ${g.unit} / $${g.cost.toFixed(4)}`)
      .sort();
    const payload = {
      from: fromIso,
      to:   toIso,
      metrics,
      totalCost,
      includedCost,
      onDemandCost,
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

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);