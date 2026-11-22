// tools/enforce-fs.mjs —— 非纯数字答案强制 FS=true
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

const PURE_NUM = /^-?\d+(\.\d+)?$/;

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('problems');

const docs = await col.find({ id: /^CHSMLH/ }, { projection: { id: 1, ans: 1, FS: 1, _id: 0 } }).toArray();

const toFix = docs.filter(d => {
  const a = String(d.ans ?? '');
  if (a === '') return false;                 // 空白答案单独处理
  return !PURE_NUM.test(a) && d.FS !== true;  // 非纯数字但 FS 不是 true
});

console.log(`需要改为 FS=true 的记录: ${toFix.length}`);
for (const d of toFix) console.log(`  ${d.id}  ans=${JSON.stringify(d.ans)}  (原 FS=${d.FS})`);

if (toFix.length) {
  const r = await col.updateMany(
    { id: { $in: toFix.map(d => d.id) } },
    { $set: { FS: true } }
  );
  console.log(`\n已更新 ${r.modifiedCount} 条`);
}

// 复查：非纯数字但 FS 仍为 false 的
const after = await col.find({ id: /^CHSMLH/ }, { projection: { id: 1, ans: 1, FS: 1, _id: 0 } }).toArray();
const bad = after.filter(d => {
  const a = String(d.ans ?? '');
  return a !== '' && !PURE_NUM.test(a) && d.FS !== true;
});
console.log(`复查残留: ${bad.length} 条`);

// 统计
const pureNum = after.filter(d => PURE_NUM.test(String(d.ans ?? ''))).length;
const emptyAns = after.filter(d => String(d.ans ?? '') === '').length;
const nonNum = after.length - pureNum - emptyAns;
console.log(`\n合计 ${after.length} 题：纯数字 ${pureNum}，非数字 ${nonNum}（均已 FS=true），空答案 ${emptyAns}`);

await client.close();
