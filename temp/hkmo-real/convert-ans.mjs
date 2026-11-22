// temp/hkmo-real/convert-ans.mjs —— 把分数/根号答案转成 6 位小数
//
//   node --env-file=.env temp/hkmo-real/convert-ans.mjs            # 预演
//   node --env-file=.env temp/hkmo-real/convert-ans.mjs --apply    # 执行
//
// judge 走 Number(ans)，所以 "170/891"、"3√2"、"(1+√5)/2" 这类会让提交直接
// 报 systemError。这里把能算的算成小数（6 位），算不出的单独列出来。
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 30_000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'wyk_math');
const P = db.collection('problems');

/** 把答案串转成可求值的表达式；不认识就返回 null */
function toExpr(raw) {
  let s = String(raw).trim()
    .replace(/[−–—]/g, '-')
    .replace(/×/g, '*').replace(/÷/g, '/')
    .replace(/\s+/g, '');

  // 去掉百分号：p% -> (p/100)
  let percent = false;
  if (/%$/.test(s)) { percent = true; s = s.replace(/%$/, ''); }

  // 根号转换。注意别把后面的右括号一起吃掉 ——
  // "(1+√5)/2" 一旦变成 "(1+sqrt(5)/2" 就是残缺表达式。
  s = s.replace(/(\d)\s*√\s*\(?(\d+(?:\.\d+)?)\)?/g, '$1*sqrt($2)');   // 3√2 -> 3*sqrt(2)
  s = s.replace(/√\s*\((\d+(?:\.\d+)?)\)/g, 'sqrt($1)');               // √(5) -> sqrt(5)
  s = s.replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)');                   // √5   -> sqrt(5)

  // 只允许这些字符，防止注入
  if (!/^[-+*/().\d sqrt]+$/.test(s)) return null;
  if (!/^[-+*/().\d sqrt]*$/.test(s)) return null;

  return percent ? `(${s})/100` : s;
}

function evaluate(raw) {
  const e = toExpr(raw);
  if (!e) return null;
  // 白名单已经限死字符集，这里只补 sqrt
  const fn = `return (${e});`;
  let v;
  try {
    // eslint-disable-next-line no-new-func
    v = new Function('sqrt', fn)(Math.sqrt);
  } catch { return null; }
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

const rows = await P.find({ id: /^MO/ }, { projection: { id: 1, ans: 1, _id: 0 } }).toArray();
const targets = rows.filter(r => r.ans != null && String(r.ans).trim() !== '' && !Number.isFinite(Number(r.ans)));

console.log(`非纯数字答案 ${targets.length} 条\n`);

const ok = [], bad = [];
for (const r of targets) {
  const v = evaluate(r.ans);
  if (v === null) bad.push(r);
  else ok.push({ id: r.id, from: String(r.ans), to: v.toFixed(6) });
}

console.log(`可转换 ${ok.length} 条，算不出 ${bad.length} 条\n`);
ok.slice(0, 20).forEach(x => console.log(`  ${x.id.padEnd(11)} ${x.from.padEnd(14)} -> ${x.to}`));
if (bad.length) {
  console.log('\n算不出的:');
  bad.forEach(x => console.log(`  ${x.id.padEnd(11)} ${x.ans}`));
}

if (!APPLY) {
  console.log('\n（预演结束，加 --apply 执行）');
  await c.close();
  process.exit(0);
}

let n = 0;
for (const x of ok) {
  const r = await P.updateOne({ id: x.id }, { $set: { ans: x.to } });
  n += r.modifiedCount || 0;
}
console.log(`\n已更新 ${n} 条`);
fs.writeFileSync('temp/hkmo-real/ans-converted.json', JSON.stringify({ ok, bad: bad.map(b => b.id) }, null, 1), 'utf8');

// 同步 hkmo.json
const live = await P.find({ id: /^MO/ }, { projection: { _id: 0 } }).toArray();
const json = JSON.parse(fs.readFileSync('private/hkmo.json', 'utf8'));
const byId = new Map(live.map(r => [r.id, r]));
let synced = 0;
for (const row of json) {
  const src = byId.get(row.id);
  if (!src) continue;
  if (String(row.ans) !== String(src.ans)) { row.ans = src.ans; synced++; }
}
fs.writeFileSync('private/hkmo.json', JSON.stringify(json, null, 1), 'utf8');
console.log(`hkmo.json 同步 ${synced} 条`);
await c.close();
