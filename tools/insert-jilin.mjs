// tools/insert-jilin.mjs —— 2026 全国高中数学联赛（吉林预赛）
// 本卷无官方答案，全部答案由本脚本作者自算，故所有题目标 bug。
// 卷面结构：1–6 选择题（每题 5 分）、7–12 填空题（每题 5 分）、13–16 解答题（每题 15 分）。
// 选择题与填空题均入 ans（选择题存所选项的数值），解答/证明题 ans 留空并置 FS=true。
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

const PROV = '吉林';
const P = 'CHSMLHJL';

const items = [
  { n: 1, d: 4.10, a: '0.25', tags: ['Combinatorics', 'probability', 'triangle'],
    s: String.raw`在一线段 $AB$ 上随机取两个点，把线段截为三段，则这三段可以构成一个三角形的概率为（　　） A. $\dfrac{1}{2}$　B. $\dfrac{1}{3}$　C. $\dfrac{1}{4}$　D. $\dfrac{1}{6}$` },
  { n: 2, d: 4.80, a: '0.4', tags: ['Algebra', 'sequence', 'fractions'],
    s: String.raw`已知当 $x\in\left[0,\dfrac{1}{2}\right)$ 时 $f(x)=x+\dfrac{1}{2}$；当 $x\in\left[\dfrac{1}{2},1\right]$ 时 $f(x)=2(1-x)$。记 $f_n(x)$ 为 $f$ 的 $n$ 次复合（即 $f_n(x)=f(f(\cdots f(x)))$，共有 $n$ 个 $f$），则 $f_{2026}\left(\dfrac{1}{5}\right)=$（　　） A. $\dfrac{2}{5}$　B. $\dfrac{3}{5}$　C. $\dfrac{7}{10}$　D. $\dfrac{9}{10}$` },
  { n: 3, d: 4.30, a: '0.447214', tags: ['Geometry', 'solid-geometry', 'angles'],
    s: String.raw`在三棱锥 $P-ABC$ 中，$PA\perp$ 平面 $ABC$，$\angle BAC=90^\circ$，$D,E,F$ 分别是棱 $AB,BC,CP$ 的中点，$AB=AC=1$，$PA=2$。则直线 $PA$ 与平面 $DEF$ 所成角的正弦值为（　　） A. $\dfrac{1}{5}$　B. $\dfrac{2}{5}$　C. $\dfrac{\sqrt{5}}{5}$　D. $\dfrac{2\sqrt{5}}{5}$` },
  { n: 4, d: 4.70, a: '1.5', tags: ['Algebra', 'trigonometry', 'optimization'],
    s: String.raw`在 $\triangle ABC$ 中，$\sin^2 A+\cos^2 B=1$，则 $\cos A+\cos B+\cos C$ 的最大值是（　　） A. $\dfrac{5}{4}$　B. $\sqrt{2}$　C. $1$　D. $\dfrac{3}{2}$` },
  { n: 5, d: 3.20, a: '1', tags: ['NumberTheory', 'modular-arithmetic', 'exponential'],
    s: String.raw`已知 $(x+4)^{2026}=a_0+a_1x+a_2x^2+\cdots+a_{2026}x^{2026}$，若 $T=a_0+a_1+\cdots+a_{2026}$，则 $T$ 被 $6$ 除所得的余数为（　　） A. $1$　B. $2$　C. $4$　D. $5$` },
  { n: 6, d: 6.00, a: '1.154701', tags: ['Geometry', 'coordinate-method', 'length'],
    s: String.raw`已知双曲线 $C:\dfrac{x^2}{a^2}-\dfrac{y^2}{b^2}=1(a>0,b>0)$，过 $C$ 的右焦点 $F$ 作垂直于渐近线的直线 $l$ 交两渐近线于 $A,B$ 两点，$A,B$ 两点分别在一、四象限。若 $\dfrac{|AF|}{|BF|}=\dfrac{1}{2}$，则双曲线 $C$ 的离心率为（　　） A. $\dfrac{2\sqrt{3}}{3}$　B. $2$　C. $\sqrt{3}$　D. $\sqrt{5}$` },
  { n: 7, d: 3.90, a: '31', tags: ['Combinatorics', 'counting', 'sum'],
    s: String.raw`设 $A=\{1,2,3,4\}$，$B=\{x\mid x=a+2b+3c+4d,\ a,b,c,d\in A\}$，则集合 $B$ 中的元素个数为 ______。` },
  // 8、9 两题为区间型填空答案：判分系统仅支持数值 ans，故与库内惯例（FJ01/SD03/GX05/NMG08）一致地置 FS=true 走 AI 判分
  { n: 8, d: 4.25, a: '(0,1)', fs: true, tags: ['Algebra', 'absolute-value', 'simplification'],
    s: String.raw`函数 $f(x)=\dfrac{2}{|x|+|x-1|-|2x-1|}$ 的定义域为 ______。` },
  { n: 9, d: 4.65, a: '[0,12]', fs: true, tags: ['Algebra', 'polynomial', 'optimization'],
    s: String.raw`已知 $x\in[0,2]$，则函数 $f(x)=x^5-5x^3+10x$ 的取值范围是 ______。` },
  { n: 10, d: 6.20, a: '4', tags: ['Algebra', 'equation', 'surds'],
    s: String.raw`关于 $x,y$ 的方程组 $\sqrt{x(1-y)}+\sqrt{y(1-x)}=\dfrac{3}{5}$，$\sqrt{xy}+\sqrt{(1-x)(1-y)}=\dfrac{4}{5}$ 共有 ______ 组解。` },
  { n: 11, d: 5.30, a: '0.710526', tags: ['Combinatorics', 'probability', 'counting'],
    s: String.raw`在正 $21$ 边形中，任取三个顶点，可以构成钝角三角形的概率是 ______。` },
  { n: 12, d: 4.60, a: '108', tags: ['Geometry', 'solid-geometry', 'optimization'],
    s: String.raw`设 $P$ 为空间直角坐标系内一点，其坐标为 $(2,3,4)$，过 $P$ 任作一平面与三条坐标轴的正半轴分别交于点 $A,B,C$。则四面体 $OABC$ 体积的最小值为 ______。` },
  { n: 13, d: 6.50, a: '', fs: true, tags: ['Algebra', 'inequality', 'logarithms'],
    s: String.raw`已知函数 $f(x)=(a+1)\ln x+ax^2+1$。
(1) 当 $a=2$ 时，求曲线 $y=f(x)$ 在 $(1,f(1))$ 处的切线方程；
(2) 设 $a\le -2$，求证：对任意 $x_1,x_2\in(0,+\infty)$，$|f(x_1)-f(x_2)|\ge 4|x_1-x_2|$。` },
  { n: 14, d: 7.55, a: '', fs: true, tags: ['Algebra', 'sequence', 'inequality'],
    s: String.raw`设数列 $\{a_n\}$ 满足 $a_1\in(1,2)$，且 $a_{n+1}=a_n+\dfrac{n}{a_n}$。求证：至多存在一对 $(i,j)$ 使得 $a_i+a_j\in\mathbb{Z}$。` },
  { n: 15, d: 7.00, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'angles'],
    s: String.raw`已知双曲线 $C:\dfrac{x^2}{a^2}-\dfrac{y^2}{b^2}=1(a>0,b>0)$ 的离心率为 $2$，过点 $P(0,m)(m>0)$ 斜率为 $1$ 的直线 $l$ 交双曲线 $C$ 于 $A,B$ 两点，且 $\overrightarrow{AP}=3\overrightarrow{PB}$，$\overrightarrow{OA}\cdot\overrightarrow{OB}=3$。
(1) 求双曲线 $C$ 的方程；
(2) 设 $Q$ 为双曲线 $C$ 右支上的一个动点，$F$ 为双曲线 $C$ 的右焦点。问：在 $x$ 轴负半轴上是否存在点 $M$ 使得 $\angle QFM=2\angle QMF$？若存在，求出点 $M$ 的坐标；若不存在，给出理由。` },
  { n: 16, d: 7.45, a: '', fs: true, tags: ['NumberTheory', 'modular-arithmetic', 'divisibility'],
    s: String.raw`设整数 $n\ge 3$。整数 $x_1,x_2,\cdots,x_n$ 构成模 $n$ 的一个完全剩余系，整数 $y_1,y_2,\cdots,y_n$ 也构成模 $n$ 的一个完全剩余系。求证：$x_1y_1,x_2y_2,\cdots,x_ny_n$ 不是模 $n$ 的完全剩余系。` },
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

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('problems');

const existing = await col.find({ id: { $in: docs.map(d => d.id) } }, { projection: { id: 1, _id: 0 } }).toArray();
const have = new Set(existing.map(e => e.id));
const toInsert = docs.filter(d => !have.has(d.id));
const toUpdate = docs.filter(d => have.has(d.id));

console.log(`计划 ${docs.length} 题，已存在 ${have.size}，插入 ${toInsert.length}，更新 ${toUpdate.length}`);
if (toInsert.length) {
  const r = await col.insertMany(toInsert);
  console.log(`✅ 已插入 ${r.insertedCount} 题`);
  for (const d of toInsert) console.log(`   ${d.id}  d=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}`);
}
for (const d of toUpdate) {
  const { id, ...rest } = d;
  await col.updateOne({ id }, { $set: rest });
}
if (toUpdate.length) console.log(`✅ 已同步更新 ${toUpdate.length} 题（幂等重跑）`);
for (const d of await col.find({ id: { $in: docs.map(d => d.id) } }, { projection: { id: 1, ans: 1, FS: 1, difficulty: 1, _id: 0 } }).sort({ id: 1 }).toArray()) {
  console.log(`   ${d.id}  d=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}`);
}
console.log(`库中 ${P}* 总数: ${await col.countDocuments({ id: new RegExp('^' + P) })}`);

await client.close();
