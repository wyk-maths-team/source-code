// tools/verify-user-rating.mjs —— rating 物化正确性
//
// 验证三件事：
//   1. getUserRating 第一次（未命中）的结果 == 纯函数现算
//   2. 第二次（命中缓存）的结果 == 第一次
//   3. 缓存命中确实跳过了重算（用 cached 标志判断）

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const ROOT = 'C:/moj';
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const { getUserRating } = await import('../lib/userRating.js');
const { calculateUserRating } = await import('../lib/rating.js');

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 90000 });
await client.connect();
const db = client.db(env.MONGODB_DB || 'wyk_math');

// 现算基准
async function scratchRating(username) {
  const [doc, probs] = await Promise.all([
    db.collection('userstats').findOne({ username }, { projection: { states: 1, _id: 0 } }),
    db.collection('problems').find({}, { projection: { id: 1, difficulty: 1, _id: 0 } }).toArray(),
  ]);
  const diffMap = Object.fromEntries(probs.map(p => [p.id, Number(p.difficulty) || 0]));
  const states = doc?.states || {};
  const diffs = [];
  for (const [pid, st] of Object.entries(states)) {
    if (st === 'passed') diffs.push(diffMap[pid] || 0);
  }
  return calculateUserRating({ solvedDifficulties: diffs });
}

// 挑几个不同活跃度的用户
const heavy = await db.collection('submissions').aggregate([
  { $group: { _id: '$username', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 3 },
]).toArray();
const light = await db.collection('submissions').aggregate([
  { $group: { _id: '$username', n: { $sum: 1 } } },
  { $sort: { n: 1 } },
  { $limit: 2 },
]).toArray();

const sample = [...new Set([...heavy, ...light].map(x => x._id))].filter(u => !/^\d+$/.test(String(u)));

console.log(`抽样用户：${sample.join(', ')}\n`);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`    ✓ ${name}`); }
  else { fail++; console.log(`    ✗ ${name}  ${detail || ''}`); }
}

for (const username of sample) {
  const scratch = await scratchRating(username);
  const first = await getUserRating(db, username);       // 可能未命中 → 重算并写回
  const second = await getUserRating(db, username);      // 应命中缓存

  console.log(`  ${username}  solved=${scratch.solvedCount}`);
  check('首次结果 == 现算', first.rating === scratch.rating, `${first.rating} vs ${scratch.rating}`);
  check('effectiveMax 一致', first.effectiveMax === scratch.effectiveMax);
  check('第二次结果稳定', second.rating === first.rating);
  check('第二次命中缓存', second.cached === true, `cached=${second.cached}`);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
await client.close();
process.exit(fail === 0 ? 0 : 1);
