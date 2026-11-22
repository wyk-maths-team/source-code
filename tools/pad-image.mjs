import fs from 'node:fs';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const [src, dst, padArg] = process.argv.slice(2);
const pad = Number(padArg || 10);
const img = await loadImage(fs.readFileSync(src));
const c = createCanvas(img.width + pad * 2, img.height + pad * 2);
const ctx = c.getContext('2d');
ctx.fillStyle = '#fff';
ctx.fillRect(0, 0, c.width, c.height);
ctx.drawImage(img, pad, pad);
fs.writeFileSync(dst, await c.encode('jpeg', 92));
console.log(`${dst} ${c.width}x${c.height} (pad ${pad})`);
