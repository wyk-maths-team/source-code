import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const ROOT = 'C:/moj';
const env = {};
for (const line of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('=')) continue;
  const i=t.indexOf('='); env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,'');
}
const c = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 90000 });
await c.connect();
const db = c.db(env.MONGODB_DB||'wyk_math');

const total = await db.collection('pk_invitations').countDocuments();
const pending = await db.collection('pk_invitations').find({ status: 'pending' }, { projection: { _id:0 } }).limit(20).toArray();
console.log('pk_invitations 总数:', total);
console.log('pending 数量:', pending.length);
for (const p of pending) {
  console.log(`  id=${p.id} from=${p.from} to=${p.to} createdAt=${p.createdAt}`);
}

// 状态分布
const statuses = await db.collection('pk_invitations').aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } }
]).toArray();
console.log('\n状态分布:', JSON.stringify(statuses));

// 房间
const rooms = await db.collection('pk_rooms').countDocuments();
console.log('\npk_rooms 数量:', rooms);

await c.close();
