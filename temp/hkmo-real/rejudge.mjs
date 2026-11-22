// temp/hkmo-real/rejudge.mjs —— 重判 HKMO 的纯文本提交（不含 AI 批改的 steps/image）
//
//   node --env-file=.env temp/hkmo-real/rejudge.mjs 200          # 试跑 200 条
//   node --env-file=.env temp/hkmo-real/rejudge.mjs --all --apply
//
// 为什么要重判：答案刚从 "170/891"、"3√2" 这类格式转成了 6 位小数，
// 之前因为 Number(ans) 算不出来而落到 SE 的提交，现在应该能正常判了；
// 反过来，之前靠字符串巧合判对的，也可能变成 WA。两种都要以新答案为准。
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { rejudgeOne } from '../../lib/rejudge.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const limit = ALL ? Infinity : Number(args.find(a => /^\d+$/.test(a)) || 200);

const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 30_000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'wyk_math');

const q = { problemId: /^MO/, type: 'text' };
const total = await db.collection('submissions').countDocuments(q);
console.log(`MO 纯文本提交共 ${total} 条，本次处理 ${Math.min(total, limit)} 条${APPLY ? '' : '（预演，不写库）'}`);

const subs = await db.collection('submissions')
  .find(q, { projection: { subid: 1, username: 1, problemId: 1, type: 1, answer: 1, status: 1, _id: 0 } })
  .limit(Math.min(total, limit))
  .toArray();

// 题目一次读进来
const pids = [...new Set(subs.map(s => s.problemId))];
const probs = await db.collection('problems').find({ id: { $in: pids } }).toArray();
const pmap = new Map(probs.map(p => [p.id, p]));
console.log(`涉及 ${pids.length} 道题，找到 ${probs.length} 道`);

const changes = [];
let ok = 0, fail = 0, same = 0;

for (const s of subs) {
  const p = pmap.get(s.problemId);
  if (!p) { fail++; continue; }
  if (!APPLY) {
    // 预演只判断答案能否被解析
    const canNum = Number.isFinite(Number(p.ans));
    if (!canNum) changes.push({ subid: s.subid, problemId: s.problemId, from: s.status, note: '答案仍非数字: ' + p.ans });
    ok++;
    continue;
  }
  try {
    const r = await rejudgeOne(db, s, p, { by: 'hkmo-realign' });
    if (r.ok) {
      ok++;
      if (r.status !== s.status) changes.push({ subid: s.subid, problemId: s.problemId, from: s.status, to: r.status });
      else same++;
    } else { fail++; changes.push({ subid: s.subid, problemId: s.problemId, from: s.status, note: 'fail: ' + r.error }); }
  } catch (e) {
    fail++; changes.push({ subid: s.subid, problemId: s.problemId, from: s.status, note: 'throw: ' + e.message });
  }
  if ((ok + fail) % 500 === 0) console.log(`  … ${ok + fail}/${subs.length}`);
}

console.log(`\n成功 ${ok}，失败 ${fail}，状态未变 ${same}，状态变化 ${changes.length}`);
const tally = {};
for (const ch of changes) { const k = `${ch.from} -> ${ch.to ?? "?"}`; tally[k] = (tally[k] || 0) + 1; }
Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

fs.mkdirSync('temp/hkmo-real', { recursive: true });
fs.writeFileSync(`temp/hkmo-real/rejudge-${APPLY ? 'applied' : 'dry'}.json`, JSON.stringify({ at: new Date().toISOString(), total, ok, fail, changes }, null, 1), 'utf8');
if (!APPLY) console.log('\n（预演结束。加 --apply 写库；--all 处理全部）');
await c.close();
