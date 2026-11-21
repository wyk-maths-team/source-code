// tools/backfill-grading-history.mjs
//
// 把 submissions 里已有的 AI 批改耗时一次性搬进 grading_history。
//
//   node --env-file=.env tools/backfill-grading-history.mjs           # 只报告
//   node --env-file=.env tools/backfill-grading-history.mjs --apply   # 真正写入
//
// 幂等：按 subid upsert，重复跑不会翻倍。
// 只搬元数据 —— lib/grading-history.js 的 pick() 是白名单，答案类字段进不来。

import { MongoClient } from 'mongodb';
import { COLLECTION, ensureIndexes, syncFromSubmissions } from '../lib/grading-history.js';

const APPLY = process.argv.includes('--apply');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'wyk_math';
if (!uri) { console.error('MONGODB_URI not defined'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 30_000 });
await client.connect();
const db = client.db(dbName);

const candidate = await db.collection('submissions').countDocuments({ aiGraded: true, judgingMs: { $gt: 0 } });
const existing = await db.collection(COLLECTION).estimatedDocumentCount().catch(() => 0);

console.log(`db: ${dbName}`);
console.log(`submissions 里可搬的记录: ${candidate}`);
console.log(`${COLLECTION} 现有: ${existing}  模式: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

if (!APPLY) {
  console.log('\n（加 --apply 才会写入）');
  await client.close();
  process.exit(0);
}

await ensureIndexes(db);
console.log('\n索引已就绪');

// 从最新往旧扫，每批 1000 条，用时间戳做游标
let before = null;
const total = { scanned: 0, upserted: 0, modified: 0 };
let round = 0;

for (;;) {
  round++;
  const r = await syncFromSubmissions(db, { before, limit: 1000 });
  if (!r.scanned) break;

  total.scanned += r.scanned;
  total.upserted += r.upserted;
  total.modified += r.modified;
  console.log(`  第 ${round} 批: 扫 ${r.scanned}  新增 ${r.upserted}  更新 ${r.modified}  最早 ${r.oldest && r.oldest.toISOString()}`);

  if (r.scanned < 1000 || !r.oldest) break;
  before = r.oldest;
}

const after = await db.collection(COLLECTION).countDocuments();
console.log(`\n完成: 扫描 ${total.scanned}  新增 ${total.upserted}  更新 ${total.modified}`);
console.log(`${COLLECTION} 现在共 ${after} 条`);

// 抽样确认没有把答案搬进来
const sample = await db.collection(COLLECTION).findOne({}, { sort: { submittedAt: -1 } });
console.log('\n最新一条（应只有元数据）:');
console.log(JSON.stringify(sample, null, 1));

await client.close();
