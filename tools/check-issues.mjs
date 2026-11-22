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

console.log('=== CHSMLHHB05（FS=false 但 ans 空）===');
const hb5 = await col.findOne({ id: 'CHSMLHHB05' }, { projection: { id:1, name:1, statement:1, ans:1, FS:1, tags:1, _id:0 } });
console.log(JSON.stringify(hb5, null, 1));

console.log('\n=== CHSMLHFJ08（7 位小数）===');
const fj8 = await col.findOne({ id: 'CHSMLHFJ08' }, { projection: { id:1, statement:1, ans:1, _id:0 } });
console.log('ans:', fj8.ans, '  statement:', (fj8.statement||'').slice(0,120));

console.log('\n=== 湖北全部 ===');
const hb = await col.find({ id: /^CHSMLHHB/ }, { projection: { id:1, ans:1, FS:1, difficulty:1, _id:0 } }).sort({id:1}).toArray();
for (const d of hb) console.log(`  ${d.id} d=${d.difficulty} FS=${d.FS} ans=${JSON.stringify(d.ans)}`);

await c.close();
