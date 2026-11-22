import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const ROOT = 'C:/moj';
const env = {};
for (const line of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('=')) continue;
  const i=t.indexOf('='); env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,'');
}
const c = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await c.connect();
const col = c.db(env.MONGODB_DB||'wyk_math').collection('problems');
const bad = await col.find({ id: /^CHSMLH/, public: { $ne: false } }, { projection: { id:1, public:1, _id:0 } }).toArray();
console.log('public != false 的记录:', bad.length);
for (const d of bad) console.log('  ', d.id, '->', d.public);
if (bad.length) {
  const r = await col.updateMany({ id: /^CHSMLH/, public: { $ne: false } }, { $set: { public: false } });
  console.log('已修正:', r.modifiedCount);
}
const left = await col.countDocuments({ id: /^CHSMLH/, public: { $ne: false } });
console.log('剩余:', left);
await c.close();
