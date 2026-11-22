// tools/reset-paper-layouts.mjs —— 按默认规则重排现有试卷的画板高度
//
// 默认：半张 A4；M0 第 16 题起整张；M1 9/10 整张、11/12 两张；
//       M2 10/11 整张、12/13 两张。
//
// 用法：
//   node tools/reset-paper-layouts.mjs --dry
//   node tools/reset-paper-layouts.mjs
//   node tools/reset-paper-layouts.mjs --keep-page   只改高度，不动 page

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], override: false });
import { MongoClient } from 'mongodb';
import { defaultHeightFor } from '../lib/paperLayout.js';

const DRY = process.argv.includes('--dry');
const KEEP_PAGE = process.argv.includes('--keep-page');

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db('wyk_math');

const papers = await db.collection('papers').find({}).toArray();
console.log('papers found:', papers.length);

for (const p of papers) {
  const pids = p.problemIds || [];
  if (!pids.length) continue;

  const prev = new Map(((p.layout && p.layout.items) || []).map((it) => [it.pid, it]));
  const items = pids.map((pid, i) => ({
    pid,
    page: KEEP_PAGE && prev.get(pid) ? prev.get(pid).page : i + 1,
    height: defaultHeightFor(p.track, i + 1),
  }));

  const summary = items.map((it) => it.height).join(', ');
  console.log('  ' + p.track + ' ' + p.year + ' -> ' + summary.slice(0, 120));

  if (!DRY) {
    await db.collection('papers').updateOne(
      { _id: p._id },
      { $set: { layout: { items }, updatedAt: new Date() } }
    );
  }
}

console.log(DRY ? '\ndry run, nothing written' : '\nlayouts reset');
await client.close();
process.exit(0);
