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
const r = await col.updateMany({ id: /^CHSMLH/ }, { $addToSet: { tags: 'CHSML' } });
console.log('matched:', r.matchedCount, 'modified:', r.modifiedCount);
const s = await col.findOne({ id: 'CHSMLHSC01' }, { projection: { id: 1, tags: 1, _id: 0 } });
console.log('sample:', JSON.stringify(s));
await c.close();
