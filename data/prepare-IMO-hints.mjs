// data/prepare-IMO-hints.mjs —— 把英文 hint 整理成可检查/可写入的 data/IMO-hints.json
//
// 价格规则：每个 hint = AC 该题获利的 15%（取整到 500），且每题总价 ≤ 获利的一半。
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], override: false });
import fs from 'node:fs';
import { connectToDatabase } from '../api/_db.js';

const SRC = 'temp/hints.json';
const OUT = 'data/IMO-hints.json';

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const db = await connectToDatabase();
const out = {};

for (const [pid, list] of Object.entries(src)) {
  const p = await db.collection('problems').findOne({ id: pid }, { projection: { difficulty: 1 } });
  if (!p) { console.log('skip (missing)', pid); continue; }
  const d = Number(p.difficulty) || 1;
  const reward = 2000 + 500 * Math.round(Math.pow(d, 2.5));
  const cap = Math.floor(reward * 0.5);
  const price = Math.min(cap, Math.round(reward * 0.15 / 500) * 500);

  out[pid] = list.slice(0, 2).map((h, i) => ({
    id: 'h' + (i + 1),
    content: h.content,
    price,
    order: i,
  }));
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');
console.log('problems:', Object.keys(out).length, '->', OUT);
process.exit(0);
