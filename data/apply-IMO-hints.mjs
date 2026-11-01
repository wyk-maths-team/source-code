// data/apply-IMO-hints.mjs —— 把 data/IMO-hints.json 写进 problems.hints
//
//   node data/apply-IMO-hints.mjs           # 预览（不改数据库）
//   node data/apply-IMO-hints.mjs --write   # 真写
//
// 只写 hints 字段，不动题目其他内容。
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], override: false });
import fs from 'node:fs';
import { connectToDatabase } from '../api/_db.js';

const WRITE = process.argv.includes('--write');
const FILE = 'data/IMO-hints.json';

if (!fs.existsSync(FILE)) {
  console.error('缺少 ' + FILE + '，先跑 node data/prepare-IMO-hints.mjs');
  process.exit(1);
}

const hints = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const db = await connectToDatabase();
const ids = Object.keys(hints);

const probs = await db.collection('problems')
  .find({ id: { $in: ids } }, { projection: { id: 1, difficulty: 1 } })
  .toArray();
const byId = Object.fromEntries(probs.map(p => [p.id, p]));

let total = 0, over = 0;
const rows = [];
for (const pid of ids) {
  const p = byId[pid];
  if (!p) { console.log('MISSING', pid); continue; }
  const list = hints[pid];
  const sum = list.reduce((s, h) => s + (Number(h.price) || 0), 0);
  const reward = 2000 + 500 * Math.round(Math.pow(Number(p.difficulty) || 1, 2.5));
  if (sum > reward) over++;
  total += sum;
  rows.push({ pid, n: list.length, sum, reward, d: p.difficulty });
}

console.log('題目:', rows.length, 'hint 總數:', rows.reduce((s, r) => s + r.n, 0));
console.log('hint 總價:', total.toLocaleString());
console.log('超獲利的題:', over);
for (const r of rows.slice(0, 8)) {
  console.log(' ', r.pid, 'd=' + r.d, '×' + r.n, 'sum=' + r.sum, 'reward=' + r.reward);
}

if (!WRITE) {
  console.log('\n[dry-run] 沒有寫入。確認後：node data/apply-IMO-hints.mjs --write');
  process.exit(0);
}

let done = 0;
for (const pid of ids) {
  if (!byId[pid]) continue;
  await db.collection('problems').updateOne({ id: pid }, { $set: { hints: hints[pid] } });
  done++;
}
console.log('\n已寫入', done, '題');
process.exit(0);
