// tools/insert-guizhou.mjs —— 2026 贵州预赛（无官方答案，答案自行计算，全部标 bug）
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

const PROV = '贵州';
const P = 'CHSMLHGZ';

const items = [
  { n: 1, d: 4.5, a: '52', tags: ['NumberTheory', 'diophantine', 'equation'],
    s: String.raw`从集合 $\{1,2,3,\cdots,37\}$ 中选出两个数，使得其余 $35$ 个数之和是这两个数之积. 则满足条件的两个数之和为 ______.` },
  { n: 2, d: 5.5, a: '-2', tags: ['Algebra', 'equation', 'absolute-value'],
    s: String.raw`已知 $z\in\mathbb{C}$，且 $12|z|^2=2|z+2|^2+|z^2+1|^2+31$，则 $z+\dfrac{6}{z}=$ ______.` },
  { n: 3, d: 6, a: '-0.083333', tags: ['Geometry', 'triangle', 'coordinate-method', 'optimization'],
    s: String.raw`设 $O$ 是 $\triangle ABC$ 三边的垂直平分线的交点，且 $BC^2+2AC=2AB^2$. 点 $E$ 满足 $\overrightarrow{BE}=2\overrightarrow{EA}$，则 $\overrightarrow{BC}\cdot\overrightarrow{EO}$ 的最小值是 ______.` },
  { n: 4, d: 5.5, a: '53.665631', tags: ['Geometry', 'solid-geometry', 'diophantine'],
    s: String.raw`在四棱锥 $M-ABCD$ 中，底面 $ABCD$ 为矩形，$MD\perp$ 面 $ABCD$. 已知 $MD$ 的长为整数，$MA,MC,MB$ 的长为三个连续的奇数. 则四棱锥 $M-ABCD$ 的体积为 ______.` },
  { n: 5, d: 6, a: '0.021429', tags: ['Combinatorics', 'probability', 'counting'],
    s: String.raw`有三个红色、三个蓝色、三个绿色共 $9$ 个形状相同的筹码，将它们放入一个 $3\times 3$ 的方格表中，则使得任意两个颜色相同的筹码互不相邻（两个方格有且仅有公共边叫相邻）的概率为 ______.` },
  { n: 6, d: 3.5, a: '30x-27', tags: ['Algebra', 'polynomial'],
    s: String.raw`多项式 $x^{20}+x^{10}+1$ 除以 $(x-1)^2$ 的余式为 ______.` },
  { n: 7, d: 5.5, a: String.raw`\frac{33\cdot 3^n-4n^3-18n^2-36n-33}{8\cdot 3^n}`, tags: ['Algebra', 'series', 'sum'],
    s: String.raw`已知数列 $\{a_n\}$ 有通项公式为 $a_n=\dfrac{n^3}{3^n}$，则数列 $\{a_n\}$ 的前 $n$ 项和 $S_n=$ ______.` },
  { n: 8, d: 5.5, a: '0.916515', tags: ['Geometry', 'trigonometry', 'inequality', 'optimization'],
    s: String.raw`在 $\triangle ABC$ 中，若 $\dfrac{\tan A}{\tan B}+\dfrac{\tan A}{\tan C}=3$，则 $\sin A$ 的最大值是 ______.` },
  { n: 9, d: 5.5, a: '8', tags: ['Algebra', 'exponential', 'optimization'],
    s: String.raw`已知函数 $f(x)$ 在定义域 $(0,+\infty)$ 上单调递减，$f(x)f\left(f(x)+\dfrac{2}{x}\right)=1$ 在 $(0,+\infty)$ 上恒成立. 则函数 $y=f(3^x-9^x)$ 的最小值是 ______.` },
  { n: 10, d: 6.5, a: String.raw`\left[\frac{1}{3},+\infty\right)`, tags: ['Algebra', 'trigonometry', 'inequality'],
    s: String.raw`设函数 $f(x)=\sin x-ax(2+\cos x)$. 若当 $x\ge 0$ 时，$f(x)\le 0$，则 $a$ 的取值范围是 ______.` },
  { n: 11, d: 4.5, a: '', fs: true, tags: ['Combinatorics', 'counting', 'circle'],
    s: String.raw`把圆沿圆心分成 $n$ 个扇形，并且用红、黄、蓝三种颜色给扇形染色，但不允许相邻的扇形有相同的颜色. 试问：共有多少种不同的染色方法？` },
  { n: 12, d: 7, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'ratios'],
    s: String.raw`已知椭圆 $\dfrac{x^2}{10}+\dfrac{y^2}{6}=1$ 的左、右焦点为 $F_1,F_2$，点 $M(1,0)$，过点 $F_1$ 且斜率为 $k$ 的直线 $l$ 与椭圆交于 $P,Q$ 两点（$P,Q$ 不在 $x$ 轴上），直线 $MP,MQ$ 与椭圆的另一个交点分别为 $A,B$.
(1) 椭圆上是否存在关于直线 $l$ 对称的两点，若有，求斜率 $k$ 的取值范围；若没有，请说明理由.
(2) 若 $\dfrac{MP}{MA}+\dfrac{MQ}{MB}=3$，求直线 $l$ 的斜率.` },
  { n: 13, d: 6.5, a: '', fs: true, tags: ['Geometry', 'length', 'optimization'],
    s: String.raw`在平面内固定摆放着一个边长为 $8\mathrm{cm}$ 的正方形框，现把一根周长为 $34\mathrm{cm}$ 的无弹性细绳圈摆放在该平面内，使正方形框在细绳圈内. 今用一支笔绷紧细绳，使其笔尖围绕细绳滑动出轨迹 $\Gamma$（正方形边框、细绳及笔尖都不考虑粗细及大小）. 求轨迹 $\Gamma$ 上的点到正方形框的中心的最大距离.` },
  { n: 14, d: 7.5, a: '', fs: true, tags: ['Geometry', 'solid-geometry', 'inequality'],
    s: String.raw`单位正方体的内部有一个四面体 $ABCD$. 设 $E,F$ 分别是棱 $AB,CD$ 的中点. 求证：$AB\cdot CD\cdot EF\le 2$.` },
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
