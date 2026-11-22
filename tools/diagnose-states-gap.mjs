// tools/diagnose-states-gap.mjs —— 查 userstats.states 与 submissions 为什么对不上
//
// 物化改造暴露了一个先前没人注意的问题：
//   distinct(problemId) 能数出 642 道题，但 states 只有 635 个 key。
// 说明有两个不同的真相源在各自演化。这里把它们摊开看。

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

const username = process.argv[2] || 'root';

const [statsDoc, subPids, allPids] = await Promise.all([
  db.collection('userstats').findOne({ username }, { projection: { states: 1, _id: 0 } }),
  db.collection('submissions').distinct('problemId', { username }),
  db.collection('problems').distinct('id'),
]);

const states = statsDoc?.states || {};
const stateKeys = new Set(Object.keys(states));
const subSet = new Set(subPids);
const knownProblems = new Set(allPids);

console.log(`用户：${username}`);
console.log(`  submissions 里的题目数: ${subSet.size}`);
console.log(`  states 里的题目数:      ${stateKeys.size}`);
console.log(`  题库总题数:             ${knownProblems.size}`);

const inSubNotState = [...subSet].filter(p => !stateKeys.has(p));
const inStateNotSub = [...stateKeys].filter(p => !subSet.has(p));

console.log(`\n在 submissions 但不在 states: ${inSubNotState.length}`);
for (const pid of inSubNotState.slice(0, 15)) {
  const subs = await db.collection('submissions')
    .find({ username, problemId: pid }, { projection: { type: 1, correct: 1, score: 1, marked: 1, timestamp: 1, systemError: 1, _id: 0 } })
    .sort({ timestamp: -1 }).limit(3).toArray();
  const exists = knownProblems.has(pid);
  console.log(`  ${pid}  题目还存在=${exists}`);
  for (const s of subs) {
    console.log(`     ${new Date(s.timestamp).toISOString().slice(0,10)} type=${s.type||'-'} correct=${s.correct} score=${s.score} marked=${s.marked} sysErr=${s.systemError||false}`);
  }
}

console.log(`\n在 states 但不在 submissions: ${inStateNotSub.length}`);
for (const pid of inStateNotSub.slice(0, 15)) {
  console.log(`  ${pid}  state=${states[pid]}  题目还存在=${knownProblems.has(pid)}`);
}

// 统计：states 里 passed 的题，在 submissions 里是否真有 AC 记录
const passedIds = Object.entries(states).filter(([, v]) => v === 'passed').map(([k]) => k);
console.log(`\nstates 中 passed: ${passedIds.length}`);

let passedWithoutAC = 0;
const samples = [];
for (const pid of passedIds) {
  const ac = await db.collection('submissions').countDocuments({
    username, problemId: pid,
    $or: [
      { type: 'image', marked: true, score: 100 },
      { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
    ],
  });
  if (ac === 0) { passedWithoutAC++; if (samples.length < 5) samples.push(pid); }
}
console.log(`  其中在 submissions 里找不到 AC 记录的: ${passedWithoutAC}`);
if (samples.length) console.log(`  样例: ${samples.join(', ')}`);

await client.close();
