#!/usr/bin/env node
// tools/probe-problems.mjs —— 探测题库文档的实际字段结构
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

const envFile = path.join(ROOT, '.env.local');
const env = loadEnv(envFile);
const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });

await client.connect();
const db = client.db(env.MONGODB_DB || 'wyk_math');
const col = db.collection('problems');

const total = await col.countDocuments();
console.log(`problems 总数: ${total}`);

const docs = await col.find({}).limit(3).toArray();
for (const [i, d] of docs.entries()) {
  console.log(`\n--- 样本 ${i + 1} 的键 ---`);
  for (const k of Object.keys(d)) {
    const v = d[k];
    const t = Array.isArray(v) ? 'array' : typeof v;
    let extra = '';
    if (typeof v === 'string') extra = ` (${v.length} 字符)`;
    else if (Array.isArray(v)) extra = ` (${v.length} 项)`;
    console.log(`  ${k.padEnd(20)} ${t.padEnd(8)}${extra}`);
  }
}

console.log('\n--- 候选字段的有值率 ---');
for (const f of ['id', 'statement', 'ans', 'difficulty', 'answer', 'content', 'name', 'problemId', 'difficultyRating']) {
  const n = await col.countDocuments({ [f]: { $exists: true, $nin: [null, ''] } });
  if (n > 0) console.log(`  ${f.padEnd(20)} ${n}/${total}`);
}

await client.close();
