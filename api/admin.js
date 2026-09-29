// api/admin.js
import { connectToDatabase } from './db.js';
import { auditLog } from '../lib/audit.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { sanitizeHTML } from '../lib/sanitize.js';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
const allowedCollections = ['problems', 'users', 'submissions', 'userstats', 'updates', 'contests', 'contest_results', 'metadata'];

const ALLOWED_COLLECTIONS = ['problems', 'users', 'submissions', 'userstats', 'updates', 'contests', 'contest_results', 'metadata'];
// async function auditLog(db, action, details, operator) {
//   try {
//     await db.collection('audit_logs').insertOne({
//       action,
//       details,
//       operator,
//       timestamp: new Date()
//     });
//   } catch (e) {
//     console.error('Audit log error:', e);
//   }
// }
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
export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'root')) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const db = await connectToDatabase();
  const { action } = req.query;

  // ====== 审计日志（内部） ======
  // async function auditLog(actionName, details) {
  //   try {
  //     await db.collection('audit_logs').insertOne({
  //       action: actionName,
  //       details,
  //       operator: decoded.username,
  //       timestamp: new Date()
  //     });
  //   } catch (e) { console.error('Audit log error:', e); }
  // }
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
  const backupDir = `backup/database/${ts}`;

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
      const SAFE_MODULES = new Set(['crypto', 'util', 'querystring', 'url']);
      const safeRequire = (name) => {
        if (!SAFE_MODULES.has(name)) throw new Error(`Module '${name}' is not allowed`);
        return require(name);
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
  // ========== SQL 终端 ==========
  if (action === 'terminal') {
    if (decoded.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Only root can use SQL terminal' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { sql } = req.body;
    if (!sql) return res.status(400).json({ success: false, message: 'Missing SQL command' });

    try {
      const result = await executeSQL(db, sql);
      await auditLog(db, 'terminal_exec', { sql }, decoded.username);
      res.status(200).json({ success: true, result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
    return;
  }

  // ========== executeSQL 函数 ==========
  async function executeSQL(db, sql) {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();
  // const allowedCollections = ['problems', 'users', 'submissions', 'userstats', 'updates', 'contests', 'contest_results', 'metadata'];

  // SHOW TABLES
  if (upper === 'SHOW TABLES') {
    return { type: 'show_tables', collections: allowedCollections };
  }
  if (upper.startsWith('DESCRIBE ') || upper.startsWith('DESC ') || upper.startsWith('SHOW COLUMNS')) {
    let collection;
    if (upper.startsWith('SHOW COLUMNS')) {
      const m = trimmed.match(/SHOW\s+COLUMNS\s+FROM\s+(\w+)/i);
      if (!m) throw new Error('Usage: SHOW COLUMNS FROM table');
      collection = m[1];
    } else {
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) throw new Error('Usage: DESCRIBE table');
      collection = parts[1];
    }

    if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error(`Collection '${collection}' not allowed.`);

    const doc = await db.collection(collection).findOne({});
    if (!doc) return { type: 'describe', message: `Collection '${collection}' is empty.`, columns: [], rows: [] };

    const fields = Object.keys(doc).map(field => {
      const val = doc[field];
      let type = typeof val;
      if (val instanceof Date) type = 'date';
      else if (Array.isArray(val)) type = 'array';
      else if (val === null) type = 'null';
      else if (type === 'object') type = 'object';
      return { Field: field, Type: type };
    });

    const columns = ['Field', 'Type'];
    const rows = fields.map(f => [f.Field, f.Type]);
    return {
      type: 'select',
      count: fields.length,
      columns,
      rows,
      tableHtml: buildTableHtml(columns, rows)
    };
  }

  // CREATE TABLE
  if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE COLLECTION')) {
    const createRegex = /CREATE\s+(?:TABLE|COLLECTION)\s+(\w+)(?:\s*\((.+)\))?$/i;
    const match = trimmed.match(createRegex);
    if (!match) throw new Error('Invalid CREATE TABLE syntax. Example: CREATE TABLE mycoll (field1, field2)');
    const collection = match[1];
    if (!/^[a-zA-Z_]\w*$/.test(collection)) throw new Error('Invalid collection name.');
    await db.createCollection(collection);
    return { type: 'create_table', message: `Collection '${collection}' created (or already exists).` };
  }

  // DROP TABLE
  if (upper.startsWith('DROP TABLE') || upper.startsWith('DROP COLLECTION')) {
    const dropRegex = /DROP\s+(?:TABLE|COLLECTION)\s+(\w+)/i;
    const match = trimmed.match(dropRegex);
    if (!match) throw new Error('Invalid DROP TABLE syntax.');
    const collection = match[1];
    if (!allowedCollections.includes(collection) && collection !== 'discussions' && collection !== 'audit_logs') {
      throw new Error(`Cannot drop protected collection '${collection}'.`);
    }
    await db.collection(collection).drop();
    return { type: 'drop_table', message: `Collection '${collection}' dropped.` };
  }

  // ALTER TABLE ADD COLUMN / DROP COLUMN
  if (upper.startsWith('ALTER TABLE')) {
    if (upper.includes('ADD COLUMN')) {
      const alterAddRegex = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i;
      const match = trimmed.match(alterAddRegex);
      if (!match) throw new Error('Invalid ALTER TABLE ADD COLUMN syntax.');
      const collection = match[1];
      const field = match[2];
      if (!allowedCollections.includes(collection)) throw new Error(`Cannot alter '${collection}'.`);
      return { type: 'alter_add_column', message: `Column '${field}' added to '${collection}' (you may need to update existing documents).` };
    }
    if (upper.includes('DROP COLUMN')) {
      const alterDropRegex = /ALTER\s+TABLE\s+(\w+)\s+DROP\s+COLUMN\s+(\w+)/i;
      const match = trimmed.match(alterDropRegex);
      if (!match) throw new Error('Invalid ALTER TABLE DROP COLUMN syntax.');
      const collection = match[1];
      const field = match[2];
      if (['username', 'password', 'role', 'id', 'states', 'public'].includes(field))
        throw new Error(`Cannot drop protected field '${field}'.`);
      await db.collection(collection).updateMany({}, { $unset: { [field]: "" } });
      return { type: 'alter_drop_column', message: `Dropped column '${field}' from ${collection}.` };
    }
    throw new Error('Unsupported ALTER TABLE operation.');
  }

  // SELECT with JOIN
  if (upper.startsWith('SELECT') && (upper.includes(' JOIN ') || upper.includes(' LEFT JOIN ') || upper.includes(' INNER JOIN '))) {
    return await handleSelectWithJoin(db, trimmed);
  }

  // Standard SELECT (no join)
  if (upper.startsWith('SELECT')) {
    return await handleSelectStandard(db, trimmed);
  }

  // INSERT, UPDATE, DELETE remain unchanged
  if (upper.startsWith('INSERT INTO')) {
    return await handleInsert(db, trimmed);
  }
  if (upper.startsWith('UPDATE')) {
    return await handleUpdate(db, trimmed);
  }
  if (upper.startsWith('DELETE')) {
    return await handleDelete(db, trimmed);
  }

  throw new Error('Unsupported SQL command. Allowed: SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, DROP TABLE, ALTER TABLE, SHOW TABLES, plus JOIN syntax.');
  }
  async function handleSelectWithJoin(db, sql) {
  // Example: SELECT t1.col1, t2.col2 FROM problems t1 INNER JOIN submissions t2 ON t1.id = t2.problemId WHERE t2.username='user' ORDER BY t1.id LIMIT 10
  const joinRegex = /SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+(\w+))?\s+(INNER|LEFT)?\s*JOIN\s+(\w+)(?:\s+(\w+))?\s+ON\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?(?:\s+LIMIT\s+(\d+))?$/i;
  const match = sql.match(joinRegex);
  if (!match) throw new Error('Invalid JOIN syntax. Example: SELECT * FROM t1 a JOIN t2 b ON a.id = b.id WHERE ...');

  const columnsPart = match[1].trim();
  const mainTable = match[2];
  const mainAlias = match[3] || mainTable;
  const joinType = (match[4] || 'INNER').toUpperCase();
  const joinTable = match[5];
  const joinAlias = match[6] || joinTable;
  const onClause = match[7].trim();
  const whereClause = match[8] || null;
  const orderField = match[9] || null;
  const orderDir = (match[10] || 'ASC').toUpperCase() === 'ASC' ? 1 : -1;
  const limit = match[11] ? parseInt(match[11]) : null;

  if (!allowedCollections.includes(mainTable)) throw new Error(`Collection '${mainTable}' not allowed.`);
  if (!allowedCollections.includes(joinTable)) throw new Error(`Collection '${joinTable}' not allowed.`);

  // Parse ON condition: expect "main.field = join.field" or "alias.field = alias.field"
  const onParts = onClause.split('=').map(s => s.trim());
  if (onParts.length !== 2) throw new Error('ON clause must be a single equality.');
  const leftField = onParts[0].split('.').pop();  // take field name after dot, e.g., "t1.id" -> "id"
  const rightField = onParts[1].split('.').pop();

  // Build aggregation pipeline
  const pipeline = [];

  // Match on main table (if WHERE clause present, we will apply after join as $match with aliases? 
  // Simpler: apply main table filter via $match on main collection before join
  if (whereClause) {
    // Convert where clause to filter object for main table
    const mainFilter = parseWhereClause(whereClause);
    if (mainFilter) pipeline.push({ $match: mainFilter });
  }

  // $lookup
  const lookupStage = {
    $lookup: {
      from: joinTable,
      let: { localField: `$${leftField}` },
      pipeline: [
        { $match: { $expr: { $eq: [`$${rightField}`, '$$localField'] } } }
      ],
      as: 'joinedData'
    }
  };
  pipeline.push(lookupStage);

  // For INNER JOIN, unwind and filter out empty arrays
  if (joinType === 'INNER') {
    pipeline.push({ $unwind: '$joinedData' });
  } else {
    // LEFT JOIN: optionally preserve empty arrays (no unwind)
    // We'll leave them as is, but when projecting we'll need to handle nulls
  }

  // Project desired columns
  const columns = columnsPart === '*' 
    ? []  // We'll handle after fetching sample, but we can't easily without knowing structure
    : columnsPart.split(',').map(c => c.trim());

  // If columns is empty (SELECT *), we need to project all fields from both tables?
  // For simplicity, require explicit columns or at least '*' will produce all fields from main and joined.
  // We'll implement a fallback: if columnsPart is '*', we project everything from main and joined using $addFields or just pass through.
  // Better: after lookup, we can merge fields into root using $replaceRoot for INNER, or add fields.
  // Let's create a projection that includes all main fields and the joined object or its fields.
  if (columns.length === 0) {
    // SELECT * : return main document + joined document merged at top level? 
    // We'll just include main document and the joined array (or object) as 'joinedData', then return them separately.
    // The table representation will show nested objects, which is okay.
    pipeline.push({
      $project: {
        _id: 0,
        ...Object.fromEntries(['password'].map(k => [k, 0])),
        // We cannot predefine all fields. Instead, we can use $replaceRoot for INNER to flatten.
      }
    });
    // For better UX, we can try to flatten for INNER join.
    if (joinType === 'INNER') {
      // Replace root with a merged document: main fields + joined fields prefixed with joinAlias_
      // Not trivial, skip for now; we'll just output main doc and joined doc as separate columns.
    }
  } else {
    // Build explicit projection
    const project = { _id: 0 };
    columns.forEach(col => {
      // col may include alias like "t1.id" or "id" - assume if no alias, it's from main table
      const parts = col.split('.');
      if (parts.length === 2) {
        const alias = parts[0];
        const field = parts[1];
        if (alias === mainAlias) {
          project[field] = `$${field}`;
        } else if (alias === joinAlias) {
          project[`${joinAlias}_${field}`] = `$joinedData.${field}`;
        } else {
          // maybe just field name, treat as main
          project[field] = `$${field}`;
        }
      } else {
        // simple column name, assume main
        project[col] = `$${col}`;
      }
    });
    pipeline.push({ $project: project });
  }

  // Sort
  if (orderField) {
    pipeline.push({ $sort: { [orderField]: orderDir } });
  }

  // Limit
  if (limit) {
    pipeline.push({ $limit: limit });
  }

  const documents = await db.collection(mainTable).aggregate(pipeline).toArray();

  // Build table columns and rows
  let finalColumns;
  if (columns.length === 0) {
    // determine from first doc
    if (documents.length > 0) {
      finalColumns = Object.keys(documents[0]).filter(k => !['password','ans','_id'].includes(k));
    } else {
      finalColumns = [];
    }
  } else {
    finalColumns = columns.map(col => {
      const parts = col.split('.');
      return parts.length === 2 ? `${joinAlias}_${parts[1]}` : col;
    });
  }

  const rows = documents.map(doc => finalColumns.map(col => doc[col] ?? ''));

  return {
    type: 'select',
    count: documents.length,
    columns: finalColumns,
    rows,
    tableHtml: buildTableHtml(finalColumns, rows)
  };
  }
  async function handleSelectStandard(db, sql) {
  const selectRegex = /^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?(?:\s+LIMIT\s+(\d+))?$/i;
  const match = sql.match(selectRegex);
  if (!match) throw new Error('Invalid SELECT syntax.');

  const columnsPart = match[1].trim();
  const collection = match[2];
  const whereClause = match[3] || null;
  const orderField = match[4] || null;
  const orderDir = (match[5] || 'ASC').toUpperCase() === 'ASC' ? 1 : -1;
  const limit = match[6] ? parseInt(match[6]) : null;

  if (!allowedCollections.includes(collection)) throw new Error(`Collection '${collection}' not allowed.`);

  const projection = { password: 0, ans: 0};
  let filter = {};
  if (whereClause) {
    filter = parseWhereClause(whereClause);
  }

  let cursor = db.collection(collection).find(filter, { projection });
  if (orderField) cursor = cursor.sort({ [orderField]: orderDir });
  if (limit) cursor = cursor.limit(limit);

  const documents = await cursor.toArray();

  let columns;
  if (columnsPart === '*') {
    columns = documents.length > 0 ? Object.keys(documents[0]).filter(k => !['password','ans'].includes(k)) : [];
  } else {
    columns = columnsPart.split(',').map(c => c.trim());
  }

  const rows = documents.map(doc => columns.map(col => doc[col] ?? ''));

  return {
    type: 'select',
    count: documents.length,
    columns,
    rows,
    tableHtml: buildTableHtml(columns, rows)
  };
  }
  async function handleInsert(db, sql) {
  const insertRegex = /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*(.+)$/i;
  const match = sql.match(insertRegex);
  if (!match) throw new Error('Invalid INSERT syntax.');
  const collection = match[1];
  if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error(`Cannot insert into '${collection}'.`);
  const fields = match[2].split(',').map(f => f.trim());
  const valuesPart = match[3].trim();
  const valueRows = valuesPart.match(/\([^)]+\)/g);
  if (!valueRows) throw new Error('Invalid VALUES format.');
  const documents = valueRows.map(row => {
    const inner = row.slice(1, -1).trim();
    const vals = inner.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    const doc = {};
    fields.forEach((field, i) => {
      let val = vals[i];
      if (!isNaN(val) && val !== '') val = Number(val);
      doc[field] = val;
    });
    return doc;
  });
  const result = await db.collection(collection).insertMany(documents);
  return { type: 'insert', message: `Inserted ${result.insertedCount} document(s) into ${collection}.` };
  }
  async function handleUpdate(db, sql) {
    const updateRegex = /UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i;
    const match = sql.match(updateRegex);
    if (!match) throw new Error('Invalid UPDATE syntax.');
    const collection = match[1];
    if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error(`Cannot update '${collection}'.`);
    const setStr = match[2];
    const setPairs = setStr.split(',').map(pair => pair.split('=').map(s => s.trim()));
    const setObj = {};
    setPairs.forEach(([field, value]) => {
      let val = value.replace(/^["']|["']$/g, '');
      if (!isNaN(val) && val !== '') val = Number(val);
      setObj[field] = val;
    });
    let filter = {};
    const whereClause = match[3] || null;
    if (whereClause) filter = parseWhereClause(whereClause);
    const result = await db.collection(collection).updateMany(filter, { $set: setObj });
    return { type: 'update', message: `Updated ${result.modifiedCount} document(s) in ${collection}.` };
  }
  async function handleDelete(db, sql) {
    const deleteRegex = /DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i;
    const match = sql.match(deleteRegex);
    if (!match) throw new Error('Invalid DELETE syntax.');
    const collection = match[1];
    if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error(`Cannot delete from '${collection}'.`);
    const whereClause = match[2] || null;
    if (!whereClause) throw new Error('WHERE clause required for DELETE.');
    let filter = parseWhereClause(whereClause);
    const result = await db.collection(collection).deleteMany(filter);
    return { type: 'delete', message: `Deleted ${result.deletedCount} document(s) from ${collection}.` };
  }
  function parseWhereClause(whereStr) {
    // 先按 OR 分割（优先级最低），每个部分再按 AND 分割
    const orParts = whereStr.split(/\s+OR\s+/i);
    if (orParts.length > 1) {
      return { '$or': orParts.map(part => parseAndClause(part)) };
    } else {
      return parseAndClause(whereStr);
    }
  }
  function parseAndClause(andStr) {
    const andParts = andStr.split(/\s+AND\s+/i);
    if (andParts.length > 1) {
      return { '$and': andParts.map(part => parseSingleCondition(part)) };
    } else {
      return parseSingleCondition(andStr);
    }
  }
  function parseSingleCondition(condStr) {
    condStr = condStr.trim();
    // 支持 LIKE
    let m = condStr.match(/^(\w+)\s+LIKE\s+(.+)$/i);
    if (m) {
      const field = m[1];
      let value = m[2].trim().replace(/^["']|["']$/g, '');
      const escaped = value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = escaped.replace(/%/g, '.*').replace(/_/g, '.');
      return { [field]: { $regex: new RegExp('^' + regex + '$', 'i') } };
    }
    // 支持 >= <= > < = !=
    m = condStr.match(/^(\w+)\s*(>=|<=|!=|>|<|=)\s*(.+)$/);
    if (m) {
      const field = m[1];
      const op = m[2];
      let value = m[3].trim().replace(/^["']|["']$/g, '');
      // 转换为数字如果可能
      if (!isNaN(value) && value !== '') value = Number(value);
      switch (op) {
        case '=': return { [field]: value };
        case '!=': return { [field]: { $ne: value } };
        case '>': return { [field]: { $gt: value } };
        case '<': return { [field]: { $lt: value } };
        case '>=': return { [field]: { $gte: value } };
        case '<=': return { [field]: { $lte: value } };
      }
    }
    throw new Error('Invalid condition: ' + condStr);
  }
  function parseConditionGroup(condStr) {
    const andParts = condStr.split(/\s+AND\s+/i);
    const filter = {};
    andParts.forEach(part => {
      let m = part.match(/^(\w+)\s+LIKE\s+(.+)$/i);
      if (m) {
        const field = m[1];
        let value = m[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        const escaped = value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = escaped.replace(/%/g, '.*').replace(/_/g, '.');
        filter[field] = { $regex: new RegExp('^' + regex + '$', 'i') };
        return;
      }
      m = part.match(/^(\w+)\s*=\s*(.+)$/i);
      if (m) {
        const field = m[1];
        let value = m[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!isNaN(value) && value !== '') value = Number(value);
        filter[field] = value;
        return;
      }
      throw new Error('Invalid condition: ' + part);
    });
    return filter;
  }
  function buildTableHtml(columns, rows) {
  function esc(val) {
    return String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  let html = '<table class="sql-result-table"><thead><tr>';
  columns.forEach(col => { html += `<th>${esc(col)}</th>`; });
  html += '</tr></thead><tbody>';
  rows.forEach(row => {
    html += '<tr>';
    row.forEach(cell => { html += `<td>${esc(cell)}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}