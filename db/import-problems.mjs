// =====================================================================
// db/import-problems.mjs —— 把 MongoDB 的题库灌进 PostgreSQL
// =====================================================================
//
// 用法：
//   node db/import-problems.mjs           # 真灌
//   node db/import-problems.mjs --dry     # 只统计，不写库
//   node db/import-problems.mjs --prune   # 灌完后删掉 PG 里 Mongo 已经不存在的题目
//
// 前置：先跑过 db/reset.sql + db/schema.sql。
//
// 设计：
//   · 幂等。按 problem_id upsert，重复跑结果一致，不会产生重复行。
//   · 不改主键。problem_no 由数据库自增，只在新插入时生成。
//   · 标签按名去重后写入 tags，再重建该题的 problem_tags。
//   · 不删除任何 Mongo 数据 —— 迁移期间 Mongo 仍是可回退的副本。
//
// 连接串来源与 tools/migrate-pg.mjs 一致：先读 process.env，再读仓库根 .env.local。
// 不要把连接串写死在这个文件里 —— 它会被提交进 git。
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import pg from 'pg';

const { Pool } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const PRUNE = process.argv.includes('--prune');
const CHUNK = 500;

function loadEnv() {
  const p = path.join(ROOT, '.env.local');
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const MONGO_URI = process.env.MONGODB_URI || env.MONGODB_URI;
const MONGO_DB  = process.env.MONGODB_DB  || env.MONGODB_DB || 'wyk_math';
const PG_URI    = process.env.DATABASE_URL || env.DATABASE_URL;

if (!MONGO_URI) { console.error('缺少 MONGODB_URI'); process.exit(1); }
if (!PG_URI && !DRY) { console.error('缺少 DATABASE_URL'); process.exit(1); }

const chunks = (arr, n = CHUNK) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** 标签名清洗：与迁移脚本保持一致的规则 */
function cleanTags(list) {
  if (!Array.isArray(list)) return [];
  const out = new Set();
  for (const raw of list) {
    const name = String(raw == null ? '' : raw).trim();
    if (!name || name.length > 64) continue;
    out.add(name);
  }
  return [...out];
}

/** Mongo 文档 -> problems 行（顺序必须与 INSERT 的列一致） */
function toRow(p) {
  const diff = Number(p.difficulty);
  return [
    String(p.id),
    p.name == null ? '' : String(p.name),
    p.statement == null ? '' : String(p.statement),
    p.ans == null ? '' : String(p.ans),
    Number.isFinite(diff) ? diff : null,
    p.public === true || p.public === 'true',
    p.FS === true,
    p.logic ? String(p.logic) : null,
  ];
}

/** 生成多行 VALUES 占位符，返回 { sql, values } */
function buildInsert(prefix, rows, onConflict) {
  const values = [];
  let n = 0;
  const tuples = rows.map(r => {
    const ph = r.map(v => { values.push(v); return '$' + (++n); });
    return '(' + ph.join(', ') + ')';
  });
  return { sql: prefix + tuples.join(', ') + (onConflict || ''), values };
}

async function main() {
  const mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 60000 });
  await mongo.connect();
  const mdb = mongo.db(MONGO_DB);

  let pool = null;
  if (!DRY) pool = new Pool({ connectionString: PG_URI, max: 4, connectionTimeoutMillis: 15000 });

  try {
    const docs = await mdb.collection('problems').find({}).toArray();
    console.log('Mongo problems: ' + docs.length + ' 条');

    const rows = [];
    const perProblemTags = new Map();
    const allTagNames = new Set();
    let skipped = 0;

    for (const p of docs) {
      if (!p || !p.id) { skipped++; continue; }
      const pid = String(p.id);
      rows.push(toRow(p));
      const tags = cleanTags(p.tags);
      if (tags.length) {
        perProblemTags.set(pid, tags);
        for (const t of tags) allTagNames.add(t);
      }
    }

    console.log('可导入 ' + rows.length + ' 条（跳过无 id 的 ' + skipped + ' 条）');
    console.log('标签：' + allTagNames.size + ' 个不同的名字，' +
      perProblemTags.size + ' 道题带标签');

    if (DRY) {
      console.log('\n[--dry] 未写库。');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ---- 1. problems ----
      let inserted = 0, updated = 0;
      const head = 'INSERT INTO problems ' +
        '(problem_id, name, statement, answer, difficulty, is_public, force_steps, logic) VALUES ';
      const upsert = ' ON CONFLICT (problem_id) DO UPDATE SET ' +
        'name = EXCLUDED.name, statement = EXCLUDED.statement, ' +
        'answer = EXCLUDED.answer, difficulty = EXCLUDED.difficulty, ' +
        'is_public = EXCLUDED.is_public, force_steps = EXCLUDED.force_steps, ' +
        'logic = EXCLUDED.logic, updated_at = NOW() ' +
        'RETURNING (xmax = 0) AS inserted';
      for (const part of chunks(rows)) {
        const q = buildInsert(head, part, upsert);
        const r = await client.query(q.sql, q.values);
        for (const row of r.rows) { if (row.inserted) inserted++; else updated++; }
      }
      console.log('problems: 新增 ' + inserted + '，更新 ' + updated);

      // ---- 2. tags ----
      const tagNames = [...allTagNames].sort();
      for (const part of chunks(tagNames.map(x => [x]))) {
        const q = buildInsert('INSERT INTO tags (name) VALUES ', part,
          ' ON CONFLICT (name) DO NOTHING');
        await client.query(q.sql, q.values);
      }
      const tagMap = new Map();
      const tq = await client.query(
        'SELECT tag_no, name FROM tags WHERE name = ANY($1::text[])', [tagNames]);
      for (const r of tq.rows) tagMap.set(r.name, r.tag_no);
      console.log('tags: 写入 ' + tagNames.length + ' 个名字');

      // ---- 3. problem_tags（先删后插，幂等）----
      const pids = [...perProblemTags.keys()];
      for (const part of chunks(pids, 1000)) {
        await client.query(
          'DELETE FROM problem_tags WHERE problem_id = ANY($1::text[])', [part]);
      }
      const links = [];
      for (const [pid, names] of perProblemTags) {
        for (const name of names) {
          const tagNo = tagMap.get(name);
          if (tagNo) links.push([pid, tagNo]);
        }
      }
      let linkCount = 0;
      for (const part of chunks(links)) {
        const q = buildInsert('INSERT INTO problem_tags (problem_id, tag_no) VALUES ', part,
          ' ON CONFLICT DO NOTHING');
        await client.query(q.sql, q.values);
        linkCount += part.length;
      }
      console.log('problem_tags: 写入 ' + linkCount + ' 条关联');

      // ---- 4. 可选：删掉 PG 里 Mongo 已经不存在的题目 ----
      if (PRUNE) {
        const mongoPids = rows.map(r => r[0]);
        const del = await client.query(
          'DELETE FROM problems WHERE NOT (problem_id = ANY($1::text[])) RETURNING problem_id',
          [mongoPids]);
        const sample = del.rows.slice(0, 10).map(r => r.problem_id).join(', ');
        console.log('prune: 删除 ' + del.rowCount + ' 条 PG 独有的题目' +
          (del.rowCount ? '（' + sample + (del.rowCount > 10 ? '…' : '') + '）' : ''));
      }

      // ---- 5. 版本号 ----
      await client.query(
        "UPDATE app_settings SET value = jsonb_set(value, '{version}', to_jsonb($1::bigint)), " +
        "updated_at = NOW() WHERE key = 'problemsVersion'",
        [Date.now()]);

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    // ---- 6. 核对 ----
    const checks = [
      ['problems', 'SELECT COUNT(*)::int AS n FROM problems'],
      ['公开题', 'SELECT COUNT(*)::int AS n FROM problems WHERE is_public'],
      ['tags', 'SELECT COUNT(*)::int AS n FROM tags'],
      ['problem_tags', 'SELECT COUNT(*)::int AS n FROM problem_tags'],
      ['无标签的题', 'SELECT COUNT(*)::int AS n FROM problems p WHERE NOT EXISTS ' +
        '(SELECT 1 FROM problem_tags pt WHERE pt.problem_id = p.problem_id)'],
    ];
    console.log('\n=== 核对 ===');
    for (const [label, sql] of checks) {
      const r = await pool.query(sql);
      console.log('  ' + label.padEnd(14) + ' ' + r.rows[0].n);
    }
    const top = await pool.query(
      'SELECT problem_id, name, difficulty FROM problems ' +
      'ORDER BY id_prefix, id_num, problem_id LIMIT 5');
    console.log('\n自然序前 5 题：');
    console.table(top.rows);

    console.log('\n导入完成。');
  } finally {
    await mongo.close();
    if (pool) await pool.end();
  }
}

main().catch(err => {
  console.error('\n导入失败：', err);
  process.exit(1);
});
