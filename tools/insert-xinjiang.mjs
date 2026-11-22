// tools/insert-xinjiang.mjs —— 2026 新疆预赛（无官方答案，答案自算，全部标 bug）
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

const PROV = '新疆';
const P = 'CHSMLHXJ';

const items = [
  { n: 1, d: 5.5, a: '4009', tags: ['Combinatorics', 'counting', 'sum'],
    s: String.raw`设集合 $A=\{1,2,3,\cdots,2026\}$，$B=\{a^2+3a\mid a\in A\}$，则 $A\cup B$ 的元素个数为 ______。` },

  { n: 2, d: 6.0, a: '-1.333333', tags: ['Algebra', 'roots', 'absolute-value'],
    s: String.raw`设复数 $z$ 满足 $|z|=1$，且使得关于 $x$ 的方程 $3x^2+3\bar{z}x+z=0$ 有实根。则这样的 $z$ 的和为 ______。` },

  { n: 3, d: 4.5, a: '0.75', tags: ['Algebra', 'trigonometry', 'simplification'],
    s: String.raw`$\sin^2 20^\circ+\cos^2 50^\circ+2\sin 20^\circ\sin 30^\circ\sin 40^\circ=$ ______。` },

  { n: 4, d: 5.5, a: 'y^2=x', tags: ['Geometry', 'coordinate-method', 'circle'],
    s: String.raw`已知 $O$ 为坐标原点，曲线 $C_1:x^2-y^2=2$ 与曲线 $C_2:y^2=2px$ 交于点 $M,N$。若 $\triangle OMN$ 的外接圆经过点 $P(3,0)$，则曲线 $C_2$ 的方程为 ______。` },

  { n: 5, d: 6.0, a: '3.674235', tags: ['Geometry', 'vectors', 'optimization'],
    s: String.raw`已知 $\vec{m},\vec{n}$ 为非零向量，且 $|\vec{m}|=|\vec{m}+\vec{n}|=1$，则 $|3\vec{m}+\vec{n}|+|\vec{n}|$ 的最大值为 ______。` },

  { n: 6, d: 7.0, a: '10', tags: ['Geometry', 'solid-geometry', 'ratios'],
    s: String.raw`已知四面体 $P-ABC$，点 $A_1$ 在 $\triangle PBC$ 内，满足 $\triangle A_1PB,\triangle A_1PC,\triangle A_1BC$ 的面积之比为 $5:3:2$。点 $G$ 在线段 $AA_1$ 上，直线 $PG$ 交平面 $ABC$ 于点 $M$，且 $\dfrac{AG}{GA_1}=\dfrac{PG}{GM}$，则四面体 $P-ABC$ 与 $A_1-ABM$ 的体积之比为 ______。` },

  { n: 7, d: 6.5, a: String.raw`1-\dfrac{1}{(n+1)2^n}`, tags: ['Algebra', 'sequence', 'fractions'],
    s: String.raw`已知正项数列 $\{a_n\}$ 满足 $a_1=2$，$a_{n+1}^2=2a_n^2+a_na_{n+1}$。令 $b_n=\dfrac{n+2}{n(n+1)a_n}$，数列 $\{b_n\}$ 的前 $n$ 项和为 $S_n$，则 $S_n=$ ______。` },

  { n: 8, d: 5.0, a: '55', tags: ['Combinatorics', 'counting'],
    s: String.raw`在方程 $x_1+x_2+x_3=30$ 的非负整数解 $(x_1,x_2,x_3)$ 中，满足 $x_1\le 12,x_2\le 13,x_3\le 14$ 的解的个数为 ______。` },

  { n: 9, d: 6.5, a: '', fs: true, tags: ['Algebra', 'polynomial', 'sequence'],
    s: String.raw`（本题满分 $16$ 分）已知函数 $f(x)=x^2+ax+b\ (a,b\in\mathbb{R})$ 有两个不同的零点。
(1) 若函数 $g(x)=(x-1)f(x)$ 是奇函数，求 $\dfrac{f(1)f(3)\cdots f(199)}{f(2)f(4)\cdots f(200)}$ 的值。
(2) 若方程 $f(x^2+4x+1)=0$ 有四个不同的实根 $x_1<x_2<x_3<x_4$，且 $x_1,x_2,x_3,x_4$ 成等差数列，求 $a-b$ 的最大值。` },

  { n: 10, d: 7.5, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'area', 'optimization'],
    s: String.raw`（本题满分 $20$ 分）已知 $O$ 为坐标原点，$F_1(-1,0),F_2(1,0)$，$A$ 为线段 $F_1F_2$ 上一点。点 $P$ 满足 $PA$ 平分 $\angle F_1PF_2$，$|PF_2|=\sqrt{2}|AF_2|$。设动点 $P$ 的轨迹为曲线 $E$。
(1) 求曲线 $E$ 的方程；
(2) 设直线 $PA$ 与曲线 $E$ 的另一个交点为 $Q$，求 $\triangle OPQ$ 面积的最大值。` },

  { n: 11, d: 7.0, a: '', fs: true, tags: ['Algebra', 'inequality', 'optimization'],
    s: String.raw`（本题满分 $20$ 分）(1) 已知 $a_i\ge 0,i=1,2,3$，求证：$a_1a_2+a_2a_3+a_3a_1\le \dfrac{1}{3}(a_1+a_2+a_3)^2$。
(2) 已知 $n\ge 2,n\in\mathbb{N}_+$，且 $\sum\limits_{i=1}^{n}a_i=2n$，$a_i\ge 0,i=1,2,\cdots,n$。求 $\sum\limits_{i=1}^{n-1}(a_i-1)(a_{i+1}-1)$ 的最小值和最大值。` },
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
