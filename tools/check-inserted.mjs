import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const ROOT = 'C:/moj';
const env = {};
for (const line of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('=')) continue;
  const i=t.indexOf('='); env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,'');
}
const c = new MongoClient(env.MONGODB_URI,{serverSelectionTimeoutMS:15000});
await c.connect();
const col = c.db(env.MONGODB_DB||'wyk_math').collection('problems');

const n = await col.countDocuments({ id: /^CHSMLH/ });
console.log('CHSMLH* 总数:', n);
console.log('');

const docs = await col.find({ id: /^CHSMLH/ }, { projection: { id:1, name:1, ans:1, difficulty:1, FS:1, tags:1, statement:1, _id:0 } }).sort({ id: 1 }).toArray();
for (const d of docs) {
  const stmtLen = (d.statement || '').length;
  const hasLatex = /\$/.test(d.statement || '');
  console.log(`${d.id}  d=${String(d.difficulty).padEnd(4)} FS=${String(d.FS).padEnd(5)} ans=${JSON.stringify(d.ans).padEnd(12)} len=${String(stmtLen).padEnd(5)} latex=${hasLatex}  tags=${d.tags.join(',')}`);
}
await c.close();
