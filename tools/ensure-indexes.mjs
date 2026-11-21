// tools/ensure-indexes.mjs
//
//   本地 CLI，索引的定义在 lib/indexes.js（和 API 共用一份）。
//
//   node --env-file=.env tools/ensure-indexes.mjs           # 只报告
//   node --env-file=.env tools/ensure-indexes.mjs --apply   # 真正创建
//
// 部署之后也可以不跑本地：POST /api/db-health?action=indexes（需要 admin token）。

import { MongoClient } from 'mongodb';
import { INDEX_PLAN, ensureIndexes } from '../lib/indexes.js';

const APPLY = process.argv.includes('--apply');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'wyk_math';
if (!uri) { console.error('MONGODB_URI not defined'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 20_000 });
await client.connect();
const db = client.db(dbName);

console.log(`db: ${dbName}  模式: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

if (APPLY) {
  const report = await ensureIndexes(db);
  for (const r of report) {
    const keys = Object.entries(r.keys).map(([k, v]) => `${k}:${v}`).join(',');
    console.log(`${r.created ? 'CREATE' : 'SKIP  '} ${r.collection} {${keys}}`);
    if (r.created) console.log(`       因为：${r.why}`);
  }
  const created = report.filter(r => r.created).length;
  console.log(`\n新建 ${created} 个，跳过 ${report.length - created} 个`);
} else {
  for (const spec of INDEX_PLAN) {
    const keys = Object.entries(spec.keys).map(([k, v]) => `${k}:${v}`).join(',');
    const existing = await db.collection(spec.collection).indexes().catch(() => []);
    const already = existing.some(idx =>
      Object.entries(idx.key || {}).map(([k, v]) => `${k}:${v}`).join(',') === keys);
    console.log(`${already ? 'SKIP  ' : 'WOULD '} ${spec.collection} {${keys}}`);
    if (!already) console.log(`       因为：${spec.why}`);
  }
  console.log('\n（加 --apply 才会真正创建）');
}

await client.close();
