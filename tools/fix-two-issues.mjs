// tools/fix-two-issues.mjs —— 修正两处真实问题
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('problems');

// 1) HHB05：官方答案是 √2(2^2025 − 1/2)，超大数（约 1.45e609），
//    double 溢出让 6 位小数方案失效。改存精确表达式字符串（与广西 3/2+i 同策略）。
const r1 = await col.updateOne(
  { id: 'CHSMLHHB05' },
  { $set: { ans: '√2(2^2025-1/2)' } }
);
console.log(`HHB05: matched=${r1.matchedCount} modified=${r1.modifiedCount}`);

// 2) FJ08：0.3359375 是 7 位小数，按规则四舍五入到 6 位
const r2 = await col.updateOne(
  { id: 'CHSMLHFJ08' },
  { $set: { ans: '0.335938' } }
);
console.log(`FJ08: matched=${r2.matchedCount} modified=${r2.modifiedCount}`);

const a = await col.findOne({ id: 'CHSMLHHB05' }, { projection: { id: 1, ans: 1, _id: 0 } });
const b = await col.findOne({ id: 'CHSMLHFJ08' }, { projection: { id: 1, ans: 1, _id: 0 } });
console.log('结果:', JSON.stringify(a), JSON.stringify(b));

await client.close();
