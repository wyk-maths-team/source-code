import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const ROOT = 'C:/moj';
const env = {};
for (const line of fs.readFileSync(path.join(ROOT,'.env.local'),'utf8').split(/\r?\n/)) {
  const t=line.trim(); if(!t||t.startsWith('#')||!t.includes('=')) continue;
  const i=t.indexOf('='); env[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^["']|["']$/g,'');
}

async function run() {
  const c = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 90000,
    connectTimeoutMS: 90000,
    socketTimeoutMS: 90000,
  });
  await c.connect();
  const col = c.db(env.MONGODB_DB||'wyk_math').collection('problems');
  const d = await col.findOne({ id: 'CHSMLHBJ01' }, { projection: { id:1, public:1, FS:1, ans:1, _id:0 } });
  console.log('before:', JSON.stringify(d));
  if (d && d.public !== false) {
    const r = await col.updateOne({ id: 'CHSMLHBJ01' }, { $set: { public: false } });
    console.log('modified:', r.modifiedCount);
  } else {
    console.log('已正确，无需修改');
  }
  const after = await col.findOne({ id: 'CHSMLHBJ01' }, { projection: { id:1, public:1, _id:0 } });
  console.log('after:', JSON.stringify(after));
  await c.close();
}

for (let attempt = 1; attempt <= 3; attempt++) {
  try { await run(); break; }
  catch (e) {
    console.log(`尝试 ${attempt} 失败: ${e.message.split('\n')[0]}`);
    if (attempt === 3) throw e;
    await new Promise(r => setTimeout(r, 15000));
  }
}
