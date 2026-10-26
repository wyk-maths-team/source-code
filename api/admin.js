// api/admin.js
//
// 管理員 API — 整理版
//
// 分區索引：
//   [1] imports
//   [2] 通用工具（getClientIP / safeStringify / ok / fail）
//   [3] 安全 db / collection 代理（cmd 模式用）
//   [4] GitHub 備份 helper
//   [5] Action handlers（每個都有獨立 try/catch）
//   [6] 主 handler（統一 auth + 分派 + 全域保護）
//
// ⚠️ auditLog 簽名：auditLog(db, action, details, operator, level)
//    level: 'info' | 'warn' | 'danger' | null

import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import * as nodeCrypto      from 'crypto';
import * as nodeUtil        from 'util';
import * as nodeQuerystring from 'querystring';
import * as nodeUrl         from 'url';
import { wrapHandler } from '../lib/errors.js';
import zlib from 'zlib';

// ═══════════════════════════════════════════════════════════════════
// [2] 通用工具
// ═══════════════════════════════════════════════════════════════════

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.connection?.remoteAddress
      || req.socket?.remoteAddress
      || 'unknown';
}

// 安全 stringify：處理循環引用和 BigInt
function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (k, v) => {
    if (typeof v === 'bigint') return v.toString();
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) return '[Circular]';
      seen.add(v);
    }
    return v;
  });
}

// 統一回應
function ok(res, data) {
  if (res.headersSent) return;
  res.status(200).json(data);
}
function fail(res, code, msg) {
  if (res.headersSent) return;
  res.status(code).json({ success: false, message: msg });
}

// 安全呼叫 auditLog（失敗只記 console，不拋）
function safeAudit(db, action, details, operator, level = null) {
  return auditLog(db, action, details, operator, level)
    .catch(e => console.error(`[audit] ${action} failed:`, e?.message || e));
}

// ═══════════════════════════════════════════════════════════════════
// [3] 安全 db / collection 代理（cmd 模式用）
// ═══════════════════════════════════════════════════════════════════

function makeSafeDb(db) {
  const DB_BLOCKED = new Set(['dropDatabase', 'rename', 'command', 'admin', 'stats']);
  return new Proxy(db, {
    get(target, prop) {
      if (typeof prop === 'string' && DB_BLOCKED.has(prop)) {
        throw new Error(`db.${prop}() is not allowed`);
      }
      if (prop === 'collection') {
        return (name) => makeSafeCollection(target.collection(String(name)));
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

function makeSafeCollection(col) {
  const COL_BLOCKED = new Set(['drop', 'dropIndex', 'dropIndexes', 'rename']);
  return new Proxy(col, {
    get(target, prop) {
      if (typeof prop === 'string' && COL_BLOCKED.has(prop)) {
        throw new Error(`collection.${prop}() is not allowed`);
      }
      const val = target[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// [4] GitHub 備份 helper
// ═══════════════════════════════════════════════════════════════════

function getBackupConfig() {
  const token  = process.env.GITHUB_BACKUP_TOKEN  || process.env.GITHUB_IMAGES_TOKEN  || process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_BACKUP_OWNER  || process.env.GITHUB_IMAGES_OWNER  || process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_BACKUP_REPO   || 'backup';
  if (!token || !owner || !repo) {
    throw new Error('GitHub backup not configured (missing env vars)');
  }
  return { token, owner, repo };
}

async function ghApi(url, token) {
  return fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wyk-math-backup',
    },
  });
}

// ⭐ 列出所有 Release 备份
async function listBackupsHelper() {
  const { token, owner, repo } = getBackupConfig();

  // 获取前 100 个 Release
  const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`;
  const res = await ghApi(url, token);
  if (res.status === 404) return [];
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GitHub Releases API ${res.status}: ${t.slice(0, 200)}`);
  }
  const releases = await res.json();

  const backups = releases
    .filter(r => r.tag_name.startsWith('backup-')) // 过滤出备份
    .map(r => {
      // tag_name 格式: backup-2026-10-26T20-11-36
      const ts = r.tag_name.replace('backup-', '');
      const isoTry = ts.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') + 'Z';
      const dt = new Date(isoTry);
      const validDate = !isNaN(dt.getTime());

      // 统计该 Release 下的 assets
      const assets = r.assets || [];
      const dataFiles = assets.filter(a => a.name.endsWith('.json.gz') && !a.name.startsWith('_'));

      return {
        id: r.id,                         // ⭐ 恢复时需要用到 release id
        release: r.tag_name,
        timestamp: ts,
        isoDate: validDate ? dt.toISOString() : null,
        collections: dataFiles.map(a => a.name.replace(/\.json\.gz$/, '')),
        collectionCount: dataFiles.length,
        fileCount: assets.length,
        totalSize: assets.reduce((s, a) => s + a.size, 0),
        hasManifest: assets.some(a => a.name === '_manifest.json.gz'),
      };
    });

  backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));  // 新的在前
  return backups;
}

// JSON 裡的 ISO 字串 → Date（啟發式）
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
function reviveDates(obj) {
  if (Array.isArray(obj)) return obj.map(reviveDates);
  if (obj && typeof obj === 'object') {
    if (obj._bsontype) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && ISO_RE.test(v)) {
        const d = new Date(v);
        out[k] = isNaN(d.getTime()) ? v : d;
      } else {
        out[k] = reviveDates(v);
      }
    }
    return out;
  }
  return obj;
}

// ⭐ 从 Release 恢复
async function restoreDatabaseHelper(db, releaseId, dryRun) {
  const { token, owner, repo } = getBackupConfig();

  // 1. 获取 Release 的所有 assets
  const assetsUrl = `https://api.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets`;
  const res = await ghApi(assetsUrl, token);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Cannot list release assets (${res.status}): ${t.slice(0, 200)}`);
  }
  const assets = await res.json();
  if (!Array.isArray(assets)) throw new Error('Invalid release assets listing');

  const dataFiles = assets.filter(it =>
    it.name.endsWith('.json.gz') && !it.name.startsWith('_')
  );
  if (dataFiles.length === 0) throw new Error('Backup release contains no data files');

  const results = [];
  let totalDocs = 0;

  for (const file of dataFiles) {
    const collectionName = file.name.replace(/\.json\.gz$/, '');
    try {
      // 2. 下载 .gz 附件 (必须用 Accept: application/octet-stream 获取原始文件)
      const dl = await fetch(file.url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/octet-stream'
        },
      });
      if (!dl.ok) throw new Error(`Download ${dl.status}`);
      
      // 3. 解压并解析 JSON
      const buffer = Buffer.from(await dl.arrayBuffer());
      const jsonString = zlib.gunzipSync(buffer).toString();
      const payload = JSON.parse(jsonString);

      const docsRaw = Array.isArray(payload) ? payload : (payload.docs || []);
      const docs = docsRaw.map(reviveDates);

      if (dryRun) {
        results.push({ collection: collectionName, count: docs.length, action: 'would-replace' });
        totalDocs += docs.length;
        continue;
      }

      // 真恢復：清空 + 分批插入
      const col = db.collection(collectionName);
      await col.deleteMany({});

      const BATCH = 500;
      for (let i = 0; i < docs.length; i += BATCH) {
        await col.insertMany(docs.slice(i, i + BATCH), { ordered: false });
      }

      results.push({ collection: collectionName, count: docs.length, action: 'restored' });
      totalDocs += docs.length;
    } catch (e) {
      console.error(`restore ${collectionName} failed:`, e);
      results.push({ collection: collectionName, error: e.message });
    }
  }

  return {
    releaseId,
    dryRun,
    results,
    totalDocs,
    collectionsRestored: results.filter(r => r.action === 'restored').length,
  };
}

// ═══════════════════════════════════════════════════════════════════
// [5] Action handlers
// ═══════════════════════════════════════════════════════════════════

// ── Marker: 待批改列表 ──
async function handleMarkerList(req, res, db) {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const submissions = await db.collection('submissions')
    .find({ type: 'image', marked: false })
    .sort({ timestamp: -1 })
    .project({ username: 1, problemId: 1, subid: 1, timestamp: 1, _id: 0 })
    .toArray();

  return ok(res, { success: true, submissions });
}

// ── Marker: 單筆詳情 ──
async function handleMarkerDetail(req, res, db) {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const { subid } = req.query;
  if (!subid) return fail(res, 400, 'Missing subid');

  const sub = await db.collection('submissions').findOne({ subid });
  if (!sub) return fail(res, 404, 'Submission not found');

  const { username, problemId, timestamp, marked, score, comment, image, markedAt } = sub;
  return ok(res, {
    success: true,
    submission: {
      subid, image, username, problemId, timestamp,
      marked, score, comment, 
      markedAt: markedAt || null,
    },
  });
}
// ── 发送系统消息 ──
async function handleSendMessage(req, res, db, decoded) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

  const { targetUser, template, variables } = req.body || {};
  if (!targetUser || !template) return fail(res, 400, 'Missing targetUser or template');

  let content = '';
  if (template === 'reviewed') {
    content = `Your problem report on ${variables?.problemId || 'a problem'} was reviewed. Your submission was rejudged. Thank you.`;
  } else if (template === 'toc') {
    content = `Your profile picture violates the ToS and was removed. Please follow the rules. Thank you.`;
  } else if (template === 'custom') {
    content = variables?.customText || 'No content';
  } else {
    return fail(res, 400, 'Invalid template');
  }

  await db.collection('messages').insertOne({
    username: targetUser,
    content,
    createdAt: new Date(),
    read: false
  });

  await safeAudit(db, 'send_system_message', { targetUser, template }, decoded.username, 'info');
  return ok(res, { success: true, message: 'Message sent' });
}
// ── 用户红黄牌制裁 ──
async function handleFlagUser(req, res, db, decoded) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

  const { targetUser, flagType } = req.body || {};
  if (!targetUser || !['red', 'yellow'].includes(flagType)) {
    return fail(res, 400, 'Missing or invalid parameters');
  }

  // ⭐ 1. 拦截自己
  if (targetUser === decoded.username) {
    return fail(res, 400, 'You cannot flag yourself.');
  }

  const target = await db.collection('users').findOne({ username: targetUser });
  if (!target) return fail(res, 404, 'User not found');

  // ⭐ 2. 权限隔离
  if (target.role === 'root') return fail(res, 403, 'Cannot flag root user');
  if (decoded.role === 'admin' && target.role === 'admin') {
    return fail(res, 403, 'Admins cannot flag other admins.');
  }

  const isRed = flagType === 'red';
  const message = isRed
    ? `[RED CARD] Your account has been suspended due to severe violation of Terms of Service (inappropriate content).`
    : `[YELLOW CARD] You have been warned for inappropriate behavior or rule violation. Please follow the rules.`;

  // 3. 更新用户状态 (红牌封号，黄牌记过)
  const updateData = isRed 
    ? { $set: { banned: true } } 
    : { $inc: { yellowCards: 1 } };
  await db.collection('users').updateOne({ username: targetUser }, updateData);

  // 4. 发送系统通知
  await db.collection('messages').insertOne({
    username: targetUser,
    content: message,
    createdAt: new Date(),
    read: false
  });

  await safeAudit(db, 'flag_user', { targetUser, flagType }, decoded.username, 'danger');
  return ok(res, { success: true, message: `User ${targetUser} flagged with ${flagType} card.` });
}
// ── Marker: 提交評分 ──
async function handleMarkSubmit(req, res, db, decoded) {
  if (req.method !== 'PUT') return fail(res, 405, 'Method not allowed');

  const { subid, score, comment } = req.body || {};
  if (!subid || score === undefined) return fail(res, 400, 'Missing subid/score');

  const sub = await db.collection('submissions').findOne({ subid });
  if (!sub) return fail(res, 404, 'Submission not found');

  const numScore = Number(score);
  if (isNaN(numScore) || numScore < 0 || numScore > 100) {
    return fail(res, 400, 'Score must be between 0 and 100');
  }

  await db.collection('submissions').updateOne(
    { subid },
    {
      $set: {
        marked: true,
        score: numScore,
        comment: comment || '',
        markedAt: new Date(),
      },
    }
  );

  // 同步更新競賽結果
  if (sub.contestId && sub.type === 'image') {
    const isSolved = numScore >= 100;
    await db.collection('contest_results').updateOne(
      { contestId: sub.contestId, username: sub.username, problemId: sub.problemId },
      {
        $set: {
          score: numScore,
          solved: isSolved,
          lastSubmissionTime: new Date(),
        },
      },
      { upsert: true }
    );
  }

  // 更新用戶解題狀態
  if (sub.type === 'image') {
    const statesCol = db.collection('userstats');
    const stats = await statesCol.findOne({ username: sub.username });
    const states = stats ? (stats.states || {}) : {};
    const pid = sub.problemId;

    if (numScore === 100) {
      states[pid] = 'passed';
    } else if (states[pid] !== 'passed') {
      states[pid] = 'failed';
    }
    await statesCol.updateOne(
      { username: sub.username },
      { $set: { states } },
      { upsert: true }
    );
  }

  // ⭐ FIX：補上 db / operator / level
  await safeAudit(db, 'mark_submission',
    { subid, score: numScore, problemId: sub.problemId, username: sub.username },
    decoded.username, 'warn');

  return ok(res, { success: true, message: 'Marked' });
}



// ── 直接把資料庫 dump 成 JSON 下載 ──
async function handleDumpDatabase(req, res, db, decoded) {
  if (decoded.role !== 'root') return fail(res, 403, 'Root only');
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const collections = await db.listCollections().toArray();
  const dump = {
    timestamp: new Date().toISOString(),
    by: decoded.username,
    collections: {},
  };
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    dump.collections[name] = await db.collection(name).find({}).toArray();
  }

  // ⭐ 不依賴 res.send()，直接用 res.end()
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="backup-${Date.now()}.json"`);
  res.statusCode = 200;
  return res.end(JSON.stringify(dump));
}

// ── 列出所有備份 ──
async function handleListBackups(req, res, decoded) {
  if (decoded.role !== 'root') return fail(res, 403, 'Root only');
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const backups = await listBackupsHelper();
  return ok(res, { success: true, backups });
}

// ═══════════════════════════════════════════════════════════════════
// [5] Action handlers (只列出改动部分)
// ═══════════════════════════════════════════════════════════════════

// ── 備份核心：把所有 collection 打成 GitHub Release ──
// 抽成獨立函式，是因為「恢復前自動存檔」也要用它。
// 回傳 { release, results }；任何單一 collection 失敗不中斷，記在 results 裡。
async function createBackupRelease(db, username) {
  const { token, owner, repo } = getBackupConfig();
  const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  const tagName = `backup-${ts}`;

  // 1. 创建 Release
  const releaseRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tagName, name: `Manual DB Backup ${ts}`, draft: false, prerelease: true })
  });
  if (!releaseRes.ok) throw new Error(`Failed to create release`);
  const releaseData = await releaseRes.json();

  // 2. 上传
  const collections = await db.listCollections().toArray();
  const results = [];
  const manifest = { timestamp: new Date().toISOString(), by: username, collections: {} };

  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    try {
      const docs = await db.collection(name).find({}).toArray();
      manifest.collections[name] = { count: docs.length };

      const rawJson = JSON.stringify({ collection: name, count: docs.length, docs });
      const compressed = zlib.gzipSync(rawJson);

      const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseData.id}/assets?name=${name}.json.gz`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/gzip',
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

  // 上传 manifest
  const manifestJson = JSON.stringify(manifest);
  const compressedManifest = zlib.gzipSync(manifestJson);
  await fetch(`https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseData.id}/assets?name=_manifest.json.gz`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/gzip', 'Content-Length': compressedManifest.length.toString() },
    body: compressedManifest
  });

  return { release: tagName, results };
}

// ── 手動備份資料庫 (改为 Release 模式) ──
async function handleBackupDatabase(req, res, db, decoded) {
  if (decoded.role !== 'root') return fail(res, 403, 'Root only');
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

  const { release, results } = await createBackupRelease(db, decoded.username);

  await safeAudit(db, 'backup_database', {
    release,
    totalCollections: results.length,
    results: results.map(r => ({ collection: r.collection, count: r.count, error: r.error })),
  }, decoded.username, 'warn');

  return ok(res, { success: true, release, results });
}

// ── 恢復資料庫 ──
async function handleRestoreDatabase(req, res, db, decoded) {
  if (decoded.role !== 'root') return fail(res, 403, 'Root only');
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

  const { releaseId, dryRun } = req.body || {};
  if (!releaseId) return fail(res, 400, 'Missing releaseId');

  // ⭐ 安全網：真正恢復之前，先把「當前狀態」備份下來。
  //    恢復本身是不可逆的 —— 選錯時間點或備份殘缺，現有資料就沒了。
  //    所以先打一次 release，出事了還能從這個 pre-restore 快照回來。
  //
  //    備份失敗就不准恢復：寧可這次操作失敗，也不能在「無法回頭」的狀態下
  //    去覆蓋資料。
  let preRestoreBackup = null;
  if (!dryRun) {
    try {
      const b = await createBackupRelease(db, decoded.username);
      preRestoreBackup = b.release;
      await safeAudit(db, 'pre_restore_backup', {
        release: b.release,
        forRestoreOf: releaseId,
        totalCollections: b.results.length,
        failed: b.results.filter(r => r.error).map(r => r.collection),
      }, decoded.username, 'warn');
    } catch (e) {
      await safeAudit(db, 'pre_restore_backup_failed', {
        forRestoreOf: releaseId,
        error: e.message,
      }, decoded.username, 'danger').catch(() => {});
      return fail(res, 500,
        `Pre-restore backup failed, refusing to restore: ${e.message}. ` +
        `恢复会把当前数据整个覆盖掉，在一次不可回滚的操作前必须先有一份存档。`);
    }
  }

  const result = await restoreDatabaseHelper(db, releaseId, !!dryRun);

  if (!dryRun) {
    await safeAudit(db, 'restore_database', { releaseId, preRestoreBackup }, decoded.username, 'danger');
  }

  return ok(res, { success: true, preRestoreBackup, ...result });
}


// ── 審計日誌查詢 ──
async function handleLogs(req, res, db) {
  if (req.method !== 'GET') return fail(res, 405, 'Method not allowed');

  const { page = '1', limit = '20', actionFilter, operatorFilter } = req.query;
  const pageNum  = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

  const filter = {};
  if (actionFilter)   filter.action   = { $regex: actionFilter,   $options: 'i' };
  if (operatorFilter) filter.operator = { $regex: operatorFilter, $options: 'i' };

  const [total, logs] = await Promise.all([
    db.collection('audit_logs').countDocuments(filter),
    db.collection('audit_logs')
      .find(filter)
      .sort({ timestamp: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .toArray(),
  ]);

  return ok(res, {
    success: true,
    logs,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum),
  });
}

// ── 同步版本號 ──
async function handleSyncVersion(req, res, db, decoded) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

  const newVer = Date.now();
  await db.collection('metadata').updateOne(
    { _key: 'problemsVersion' },
    { $set: { version: newVer } }
  );

  // ⭐ FIX：補上 db / operator / level
  await safeAudit(db, 'sync_version', { newVer }, decoded.username, 'info');

  return ok(res, { success: true, version: newVer });
}

// ── 手動設定題目難度 ──
async function handleSetDifficulty(req, res, db, decoded) {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

  const { problemId, difficulty, lock } = req.body || {};
  if (!problemId) return fail(res, 400, 'Missing problemId');

  const d = Number(difficulty);
  if (!Number.isFinite(d) || d < 1 || d > 10) {
    return fail(res, 400, 'Difficulty must be between 1 and 10');
  }

  const problem = await db.collection('problems').findOne(
    { id: String(problemId) },
    { projection: { id: 1, _id: 0 } }
  );
  if (!problem) return fail(res, 404, 'Problem not found');

  const rounded = Math.round(d * 100) / 100;
  await db.collection('problems').updateOne(
    { id: String(problemId) },
    {
      $set: {
        difficulty: rounded,
        manualDifficulty: rounded,          // 手动值成为后续自动调整的先验
        difficultyLocked: lock === true,    // 锁定后 cron 跳过此题
        difficultyLastAdjustedAt: new Date(),
      },
    }
  );

  await safeAudit(db, 'set_difficulty',
    { problemId: String(problemId), difficulty: rounded, locked: lock === true },
    decoded.username, 'warn');

  return ok(res, { success: true, problemId: String(problemId), difficulty: rounded, locked: lock === true });
}

// ── 手動觸發全量難度調整 ──
async function handleRunDifficultyAdjust(req, res, db, decoded) {
  if (decoded.role !== 'root') return fail(res, 403, 'Root only');
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

  const { sweepDifficulties } = await import('../lib/difficulty-sweep.js');
  const summary = await sweepDifficulties(db);

  await safeAudit(db, 'run_difficulty_adjust',
    { total: summary.total, adjusted: summary.adjusted, skipped: summary.skipped },
    decoded.username, 'info');

  return ok(res, { success: true, ...summary });
}

// ── 高級命令終端（加固版） ──
async function handleCmd(req, res, db, decoded) {
  if (decoded.role !== 'root') return fail(res, 403, 'Only root can use this terminal');
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');

  const { mode, code } = req.body || {};
  if (!code || typeof code !== 'string') return fail(res, 400, 'Missing code');
  //if (code.length > 5000) return fail(res, 400, 'Code too long (max 5000)');

  // 審計：先寫，再執行
  await safeAudit(db, 'admin_cmd_exec', {
    mode: mode || 'js',
    codePreview: code.slice(0, 300),
    ip: getClientIP(req),
  }, decoded.username, 'danger');

  const logs = [];
  const origLog   = console.log;
  const origError = console.error;

  try {
    // 捕獲 console 輸出
    const pushLog = (prefix, args) => {
      logs.push(prefix + args.map(a =>
        typeof a === 'string' ? a : safeStringify(a)
      ).join(' '));
    };
    console.log   = (...args) => pushLog('', args);
    console.error = (...args) => pushLog('[ERROR] ', args);

    // require 白名單
    const SAFE_MODULES = {
      crypto:      nodeCrypto,
      util:        nodeUtil,
      querystring: nodeQuerystring,
      url:         nodeUrl,
    };
    const safeRequire = (name) => {
      if (!Object.prototype.hasOwnProperty.call(SAFE_MODULES, name)) {
        throw new Error(`Module '${name}' is not allowed`);
      }
      return SAFE_MODULES[name];
    };

    // process 代理：只讀、只暴露無害欄位
    const safeProcess = Object.freeze({
      version:  process.version,
      platform: process.platform,
      arch:     process.arch,
      uptime:   () => process.uptime(),
      memoryUsage: () => process.memoryUsage(),
    });

    // db 代理（僅 db 模式）
    const safeDb = mode === 'db' ? makeSafeDb(db) : undefined;

    // VM 沙箱
    const vm = await import('vm');
    const context = vm.createContext(Object.create(null), {
      name: 'admin-cmd-sandbox',
      codeGeneration: { strings: false, wasm: false },
    });

    Object.assign(context, {
      console: {
        log:   (...a) => pushLog('', a),
        error: (...a) => pushLog('[ERROR] ', a),
        warn:  (...a) => pushLog('[WARN] ', a),
        info:  (...a) => pushLog('', a),
      },
      Buffer,
      Promise,
      JSON, Math, Date, RegExp, Error, TypeError,
      Object, Array, String, Number, Boolean, Map, Set,
      parseInt, parseFloat, isNaN, isFinite,
      setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 5000)),
      clearTimeout,
      require: safeRequire,
      process: safeProcess,
      ...(mode === 'db' ? {
        db: safeDb,
        ObjectId: (await import('mongodb')).ObjectId,
      } : {}),
    });

    // 用函式包裝而非字串拼接，避免注入
    const wrapped = `(async function () {\n"use strict";\n${code}\n})()`;
    const script = new vm.Script(wrapped, { filename: 'admin-cmd.js' });

    // 超時：同步用 timeout，異步用 Promise.race 兜底
    const result = await Promise.race([
      Promise.resolve(script.runInContext(context, { timeout: 3000 })),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Execution timeout (3.5s)')), 3500)
      ),
    ]);

    return ok(res, {
      success: true,
      output: logs.join('\n'),
      result: result !== undefined ? safeStringify(result) : null,
    });
  } catch (err) {
    return fail(res, 500, String((err && err.message) || err));
  } finally {
    // 無論如何恢復 console
    console.log   = origLog;
    console.error = origError;
  }
}

// ═══════════════════════════════════════════════════════════════════
// [6] 主 handler
// ═══════════════════════════════════════════════════════════════════

async function handler(req, res) {
  // Rate limit
  try {
    if (!(await applyRateLimit(req, res))) return;
  } catch (e) {
    console.error('[admin] rateLimit error:', e);
    return fail(res, 500, 'Rate limit error');
  }

  // Auth
  let decoded;
  try {
    decoded = await verifyToken(req);
  } catch (e) {
    console.error('[admin] verifyToken error:', e);
    return fail(res, 500, 'Auth error');
  }
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'root')) {
    return fail(res, 403, 'Admin only');
  }

  // DB
  let db;
  try {
    db = await connectToDatabase();
  } catch (e) {
    console.error('[admin] DB connect error:', e);
    return fail(res, 500, 'Database connection failed');
  }

  const action = req.query.action;

  // 分派（每個 handler 內部有自己的 try/catch 或由上層兜底）
  try {
    switch (action) {
      case 'markerList':      return await handleMarkerList(req, res, db);
      case 'markerDetail':    return await handleMarkerDetail(req, res, db);
      case 'markSubmit':      return await handleMarkSubmit(req, res, db, decoded);
      case 'backupDatabase':  return await handleBackupDatabase(req, res, db, decoded);
      case 'dumpDatabase':    return await handleDumpDatabase(req, res, db, decoded);
      case 'listBackups':     return await handleListBackups(req, res, decoded);
      case 'restoreDatabase': return await handleRestoreDatabase(req, res, db, decoded);
      case 'logs':            return await handleLogs(req, res, db);
      case 'syncVersion':     return await handleSyncVersion(req, res, db, decoded);
      case 'setDifficulty':   return await handleSetDifficulty(req, res, db, decoded);
      case 'runDifficultyAdjust': return await handleRunDifficultyAdjust(req, res, db, decoded);
      case 'cmd':             return await handleCmd(req, res, db, decoded);
      case 'sendMessage':     return await handleSendMessage(req, res, db, decoded);
      case 'flagUser':        return await handleFlagUser(req, res, db, decoded);
      default:
        return fail(res, 400, 'Invalid action');
    }
  } catch (e) {
    console.error(`[admin] action=${action} error:`, e);
    // 若 res 已發送過，fail() 會自動跳過
    return fail(res, 500, e?.message || 'Internal error');
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);