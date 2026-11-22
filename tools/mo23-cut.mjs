// temp/mo23-cut.mjs —— HKMO 2023 卷面配图裁剪（自用）
//   node temp/mo23-cut.mjs text  "PDF" PAGE
//   node temp/mo23-cut.mjs box   "PDF" PAGE ID "label1,label2,..." [pad]
//   node temp/mo23-cut.mjs cut   "PDF" PAGE ID x,y,w,h
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const OUT = 'temp/ha-figures';
const SCALE = 3;
fs.mkdirSync(OUT, { recursive: true });

const [mode, pdfPath, pageArg, idArg, boxArg, padArg] = process.argv.slice(2);

async function openDoc() {
  return await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: true }).promise;
}
async function renderPage(doc, pageNo) {
  const page = await doc.getPage(Number(pageNo));
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
  return { page, canvas, ctx, viewport };
}
async function items(page, viewport) {
  const tc = await page.getTextContent();
  const out = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const [x, y] = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
    out.push({ s: it.str, x, y, w: (it.width || 0) * SCALE, h: (it.height || 0) * SCALE });
  }
  return out;
}

const doc = await openDoc();
const { page, canvas, ctx, viewport } = await renderPage(doc, pageArg);
const its = await items(page, viewport);

if (mode === 'text') {
  console.log(`page ${pageArg}  ${canvas.width}x${canvas.height}  文字项 ${its.length}`);
  for (const i of its.sort((a, b) => a.y - b.y || a.x - b.x)) {
    console.log(`x=${Math.round(i.x).toString().padStart(5)} y=${Math.round(i.y).toString().padStart(5)} w=${Math.round(i.w).toString().padStart(4)}  ${JSON.stringify(i.s)}`);
  }
  process.exit(0);
}

if (mode === 'box') {
  const want = String(boxArg).split(',').map(s => s.trim());
  const pad = Number(padArg || 45);
  const hits = its.filter(i => want.includes(i.s.trim()));
  console.log(`命中标签 ${hits.length}: ${hits.map(h => `${h.s}(${Math.round(h.x)},${Math.round(h.y)})`).join(' ')}`);
  if (!hits.length) process.exit(2);
  const minX = Math.min(...hits.map(h => h.x)), maxX = Math.max(...hits.map(h => h.x + h.w));
  const minY = Math.min(...hits.map(h => h.y)), maxY = Math.max(...hits.map(h => h.y + h.h));
  const x = Math.max(0, Math.round(minX - pad)), y = Math.max(0, Math.round(minY - pad));
  const w = Math.min(canvas.width - x, Math.round(maxX - minX + pad * 2));
  const h = Math.min(canvas.height - y, Math.round(maxY - minY + pad * 2));
  console.log(`box: ${x},${y},${w},${h}`);
  process.exit(0);
}

if (mode === 'cut') {
  const [x, y, w, h] = String(boxArg).split(',').map(Number);
  const out = createCanvas(w, h);
  // JPEG 不能透明，先铺白底
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff'; octx.fillRect(0, 0, w, h);
  octx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  const f = path.join(OUT, `${idArg}-1.jpg`);
  fs.writeFileSync(f, await out.encode('jpeg', 92));
  console.log(`-> ${f}  ${w}x${h}`);
  process.exit(0);
}
console.error('mode: text | box | cut');
