// temp/build-hint-svgs.mjs —— 为几何题生成提示图，上传到私有仓库
//
//   node --env-file=.env temp/build-hint-svgs.mjs           # 只生成本地文件预览
//   node --env-file=.env temp/build-hint-svgs.mjs --apply   # 上传并挂到 problems.hints
//
// 只画「结构清晰」的题：图上不标长度、不标角度关系，只标点和线，
// 让人一眼看清布置，剩下的推理留给学生。

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { putHintImage } from '../lib/hint-images.js';

const APPLY = process.argv.includes('--apply');
const OUT_DIR = 'temp/hint-svg';
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── SVG 构造小工具 ───────────────────────────────────────────
const W = 420, H = 320, PAD = 46;

function makeSvg({ viewBox, lines = [], dots = [], labels = [], extra = '' }) {
  const stroke = '#1f2933';
  const fill = '#ffffff';
  const body = [
    ...lines.map(([a, b, dashed]) =>
      `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${stroke}" stroke-width="1.6"` +
      `${dashed ? ' stroke-dasharray="5 4" stroke-opacity="0.55"' : ''} />`),
    ...dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${stroke}" />`),
    ...labels.map(([x, y, t, dx = 0, dy = 0]) =>
      `<text x="${x + dx}" y="${y + dy}" font-family="Georgia, 'Times New Roman', serif" font-size="15" ` +
      `font-style="italic" fill="${stroke}" text-anchor="middle" dominant-baseline="middle">${t}</text>`),
    extra,
  ].join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${W}" height="${H}" role="img">
  <rect x="${viewBox.split(' ')[0]}" y="${viewBox.split(' ')[1]}" width="${viewBox.split(' ')[2]}" height="${viewBox.split(' ')[3]}" fill="${fill}" />
  ${body}
</svg>
`;
}

// 屏幕坐标：y 向下。用 s 把数学坐标压进画布，o 是偏移。
function fit(pts, w = W, h = H, pad = PAD) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (w - 2 * pad) / Math.max(1e-9, maxX - minX);
  const sy = (h - 2 * pad) / Math.max(1e-9, maxY - minY);
  const s = Math.min(sx, sy);
  const ox = (w - s * (maxX - minX)) / 2;
  const oy = (h - s * (maxY - minY)) / 2;
  // y 翻转
  return p => [ox + (p[0] - minX) * s, h - (oy + (p[1] - minY) * s)];
}

// ─── IP0213 ───────────────────────────────────────────────────
// 正方形 ABCD 边长 5, E on BC (BE=3), P on 对角线 BD
function ip0213() {
  const A = [0, 0], B = [5, 0], C = [5, 5], D = [0, 5], E = [5, 3], P = [3, 2];
  const t = fit([A, B, C, D, E, P]);
  const [a, b, c, d, e, p] = [A, B, C, D, E, P].map(t);
  const off = 15;
  return makeSvg({
    viewBox: `0 0 ${W} ${H}`,
    lines: [
      [a, b], [b, c], [c, d], [d, a],          // 正方形
      [b, d, true],                             // 对角线 BD（虚线：P 在上面移动）
      [p, e], [p, c],                           // PE, PC
    ],
    dots: [a, b, c, d, e, p],
    labels: [
      [a[0] - 12, a[1] + off, 'A'],
      [b[0] + 12, b[1] + off, 'B'],
      [c[0] + 12, c[1] - off, 'C'],
      [d[0] - 12, d[1] - off, 'D'],
      [e[0] + 14, e[1], 'E'],
      [p[0] - 14, p[1] - 12, 'P'],
    ],
  });
}

// ─── IP0212 ───────────────────────────────────────────────────
// 梯形 ABCD: BC⊥AB, BC⊥CD, AC⊥BD, AB=√11, AD=√1001
//
// 取 A(0,0), B(u,0), C(u,h), D(u-w,h)，u=AB=√11。
// BC⊥AB 与 BC⊥CD 把 AB、CD 都钉成水平，于是它们平行（这就是梯形）；
// AC⊥BD 给出 u·v + h² = 0，v = D.x - C.x 必须为负 —— 所以 D 在 C 的左边，不是右边。
// 令 w = -v，则 h² = uw；再用 AD² = (u-w)² + uw = 1001 解出 w。
// 结果 BC² = h² = 110。
function ip0212() {
  const u = Math.sqrt(11);
  const w = (u + Math.sqrt(u * u + 4 * 990)) / 2;   // w² - uw - 990 = 0
  const h = Math.sqrt(u * w);

  const A = [0, 0], B = [u, 0], C = [u, h], Dk = [u - w, h];
  const t = fit([A, B, C, Dk]);
  const [a, b, c, d2] = [A, B, C, Dk].map(t);
  const off = 16;
  return makeSvg({
    viewBox: `0 0 ${W} ${H}`,
    lines: [
      [a, b], [b, c], [c, d2], [d2, a],      // 梯形 ABCD
      [a, c, true], [b, d2, true],           // 对角线 AC、BD（互相垂直）
    ],
    dots: [a, b, c, d2],
    labels: [
      [a[0] - 6, a[1] + off, 'A'],
      [b[0] + 10, b[1] + off, 'B'],
      [c[0] + 13, c[1] - off, 'C'],
      [d2[0] - 13, d2[1] - off, 'D'],
    ],
  });
}

// ─── IP0207 ───────────────────────────────────────────────────
// △ABC: X,Y 三等分 BC; M,N 三等分 AC; BM,BN 交 AY 于 S,R
function ip0207() {
  const B = [0, 0], C = [3, 0];
  const X = [1, 0], Y = [2, 0];
  const A = [1.4, 3.4];
  const lerp = (p, q, k) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  const M = lerp(A, C, 1 / 3), N = lerp(A, C, 2 / 3);

  // 直线交点
  function inter(p1, p2, p3, p4) {
    const d1 = [p2[0] - p1[0], p2[1] - p1[1]];
    const d2 = [p4[0] - p3[0], p4[1] - p3[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-12) return null;
    const t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / den;
    return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
  }
  const S = inter(B, M, A, Y);
  const R = inter(B, N, A, Y);

  const t = fit([A, B, C]);
  const f = p => t(p);
  const [a, b, c, x, y, m, n, s, r] = [A, B, C, X, Y, M, N, S, R].map(f);
  const off = 15;
  return makeSvg({
    viewBox: `0 0 ${W} ${H}`,
    lines: [
      [a, b], [b, c], [c, a],                // 三角形
      [a, y, true],                          // AY
      [b, m], [b, n],                        // BM, BN
      [a, m, true], [m, n, true], [n, c, true],  // AC 上的三等分点连线
    ],
    dots: [a, b, c, x, y, m, n, s, r],
    labels: [
      [a[0], a[1] - 16, 'A'],
      [b[0] - 13, b[1] + off, 'B'],
      [c[0] + 13, c[1] + off, 'C'],
      [x[0], x[1] + 17, 'X'],
      [y[0] + 2, y[1] + 17, 'Y'],
      [m[0] + 15, m[1], 'M'],
      [n[0] + 15, n[1], 'N'],
      [s[0] - 14, s[1] + 2, 'S'],
      [r[0] - 14, r[1] + 2, 'R'],
    ],
  });
}

const JOBS = [
  { id: 'IP0213', hintId: 'h1', file: 'IP0213-h1.svg', alt: 'Square ABCD with E on BC and P on diagonal BD', build: ip0213 },
  { id: 'IP0212', hintId: 'h1', file: 'IP0212-h1.svg', alt: 'Trapezium ABCD with perpendicular diagonals', build: ip0212 },
  { id: 'IP0207', hintId: 'h1', file: 'IP0207-h1.svg', alt: 'Triangle ABC with trisection points on BC and AC', build: ip0207 },
];

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 30_000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'wyk_math');

for (const job of JOBS) {
  const svg = job.build();
  const local = path.join(OUT_DIR, job.file);
  fs.writeFileSync(local, svg, 'utf8');
  console.log(`${job.id}: ${Buffer.byteLength(svg)} bytes -> ${local}`);

  if (!APPLY) continue;

  const up = await putHintImage(job.file, svg);
  console.log(`   uploaded ${up.path} (${up.created ? 'new' : 'overwritten'})`);

  // 挂到题目的 hint 上：保留原有文字，加 image 字段
  const doc = await db.collection('problems').findOne({ id: job.id }, { projection: { hints: 1 } });
  const hints = Array.isArray(doc && doc.hints) ? doc.hints.map(h => ({ ...h })) : [];
  let target = hints.find(h => String(h.id) === job.hintId);
  if (!target) {
    target = { id: job.hintId, content: '', price: 5000, order: hints.length };
    hints.push(target);
  }
  target.image = { file: job.file, alt: job.alt };

  await db.collection('problems').updateOne({ id: job.id }, { $set: { hints } });
  console.log(`   attached to ${job.id}.${job.hintId}`);
}

if (!APPLY) console.log('\n（加 --apply 才会上传并写库）');
await client.close();
