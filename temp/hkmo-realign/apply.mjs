// temp/hkmo-realign/apply.mjs —— HKMO 题号重整
//
//   node --env-file=.env temp/hkmo-realign/apply.mjs            # 预演，只报告
//   node --env-file=.env temp/hkmo-realign/apply.mjs --apply    # 真正执行
//
// 要修的四种东西：
//   1) 四段「内容其实是别的年份/别的环节」的副本 -> 把引用迁到正主，然后删掉副本
//   2) MO00HG 装的是 2002 Heat 真题（唯一来源）-> 改成 MO02HI
//   3) 引用这些 id 的 submissions / grading_history / reports / solutions
//   4) userstats.states 里的键（{problemId: state} 的映射）
//
// 顺序很重要：必须先把旧的 MO02HI 清空，才能让 MO00HG 改名占用 MO02HI。
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 30_000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'wyk_math');

const norm = s => String(s || '').toLowerCase().replace(/\$[^$]*\$/g, '').replace(/[^a-z0-9]/g, '').slice(0, 150);

const PAIRS = [
  { dup: 'MO02HI', main: 'MO04HI' },   // 2004 Heat 副本
  { dup: 'MO01HG', main: 'MO06HI' },   // 2005-06 Heat 副本
  { dup: 'MO02FG', main: 'MO03FI' },   // 2003 Final 副本
  { dup: 'MO01FG', main: 'MO03FI' },   // 2003 Final 副本
];
const RENAME = { from: 'MO00HG', to: 'MO02HI' };   // 2002 Heat 真题归位

// ── 1. 按题面建映射，未命中的 id 保留不删 ──
const all = await db.collection('problems').find({ id: /^MO/ }, { projection: { id: 1, statement: 1 } }).toArray();
const stmtOf = new Map(all.map(r => [r.id, norm(r.statement)]));
const byStmt = new Map();
for (const r of all) {
  const k = stmtOf.get(r.id);
  if (k && !byStmt.has(k)) byStmt.set(k, r.id);
}

const plans = [];     // { dupId, targetId }
const kept = [];      // 找不到正主、保留的
for (const { dup, main } of PAIRS) {
  const dups = all.filter(r => r.id.startsWith(dup)).sort((a, b) => a.id.localeCompare(b.id));
  const mains = all.filter(r => r.id.startsWith(main));
  const mainByStmt = new Map(mains.map(r => [norm(r.statement), r.id]));
  for (const d of dups) {
    const t = mainByStmt.get(norm(d.statement));
    if (t && t !== d.id) plans.push({ dupId: d.id, targetId: t, dup, main });
    else kept.push(d.id);
  }
}

console.log(`可迁移 ${plans.length} 条，保留（正主里没有对应）${kept.length} 条`);
if (kept.length) console.log('  保留:', kept.join(', '));

const targetOf = new Map(plans.map(p => [p.dupId, p.targetId]));
const delIds = [...targetOf.keys()];

// ── 2. 预演统计 ──
async function countRefs(ids) {
  const re = ids.map(i => '^' + i + '$').join('|');
  const r = {};
  r.submissions = await db.collection('submissions').countDocuments({ problemId: new RegExp(re) });
  r.grading_history = await db.collection('grading_history').countDocuments({ problemId: new RegExp(re) });
  r.reports = await db.collection('reports').countDocuments({ problemId: new RegExp(re) });
  r.solutions = await db.collection('solutions').countDocuments({ problemId: new RegExp(re) });
  return r;
}
console.log('\n副本引用:', JSON.stringify(await countRefs(delIds)));
const renameIds = all.filter(r => r.id.startsWith(RENAME.from)).map(r => r.id);
const renameMap = new Map(renameIds.map(id => [id, RENAME.to + id.slice(RENAME.from.length)]));
console.log(`改名 ${RENAME.from} -> ${RENAME.to}: ${renameIds.length} 条`);
console.log('改名引用:', JSON.stringify(await countRefs(renameIds)));

if (!APPLY) {
  console.log('\n（预演结束，加 --apply 执行）');
  await c.close();
  process.exit(0);
}

// ── 3. 执行 ──
const S = db.collection('submissions');
const GH = db.collection('grading_history');
const RP = db.collection('reports');
const SL = db.collection('solutions');
const US = db.collection('userstats');
const PR = db.collection('problems');

const log = [];
async function remapColl(coll, map, label) {
  let n = 0;
  for (const [from, to] of map) {
    const r = await coll.updateMany({ problemId: from }, { $set: { problemId: to } });
    n += r.modifiedCount || 0;
  }
  log.push(`${label}: ${n} 条`);
  return n;
}

// 3a. 副本的引用 -> 正主
const dupMap = [...targetOf.entries()];
await remapColl(S, dupMap, 'submissions');
await remapColl(GH, dupMap, 'grading_history');
await remapColl(RP, dupMap, 'reports');
await remapColl(SL, dupMap, 'solutions');

// 3b. userstats.states 合并（状态优先级 passed > tried > failed > not_started）
const rank = { passed: 3, tried: 2, failed: 1, not_started: 0 };
async function mergeStates(map, label) {
  const users = await US.find({}).project({ username: 1, states: 1 }).toArray();
  let touched = 0, keys = 0;
  for (const u of users) {
    const st = u.states || {};
    const set = {}, unset = {};
    for (const [from, to] of map) {
      if (!(from in st)) continue;
      const a = st[from], b = st[to];
      if (b === undefined || (rank[a] ?? 0) > (rank[b] ?? 0)) set['states.' + to] = a;
      unset['states.' + from] = '';
      keys++;
    }
    if (!keys) continue;
    const upd = {};
    if (Object.keys(set).length) upd.$set = set;
    if (Object.keys(unset).length) upd.$unset = unset;
    if (Object.keys(upd).length) { await US.updateOne({ username: u.username }, upd); touched++; }
  }
  log.push(`${label} states: ${keys} 个键 / ${touched} 个用户`);
}
await mergeStates(dupMap, '副本');

// 3c. 删副本题目
const del = await PR.deleteMany({ id: { $in: delIds } });
log.push(`删除副本题目: ${del.deletedCount} 条`);

// 3d. MO00HG 改名 —— 此时 MO02HI 已空出
let renamed = 0;
for (const [from, to] of renameMap) {
  const r = await PR.updateOne({ id: from }, { $set: { id: to } });
  renamed += r.modifiedCount || 0;
}
log.push(`题目改名: ${renamed} 条`);

// 3e. 改名系列的引用
const renamePairs = [...renameMap.entries()];
await remapColl(S, renamePairs, 'submissions(改名)');
await remapColl(GH, renamePairs, 'grading_history(改名)');
await remapColl(RP, renamePairs, 'reports(改名)');
await remapColl(SL, renamePairs, 'solutions(改名)');
await mergeStates(renamePairs, '改名');

console.log('\n执行结果:');
log.forEach(l => console.log('  ' + l));

// ── 4. 校验 ──
const leftDup = await PR.countDocuments({ id: new RegExp('^(' + PAIRS.map(p => p.dup).join('|') + ')') });
const newMO02HI = await PR.countDocuments({ id: /^MO02HI/ });
const oldMO00HG = await PR.countDocuments({ id: /^MO00HG/ });
console.log(`\n校验: 残留副本前缀 ${leftDup} 条（应为 ${kept.length}）| MO02HI ${newMO02HI} 条 | MO00HG ${oldMO00HG} 条（应为 0）`);

// 导出映射表供 submissions 对账
fs.mkdirSync('temp/hkmo-realign', { recursive: true });
fs.writeFileSync('temp/hkmo-realign/id-map.json', JSON.stringify({
  duplicated: Object.fromEntries(dupMap),
  renamed: Object.fromEntries(renamePairs),
  kept,
  at: new Date().toISOString(),
}, null, 1), 'utf8');
console.log('映射表: temp/hkmo-realign/id-map.json');

await c.close();
