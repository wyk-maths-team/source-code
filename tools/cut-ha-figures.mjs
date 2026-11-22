// temp/cut-ha-figures.mjs â€”â€” ä»Ž HKMHASC çš„ PDF é‡Œè£å‡ºé¢˜ç›®çš„å›¾
//
//   node --env-file=.env temp/cut-ha-figures.mjs            # åªè£å‡ å¼ è¯•æ°´
//   node --env-file=.env temp/cut-ha-figures.mjs --all      # å¤„ç†æ˜ å°„é‡Œæ‰€æœ‰é«˜åˆ†é¢˜
//   node --env-file=.env temp/cut-ha-figures.mjs --apply    # ä¸Šä¼ å¹¶å†™å›ž statement
//
// å®šä½æ€è·¯ï¼šç”¨ pdfjs æ‹¿åˆ°æ¯é“é¢˜æ–‡å­—çš„ y åæ ‡ï¼Œé¢˜ç›®å—ä¸‹æ–¹çš„ç©ºç™½åŒºé‡Œ
// å¦‚æžœå­˜åœ¨å¯†é›†çš„éžç™½åƒç´ ï¼Œé‚£å°±æ˜¯å›¾ã€‚bbox å–è¯¥åŒºåŸŸé‡Œæ‰€æœ‰éžç™½åƒç´ çš„åŒ…å›´ç›’ã€‚

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { uploadNumberedImage } from '../lib/github-upload.js';

const DIR = process.env.HKMHASC_DIR || 'downloaded_pdfs';
const OUT_DIR = 'temp/ha-figures';
const SCALE = 3;
const ALL = process.argv.includes('--all');
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
// 手动指定裁剪框（页面像素坐标，scale=3 下的坐标）：--box=x,y,w,h
const BOX = process.argv.find(a => a.startsWith('--box='))?.split('=')[1];
// 只渲染不裁剪，用来先看整页
const RENDER_ONLY = process.argv.includes('--render-only');

fs.mkdirSync(OUT_DIR, { recursive: true });

const map = JSON.parse(fs.readFileSync('temp/ha-map.json', 'utf8'))
  .filter(m => m.score >= 0.75)
  .filter(m => !ONLY || m.id === ONLY);

const jobs = ALL ? map : map.slice(0, 3);
console.log(`å¾…å¤„ç† ${jobs.length} é“ï¼ˆæ˜ å°„é‡Œé«˜åˆ†å…± ${map.length} é“ï¼‰`);

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 30_000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'wyk_math');

// æŒ‰ PDF åˆ†ç»„ï¼Œæ¯ä»½åªæ¸²æŸ“ä¸€æ¬¡
const byPdf = {};
for (const j of jobs) (byPdf[j.pdf] = byPdf[j.pdf] || []).push(j);

/**
 * åœ¨ä¸€é¡µé‡Œæ‰¾å‡ºæŸé“é¢˜ä¸‹æ–¹çš„å›¾å½¢åŒ…å›´ç›’ã€‚
 *
 * å…³é”®ä¸æ˜¯ã€Œå“ªé‡Œæœ‰å¢¨è¿¹ã€â€”â€”æ–‡å­—å’Œå›¾éƒ½æœ‰å¢¨è¿¹ã€‚å…³é”®æ˜¯ã€Œå“ªé‡Œä¸æ˜¯æ–‡å­—ã€ï¼š
 * ç”¨ getTextContent å¾—åˆ°çš„æ¯ä¸€è¡Œæ–‡å­—æ¡†å»ºé®ç½©ï¼Œä»Žæœ€åŽä¸€è¡Œæ–‡å­—å¾€ä¸‹ï¼Œ
 * è·³è¿‡æ‰€æœ‰è½åœ¨æ–‡å­—æ¡†å†…çš„è¡Œï¼Œå‰©ä¸‹çš„è¿žç»­åŒºåŸŸæ‰æ˜¯å›¾ã€‚
 *
 * è¿™æ ·ä¸‰è§’å½¢å†…éƒ¨é‚£ç§ã€Œåªæœ‰ä¸¤æ¡è¾¹ã€ä¸­é—´å¤§ç‰‡ç©ºç™½ã€çš„å›¾ä¹Ÿèƒ½æ•´å—åœˆä½ï¼Œ
 * ä¸ä¼šå› ä¸ºæŸä¸€è¡Œå¢¨è¿¹å¤ªå°‘å°±è¢«åˆ¤æˆç»“æŸã€‚
 */
function findFigureBox(imgData, lines, qLastTextY, footerY) {
  const { data, width, height } = imgData;

  // æ¯è¡Œæ–‡å­—çš„çºµå‘å ç”¨ï¼ˆå­—å· 15pt åœ¨ scale=3 ä¸‹çº¦ 50pxï¼Œç•™è¶³ä½™é‡ï¼‰
  const BAND = 22;
  const textBands = lines.map(l => [l.y - BAND, l.y + BAND]);

  const isInk = (i) => (data[i] + data[i + 1] + data[i + 2]) < 700;
  const inTextBand = (y) => textBands.some(([a, b]) => y >= a && y <= b);

  const y0 = Math.max(0, Math.floor(qLastTextY + 24));
  const y1 = Math.min(Math.floor(footerY), height);
  if (y1 - y0 < 80) return null;

  // ä»Ž y0 å¾€ä¸‹æ‰¾ç¬¬ä¸€æ®µã€Œä¸å±žäºŽæ–‡å­—ã€ä¸”æœ‰å¢¨è¿¹çš„è¿žç»­åŒºåŸŸ
  let top = -1, bottom = -1, gap = 0;
  const MAX_GAP = 90;          // å›¾å½¢å†…éƒ¨çš„åˆç†ç©ºç™½

  for (let y = y0; y < y1; y++) {
    let rowInk = 0;
    for (let x = 0; x < width; x++) if (isInk((y * width + x) * 4)) rowInk++;

    const isFigRow = rowInk > 0 && !inTextBand(y);

    if (isFigRow) {
      if (top === -1) top = y;
      bottom = y;
      gap = 0;
    } else if (top !== -1) {
      gap++;
      if (gap > MAX_GAP) break;
    }
  }
  if (top === -1) return null;

  const h = bottom - top;
  if (h < 50) return null;

  let minX = width, maxX = -1, ink = 0;
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInk((y * width + x) * 4)) continue;
      ink++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (ink < 600 || maxX < 0) return null;
  if (maxX - minX < 50) return null;

  return { x: minX, y: top, w: maxX - minX, h, ink };
}

for (const [pdfName, list] of Object.entries(byPdf)) {
  const pdfPath = path.join(DIR, pdfName);
  if (!fs.existsSync(pdfPath)) { console.log(`è·³è¿‡ï¼ˆæ–‡ä»¶ä¸å­˜åœ¨ï¼‰: ${pdfName}`); continue; }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), useSystemFonts: true }).promise;
  console.log(`\n=== ${pdfName} ï¼ˆ${list.length} é“ï¼‰===`);

  // éœ€è¦çš„é¡µ
  const pages = [...new Set(list.map(j => j.page))];

  for (const pageNo of pages) {
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

    // æ–‡æœ¬è¡Œåæ ‡ï¼ˆviewport åæ ‡ï¼‰
    const tc = await page.getTextContent();
    const lines = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const pt = viewport.convertToViewportPoint(it.transform[4], it.transform[5]);
      lines.push({ s: it.str, x: pt[0], y: pt[1] });
    }
    lines.sort((a, b) => a.y - b.y);

    // é¢˜å·è¡Œ
    const marks = [];
    for (const ln of lines) {
      const m = /^\s*(\d{1,2})\s*[.ï¼Žã€]/.exec(ln.s);
      if (m) marks.push({ qno: Number(m[1]), y: ln.y });
    }

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    for (const job of list.filter(j => j.page === pageNo)) {
      const idx = marks.findIndex(m => m.qno === job.qno);
      const top = idx >= 0 ? marks[idx].y : 0;
      const bottom = idx >= 0 && marks[idx + 1] ? marks[idx + 1].y : canvas.height * 0.95;

      // è¯¥é¢˜èŒƒå›´å†…çš„æœ€åŽä¸€è¡Œæ–‡å­—
      const inRange = lines.filter(l => l.y >= top - 2 && l.y < bottom - 2);
      const lastTextY = inRange.length ? Math.max(...inRange.map(l => l.y)) : top + 40;

      const box = findFigureBox(imgData, lines, lastTextY, canvas.height * 0.9);
      if (!box) { console.log(`  ${job.id} Q${job.qno} p${pageNo}: æ²¡æ‰¾åˆ°æ˜Žæ˜¾çš„å›¾`); continue; }

      // ä¸Šä¸‹ç•™ 12pxã€å·¦å³ç•™ 16px ä½™é‡
      const pad = { x: 16, y: 12 };
      const cx = Math.max(0, box.x - pad.x);
      const cy = Math.max(0, box.y - pad.y);
      const cw = Math.min(canvas.width - cx, box.w + pad.x * 2);
      const chh = Math.min(canvas.height - cy, box.h + pad.y * 2);

      const out = createCanvas(cw, chh);
      out.getContext('2d').putImageData(
        ctx.getImageData(cx, cy, cw, chh), 0, 0
      );

      const file = path.join(OUT_DIR, `${job.id}-1.jpg`);
      fs.writeFileSync(file, await out.encode('jpeg', 92));
      console.log(`  ${job.id} Q${job.qno} p${pageNo}: ${cw}x${chh} -> ${file}`);
      job._file = file;
      job._size = { w: cw, h: chh };
    }
  }
  if (typeof doc.destroy === 'function') await doc.destroy();
}

// â”€â”€ ä¸Šä¼  + å†™å›ž statement â”€â”€
if (APPLY) {
  console.log('\n=== ä¸Šä¼  ===');
  for (const job of jobs) {
    if (!job._file || !fs.existsSync(job._file)) continue;
    const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(job._file).toString('base64');
    try {
      const url = await uploadNumberedImage(dataUrl, { folder: 'images/problems', baseName: job.id });
      console.log(`  ${job.id}: ${url}`);

      const html = `<img src="${url}" alt="problem image" loading="lazy" style="max-width:66.67%;width:100%;height:auto;display:block;margin:.6rem auto;" />`;
      const p = await db.collection('problems').findOne({ id: job.id }, { projection: { statement: 1 } });
      if (p && !/<img/i.test(String(p.statement || ''))) {
        await db.collection('problems').updateOne(
          { id: job.id },
          { $set: { statement: String(p.statement || '').trim() + '\n' + html } }
        );
        console.log(`     å·²æ’å…¥ statement`);
      } else {
        console.log(`     statement é‡Œå·²æœ‰ imgï¼Œè·³è¿‡æ’å…¥`);
      }
    } catch (e) {
      console.error(`  ${job.id}: ä¸Šä¼ å¤±è´¥ ${e.message}`);
    }
  }
} else {
  console.log('\nï¼ˆåŠ  --apply æ‰ä¸Šä¼ å¹¶å†™åº“ï¼‰');
}

await client.close();

