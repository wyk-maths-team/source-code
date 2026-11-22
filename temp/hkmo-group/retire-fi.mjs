// temp/hkmo-group/retire-fi.mjs â€”â€” æ¸…é€€ 2008/2009 é‡Œè£…é”™å†…å®¹çš„ FI æ¡ç›®
//
//   node --env-file=.env temp/hkmo-group/retire-fi.mjs            # é¢„æ¼”
//   node --env-file=.env temp/hkmo-group/retire-fi.mjs --apply    # æ‰§è¡Œ
//
// è¿™ä¸¤å¹´çš„ Group å†…å®¹åŽŸæœ¬ä½åœ¨ FI ç¼–å·ä¸‹ï¼Œå·²ç»å¤åˆ¶åˆ°æ–°çš„ FG æ®µã€‚
// çŽ°åœ¨æŠŠæºæ¡ç›®æ¸…æŽ‰ï¼Œæäº¤è®°å½•æŒ‰é¢˜é¢åŒ¹é…è¿åˆ°æ‰¿æŽ¥å®ƒä»¬çš„æ¡ç›®ä¸Šã€‚
//
// ä¿å®ˆä¹‹å¤„ï¼šMO08FI21-24 æ˜¯ ISï¼ˆIndividual Spareï¼‰ï¼Œä¸æ˜¯ Groupï¼Œæ²¡æœ‰æ‰¿æŽ¥å¯¹è±¡ï¼Œ
// åŽŸæ ·ä¿ç•™ï¼Œåªåœ¨æŠ¥å‘Šé‡Œåˆ—å‡ºã€‚
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 30_000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'wyk_math');
const P = db.collection('problems');
const S = db.collection('submissions');

// é¢˜é¢å½’ä¸€åŒ–åŽåšåŒ¹é…é”®ã€‚
// æ³¨æ„ä¸èƒ½æˆªæ–­å¾—å¤ªçŸ­ï¼š2009 çš„ FI30 å’Œ FI33 éƒ½ä»¥ã€ŒLet $[x]$ be the largest
// integer not greater than $x$. Ifã€å¼€å¤´ï¼Œæˆªåˆ° 150 å­—ç¬¦å°±åˆ†ä¸å¼€äº†ï¼Œ
// ä¼šæŠŠä¸¤é“ä¸åŒçš„é¢˜æ˜ å°„åˆ°åŒä¸€ä¸ªæ‰¿æŽ¥æ–¹ã€‚
// 不能把 $...$ 整段删掉：2009 的 FI30（B=[10+√(10+…)]) 与 FI33（A=[2008×80+…]）
// 去掉公式后都只剩「Let be the largest integer not greater than . If」，会撞车。
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const key = s => norm(s).slice(0, 600);

const all = await P.find({ id: /^MO/ }, { projection: { id: 1, statement: 1 } }).toArray();
const byStmt = new Map();
for (const r of all) {
  const k = key(r.statement);
  if (k && !byStmt.has(k)) byStmt.set(k, r.id);
}

// è¦æ¸…é€€çš„èŒƒå›´ -> æ‰¿æŽ¥æ–¹å‰ç¼€
const RULES = [
  { year: '08', from: /^MO08FI(1[7-9]|20)$/, toPrefix: 'MO08FI1', note: 'I4 é‡å¤å‰¯æœ¬' },
  { year: '08', from: /^MO08FI(2[5-9]|3[0-3])$/, toPrefix: 'MO08FG0', note: 'Group -> æ–° FG' },
  { year: '09', from: /^MO09FI(1[7-9]|20)$/, toPrefix: 'MO09FI1', note: 'I4 é‡å¤å‰¯æœ¬' },
  { year: '09', from: /^MO09FI(2[1-9]|3[0-9]|40)$/, toPrefix: 'MO09FG', note: 'Group -> æ–° FG' },
];

const KEEP = /^MO08FI2[1-4]$/;   // IS ç»„ï¼Œæ— è¯­ä¹‰æ‰¿æŽ¥å¯¹è±¡

const plans = [];
const kept = [];

for (const rule of RULES) {
  const rows = all.filter(r => rule.from.test(r.id));
  for (const r of rows) {
    if (KEEP.test(r.id)) { kept.push(r.id); continue; }
    // æ‰¿æŽ¥æ–¹ï¼šåŒä¸€å¹´ã€å‰ç¼€åŒ¹é…ã€é¢˜é¢ç›¸åŒ
    const cand = all.filter(x => x.id.startsWith(rule.toPrefix) && x.id !== r.id);
    const hit = cand.find(x => key(x.statement) === key(r.statement));
    if (hit) plans.push({ from: r.id, to: hit.id, note: rule.note });
    else kept.push(r.id);   // æ‰¾ä¸åˆ°æ‰¿æŽ¥ï¼Œä¿ç•™
  }
}

console.log(`å¯æ¸…é€€ ${plans.length} æ¡ï¼Œä¿ç•™ ${kept.length} æ¡`);
if (kept.length) console.log('  ä¿ç•™:', kept.join(', '));

const fromIds = plans.map(p => p.from);
let subTotal = 0;
for (const p of plans) {
  p.subs = await S.countDocuments({ problemId: p.from });
  subTotal += p.subs;
}
console.log(`\næ¶‰åŠæäº¤ ${subTotal} æ¡`);
plans.filter(p => p.subs).forEach(p => console.log(`  ${p.from} -> ${p.to}  (${p.subs} æ¡æäº¤, ${p.note})`));

if (!APPLY) {
  fs.writeFileSync('temp/hkmo-group/retire-plan.json', JSON.stringify(plans, null, 1), 'utf8');
  console.log('\nï¼ˆé¢„æ¼”ç»“æŸï¼Œæ˜ å°„å·²å­˜ temp/hkmo-group/retire-plan.jsonï¼‰');
  await c.close();
  process.exit(0);
}

// 1. è¿æäº¤
let movedSubs = 0;
for (const p of plans) {
  if (!p.subs) continue;
  const r = await S.updateMany({ problemId: p.from }, { $set: { problemId: p.to } });
  movedSubs += r.modifiedCount || 0;
}
console.log(`\næäº¤è¿ç§» ${movedSubs} æ¡`);

// 2. åˆå¹¶ userstats.states
const rank = { passed: 3, tried: 2, failed: 1, not_started: 0 };
const us = db.collection('userstats');
const users = await us.find({}).project({ username: 1, states: 1 }).toArray();
let mergedKeys = 0;
for (const u of users) {
  const st = u.states || {};
  const set = {}, unset = {};
  for (const p of plans) {
    if (!(p.from in st)) continue;
    const a = st[p.from], b = st[p.to];
    if (b === undefined || (rank[a] ?? 0) > (rank[b] ?? 0)) set['states.' + p.to] = a;
    unset['states.' + p.from] = '';
    mergedKeys++;
  }
  if (!mergedKeys) continue;
  const upd = {};
  if (Object.keys(set).length) upd.$set = set;
  if (Object.keys(unset).length) upd.$unset = unset;
  if (Object.keys(upd).length) await us.updateOne({ username: u.username }, upd);
}
console.log(`states åˆå¹¶ ${mergedKeys} ä¸ªé”®`);

// 3. åˆ é¢˜
const del = await P.deleteMany({ id: { $in: fromIds } });
console.log(`åˆ é™¤é¢˜ç›® ${del.deletedCount} æ¡`);

// 4. æ ¡éªŒ
const left = await P.countDocuments({ id: /^MO0(8|9)FI(1[7-9]|2[0-9]|3[0-9]|40)$/ });
const orphan = await S.countDocuments({ problemId: { $in: fromIds } });
console.log(`\næ ¡éªŒ: æ®‹ç•™ FI æ¸…é€€èŒƒå›´ ${left} æ¡ï¼ˆåº”=${kept.filter(k=>!/FI2[1-4]$/.test(k)).length + 0}ï¼Œå«ä¿ç•™çš„ IS 4 æ¡ï¼‰| å­¤å„¿æäº¤ ${orphan}`);
fs.writeFileSync('temp/hkmo-group/retire-done.json', JSON.stringify({ plans, movedSubs, at: new Date().toISOString() }, null, 1), 'utf8');
await c.close();

