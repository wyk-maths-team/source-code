// tools/insert-beijing.mjs —— 2026 北京预赛（无官方答案，全部标 bug）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const PROV = '北京';
const P = 'CHSMLHBJ';

const items = [
  { n: 1, d: 5.5, a: '0', tags: ['Combinatorics', 'counting', 'sum'],
    s: String.raw`设集合 $W=\{1,2,\cdots,2026\}$，对 $W$ 的子集 $A=\{a_1,a_2,\cdots,a_k\}$，定义 $\lambda_A=(-1)^{a_1+a_2+\cdots+a_k}\cdot k$，其中 $\lambda_\varnothing=0$。则 $\sum_{A\subseteq W}\lambda_A=$ ______。` },
  { n: 2, d: 3.5, a: '13.392305', tags: ['Algebra', 'exponential', 'optimization'],
    s: String.raw`设 $x\in\mathbb{R}$，则 $\dfrac{3^{2x+1}+3^{x+2}+15}{3^x+1}$ 的最小值为 ______。` },
  { n: 3, d: 4.5, a: '0.469382', tags: ['Geometry', 'solid-geometry', 'area'],
    s: String.raw`已知一个正三棱锥的底面边长为 $2$，侧棱长为 $3$，则其内切球的半径为 ______。` },
  { n: 4, d: 5.5, a: '4.403669', tags: ['Algebra', 'roots', 'optimization'],
    s: String.raw`设复数 $z$ 满足 $|z|=1$，则 $|z^3-3z+1|$ 的最大值为 ______。` },
  { n: 5, d: 4.5, a: '1.666667', tags: ['Geometry', 'coordinate-method', 'optimization'],
    s: String.raw`设点 $P(x,y,z)$ 在平面 $2x-y+z=2$ 上，记 $d_1=|OP|$，$d_2$ 是 $P$ 到平面 $x-2y+2z=0$ 的距离。则 $d_1^2+9d_2^2$ 的最小值为 ______。` },
  { n: 6, d: 6, a: '6.667293', tags: ['Geometry', 'coordinate-method', 'area', 'optimization'],
    s: String.raw`已知椭圆 $\dfrac{x^2}{3}+\dfrac{y^2}{9}=1$，$\triangle ABC$ 是这个椭圆的内接三角形，且 $AB$ 过点 $(0,\dfrac{6}{5})$，则 $S_{\triangle ABC}$ 的最大值为 ______。` },
  { n: 7, d: 6, a: '2', tags: ['NumberTheory', 'modular-arithmetic', 'surds'],
    s: String.raw`设 $a-b\sqrt{3}=(2-\sqrt{3})^{2026}$，其中 $a,b$ 是整数。则 $ab$ 除以 $19$ 的余数为 ______。` },
  { n: 8, d: 5.5, a: '136800', tags: ['Combinatorics', 'counting'],
    s: String.raw`已知一个凸 $20$ 边形的任意三条对角线不交于一点，则这个凸 $20$ 边形的所有边与对角线围成的三角形的个数为 ______。` },
  { n: 9, d: 7, a: '0.75', tags: ['Algebra', 'inequality', 'optimization'],
    s: String.raw`设非负实数 $a_1,a_2,\cdots,a_{2026}$ 满足 $\sum_{i=1}^{2026}a_i=1$。则 $\dfrac{a_1}{4a_2^2+1}+\dfrac{a_2}{4a_3^2+1}+\cdots+\dfrac{a_{2026}}{4a_1^2+1}$ 的最小值为 ______。` },
  { n: 10, d: 6.5, a: '18', tags: ['Algebra', 'sequence', 'floor-function'],
    s: String.raw`设数列 $\{a_n\}$ 满足 $a_1=1$，$a_2=2$，$a_{n+2}=a_{n+1}+\dfrac{1}{a_n^2}$。则 $[a_{2026}]=$ ______。` },
  { n: 11, d: 7, a: '-0.333333', tags: ['Geometry', 'coordinate-method', 'area', 'optimization'],
    s: String.raw`设直线 $y=x$ 与椭圆 $\dfrac{x^2}{21}+\dfrac{y^2}{11}=1$ 交于 $A,B$ 两点，过椭圆的右焦点 $F_2$ 作直线 $l$ 交椭圆于 $M,N$ 两点。则当四边形 $MANB$ 的面积最大时，直线 $l$ 的斜率为 ______。` },
  { n: 12, d: 7, a: '', fs: true, tags: ['Geometry', 'angle-chasing', 'circle', 'triangle'],
    s: String.raw`如图，在锐角 $\triangle ABC$ 中，$M$ 是 $BC$ 的中点，$D,E$ 是形内两点，满足 $D$ 在 $\triangle ABM$ 的外接圆上，$E$ 在 $\triangle ACM$ 的外接圆上，且 $MD\perp ME$。延长 $MD,ME$ 分别交 $AC,AB$ 于点 $F,G$。已知 $D,E,G,F$ 四点共圆，求证：$MD$ 平分 $\angle AMC$。` },
  { n: 13, d: 7.5, a: '', fs: true, tags: ['Algebra', 'inequality', 'sequence'],
    s: String.raw`给定整数 $n\ge 3$。设实数 $x_1,x_2,\cdots,x_n$ 满足 $\max_{1\le k\le n}\dfrac{x_1+x_2+\cdots+x_k}{k}=1$，$\min_{1\le k\le n}\dfrac{x_1+x_2+\cdots+x_k}{k}=0$。求 $D=\max_{1\le k\le n-1}|x_{k+1}-x_k|$ 的最大值与最小值。` },
  { n: 14, d: 8, a: '', fs: true, tags: ['Combinatorics', 'counting', 'digits'],
    s: String.raw`称正整数 $n$ 为「专一的」，如果对任意 $1\le i\le n-1$，$i$ 和 $n-i$ 中至少有一个在十进制表示中含数码 $1$。记 $S$ 为所有小于 $10^{2026}$ 的专一数之和，求 $S$ 除以 $11$ 的余数。` },
  { n: 15, d: 8.5, a: '', fs: true, tags: ['Combinatorics', 'counting'],
    s: String.raw`设整数 $n\ge 2$。在一个 $n\times n$ 的棋盘中，每个格被染成两种颜色之一。有些格中有若干个硬币，一次操作选择一个格，将此格中所有硬币分配至邻格（有公共边），异色邻格分配 $2$ 个硬币，同色邻格分配 $1$ 个硬币。已知操作可以无限进行下去，求硬币总数的所有可能值。` },
];

const docs = items.map(p => ({
  id: `${P}${String(p.n).padStart(2, '0')}`,
  name: `高中联赛预赛（${PROV}）第${p.n}题`,
  statement: p.s,
  ans: p.a,
  difficulty: p.d,
  public: false,
  FS: p.fs === true,
  tags: [...p.tags, 'CHSML', 'bug'],
  logic: '',
}));

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('problems');

const existing = await col.find({ id: { $in: docs.map(d => d.id) } }, { projection: { id: 1, _id: 0 } }).toArray();
const have = new Set(existing.map(e => e.id));
const toInsert = docs.filter(d => !have.has(d.id));

console.log(`计划 ${docs.length} 题，已存在 ${have.size}，插入 ${toInsert.length}`);
if (toInsert.length) {
  const r = await col.insertMany(toInsert);
  console.log(`✅ 已插入 ${r.insertedCount} 题`);
  for (const d of toInsert) console.log(`   ${d.id}  d=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}`);
}
console.log(`库中 ${P}* 总数: ${await col.countDocuments({ id: new RegExp('^' + P) })}`);

await client.close();
