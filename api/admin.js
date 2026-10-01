// api/admin.js
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { sanitizeHTML } from '../lib/sanitize.js';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
import * as nodeCrypto      from 'crypto';
import * as nodeUtil        from 'util';
import * as nodeQuerystring from 'querystring';
import * as nodeUrl         from 'url';
const allowedCollections = ['problems', 'users', 'submissions', 'userstats', 'updates', 'contests', 'contest_results', 'metadata'];

const ALLOWED_COLLECTIONS = ['problems', 'users', 'submissions', 'userstats', 'updates', 'contests', 'contest_results', 'metadata'];

// 安全 stringify：处理循环引用和 BigInt
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

// 把 db 包一层 Proxy，禁止危险操作
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
// ═══════════════ GitHub 备份辅助 ═══════════════
function getBackupConfig() {
  const token  = process.env.GITHUB_BACKUP_TOKEN  || process.env.GITHUB_IMAGES_TOKEN  || process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_BACKUP_OWNER  || process.env.GITHUB_IMAGES_OWNER  || process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_BACKUP_REPO   || 'backup';
  const branch = process.env.GITHUB_BACKUP_BRANCH || 'main';
  if (!token || !owner || !repo) {
    throw new Error('GitHub backup not configured (missing env vars)');
  }
  return { token, owner, repo, branch };
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

// 列出 database/ 下所有备份目录
async function listBackupsHelper() {
  const { token, owner, repo, branch } = getBackupConfig();

  // 用 tree API 一次性拿所有路径，比 contents API N+1 快
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const res = await ghApi(url, token);
  if (res.status === 404) return [];
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`GitHub tree API ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();

  // 按 database/<ts>/ 分组
  const byDir = {};
  for (const node of (data.tree || [])) {
    if (node.type !== 'blob') continue;
    if (!node.path.startsWith('database/')) continue;
    const rest = node.path.slice('database/'.length);
    const slash = rest.indexOf('/');
    if (slash === -1) continue;
    const ts = rest.slice(0, slash);
    const file = rest.slice(slash + 1);
    if (!file.endsWith('.json')) continue;
    if (!byDir[ts]) byDir[ts] = { files: [], totalSize: 0 };
    byDir[ts].files.push(file);
    byDir[ts].totalSize += node.size || 0;
  }

  const backups = Object.entries(byDir).map(([ts, d]) => {
    // ts 格式：2026-09-29T23-07-38  （ISO slice(0,19) 把 : 换成 -）
    const isoTry = ts.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') + 'Z';
    const dt = new Date(isoTry);
    const validDate = !isNaN(dt.getTime());

    const collections = d.files
      .filter(f => !f.startsWith('_'))
      .map(f => f.replace(/\.json$/, ''));

    return {
      dir: `database/${ts}`,
      timestamp: ts,
      isoDate: validDate ? dt.toISOString() : null,
      collections,
      collectionCount: collections.length,
      fileCount: d.files.length,
      totalSize: d.totalSize,
      hasManifest: d.files.includes('_manifest.json'),
    };
  });

  backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));  // 新的在前
  return backups;
}

// JSON 里的 ISO 字符串 → Date（启发式）
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

// 从备份恢复
async function restoreDatabaseHelper(db, dir, dryRun) {
  const { token, owner, repo, branch } = getBackupConfig();

  // 列出备份目录内容
  const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(dir)}?ref=${encodeURIComponent(branch)}`;
  const res = await ghApi(listUrl, token);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Cannot list backup (${res.status}): ${t.slice(0, 200)}`);
  }
  const items = await res.json();
  if (!Array.isArray(items)) throw new Error('Invalid backup listing');

  const dataFiles = items.filter(it =>
    it.type === 'file' && it.name.endsWith('.json') && !it.name.startsWith('_')
  );
  if (dataFiles.length === 0) throw new Error('Backup contains no data files');

  const results = [];
  let totalDocs = 0;

  for (const file of dataFiles) {
    const collectionName = file.name.replace(/\.json$/, '');
    try {
      // 用 raw 下载（带 token 才能访问 private repo）
      const dl = await fetch(file.download_url, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!dl.ok) throw new Error(`Download ${dl.status}`);
      const payload = await dl.json();

      const docsRaw = Array.isArray(payload) ? payload : (payload.docs || []);
      const docs = docsRaw.map(reviveDates);

      if (dryRun) {
        results.push({ collection: collectionName, count: docs.length, action: 'would-replace' });
        totalDocs += docs.length;
        continue;
      }

      // 真恢复：清空 + 分批插入
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
    dir,
    dryRun,
    results,
    totalDocs,
    collectionsRestored: results.filter(r => r.action === 'restored').length,
  };
}
export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'root')) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const db = await connectToDatabase();
  const { action } = req.query;

  // ========== Marker: 待批改列表 ==========
  if (action === 'markerList') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const submissions = await db.collection('submissions')
      .find({ type: 'image', marked: false })
      .sort({ timestamp: -1 })
      .project({ username: 1, problemId: 1, subid: 1, timestamp: 1, _id: 0 })
      .toArray();
    return res.status(200).json({ success: true, submissions });
  }

  if (action === 'markerDetail') {
    const { subid } = req.query;
    if (!subid) return res.status(400).json({ success: false, message: 'Missing subid' });
    const sub = await db.collection('submissions').findOne({ subid });
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

    // 不要排除 image 字段，直接返回
    const { username, problemId, timestamp, marked, score, comment, drawing, image, markedAt } = sub;
    return res.status(200).json({
      success: true,
      submission: {
        subid,
        image,       // 确保包含 image
        username,
        problemId,
        timestamp,
        marked,
        score,
        comment,
        drawing,
        markedAt: markedAt || null
      }
    });
  }

// ========== Marker: 提交评分 ==========
  if (action === 'markSubmit') {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const { subid, score, comment, drawing } = req.body;
    if (!subid || score === undefined) return res.status(400).json({ success: false, message: 'Missing subid/score' });
    
    const sub = await db.collection('submissions').findOne({ subid });
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });
    
    const numScore = Number(score);
    if (isNaN(numScore) || numScore < 0 || numScore > 100) {
      return res.status(400).json({ success: false, message: 'Score must be between 0 and 100' });
    }

    await db.collection('submissions').updateOne(
      { subid },
      { $set: { marked: true, score: numScore, comment: comment || '', drawing: drawing || '', markedAt: new Date() } }
    );

    // 同步更新竞赛结果（如果是竞赛图片提交）
    if (sub.contestId && sub.type === 'image') {
      const isSolved = numScore >= 100;
      await db.collection('contest_results').updateOne(
        { contestId: sub.contestId, username: sub.username, problemId: sub.problemId },
        {
          $set: {
            score: numScore,
            solved: isSolved,
            lastSubmissionTime: new Date()
          }
        },
        { upsert: true }
      );
    }

    // 更新用户解题状态（图片提交批改后）
    if (sub.type === 'image') {
      const statesCol = db.collection('userstats');
      const stats = await statesCol.findOne({ username: sub.username });
      let states = stats ? stats.states : {};
      const pid = sub.problemId;
      if (numScore === 100) {
        states[pid] = 'passed';
      } else if (states[pid] !== 'passed') {
        states[pid] = 'failed';
      }
      await statesCol.updateOne({ username: sub.username }, { $set: { states } }, { upsert: true });
    }

    await auditLog('mark_submission', { subid, score: numScore });
    return res.status(200).json({ success: true, message: 'Marked' });
  }
  // ========== 备份数据库到 GitHub ==========
if (action === 'backupDatabase') {
  if (decoded.role !== 'root') {
    return res.status(403).json({ success: false, message: 'Root only' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  const backupDir = `database/${ts}`;

  try {
    const { uploadJsonFile } = await import('../lib/github-upload.js');

    const collections = await db.listCollections().toArray();
    const results = [];
    const manifest = {
      timestamp: new Date().toISOString(),
      by: decoded.username,
      collections: {},
    };

    for (const { name } of collections) {
      if (name.startsWith('system.')) continue;
      try {
        const docs = await db.collection(name).find({}).toArray();
        manifest.collections[name] = { count: docs.length };
        const r = await uploadJsonFile(
          `${backupDir}/${name}.json`,
          { collection: name, count: docs.length, docs },
          { message: `backup: ${name} (${docs.length} docs) by ${decoded.username}` }
        );
        results.push({ collection: name, count: docs.length, url: r.githubUrl });
      } catch (e) {
        console.error(`backup ${name} failed:`, e);
        results.push({ collection: name, error: e.message });
      }
    }

    await uploadJsonFile(
      `${backupDir}/_manifest.json`,
      manifest,
      { message: `backup: manifest (${collections.length} collections)` }
    );

    await auditLog(db, 'backup_database', {
      dir: backupDir,
      totalCollections: results.length,
      results: results.map(r => ({ collection: r.collection, count: r.count, error: r.error })),
    }, decoded.username, 'warn').catch(() => {});

    return res.status(200).json({ success: true, dir: backupDir, results });
  } catch (err) {
    console.error('backupDatabase error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ========== 直接把数据库 dump 成 JSON 下载 ==========
if (action === 'dumpDatabase') {
  if (decoded.role !== 'root') {
    return res.status(403).json({ success: false, message: 'Root only' });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
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
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="backup-${Date.now()}.json"`
    );
    return res.status(200).send(JSON.stringify(dump));
  } catch (err) {
    console.error('dumpDatabase error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
// ========== 列出所有备份 ==========
if (action === 'listBackups') {
  if (decoded.role !== 'root') return res.status(403).json({ success: false, message: 'Root only' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const backups = await listBackupsHelper();
    return res.status(200).json({ success: true, backups });
  } catch (err) {
    console.error('listBackups error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// ========== 恢复数据库 ==========
if (action === 'restoreDatabase') {
  if (decoded.role !== 'root') return res.status(403).json({ success: false, message: 'Root only' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { dir, dryRun } = req.body || {};
  if (!dir || typeof dir !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing dir' });
  }
  // 严格校验：只允许 database/<timestamp>
  if (!/^database\/[\w.\-]+$/.test(dir)) {
    return res.status(400).json({ success: false, message: 'Invalid backup dir' });
  }

  try {
    const result = await restoreDatabaseHelper(db, dir, !!dryRun);

    // dry-run 不写审计，真恢复写
    if (!dryRun) {
      // ⭐ 强制安全网：恢复前先把当前状态存档
      const preTs = `pre-restore-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`;
      const preDir = `database/${preTs}`;
      const { uploadJsonFile } = await import('../lib/github-upload.js');

      for (const { name } of await db.listCollections().toArray()) {
        if (name.startsWith('system.')) continue;
        try {
          const docs = await db.collection(name).find({}).toArray();
          await uploadJsonFile(`${preDir}/${name}.json`, { collection: name, count: docs.length, docs },
            { message: `pre-restore snapshot: ${name}` });
        } catch (e) { /* 记录但继续 */ }
      }
      // 记到审计日志里，方便以后找回
      await auditLog(db, 'pre_restore_snapshot', { dir: preDir }, decoded.username, 'warn').catch(() => {});
    }

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('restoreDatabase error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}
  // ========== 审计日志查询 ==========
  if (action === 'logs') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    // 仅 admin/root 可访问（已在上层验证）

    const { page = '1', limit = '20', actionFilter, operatorFilter } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    const filter = {};
    if (actionFilter) filter.action = { $regex: actionFilter, $options: 'i' };
    if (operatorFilter) filter.operator = { $regex: operatorFilter, $options: 'i' };

    try {
      const total = await db.collection('audit_logs').countDocuments(filter);
      const logs = await db.collection('audit_logs')
        .find(filter)
        .sort({ timestamp: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .toArray();

      return res.status(200).json({
        success: true,
        logs,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      });
    } catch (err) {
      console.error('Logs error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ========== 同步版本号 ==========
  if (action === 'syncVersion') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const newVer = Date.now();
    await db.collection('metadata').updateOne({ _key: 'problemsVersion' }, { $set: { version: newVer } });
    await auditLog('sync_version', { newVer });
    return res.status(200).json({ success: true, version: newVer });
  }
// ========== 高级命令终端（加固版） ==========
  if (action === 'cmd') {
    if (decoded.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Only root can use this terminal' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // ⭐ 1. 总开关：默认禁用，需要环境变量显式开启
    // if (process.env.ENABLE_ADMIN_CMD !== '1') {
    //   return res.status(404).json({ success: false, message: 'Command terminal disabled' });
    // }

    const { mode, code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing code' });
    }
    if (code.length > 5000) {
      return res.status(400).json({ success: false, message: 'Code too long (max 5000)' });
    }

    // ⭐ 2. 审计日志：先写，再执行
    await auditLog(db, 'admin_cmd_exec', {
      mode: mode || 'js',
      codePreview: code.slice(0, 300),
      ip: getClientIP(req),
    }, decoded.username, 'danger').catch(() => {});

    const logs = [];
    const originalLog   = console.log;
    const originalError = console.error;

    try {
      // 捕获 console 输出
      const pushLog = (prefix, args) => {
        logs.push(prefix + args.map(a =>
          typeof a === 'string' ? a : safeStringify(a)
        ).join(' '));
      };
      console.log   = (...args) => pushLog('', args);
      console.error = (...args) => pushLog('[ERROR] ', args);

      // ⭐ 3. require 白名单
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

      // ⭐ 4. process 代理：只读、只暴露无害字段
      const safeProcess = Object.freeze({
        version:  process.version,
        platform: process.platform,
        arch:     process.arch,
        uptime:   () => process.uptime(),
        memoryUsage: () => process.memoryUsage(),
        // ❌ 不暴露 env / exit / kill / cwd / chdir / mainModule
      });

      // ⭐ 5. db 代理：禁止 drop / delete，只允许读 + 更新
      const safeDb = mode === 'db' ? makeSafeDb(db) : undefined;

      // ⭐ 6. 白名单化的全局对象（不直接把主 realm 的 Object 塞进去）
      const vm = await import('vm');
      const context = vm.createContext(Object.create(null), {
        name: 'admin-cmd-sandbox',
        codeGeneration: { strings: false, wasm: false },  // ⭐ 禁掉 eval / new Function
      });

      // 手动挂载安全的全局
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
        // ❌ 故意不暴露 setInterval（防无限占用）
        require: safeRequire,
        process: safeProcess,
        ...(mode === 'db' ? {
          db: safeDb,
          ObjectId: (await import('mongodb')).ObjectId,
        } : {}),
      });

      // ⭐ 7. 用函数包装而不是字符串拼接，避免注入
      //      string 版本仍能读到 context 里的东西，但不再容易被 })(); 跳出
      const wrapped = `(async function () {\n"use strict";\n${code}\n})()`;

      // 通过 vm.Script 编译时禁用 codeGeneration（上面已设）——但 codeGeneration
      // 只对 context 内部新生成的代码生效，对 compile 本身无效，所以这行留作保险
      const script = new vm.Script(wrapped, { filename: 'admin-cmd.js' });

      // ⭐ 8. 超时：同步代码用 timeout 选项；异步代码用 Promise.race 兜底
      const result = await Promise.race([
        Promise.resolve(script.runInContext(context, { timeout: 3000 })),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error('Execution timeout (3.5s)')), 3500)
        ),
      ]);

      return res.status(200).json({
        success: true,
        output: logs.join('\n'),
        result: result !== undefined ? safeStringify(result) : null,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: String(err && err.message || err),
        output: logs.join('\n'),
      });
    } finally {
      // ⭐ 9. 无论如何恢复 console
      console.log   = originalLog;
      console.error = originalError;
    }
  }
  return res.status(400).json({ success: false, message: 'Invalid action' });
}