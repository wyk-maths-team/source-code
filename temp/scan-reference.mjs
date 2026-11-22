// temp/scan-reference.mjs —— 确认 Reference 没有被抄进任何用户可见字段
import { MongoClient } from 'mongodb';
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 30_000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'wyk_math');

const checks = [
  ['problems', 'statement'],
  ['problems', 'name'],
  ['solutions', 'content'],
  ['solutions', 'statement'],
  ['discussions', 'content'],
  ['reports', 'description'],
];
let hit = 0;
for (const [col, field] of checks) {
  try {
    const n = await db.collection(col).countDocuments({ [field]: /Reference\s*:/i });
    if (n) { console.log(`  ${col}.${field}: ${n} 条`); hit += n; }
  } catch { /* 字段不存在就跳过 */ }
}
console.log(hit ? `共 ${hit} 处含 Reference` : '所有用户可见字段里都没有 Reference');

// 顺带：statement 里是否混进了卷面页眉页脚
const junk = await db.collection('problems').countDocuments({
  id: /^MO/,
  $or: [
    { statement: /HKMHASC/i },
    { statement: /Created by/i },
    { statement: /Page \d+/i },
  ],
});
console.log(`MO 题 statement 里混入页眉页脚: ${junk} 条`);
await c.close();
