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

const cz2 = await col.findOne({ id: 'CHSMLHCZ02' }, { projection: { id:1, ans:1, difficulty:1, FS:1, public:1, tags:1, _id:0 } });
console.log('CZ02:', JSON.stringify(cz2));

const all = await col.find({ id: /^CHSMLH/ }, { projection: { id:1, ans:1, public:1, FS:1, _id:0, difficulty:1 } }).toArray();
const answered = all.filter(d => String(d.ans ?? '').trim() !== '');
const blank = all.filter(d => String(d.ans ?? '').trim() === '');
console.log(`\n总计 ${all.length}`);
console.log(`  有答案 ${answered.length}  → 全部 public=${answered.every(d=>d.public===true)}`);
console.log(`  无答案 ${blank.length}  → 全部未公开=${blank.every(d=>d.public!==true)}`);
console.log(`  有答案中 FS=true（非纯数字）: ${answered.filter(d=>d.FS===true).length}`);
console.log(`  有答案中 FS=false（纯数字，可自动判）: ${answered.filter(d=>d.FS!==true).length}`);
await c.close();
