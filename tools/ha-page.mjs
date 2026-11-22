// temp/ha-page.mjs —— 渲染指定 PDF 页 / 按手动坐标裁剪
//   node temp/ha-page.mjs render "2011-2012_Questions.pdf" 4
//   node temp/ha-page.mjs cut HA1116 "2011-2012_Questions.pdf" 4 100,200,800,600
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const DIR = 'C:\\Users\\lichi\\Downloads\\dsh\\HKMHASC';
const OUT = 'temp/ha-figures';
const SCALE = 3;
fs.mkdirSync(OUT, { recursive: true });

const [mode, ...rest] = process.argv.slice(2);

async function renderPage(pdfName, pageNo) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(DIR, pdfName))), useSystemFonts: true }).promise;
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
  if (typeof doc.destroy === 'function') await doc.destroy();
  return canvas;
}

if (mode === 'render') {
  const [pdfName, pageNo] = rest;
  const canvas = await renderPage(pdfName, Number(pageNo));
  const f = path.join(OUT, `page-${pdfName.replace('.pdf', '')}-p${pageNo}.png`);
  fs.writeFileSync(f, canvas.toBuffer('image/png'));
  console.log(f, `${canvas.width}x${canvas.height}`);
} else if (mode === 'cut') {
  const [id, pdfName, pageNo, boxStr] = rest;
  const [x, y, w, h] = boxStr.split(',').map(Number);
  const canvas = await renderPage(pdfName, Number(pageNo));
  const out = createCanvas(w, h);
  out.getContext('2d').putImageData(canvas.getContext('2d').getImageData(x, y, w, h), 0, 0);
  const f = path.join(OUT, `${id}-1.jpg`);
  fs.writeFileSync(f, await out.encode('jpeg', 92));
  console.log(f, `${w}x${h}`);
} else {
  console.log('用法见文件头');
}
