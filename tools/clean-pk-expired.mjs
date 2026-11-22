// tools/clean-pk-expired.mjs —— 清理已过期但仍标记为 pending 的 PK 邀请
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

const DRY = process.argv.includes('--dry');

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 90000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('pk_invitations');

const now = new Date();
console.log('now =', now.toISOString());

// 找出所有过期但仍 pending 的
const stale = await col.find(
  { status: 'pending', expiresAt: { $lt: now } },
  { projection: { id: 1, from: 1, to: 1, createdAt: 1, expiresAt: 1, _id: 0 } }
).toArray();

console.log(`\n已过期仍为 pending 的记录: ${stale.length}`);
for (const s of stale) {
  const age = Math.round((now - new Date(s.expiresAt)) / 60000);
  console.log(`  ${s.id}  ${s.from} -> ${s.to}   过期 ${age} 分钟`);
}

// 另找：没有 expiresAt 字段的 pending（老数据）
const noExpiry = await col.find(
  { status: 'pending', expiresAt: { $exists: false } },
  { projection: { id: 1, from: 1, to: 1, createdAt: 1, _id: 0 } }
).toArray();
if (noExpiry.length) {
  console.log(`\n没有 expiresAt 字段的 pending: ${noExpiry.length}`);
  for (const s of noExpiry) console.log(`  ${s.id}  ${s.from} -> ${s.to}  createdAt=${s.createdAt}`);
}

if (DRY) {
  console.log('\n[DRY RUN] 未做修改');
} else {
  const r1 = await col.updateMany(
    { status: 'pending', expiresAt: { $lt: now } },
    { $set: { status: 'expired', expiredAt: now } }
  );
  console.log(`\n已标记为 expired: ${r1.modifiedCount}`);

  if (noExpiry.length) {
    const r2 = await col.updateMany(
      { status: 'pending', expiresAt: { $exists: false } },
      { $set: { status: 'expired', expiredAt: now } }
    );
    console.log(`无 expiresAt 的老记录也已标记: ${r2.modifiedCount}`);
  }

  const remain = await col.countDocuments({ status: 'pending' });
  console.log(`剩余 pending: ${remain}`);
}

await client.close();
