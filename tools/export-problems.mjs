#!/usr/bin/env node
/**
 * tools/export-problems.mjs
 *
 * 从生产 MongoDB 导出题库的四项内容：id / statement / ans / difficulty。
 *
 * 连接信息从 .env.local 读取（MONGODB_URI / MONGODB_DB），不在代码里写死。
 * 只做只读查询，不修改任何数据。
 *
 * 用法：
 *   node tools/export-problems.mjs --probe     # 只探测 collection 与字段结构
 *   node tools/export-problems.mjs             # 导出到 private/problems-export.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = process.argv.includes('--probe');

/** 极简 .env 解析：只取 KEY=VALUE，忽略注释与空行 */
function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = { ...loadEnv(path.join(ROOT, '.env.local')) };
const uri = env.MONGODB_URI;
const dbName = env.MONGODB_DB || 'wyk_math';

if (!uri) {
  console.error('未在 .env.local 中找到 MONGODB_URI');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const db = client.db(dbName);
  console.log(`已连接，数据库: ${dbName}`);

  const collections = await db.listCollections().toArray();
  console.log(`\ncollection 数量: ${collections.length}`);
  for (const c of collections) {
    const n = await db.collection(c.name).estimatedDocumentCount().catch(() => -1);
    console.log(`  ${c.name.padEnd(28)} ~${n} 条`);
  }

  // 题库很可能叫 problems
  const candidate = collections.find(c => /^problems$/i.test(c.name))
    || collections.find(c => /problem/i.test(c.name));

  if (!candidate) {
    console.log('\n未找到题库 collection');
    process.exit(0);
  }

  console.log(`\n=== 题库 collection: ${candidate.name} ===`);
  const sample = await db.collection(candidate.name).findOne();
  if (sample) {
    console.log('  字段列表:');
    for (const [k, v] of Object.entries(sample)) {
      const type = Array.isArray(v) ? 'array' : typeof v;
      let preview = '';
      if (typeof v === 'string') preview = v.slice(0, 60).replace(/\n/g, ' ');
      else if (typeof v === 'number') preview = String(v);
      console.log(`    ${k.padEnd(20)} ${type.padEnd(8)} ${preview}`);
    }
  }

  if (!PROBE) {
    const cursor = db.collection(candidate.name).find(
      {},
      { projection: { id: 1, statement: 1, ans: 1, difficulty: 1, _id: 0 } }
    );
    const docs = await cursor.toArray();

    const outDir = path.join(ROOT, 'private');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'problems-export.json');
    fs.writeFileSync(outFile, JSON.stringify(docs, null, 2), 'utf8');

    const withStmt = docs.filter(d => d.statement && String(d.statement).trim()).length;
    const withAns = docs.filter(d => d.ans !== undefined && d.ans !== null && String(d.ans).trim()).length;
    const withDiff = docs.filter(d => typeof d.difficulty === 'number').length;

    console.log(`\n已导出 ${docs.length} 条到 private/problems-export.json`);
    console.log(`  有 statement: ${withStmt}`);
    console.log(`  有 ans      : ${withAns}`);
    console.log(`  有 difficulty: ${withDiff}`);
  }
} catch (e) {
  console.error('连接或查询失败:', e.message);
  process.exit(1);
} finally {
  await client.close();
}
