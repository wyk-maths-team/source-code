// temp/map-ha-to-pdf.mjs —— 把题库里的 HA 题对应到 HKMHASC 的 PDF 页
//
// 做法：提取每份 PDF 的文字，按题号切开，再用题面的英文部分去和 problems.statement 做相似度匹配。
// 输出 temp/ha-map.json: [{ id, pdf, page, qno, score }]
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const DIR = process.env.HKMHASC_DIR || 'downloaded_pdfs';
const OUT = 'temp/ha-map.json';

const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 30_000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'wyk_math');

const probs = await db.collection('problems')
  .find({ id: /^HA/ }, { projection: { id: 1, statement: 1, tags: 1, _id: 0 } })
  .toArray();
console.log(`HA 题: ${probs.length} 道（need-img ${probs.filter(p => (p.tags || []).includes('need-img')).length} 道）`);

// ── 规范化：只留英文单词，去掉 LaTeX 和标点 ──
function norm(s) {
  return String(s || '')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) {
  return new Set(norm(s).split(' ').filter(w => w.length > 2));
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ── 提取 PDF 每页文字，并按题号切成块 ──
const pdfs = fs.readdirSync(DIR).filter(f => /_Questions\.pdf$/i.test(f)).sort();
console.log(`PDF: ${pdfs.length} 份`);

const blocks = [];   // { pdf, page, qno, text, y }

for (const name of pdfs) {
  const data = new Uint8Array(fs.readFileSync(path.join(DIR, name)));
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  } catch (e) {
    console.error(`  ${name}: 打不开 (${e.message})`);
    continue;
  }

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();

    // 按 y 排序后重排成行
    const items = tc.items
      .map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter(it => it.s && it.s.trim());
    items.sort((a, b) => (Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x));

    let line = [], lines = [];
    let lastY = null;
    for (const it of items) {
      if (lastY === null || Math.abs(it.y - lastY) <= 3) { line.push(it); }
      else { lines.push(line); line = [it]; }
      lastY = it.y;
    }
    if (line.length) lines.push(line);

    // 题号：行首形如 "12." 或 "12．"
    let cur = null;
    for (const ln of lines) {
      const text = ln.map(i => i.s).join(' ').trim();
      const m = /^(\d{1,2})\s*[.．、]\s*/.exec(text);
      if (m) {
        if (cur) blocks.push(cur);
        cur = { pdf: name, page: n, qno: Number(m[1]), text: text.replace(m[0], ''), y: ln[0].y };
      } else if (cur) {
        cur.text += ' ' + text;
      }
    }
    if (cur) { blocks.push(cur); }
  }
  if (typeof doc.destroy === 'function') await doc.destroy();
}

console.log(`切出 ${blocks.length} 个题目块`);

// ── 匹配 ──
const blockToks = blocks.map(b => tokens(b.text));
const map = [];

for (const p of probs) {
  const pt = tokens(p.statement);
  let best = null, bestScore = 0;
  for (let i = 0; i < blocks.length; i++) {
    const s = jaccard(pt, blockToks[i]);
    if (s > bestScore) { bestScore = s; best = blocks[i]; }
  }
  if (best && bestScore >= 0.45) {
    map.push({ id: p.id, pdf: best.pdf, page: best.page, qno: best.qno, score: +bestScore.toFixed(2),
               needImg: (p.tags || []).includes('need-img') });
  }
}

map.sort((a, b) => b.score - a.score);
fs.writeFileSync(OUT, JSON.stringify(map, null, 1), 'utf8');

const matched = map.length, hi = map.filter(m => m.score >= 0.7).length;
console.log(`\n匹配上 ${matched}/${probs.length} 道（相似度 ≥0.7 的 ${hi} 道）`);
console.log('按 PDF 分布:');
const byPdf = {};
for (const m of map) byPdf[m.pdf] = (byPdf[m.pdf] || 0) + 1;
for (const [k, v] of Object.entries(byPdf).sort()) console.log(`  ${k}: ${v}`);

console.log('\n低分匹配（可能不准）:');
map.filter(m => m.score < 0.6).slice(0, 8).forEach(m => console.log(`  ${m.id} -> ${m.pdf} p${m.page} Q${m.qno} (${m.score})`));

await c.close();
