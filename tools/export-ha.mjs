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

const all = await col.find({ id: /^HA/ }, { projection: { id:1, statement:1, ans:1, difficulty:1, public:1, FS:1, name:1, _id:0 } }).toArray();
console.log('HA 开头题目总数:', all.length);

const withAns = all.filter(d => String(d.ans ?? '').trim() !== '');
console.log('其中有答案:', withAns.length);
console.log('其中无答案:', all.length - withAns.length);

const diffs = all.map(d => d.difficulty).filter(x => typeof x === 'number').sort((a,b)=>a-b);
if (diffs.length) {
  console.log('\n难度分布:');
  console.log(`  min=${diffs[0]}  median=${diffs[Math.floor(diffs.length/2)]}  max=${diffs[diffs.length-1]}`);
  const buckets = {};
  for (const d of diffs) {
    const k = d < 1 ? '<1' : d < 2 ? '1-2' : d < 3 ? '2-3' : d < 4 ? '3-4' : d < 5 ? '4-5' : d < 6 ? '5-6' : '6+';
    buckets[k] = (buckets[k]||0)+1;
  }
  for (const [k,v] of Object.entries(buckets)) console.log(`  ${k.padEnd(6)} ${v}`);
}

console.log('\n最简 10 题预览:');
all.sort((a,b)=>a.difficulty-b.difficulty).slice(0,10).forEach(d => {
  console.log(`  ${d.id}  d=${d.difficulty}  ans=${JSON.stringify(String(d.ans).slice(0,30))}  stmt=${String(d.statement||'').slice(0,50).replace(/\n/g,' ')}`);
});

await c.close();
