// 恢复难度：把 DB 里的 difficulty 还原为 _problems_cur.json（调整前）的值
// 用法：node _restore_difficulty.mjs          → 只预览（dry-run）
//       node _restore_difficulty.mjs --apply  → 真正写库
import fs from 'fs';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
dotenv.config({ path: 'grader/.env' });

const APPLY = process.argv.includes('--apply');

const cur = JSON.parse(fs.readFileSync('_problems_cur.json', 'utf8')).problems || [];
const curMap = new Map(cur.map(d => [String(d.id), Number(d.difficulty) || 0]));

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'wyk_math');

const docs = await db.collection('problems').find(
  {},
  { projection: { id: 1, difficulty: 1, _id: 0 } }
).toArray();

const toRevert = [];
for (const d of docs) {
  const id = String(d.id);
  const curDiff = curMap.get(id);
  if (curDiff === undefined) continue;            // cur 里没有的题跳过
  const dbDiff = Number(d.difficulty) || 0;
  if (dbDiff !== curDiff) {
    toRevert.push({ id, from: dbDiff, to: curDiff });
  }
}

console.log(`待恢复题目数：${toRevert.length}`);
for (const r of toRevert) {
  console.log(`  ${r.id.padEnd(10)} ${r.from} -> ${r.to}`);
}

if (APPLY) {
  let n = 0;
  for (const r of toRevert) {
    await db.collection('problems').updateOne(
      { id: r.id },
      { $set: { difficulty: r.to }, $unset: { difficultyLastAdjustedAt: '' } }
    );
    n++;
  }
  console.log(`\n✅ 已恢复 ${n} 道题的难度（并清除 difficultyLastAdjustedAt）`);
} else {
  console.log('\n（dry-run，未写库。加 --apply 参数才真正恢复）');
}

await client.close();
