// tools/probe-tags.mjs —— 查看现有题库的标签体系
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(ROOT, '.env.local');

const env = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db(env.MONGODB_DB || 'wyk_math');
const col = db.collection('problems');

console.log('total problems:', await col.countDocuments({}));

// tags 的原始形态
const samples = await col.find({ tags: { $exists: true, $ne: [] } }, { projection: { tags: 1, id: 1 } }).limit(4).toArray();
for (const s of samples) {
  console.log('  sample', s.id, '->', JSON.stringify(s.tags).slice(0, 180));
}

// 统计
const counter = new Map();
for (const doc of await col.find({ tags: { $exists: true } }, { projection: { tags: 1 } }).toArray()) {
  for (const t of (doc.tags || [])) {
    let name = null;
    if (typeof t === 'string') name = t;
    else if (t && typeof t === 'object') name = t.name || t.tag || t.label || t.id || null;
    if (name) counter.set(name, (counter.get(name) || 0) + 1);
  }
}

const sorted = [...counter.entries()].sort((a, b) => b[1] - a[1]);
console.log('\ndistinct tags:', sorted.length);
console.log('\ntop 45:');
for (const [name, n] of sorted.slice(0, 45)) console.log(`  ${String(name).padEnd(26)} ${n}`);

await client.close();
