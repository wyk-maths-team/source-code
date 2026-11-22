// tools/verify-materialized-stats.mjs —— 物化统计 vs 全量现算，逐字段对照
//
// 这是第二步（成就计数物化）的正确性验证：
// 对若干真实用户，分别用
//   A) 物化路径：collectStats()（只读 userstats）
//   B) 全量路径：直接扫 submissions 现算
// 两边必须完全一致。不一致就说明增量维护漏了情况。

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

const { collectStats, getHktToday } = await import('../lib/achievements.js');

// achievements.js 没导出这个（内部用），这里照抄一份给基准计算用
function getHktDayStartUtc() {
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  return new Date(new Date(today + 'T00:00:00.000Z').getTime() - 8 * 3600_000);
}

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 90000 });
await client.connect();
const db = client.db(env.MONGODB_DB || 'wyk_math');

// ── 全量现算（旧实现的逻辑，作为基准）──
async function computeFromScratch(username) {
  const todayStart = getHktDayStartUtc();
  const AC_FILTER = {
    $or: [
      { type: 'image', marked: true, score: 100 },
      { type: { $ne: 'image' }, correct: true, systemError: { $ne: true } },
    ],
  };

  const [statsDoc, firstSubs, todayACIds, todayTriedIds, allSolvedIds, allTriedIds] = await Promise.all([
    db.collection('userstats').findOne({ username }, { projection: { states: 1, _id: 0 } }),
    db.collection('submissions').aggregate([
      { $match: { username } },
      { $sort: { timestamp: 1 } },
      { $group: {
        _id: '$problemId',
        firstType: { $first: '$type' }, firstCorrect: { $first: '$correct' },
        firstSystemError: { $first: '$systemError' }, firstMarked: { $first: '$marked' },
        firstScore: { $first: '$score' },
      }},
    ]).toArray(),
    db.collection('submissions').distinct('problemId', { username, timestamp: { $gte: todayStart }, ...AC_FILTER }),
    db.collection('submissions').distinct('problemId', { username, timestamp: { $gte: todayStart } }),
    db.collection('submissions').distinct('problemId', { username, ...AC_FILTER }),
    db.collection('submissions').distinct('problemId', { username }),
  ]);

  const states = statsDoc?.states || {};
  const passedIds = Object.entries(states).filter(([, v]) => v === 'passed').map(([k]) => k);

  const diffs = await db.collection('problems')
    .find({ id: { $in: passedIds } }, { projection: { id: 1, difficulty: 1, _id: 0 } }).toArray();
  const diffMap = Object.fromEntries(diffs.map(p => [p.id, Number(p.difficulty) || 0]));

  let maxDifficulty = 0;
  for (const pid of passedIds) maxDifficulty = Math.max(maxDifficulty, diffMap[pid] || 0);

  let firstTryCount = 0;
  for (const s of firstSubs) {
    const passed = (s.firstType === 'image')
      ? (s.firstMarked === true && s.firstScore === 100)
      : (s.firstCorrect === true && s.firstSystemError !== true);
    if (passed) firstTryCount++;
  }

  const allTried = allTriedIds.length;
  const allSolved = allSolvedIds.length;

  return {
    solvedCount: passedIds.length,
    maxDifficulty: Math.round(maxDifficulty * 100) / 100,
    firstTryCount,
    todayAC: todayACIds.length,
    todayTried: todayTriedIds.length,
    allTried,
    allSolved,
    accuracy: allTried > 0 ? allSolved / allTried : 0,
  };
}

// 挑几个提交量最大的用户，最有代表性
const heavy = await db.collection('submissions').aggregate([
  { $group: { _id: '$username', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 5 },
]).toArray();

const sample = heavy.map(h => h._id).filter(u => !/^\d+$/.test(String(u)));

console.log(`抽样用户：${sample.join(', ')}\n`);

let pass = 0, fail = 0;

for (const username of sample) {
  const subs = await db.collection('submissions').countDocuments({ username });

  const scratch = await computeFromScratch(username);
  const materialized = await collectStats(db, username, { fresh: true });

  // ── A. 语义未变的三项：必须完全一致（证明增量维护没漏）──
  const strictKeys = ['firstTryCount', 'todayAC', 'todayTried'];
  const diffs = [];
  for (const k of strictKeys) {
    if (Number(scratch[k]) !== Number(materialized[k])) {
      diffs.push(`${k}: 现算=${scratch[k]} 物化=${materialized[k]}`);
    }
  }

  // ── B. 语义收紧的三项：应以 states 为准 ──
  // 旧口径 distinct() 把 systemError / 未批改 / 已删题都算成「尝试过」，
  // 导致分母虚高。这里确认物化值 == states 口径。
  const states = (await db.collection('userstats').findOne(
    { username }, { projection: { states: 1, _id: 0 } }
  ))?.states || {};
  const passedCount = Object.values(states).filter(v => v === 'passed').length;
  const triedCount = Object.keys(states).length;

  if (materialized.solvedCount !== passedCount) {
    diffs.push(`solvedCount: 物化=${materialized.solvedCount} states=${passedCount}`);
  }
  if (materialized.allTried !== triedCount) {
    diffs.push(`allTried: 物化=${materialized.allTried} states=${triedCount}`);
  }
  if (materialized.allSolved !== passedCount) {
    diffs.push(`allSolved: 物化=${materialized.allSolved} states=${passedCount}`);
  }

  // 报告旧口径与 states 的差距（不是失败，是口径收紧）
  const lostTried = scratch.allTried - triedCount;
  const lostSolved = scratch.allSolved - passedCount;

  if (diffs.length === 0) {
    pass++;
    const note = (lostTried || lostSolved)
      ? `  ← 旧口径虚高 ${lostTried} 题尝试 / ${lostSolved} 题 AC`
      : '';
    console.log(`  ✓ ${username}  (${subs} 次提交)  solved=${materialized.solvedCount} firstTry=${materialized.firstTryCount} allTried=${materialized.allTried}${note}`);
  } else {
    fail++;
    console.log(`  ✗ ${username}  (${subs} 次提交)`);
    for (const d of diffs) console.log(`      ${d}`);
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
await client.close();
process.exit(fail === 0 ? 0 : 1);
