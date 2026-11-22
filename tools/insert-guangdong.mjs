// tools/insert-guangdong.mjs —— 2026 广东预赛（有官方答案）
// 填空 1-10（答案取自参考答案 PDF 第 1-4 页），解答 11-14
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

const P = 'CHSMLHGD';       // 省份前缀（广东 = GD，不是 GZ 广州）
const PROV = '广东';

const problems = [
  {
    n: 1, diff: 4.20, ans: '8',
    tags: ['Algebra', 'equation', 'polynomial'],
    statement: String.raw`设 $S=\{a:a^2<2026\}$，$T=\{a:\text{关于 }x\text{ 的一元二次方程 }x^2-4x+a=0\text{ 有整数根}\}$。则 $S\cap T$ 的元素个数为 ______。`,
  },
  {
    n: 2, diff: 5.60, ans: '2.449490',
    tags: ['Algebra', 'logarithms', 'equation'],
    statement: String.raw`已知 $\log_2 x=\log_3 y=\log_5\sqrt{x^2+y^2}$，则 $xy=$ ______。`,
  },
  {
    n: 3, diff: 5.00, ans: '16',
    tags: ['Combinatorics', 'counting', 'modular-arithmetic'],
    statement: String.raw`有 $24$ 名小朋友排成一圈，现在要将小朋友们两两配对，一共配成 $12$ 对，并要求任意两名配对的小朋友之间恰好隔了 $3$ 名小朋友。则共有 ______ 种配对的方法。`,
  },
  {
    n: 4, diff: 5.50, ans: '1',
    tags: ['Geometry', 'coordinate-method', 'optimization'],
    statement: String.raw`在平面直角坐标系中，点 $A(-3,0),B(3,0)$，动点 $M$ 满足 $|MA|\cdot|MB|=6$，则 $M$ 的纵坐标的最大值为 ______。`,
  },
  {
    n: 5, diff: 6.40, ans: '1013',
    tags: ['Algebra', 'sequence', 'equation'],
    statement: String.raw`若存在 $n+1$ 个实数 $a_0,a_1,\cdots,a_n$ 同时满足：(1) $a_0=-2026a_1$；(2) 对 $k=1,2,\cdots,n-1$，有 $a_{k+1}=\dfrac{a_k^2}{2a_k+a_{k-1}}$。则正整数 $n$ 的最大值是 ______。`,
  },
  {
    n: 6, diff: 6.00, ans: '0.507673',
    tags: ['Geometry', 'solid-geometry', 'angles', 'vectors'],
    statement: String.raw`在矩形 $ABCD$ 中，$AB=3,BC=2$。将 $ABCD$ 沿对角线 $AC$ 折起后形成三棱锥 $D-ABC$。当三棱锥 $D-ABC$ 的体积最大时，直线 $AC,BD$ 所成角的余弦值为 ______。`,
  },
  {
    n: 7, diff: 7.00, ans: '9',
    tags: ['Algebra', 'floor-function', 'optimization'],
    statement: String.raw`设整数 $1=a_1<a_2<\cdots<a_7=100$，则 $\sum_{i=1}^{6}\left[\dfrac{a_{i+1}}{a_i}\right]$ 的最小可能值为 ______。`,
  },
  {
    n: 8, diff: 6.60, ans: '34.655447',
    tags: ['NumberTheory', 'prime', 'sum'],
    statement: String.raw`四个互不相等的复数 $z_1,z_2,z_3,z_4$ 的实部和虚部都是非负整数，且 $|z_1z_2z_3z_4|=\sqrt{2026}$，则 $|z_1+z_2+z_3+z_4|=$ ______。`,
  },
  {
    n: 9, diff: 7.40, ans: '[0.5,1.5]',
    tags: ['Geometry', 'circle', 'ratios'],
    statement: String.raw`给定平面直角坐标系内三点 $A\left(\dfrac12,0\right),B\left(2,\dfrac32\right),C(2,-2)$。过 $A$ 作一条直线与圆 $x^2+y^2=1$ 交于两点 $P,Q$，则 $\dfrac{|BP|}{|CQ|}$ 的取值范围是 ______。`,
  },
  {
    n: 10, diff: 6.70, ans: '22.444622',
    tags: ['Geometry', 'triangle', 'trigonometry', 'area'],
    statement: String.raw`设 $H$ 是锐角三角形 $ABC$ 的垂心，三角形 $ABH,BCH,CAH$ 的面积分别为 $2,3,4$，则三角形 $ABC$ 的外接圆的面积为 ______。`,
  },
  {
    n: 11, diff: 7.60, ans: '', fs: true,
    tags: ['Algebra', 'sequence', 'surds'],
    statement: String.raw`设 $a_0=1$，$a_{n+1}=2a_n-1+\sqrt{3a_n^2-6a_n+4}\ (n\ge 0)$。求 $\{a_n\}$ 的通项公式。`,
  },
  {
    n: 12, diff: 8.20, ans: '', fs: true,
    tags: ['Geometry', 'triangle', 'trigonometry', 'ratios'],
    statement: String.raw`设 $ABCD$ 是一个凸四边形，延长 $DC,AB$ 交于点 $E$。已知 $BE=AB$，$BD-AD=AC-BC=\dfrac12 AB$，$CD=\sqrt5 AB$。求 $\tan\angle AED$。`,
  },
  {
    n: 13, diff: 8.60, ans: '', fs: true,
    tags: ['NumberTheory', 'fractions', 'inequality'],
    statement: String.raw`(1) 求证：对任意满足 $0<b-a\le 1$ 的实数 $a,b$，开区间 $(a,b)$ 内分母最小的分数是唯一的（分母必须是正整数，整数视为分母为 $1$ 的分数）；(2) 设整数 $m\ge 2$，实数 $a,b$ 满足 $\dfrac{1}{m(m+1)}<a<b<1-\dfrac{1}{m(m+1)}$，$b-a>\dfrac{1}{m+1}$。求证：开区间 $(a,b)$ 内分母最小的分数的分母不超过 $m$。`,
  },
  {
    n: 14, diff: 8.80, ans: '', fs: true,
    tags: ['Combinatorics', 'counting'],
    statement: String.raw`有 $100$ 名乒乓球选手参加一次单打联赛，每两人最多打一场，每一场比赛都会分出胜负。已知比赛结束后，对任意四名两两比赛过的选手，都可以从中选出三名选手，使得这三名选手之间的比赛中，每人都恰胜了一场。求比赛场数的最大可能值。`,
  },
];

const docs = problems.map(p => ({
  id: `${P}${String(p.n).padStart(2, '0')}`,
  name: `高中联赛预赛（${PROV}）第${p.n}题`,
  statement: p.statement,
  ans: p.ans,
  difficulty: p.diff,
  public: false,
  FS: p.fs === true,
  tags: [...p.tags, 'CHSML'],
  logic: '',
}));

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('problems');

const ids = docs.map(d => d.id);
const existing = await col.find({ id: { $in: ids } }, { projection: { id: 1, _id: 0 } }).toArray();
const existingIds = new Set(existing.map(e => e.id));

const toInsert = docs.filter(d => !existingIds.has(d.id));
console.log(`计划插入 ${docs.length} 题，已存在 ${existingIds.size} 题，实际插入 ${toInsert.length} 题`);

if (toInsert.length > 0) {
  const res = await col.insertMany(toInsert);
  console.log(`✅ 已插入 ${res.insertedCount} 题`);
  for (const d of toInsert) console.log(`   ${d.id}  diff=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}  tags=${d.tags.join(',')}`);
}

const total = await col.countDocuments({ id: /^CHSMLHGD/ });
console.log(`\n库中 CHSMLHGD* 总数: ${total}`);

await client.close();
