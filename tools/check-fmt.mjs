// tools/check-fmt.mjs —— 检查现有题面格式与 CHSML 前缀占用情况
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

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db(env.MONGODB_DB || 'wyk_math');
const col = db.collection('problems');

const docs = await col.find(
  { statement: { $regex: '\\$|\\\\frac|\\\\sqrt' } },
  { projection: { id: 1, statement: 1, ans: 1, name: 1, difficulty: 1, tags: 1 } }
).limit(3).toArray();

for (const d of docs) {
  console.log('---', d.id, '| name:', d.name, '| diff:', d.difficulty, '| tags:', JSON.stringify(d.tags));
  console.log('  statement:', JSON.stringify(d.statement).slice(0, 320));
  console.log('  ans:', JSON.stringify(d.ans).slice(0, 140));
  console.log();
}

console.log('已有 CHSML 题数:', await col.countDocuments({ id: /^CHSML/ }));
const s = await col.find({ id: /^CHSML/ }, { projection: { id: 1, name: 1, _id: 0 } }).limit(5).toArray();
console.log('样例:', JSON.stringify(s));

await client.close();
