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
const col = c.db(env.MONGODB_DB||'wyk_math').collection('problems');

const all = await col.find({ id: /^CHSMLH/ }, { projection: { id:1, ans:1, public:1, _id:0 } }).toArray();
const answered = all.filter(d => String(d.ans ?? '').trim() !== '');
const blank = all.filter(d => String(d.ans ?? '').trim() === '');
console.log(`总数 ${all.length}  有答案 ${answered.length}  无答案(证明题) ${blank.length}`);

const r = await col.updateMany(
  { id: /^CHSMLH/, ans: { $nin: ['', null] } },
  { $set: { public: true } }
);
console.log(`已设为 public: ${r.modifiedCount}`);

const after = await col.find({ id: /^CHSMLH/ }, { projection: { id:1, ans:1, public:1, _id:0 } }).toArray();
const pubWithAns = after.filter(d => d.public === true && String(d.ans ?? '').trim() !== '').length;
const pubBlank = after.filter(d => d.public === true && String(d.ans ?? '').trim() === '').length;
const hidden = after.filter(d => d.public !== true).length;
console.log(`\n复查：public且有答案 ${pubWithAns}，public但无答案 ${pubBlank}，未公开 ${hidden}`);
await c.close();
