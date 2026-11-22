// tools/ha-crop.mjs —— 按 HA 题号自动定位并裁剪配图
//
//   node tools/ha-crop.mjs --text=2012-2013_Questions.pdf:3     # 打印该页每个文字项的坐标
//   node tools/ha-crop.mjs --auto=HA1206                        # 自动找题、算框、裁剪
//   node tools/ha-crop.mjs --auto=HA1206 --dry                  # 只算框不裁
//
// 为什么不再靠肉眼估坐标：HAxxx 的题号编码了学年和题号（HA + (年份-1998) + 题号），
// 而图形里的顶点标签（A、B、C…）在 PDF 里是有精确坐标的文字项。用标签的包围盒
// 加一圈边距，裁剪框第一次就基本正确 —— 比看缩略图估像素准得多，也不用反复试。
//
// 局限：只有「图里带字母标签」的题适用。纯阴影图、纯数字标注的图，标签法找不到框，
// 这时候用 --text 打印坐标，自己给 --box。

import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const DIR = process.env.HKMHASC_DIR || 'downloaded_pdfs';
const OUT = 'temp/ha-figures';
const SCALE = 3;
const PAD = 40;          // 标签外的边距（页面像素）

const args = process.argv.slice(2);
const arg = (k) => args.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const has = (k) => args.includes(`--${k}`);

fs.mkdirSync(OUT, { recursive: true });

async function openPdf(name) {
  const f = path.join(DIR, name);
  if (!fs.existsSync(f)) throw new Error(`找不到 ${f}`);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true }).promise;
  return doc;
}

async function renderPage(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  await page.render({
    canvasContext: ctx, viewport,
    canvasFactory: {
      create: (w, h) => { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; },
      reset: (cc, w, h) => { cc.canvas.width = w; cc.canvas.height = h; },
      destroy: (cc) => { cc.canvas.width = 0; cc.canvas.height = 0; },
    },
  }).promise;
  return { canvas, ctx, viewport, page };
}

/** 把文字项按行合并，转成 viewport 坐标 */
async function textLines(page, viewport) {
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
    items.push({
      s: it.str,
      x, y,
      w: (it.width || 0) * SCALE,
      h: (it.height || 0) * SCALE,
    });
  }

  // 按 y 归行（同一行的 y 差小于 6px）
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const ln = lines.find(l => Math.abs(l.y - it.y) < 6);
    if (ln) { ln.items.push(it); ln.y = (ln.y + it.y) / 2; }
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map(i => i.s).join(' ');
  }
  lines.sort((a, b) => a.y - b.y);
  return lines;
}

const TARGET = arg('auto') || arg('only');
const TEXTMODE = arg('text');

if (TEXTMODE) {
  const [pdfName, pageNo] = TEXTMODE.split(':');
  const doc = await openPdf(pdfName);
  const { page, viewport } = await renderPage(doc, Number(pageNo));
  const lines = await textLines(page, viewport);
  console.log(`${pdfName} p${pageNo}  共 ${lines.length} 行`);
  for (const l of lines) {
    const qm = /^\s*(\d{1,2})\s*[.．、]/.exec(l.text);
    console.log(`${qm ? `[Q${qm[1]}]` : "     "} y=${Math.round(l.y).toString().padStart(4)}  ${l.text.slice(0, 90)}`);
  }
  if (typeof doc.destroy === 'function') await doc.destroy();
  process.exit(0);
}

if (!TARGET) {
  console.log(`用法:
  node tools/ha-crop.mjs --text=<pdf>:<page>     打印文字坐标
  node tools/ha-crop.mjs --auto=HA1206           自动定位并裁剪`);
  process.exit(1);
}

// 题号解码：HA + 两位年份码 + 两位题号
//
//   年份码 07 -> 2007-08    11 -> 2011-12    15 -> 2015-16
//   年份码 98 -> 1998-99    99 -> 1999-2000
//
// 也就是 2000 + 年份码，但 9x 那两位是 19xx 的尾巴。验证过的样本：
// HA0716 / HA1007 / HA1116 / HA1501 / HA1717 / HA9806。
const m = /^HA(\d{2})(\d{2})$/.exec(TARGET);
if (!m) { console.error(`题号格式不认识: ${TARGET}`); process.exit(1); }
const yearCode = Number(m[1]);
const qno = Number(m[2]);
const startYear = yearCode >= 90 ? 1900 + yearCode : 2000 + yearCode;
const pdfName = `${startYear}-${startYear + 1}_Questions.pdf`;

console.log(`${TARGET} -> ${pdfName} 的 Q${qno}`);

const doc = await openPdf(pdfName);

// 找题号在第几页
let foundPage = 0, lines = null, pageObj = null, vp = null, canvas = null, ctx = null;
for (let p = 1; p <= doc.numPages; p++) {
  const r = await renderPage(doc, p);
  const ls = await textLines(r.page, r.viewport);
  if (ls.some(l => new RegExp(`^\\s*${qno}\\s*[.．、]`).test(l.text))) {
    foundPage = p; lines = ls; pageObj = r.page; vp = r.viewport; canvas = r.canvas; ctx = r.ctx;
    break;
  }
}
if (!foundPage) { console.error(`在 ${pdfName} 里没找到 Q${qno}`); process.exit(1); }
console.log(`  在第 ${foundPage} 页`);

// 本题的纵向范围
const marks = [];
for (const l of lines) {
  const mm = /^\s*(\d{1,2})\s*[.．、]/.exec(l.text);
  if (mm) marks.push({ qno: Number(mm[1]), y: l.y });
}
const idx = marks.findIndex(x => x.qno === qno);
const top = idx >= 0 ? marks[idx].y : 0;
const bottom = idx >= 0 && marks[idx + 1] ? marks[idx + 1].y : canvas.height * 0.96;

// 范围内的行分成两类：
//   题干行 —— 含中文，或含超过 3 个字母的英文单词
//   图形标签行 —— 只剩单个/两个字母、数字这种短项
// 图一定在本题最后一行题干之后，所以先找到那条分界线，再只收界线以下的短标签。
const looksLikeProse = (l) => l.items.some(it => {
  const s = it.s.trim();
  if (!s) return false;
  if (/[\u4e00-\u9fff]/.test(s)) return true;
  return /[A-Za-z]{4,}/.test(s);
});

const inRange = lines.filter(l => l.y >= top - 6 && l.y < bottom - 4);
const proseRows = inRange.filter(looksLikeProse);
const lastProseY = proseRows.length ? Math.max(...proseRows.map(l => l.y)) : top + 30;

const LABEL = /^[A-Za-z]{1,2}$|^\d{1,2}$/;
const labels = [];
for (const l of inRange) {
  if (l.y <= lastProseY + 6) continue;          // 题干区，跳过
  for (const it of l.items) {
    if (LABEL.test(it.s.trim())) labels.push(it);
  }
}

if (labels.length < 2) {
  console.error(`  Q${qno} 范围内只找到 ${labels.length} 个单字母标签，标签法不适用。`);
  console.error(`  用 --text=${pdfName}:${foundPage} 看坐标后手动指 --box`);
  process.exit(2);
}

const minX = Math.min(...labels.map(l => l.x));
const maxX = Math.max(...labels.map(l => l.x + l.w));
const minY = Math.min(...labels.map(l => l.y)) - 20;
const maxY = Math.max(...labels.map(l => l.y)) + 20;

let x = Math.max(0, Math.floor(minX - PAD));
let y = Math.max(0, Math.floor(minY - PAD));
let w = Math.min(canvas.width - x, Math.ceil(maxX - minX + PAD * 2));
let h = Math.min(canvas.height - y, Math.ceil(maxY - minY + PAD * 2));

console.log(`  ${labels.length} 个标签: ${labels.map(l => l.s.trim()).join(' ')}`);
console.log(`  裁剪框: ${x},${y},${w},${h}`);

if (has('dry')) { process.exit(0); }

const out = createCanvas(w, h);
out.getContext('2d').putImageData(ctx.getImageData(x, y, w, h), 0, 0);
const file = path.join(OUT, `${TARGET}-1.jpg`);
fs.writeFileSync(file, await out.encode('jpeg', 92));
console.log(`  -> ${file}`);

if (typeof doc.destroy === 'function') await doc.destroy();
