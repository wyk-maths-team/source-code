// api/oplog.js
// 從 local.oplog.rs 讀取 MongoDB 副本集的寫入記錄
// 只給 admin / root 存取
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { Timestamp } from 'mongodb';

// ═══════════════ 常數 ═══════════════
const OP_CATEGORY = { i: 'insert', u: 'update', d: 'delete', c: 'command' };
const MAX_SERIALIZE_LEN = 10000;
const SEARCH_HARD_LIMIT = 2000;

// ═══════════════ 工具函式 ═══════════════

// 解析 ns: "6a2e29620cfd90710534e012_wyk_math.submissions"
// → { db: 'wyk_math', coll: 'submissions' }
function parseNs(ns) {
  if (!ns || typeof ns !== 'string') return { db: '', coll: ns || '' };
  const dot = ns.lastIndexOf('.');
  if (dot < 0) return { db: '', coll: ns };
  const coll = ns.slice(dot + 1);
  const dbRaw = ns.slice(0, dot);
  // 去掉可能的租戶前綴
  const idx = dbRaw.lastIndexOf('_');
  const db = idx >= 0 ? dbRaw.slice(idx + 1) : dbRaw;
  return { db, coll };
}

// 把 BSON 物件轉成 JSON-safe 的普通物件
function safeSerialize(obj) {
  if (obj === null || obj === undefined) return obj;
  const t = typeof obj;
  if (t === 'string' || t === 'number' || t === 'boolean') return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(safeSerialize);
  if (t === 'object') {
    const bt = obj._bsontype;
    if (bt === 'ObjectId' || (obj.constructor && obj.constructor.name === 'ObjectId')) {
      return obj.toString();
    }
    if (bt === 'Timestamp') return { $timestamp: { t: obj.t, i: obj.i } };
    if (bt === 'Binary') {
      const len = typeof obj.length === 'function' ? obj.length() : (obj.length || '?');
      return `[Binary ${len} bytes]`;
    }
    if (bt === 'Long' || bt === 'Double' || bt === 'Int32') {
      return typeof obj.toString === 'function' ? obj.toString() : Number(obj);
    }
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = safeSerialize(v);
    return out;
  }
  return String(obj);
}

// ═══════════════ 摘要生成 ═══════════════
function summarize(op, coll, o, o2) {
  try {
    if (op === 'i') return summarizeInsert(coll, o);
    if (op === 'u') return summarizeUpdate(coll, o, o2);
    if (op === 'd') return summarizeDelete(coll, o2);
    if (op === 'c') return `Command: ${o && o.create ? 'create ' + o.create : (o && o.drop ? 'drop ' + o.drop : 'cmd')}`;
  } catch (e) {}
  return `${op} on ${coll}`;
}

function summarizeInsert(coll, o) {
  if (!o) return `Insert into ${coll}`;
  switch (coll) {
    case 'submissions':
      return `${o.username || '?'} submitted ${o.problemId || '?'} → ${truncStr(o.answer, 40)}${o.correct ? ' ✓' : ''}`;
    case 'users':
      return `New user: ${o.username || '?'} (${o.role || 'student'})`;
    case 'problems':
      return `New problem: ${o.id || '?'} "${truncStr(o.name, 40)}"`;
    case 'contests':
      return `New contest: #${o.id || '?'} "${truncStr(o.name, 40)}"`;
    case 'updates':
      return `New announcement: ${truncStr(o.title || o.badgeText, 50)}`;
    case 'audit_logs':
      return `Audit: ${o.action || '?'} by ${o.operator || '?'}`;
    case 'userstats':
      return `New userstats for ${o.username || '?'}`;
    case 'discussions':
      return `New discussion on ${o.problemId || '?'} by ${o.username || '?'}`;
    case 'tr-problems':
      return `New TR problem: ${o.id || '?'}`;
    case 'teams':
      return `New team: ${o.name || '?'} (captain ${o.captain || '?'})`;
    case 'reports':
      return `New report on ${o.problemId || '?'} by ${o.username || '?'}`;
    default:
      return `Insert into ${coll}: ${o._id ? String(o._id).slice(-8) : (o.id || '?')}`;
  }
}

function summarizeUpdate(coll, o, o2) {
  const fields = extractDiffFields(o);
  const fieldStr = fields.slice(0, 3).join(', ');
  const target = o2 && o2._id ? ` (…${String(o2._id).slice(-8)})` : '';
  return `Update ${coll}${target}${fieldStr ? ': ' + fieldStr : ''}`;
}

function summarizeDelete(coll, o2) {
  const id = o2 && o2._id ? String(o2._id).slice(-8) : '?';
  return `Deleted ${coll} doc …${id}`;
}

function extractDiffFields(o) {
  if (!o) return [];
  const out = [];
  if (o.$set) Object.keys(o.$set).forEach(k => out.push(`set ${k}`));
  if (o.$unset) Object.keys(o.$unset).forEach(k => out.push(`unset ${k}`));
  if (o.$inc) Object.keys(o.$inc).forEach(k => out.push(`inc ${k}`));
  if (o.$v === 2 && o.diff) walkDiff(o.diff, '', out);
  return out;
}

function walkDiff(node, prefix, out) {
  if (!node || typeof node !== 'object') return;
  if (node.i || node.u || node.d) {
    if (node.i) Object.keys(node.i).forEach(k => out.push(`+${prefix}${k}`));
    if (node.u) Object.keys(node.u).forEach(k => out.push(`~${prefix}${k}`));
    if (node.d) Object.keys(node.d).forEach(k => out.push(`-${prefix}${k}`));
    return;
  }
  for (const [k, v] of Object.entries(node)) walkDiff(v, prefix + k + '.', out);
}

function truncStr(s, n) {
  if (s == null) return '';
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function extractActor(o) {
  if (!o) return '';
  return o.username || o.operator || o.displayName || '';
}

// ═══════════════ 截斷過大的 o ═══════════════
function truncateO(o) {
  const ser = safeSerialize(o || {});
  const json = JSON.stringify(ser);
  if (json.length < MAX_SERIALIZE_LEN) return { o: ser, truncated: false };

  const truncated = { ...ser };
  for (const f of ['image', 'drawing', 'pfp', 'wallpaper']) {
    if (truncated[f]) truncated[f] = `[truncated, ${String(truncated[f]).length} chars]`;
  }
  for (const f of ['statement', 'content', 'statementHtml']) {
    if (truncated[f] && String(truncated[f]).length > 1000) {
      truncated[f] = String(truncated[f]).slice(0, 1000) + '… [truncated]';
    }
  }
  return { o: truncated, truncated: true };
}

// ═══════════════ 序列化單一條目 ═══════════════
function serializeEntry(e) {
  const parsed = parseNs(e.ns);
  const oSer = truncateO(e.o);
  return {
    tsKey: `${e.ts.t}-${e.ts.i}`,
    ts: { t: e.ts.t, i: e.ts.i },
    op: e.op,
    category: OP_CATEGORY[e.op] || 'other',
    db: parsed.db,
    coll: parsed.coll,
    ns: e.ns,
    wall: e.wall ? e.wall.toISOString() : null,
    lsid: e.lsid && e.lsid.id ? e.lsid.id.toString() : '',
    actor: extractActor(e.o),
    o: oSer.o,
    o2: safeSerialize(e.o2),
    summary: summarize(e.op, parsed.coll, e.o, e.o2),
    truncated: oSer.truncated,
  };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════ 主處理器 ═══════════════
export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (decoded.role !== 'admin' && decoded.role !== 'root') {
    // 用 404 而非 403，不洩漏這個 API 存在
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  const db = await connectToDatabase();

  let oplog;
  try {
    oplog = db.client.db('local').collection('oplog.rs');
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Cannot access local.oplog.rs' });
  }

  const action = req.query.action || 'list';

  try {
    if (action === 'list')   return await handleList(req, res, oplog);
    if (action === 'detail') return await handleDetail(req, res, oplog);
    if (action === 'stats')  return await handleStats(req, res, oplog);
    return res.status(400).json({ success: false, message: 'Invalid action' });
  } catch (e) {
    console.error('[oplog] error:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
}

// ═══════════════ action=list ═══════════════
async function handleList(req, res, oplog) {
  const {
    since, until,
    coll: filterColl,
    op: filterOp,
    q,
    page = '1',
    limit = '50',
  } = req.query;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));

  const now = new Date();
  const defaultSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sinceDate = since ? new Date(since) : defaultSince;
  const untilDate = until ? new Date(until) : now;

  if (isNaN(sinceDate.getTime()) || isNaN(untilDate.getTime())) {
    return res.status(400).json({ success: false, message: 'Invalid date range' });
  }

  const sinceTs = Timestamp.fromNumber(Math.floor(sinceDate.getTime() / 1000));
  const untilTs = Timestamp.fromNumber(Math.floor(untilDate.getTime() / 1000));

  const match = {
    ts: { $gte: sinceTs, $lte: untilTs },
    op: (filterOp && ['i', 'u', 'd'].includes(filterOp))
      ? filterOp
      : { $in: ['i', 'u', 'd'] },
  };

  if (filterColl) {
    match.ns = new RegExp('\\.' + escapeRegex(filterColl) + '$');
  }

  const skip = (pageNum - 1) * limitNum;

  // 沒關鍵字 → 直接在 Mongo 分頁
  if (!q || !String(q).trim()) {
    const [total, entries] = await Promise.all([
      oplog.countDocuments(match),
      oplog.find(match).sort({ ts: -1 }).skip(skip).limit(limitNum).toArray(),
    ]);

    return res.status(200).json({
      success: true,
      entries: entries.map(serializeEntry),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
      range: { since: sinceDate.toISOString(), until: untilDate.toISOString() },
    });
  }

  // 有關鍵字 → 拉一批做應用層過濾
  const all = await oplog.find(match).sort({ ts: -1 }).limit(SEARCH_HARD_LIMIT).toArray();
  const needle = String(q).toLowerCase();

  const filtered = all.filter(e => {
    const json = JSON.stringify(safeSerialize(e.o || {}))
               + JSON.stringify(safeSerialize(e.o2 || {}));
    return json.toLowerCase().includes(needle);
  });

  const total = filtered.length;
  const pageEntries = filtered.slice(skip, skip + limitNum);

  return res.status(200).json({
    success: true,
    entries: pageEntries.map(serializeEntry),
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.max(1, Math.ceil(total / limitNum)),
    range: { since: sinceDate.toISOString(), until: untilDate.toISOString() },
    searchLimited: all.length >= SEARCH_HARD_LIMIT,
  });
}

// ═══════════════ action=detail ═══════════════
async function handleDetail(req, res, oplog) {
  const { t, i } = req.query;
  if (!t || i === undefined) {
    return res.status(400).json({ success: false, message: 'Missing t/i' });
  }

  const ts = new Timestamp(parseInt(t, 10), parseInt(i, 10));
  const entry = await oplog.findOne({ ts });
  if (!entry) {
    return res.status(404).json({ success: false, message: 'Entry not found (may have been rotated out)' });
  }

  let related = [];
  if (entry.lsid && entry.lsid.id) {
    related = await oplog
      .find({ 'lsid.id': entry.lsid.id, ts: { $ne: ts } })
      .sort({ ts: 1 })
      .limit(20)
      .toArray();
  }

  return res.status(200).json({
    success: true,
    entry: serializeEntry(entry),
    related: related.map(serializeEntry),
  });
}

// ═══════════════ action=stats ═══════════════
async function handleStats(req, res, oplog) {
  const db = oplog.s.db;

  let dbStats = null;
  try { dbStats = await db.command({ dbStats: 1 }); } catch (e) {}

  const [oldest, newest] = await Promise.all([
    oplog.find({}).sort({ ts: 1 }).limit(1).next(),
    oplog.find({}).sort({ ts: -1 }).limit(1).next(),
  ]);

  return res.status(200).json({
    success: true,
    dataSize: dbStats ? dbStats.dataSize : null,
    storageSize: dbStats ? dbStats.storageSize : null,
    oldestTs: oldest ? new Date(oldest.ts.t * 1000).toISOString() : null,
    newestTs: newest ? new Date(newest.ts.t * 1000).toISOString() : null,
  });
}