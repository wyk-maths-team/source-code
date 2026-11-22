// temp/merge-geo-svgs.mjs —— 汇总子智能体产出的 SVG，上传并挂到题目 hint 上
//
//   node --env-file=.env temp/merge-geo-svgs.mjs           # 只清点
//   node --env-file=.env temp/merge-geo-svgs.mjs --apply   # 上传 + 写库
//
// 幂等：同名文件覆盖上传，hint 上已挂同一张图就跳过。

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { putHintImage, isValidHintFile } from '../lib/hint-images.js';

const OUT_DIR = 'temp/geo-batch/out';
const APPLY = process.argv.includes('--apply');
const HINT_PRICE = Number(process.env.GEO_HINT_PRICE || 5000);

// ── 收集清单 ──
const manifests = fs.readdirSync('temp/geo-batch').filter(f => /^manifest-\d+\.json$/.test(f)).sort();
const entries = [];
const seen = new Set();

for (const m of manifests) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join('temp/geo-batch', m), 'utf8')); }
  catch (e) { console.warn(`  ${m}: 解析失败 ${e.message}`); continue; }
  if (!Array.isArray(arr)) { console.warn(`  ${m}: 不是数组`); continue; }

  for (const it of arr) {
    if (!it || !it.id || !it.file) continue;
    if (seen.has(it.id)) { console.warn(`  重复条目 ${it.id}（${m}）`); continue; }
    const svgPath = path.join(OUT_DIR, it.file);
    if (!fs.existsSync(svgPath)) { console.warn(`  缺文件 ${it.file}（声明于 ${m}）`); continue; }
    seen.add(it.id);
    entries.push({ ...it, svgPath, manifest: m });
  }
}

console.log(`清单 ${manifests.length} 份，去重后 ${entries.length} 道：${manifests.join(', ')}`);
console.log(`目录里实际 SVG: ${fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.svg')).length} 个`);

// 文件名合法性
const badName = entries.filter(e => !isValidHintFile(e.file));
if (badName.length) {
  console.warn(`文件名不合规 ${badName.length} 个:`);
  badName.slice(0, 5).forEach(e => console.warn(`  ${e.id}: ${e.file}`));
}

if (!APPLY) {
  console.log('\n前 8 条预览:');
  entries.slice(0, 8).forEach(e => console.log(`  ${e.id}  ${e.file}  ${(fs.statSync(e.svgPath).size / 1024).toFixed(1)}KB  "${e.alt || ''}"`));
  console.log('\n（加 --apply 才上传并写库）');
  process.exit(0);
}

// ── 上传 + 挂库 ──
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 30_000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'wyk_math');

let up = 0, attached = 0, skipped = 0, failed = 0;
const failures = [];

for (const e of entries) {
  if (!isValidHintFile(e.file)) { failed++; failures.push(`${e.id}: 文件名不合规`); continue; }

  const svg = fs.readFileSync(e.svgPath, 'utf8');
  try {
    await putHintImage(e.file, svg);
    up++;
  } catch (err) {
    failed++;
    failures.push(`${e.id}: 上传失败 ${err.message}`);
    continue;
  }

  try {
    const doc = await db.collection('problems').findOne({ id: e.id }, { projection: { hints: 1 } });
    if (!doc) { failed++; failures.push(`${e.id}: 题库里没有这道题`); continue; }

    const hints = Array.isArray(doc.hints) ? doc.hints.map(h => ({ ...h })) : [];
    const hintId = e.hintId || 'h1';
    let target = hints.find(h => String(h.id) === hintId);

    if (target && target.image && target.image.file === e.file) { skipped++; continue; }

    if (!target) {
      target = { id: hintId, content: '', price: HINT_PRICE, order: hints.length };
      hints.push(target);
    }
    target.image = { file: e.file, alt: String(e.alt || 'Diagram').slice(0, 120) };

    await db.collection('problems').updateOne({ id: e.id }, { $set: { hints } });
    attached++;
  } catch (err) {
    failed++;
    failures.push(`${e.id}: 写库失败 ${err.message}`);
  }

  if ((up + attached) % 20 === 0) console.log(`  进度 ${up + attached}/${entries.length}`);
}

console.log(`\n上传 ${up} 张，挂载 ${attached} 道，跳过 ${skipped} 道（已挂过），失败 ${failed} 条`);
if (failures.length) {
  console.log('\n失败明细:');
  failures.slice(0, 20).forEach(f => console.log('  ' + f));
}
await client.close();
