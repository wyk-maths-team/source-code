// tools/insert-jiangsu.mjs —— 2026 江苏预赛（无官方答案，全部标 bug）
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

const PROV = '江苏';
const P = 'CHSMLHJS';

const items = [
  { n: 1, d: 3.0, a: '2.236068', tags: ['Algebra', 'roots'],
    s: String.raw`已知复数 $z$ 满足 $z+\dfrac{5}{z}=2$，则 $|z|=$ ______。` },
  { n: 2, d: 3.5, a: '3', tags: ['Geometry', 'trigonometry', 'area'],
    s: String.raw`在锐角 $\triangle ABC$ 中，$BC=3$，$AC=2\sqrt{2}$。若其面积为 $3$，则 $\tan\angle BAC=$ ______。` },
  { n: 3, d: 3.0, a: '0.84375', tags: ['Combinatorics', 'probability'],
    s: String.raw`甲、乙两人进行羽毛球比赛，采用三局两胜制。已知每局比赛甲胜的概率为 $\dfrac{1}{4}$，乙胜的概率为 $\dfrac{3}{4}$，则乙赢得比赛的概率为 ______。` },
  { n: 4, d: 4.5, a: '0.732051', tags: ['Geometry', 'solid-geometry'],
    s: String.raw`在正四棱锥 $P-ABCD$ 中，$AB=2\sqrt{2}$，侧面与底面所成二面角的正切值为 $\sqrt{2}$。则此正四棱锥的内切球半径为 ______。` },
  { n: 5, d: 4.5, a: '0.333333', tags: ['Geometry', 'coordinate-method'],
    s: String.raw`在平面直角坐标系 $xOy$ 中，已知双曲线 $C:\dfrac{x^2}{a^2}-\dfrac{y^2}{b^2}=1\ (a,b>0)$ 的离心率 $e=\sqrt{3}$。$P$ 为 $x$ 正半轴上一点，过 $P$ 作双曲线 $C$ 的一条渐近线的垂线，垂足为 $A$，直线 $PA$ 与另一条渐近线交于点 $B$。若 $\overrightarrow{PA}=t\overrightarrow{PB}$，则 $t$ 的值为 ______。` },
  { n: 6, d: 5.5, a: '0.577350', tags: ['Algebra', 'trigonometry'],
    s: String.raw`已知 $a,b$ 为实数，函数 $f(x)=a\sin 4x-\dfrac{1}{2}\sin^2 2x+b$，$g(x)=f\left(x-\dfrac{\pi}{3}\right)$。若 $g(x)$ 为奇函数，则 $\dfrac{a}{b}$ 的值为 ______。` },
  { n: 7, d: 6.0, a: '4', tags: ['Geometry', 'coordinate-method'],
    s: String.raw`在平面直角坐标系 $xOy$ 中，已知点 $O(0,0),A(-1,1),B(0,3),C(2,4),D(3,3)$ 都在椭圆 $\Gamma$ 上，则 $\Gamma$ 的焦距为 ______。` },
  { n: 8, d: 5.0, a: '0.36', tags: ['Algebra', 'inequality'],
    s: String.raw`设实数 $a,b,c,d\in[1,3]$，则 $\dfrac{(ab+cd)^2}{(a^2+c^2)(b^2+d^2)}$ 的最小值为 ______。` },
  { n: 9, d: 4.5, a: '579', tags: ['NumberTheory', 'modular-arithmetic', 'counting'],
    s: String.raw`已知整数 $u,v$ 满足 $7u+18v=1$，且 $|v|\le 2026$，这样的数对 $(u,v)$ 共有 ______ 个。` },
  { n: 10, d: 5.5, a: '1056', tags: ['Combinatorics', 'counting'],
    s: String.raw`已知集合 $T\subseteq\{1,2,\cdots,2026\}$，若 $T$ 中任意两个数之差不等 $96$，则 $T$ 中元素个数的最大值为 ______。` },
  { n: 11, d: 6.5, a: '2', tags: ['Algebra', 'equation'],
    s: String.raw`设函数 $f(x)$ 的定义域为 $\mathbb{R}$，且 $\forall x,y\in\mathbb{R}$，均有 $f(x+y)=f(x)f(y)-xy$。这样的函数 $f(x)$ 共有 ______ 个。` },
  { n: 12, d: 7.5, a: '4951', tags: ['Algebra', 'sequence', 'floor-function'],
    s: String.raw`设 $a_1,a_2,\cdots,a_{100}\in\mathbb{R}$。若 $\{[a_1],[a_2],\cdots,[a_{100}]\}=\{1,2,\cdots,100\}$，则 $\sum_{i=1}^{99}[a_{i+1}-a_i]$ 的最大值与最小值之差为 ______。` },
  { n: 13, d: 6.5, a: '', fs: true, tags: ['Geometry', 'coordinate-method'],
    s: String.raw`在平面直角坐标系 $xOy$ 中，已知抛物线 $\Gamma:y=\dfrac{1}{2}x^2$。过点 $P(1,1)$ 的直线与 $\Gamma$ 交于 $A,B$ 两点，$\Gamma$ 在 $A,B$ 处的切线交于点 $Q$。(1) 求线段 $PQ$ 长度的最小值；(2) 若直线 $PQ$ 与 $\Gamma$ 交于 $C,D$ 两点，$M,N$ 分别为线段 $AB,CD$ 的中点。求证：直线 $MN$ 经过定点。` },
  { n: 14, d: 7.5, a: '', fs: true, tags: ['Geometry', 'angle-chasing', 'circle'],
    s: String.raw`设点 $D,E,F$ 分别为 $\triangle ABC$ 内切圆与三边的切点，作 $DG\perp EF$ 于点 $G$。直线 $AG$ 交 $BC$ 于点 $M$，直线 $BG$ 交 $AC$ 于点 $N$。(1) 求证：$A,B,M,N$ 四点共圆。(2) 设 $P$ 为线段 $AN$ 中垂线与 $BM$ 中垂线的交点，$Q$ 为 $CM$ 中垂线与 $AB$ 边上的高 $CH$ 的交点。求证：$PQ\perp MN$。` },
  { n: 15, d: 7.0, a: '', fs: true, tags: ['NumberTheory', 'optimization'],
    s: String.raw`已知向量 $\overrightarrow{OP}=(182,143),\overrightarrow{OQ}=(262,206)$。记集合 $T=\{\overrightarrow{d}\mid \overrightarrow{d}=x\overrightarrow{OP}+y\overrightarrow{OQ},\,x,y\in\mathbb{Z}\}$。求集合 $T$ 中非零向量的模的最小值及所对应的向量。` },
  { n: 16, d: 8.0, a: '', fs: true, tags: ['NumberTheory', 'modular-arithmetic'],
    s: String.raw`设整数 $n\ge 2$ 满足：对任意与 $n$ 互质的整数 $a$，有 $a^{n-1}\equiv a\ (\mathrm{mod}\ n)$。(1) 若 $p$ 是 $n$ 的奇质因子，求证：$p^2\nmid n$；(2) 设 $n$ 的奇质因子仅有两个，求所有满足条件的 $n$。` },
  { n: 17, d: 8.0, a: '', fs: true, tags: ['Combinatorics', 'counting', 'optimization'],
    s: String.raw`有一个 $4\times 2026$ 的矩形 $\Gamma$，它被分割成 $4\times 2026$ 个单位正方形。若两个不同的单位正方形有一条公共边，就称它们为相邻的。现将矩形 $\Gamma$ 中 $m$ 个单位方格染成蓝色，使 $\Gamma$ 中任意一个单位正方形都至少与一个蓝色的单位正方形相邻，试求 $m$ 的最小值。` },
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
