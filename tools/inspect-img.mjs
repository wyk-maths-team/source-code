import fs from 'node:fs';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const f = process.argv[2];
const img = await loadImage(fs.readFileSync(f));
const c = createCanvas(img.width, img.height);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width, H = img.height;
const lum = (x, y) => { const i = (y * W + x) * 4; return (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11); };

// 逐行：统计该行暗像素（<160）的最左/最右 x
console.log(`size ${W}x${H}`);
const rows = [];
for (let y = 0; y < H; y++) {
  let first = -1, last = -1, cnt = 0;
  for (let x = 0; x < W; x++) if (lum(x, y) < 160) { if (first < 0) first = x; last = x; cnt++; }
  rows.push({ y, first, last, cnt });
}
const thin = rows.filter(r => r.cnt > 0 && r.cnt < 6);
console.log('近满宽细线行（可能是横线）:', thin.filter(r => r.last - r.first > W * 0.8).map(r => r.y).slice(0, 12).join(','));
// 竖线：在某几行上找暗像素列
for (const y of [Math.floor(H * 0.15), Math.floor(H * 0.5), Math.floor(H * 0.85)]) {
  const xs = [];
  for (let x = 0; x < W; x++) if (lum(x, y) < 160) xs.push(x);
  console.log(`y=${y} 暗像素列: ${xs.slice(0, 20).join(',')}${xs.length > 20 ? ' ... 共' + xs.length : ''}`);
}
// 边缘 8 列平均亮度
const edge = [];
for (let x = 0; x < 8; x++) { let s = 0; for (let y = 0; y < H; y++) s += lum(x, y); edge.push(`${x}:${Math.round(s / H)}`); }
console.log('左边缘平均亮度', edge.join(' '));
