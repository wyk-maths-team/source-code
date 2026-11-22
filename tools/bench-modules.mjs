// tools/bench-modules.mjs —— 量化三处物化的收益
//
// 用真实数据测：旧路径（每次现算）vs 新路径（读物化值）。

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

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 90000 });
await client.connect();
const db = client.db(env.MONGODB_DB || 'wyk_math');

const { getUserRating } = await import('../lib/userRating.js');
const { collectStats } = await import('../lib/achievements.js');
const { getPublicProblems } = await import('../lib/problemCache.js');
const { calculateUserRating } = await import('../lib/rating.js');

async function time(label, fn, iters = 1) {
  await fn();                          // 预热（建缓存）
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) await fn();
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6 / iters;
  console.log(`  ${label.padEnd(48)} ${ms.toFixed(2)} ms/次`);
  return ms;
}

const username = 'root';
const subs = await db.collection('submissions').countDocuments({ username });
console.log(`测试用户: ${username}（${subs} 次提交）\n`);

console.log('=== 1. Profile 的题库元数据 ===');
const oldProblems = await time('旧：每次拉全部 public 题目', async () => {
  const rows = await db.collection('problems')
    .find({ public: true }, { projection: { id: 1, difficulty: 1, _id: 0 } }).toArray();
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  return rows.length;
}, 5);

const newProblems = await time('新：读 60s 缓存', async () => {
  const d = await getPublicProblems(db);
  return d.list.length;
}, 5);

console.log(`  → 提速 ${(oldProblems / Math.max(newProblems, 0.001)).toFixed(0)}x\n`);

console.log('=== 2. 成就统计 ===');
const oldStats = await time('旧：4 个 distinct + 聚合扫 submissions', async () => {
  const AC_FILTER = { $or: [
    { type: 'image', marked: true, score: 100 },
    { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
  ]};
  const todayStart = new Date(new Date(new Date(Date.now() + 8*3600_000).toISOString().slice(0,10) + 'T00:00:00.000Z').getTime() - 8*3600_000);
  await Promise.all([
    db.collection('submissions').aggregate([
      { $match: { username } }, { $sort: { timestamp: 1 } },
      { $group: { _id: '$problemId', f: { $first: '$correct' } } },
    ]).toArray(),
    db.collection('submissions').distinct('problemId', { username, timestamp: { $gte: todayStart }, ...AC_FILTER }),
    db.collection('submissions').distinct('problemId', { username, timestamp: { $gte: todayStart } }),
    db.collection('submissions').distinct('problemId', { username, ...AC_FILTER }),
    db.collection('submissions').distinct('problemId', { username }),
  ]);
}, 3);

const newStats = await time('新：只读 userstats（物化）', async () => {
  await collectStats(db, username, { fresh: true });   // fresh 仍不碰 submissions
}, 3);

console.log(`  → 提速 ${(oldStats / Math.max(newStats, 0.001)).toFixed(0)}x\n`);

console.log('=== 3. Rating ===');
const probs = await db.collection('problems').find({}, { projection: { id: 1, difficulty: 1, _id: 0 } }).toArray();
const diffMap = Object.fromEntries(probs.map(p => [p.id, Number(p.difficulty) || 0]));
const statesDoc = await db.collection('userstats').findOne({ username }, { projection: { states: 1 } });
const diffs = Object.entries(statesDoc?.states || {})
  .filter(([, v]) => v === 'passed').map(([pid]) => diffMap[pid] || 0);

const oldRating = await time('旧：每次 sort + 加权（内存）', async () => {
  calculateUserRating({ solvedDifficulties: diffs });
}, 20);

const newRating = await time('新：读物化缓存（命中）', async () => {
  await getUserRating(db, username);
}, 20);

console.log(`  → 提速 ${(oldRating / Math.max(newRating, 0.001)).toFixed(0)}x`);
console.log(`  （旧路径另外还要查一次 problems 表，这里只算了纯计算部分）`);

await client.close();
