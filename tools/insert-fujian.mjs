// tools/insert-fujian.mjs —— 2026 全国高中数学联赛（福建预赛）
// 题面：private/paper/2026福建.pdf（3 页）
// 答案：private/paper/2026年福建预赛参考答案.pdf（填空答案见第 1–5 页）
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

const P = 'CHSMLHFJ';       // 福建前缀
const PROV = '福建';

const problems = [
  {
    n: 1, diff: 4.3, ans: '(-1/3, √3)',
    tags: ['Geometry', 'coordinate-method', 'circle', 'angles'],
    statement: String.raw`已知六边形 $ABCDEF$ 为圆 $O$ 的内接正六边形（$O$ 为坐标原点，$A,B,C,D,E,F$ 依逆时针排列），$G$ 为 $\triangle ABC$ 的重心。若点 $A$ 的坐标为 $(2,\sqrt{3})$，则点 $G$ 的坐标为 ______。`,
  },
  {
    n: 2, diff: 5.3, ans: '[1, (√5+1)/2)',
    tags: ['Geometry', 'triangle', 'ratios'],
    statement: String.raw`在 $\triangle ABC$ 中，内角 $A,B,C$ 所对的边分别为 $a,b,c$。若 $A\le B$，且 $a,b,c$ 成等比数列，则 $\dfrac{b}{a}$ 的取值范围为 ______。`,
  },
  {
    n: 3, diff: 6.3, ans: '2.828427',
    tags: ['Geometry', 'solid-geometry', 'coordinate-method'],
    statement: String.raw`已知三棱柱 $ABC-A_1B_1C_1$ 的所有棱长均为 $2\sqrt{3}$，若 $CB_1=2\sqrt{3}$，$\cos\angle A_1AB=-\dfrac{1}{4}$，则三棱锥 $A_1-ABC$ 的外接球的半径为 ______。`,
  },
  {
    n: 4, diff: 4.6, ans: '0',
    tags: ['Algebra', 'polynomial', 'roots', 'equation'],
    statement: String.raw`已知 $f(x)=x^2+ax+b$（$a,b\in\mathbb{R}$ 且 $ab\ne 0$）。若 $\{x\mid f(x)=0,x\in\mathbb{R}\}\ne\varnothing$，且 $\{x\mid f(x)=0,x\in\mathbb{R}\}\subseteq\{x\mid f(f(f(x)))=0,x\in\mathbb{R}\}$，则 $f(1)=$ ______。`,
  },
  {
    n: 5, diff: 6.6, ans: '169',
    tags: ['Combinatorics', 'counting', 'sequence', 'sum'],
    statement: String.raw`将正整数 $n$ 改写成 $m$ 个从小到大的正整数的和，称为 $n$ 的一种分解。若这 $m$ 个数构成等差数列，则称这 $m$ 个数为正整数 $n$ 的一种“等差分解”方式。那么 $2026$ 的不同“等差分解”方式有 ______ 种。`,
  },
  {
    n: 6, diff: 5.8, ans: '36',
    tags: ['Combinatorics', 'counting', 'equation'],
    statement: String.raw`来自某中学高三年级 $5$ 个班的 $40$ 位同学参加“读书节”活动，在活动中这 $40$ 位同学共捐赠了 $50$ 本书给图书馆。已知同一个班的同学捐赠的书的本数相同，不同班的两个同学捐的书的本数不同，且每个同学都至少捐赠了一本书。则恰好捐赠一本书的同学有 ______ 位。`,
  },
  {
    n: 7, diff: 6.2, ans: '90',
    tags: ['Geometry', 'circle', 'angles', 'optimization'],
    statement: String.raw`在平面直角坐标系 $xOy$ 中，点 $A(2,0)$，$B(4,0)$。$P$ 是圆 $C:x^2+y^2-8y=0$ 上的一个动点，则 $\angle APB$ 的最大值为 ______。`,
  },
  {
    n: 8, diff: 6.4, ans: '0.3359375',
    tags: ['Combinatorics', 'probability', 'counting'],
    statement: String.raw`已知全集 $U=\{1,2,3,4,5\}$，从中任取集合 $U$ 的两个子集 $A,B$（$A,B$ 可以相同）。记事件 $D$ 为“$A$ 中最大元素为 $4$，$B$ 中最大元素为 $5$”，事件 $E$ 为“$A$ 是 $B$ 的子集”。则事件 $D\cup E$ 的概率 $P(D\cup E)=$ ______。（用数字作答）`,
  },
  {
    n: 9, diff: 6.0, ans: '7',
    tags: ['NumberTheory', 'inequality', 'fractions'],
    statement: String.raw`设 $a_1,a_2,\cdots,a_n$ 是 $n$ 个不同的正整数，满足 $\left(1-\dfrac{1}{a_1}\right)\left(1-\dfrac{1}{a_2}\right)\cdots\left(1-\dfrac{1}{a_n}\right)=\dfrac{36}{259}$，则正整数 $n$ 的最小值为 ______。`,
  },
  {
    n: 10, diff: 6.8, ans: '1',
    tags: ['Algebra', 'inequality', 'optimization', 'symmetric'],
    statement: String.raw`若正实数 $x,y,z$ 满足 $x^2y^2+16y^2z^2+4z^2x^2=2xyz$，则 $x+2y+4z$ 的最大值为 ______。`,
  },
  {
    n: 11, diff: 7.0, ans: '', fs: true,
    tags: ['Geometry', 'coordinate-method', 'area', 'optimization'],
    statement: String.raw`已知双曲线 $C:\dfrac{x^2}{a^2}-\dfrac{y^2}{b^2}=1\ (a>0,b>0)$ 的左、右焦点分别为 $F_1,F_2$，离心率为 $\sqrt{5}$。$P$ 为双曲线 $C$ 上一点，且 $PF_1\perp PF_2$，$\triangle PF_1F_2$ 的内切圆半径为 $3-\sqrt{5}$。
(1) 求双曲线 $C$ 的方程；
(2) 设斜率不为零的直线 $l:y=kx+m$ 交双曲线 $C$ 于 $A,B$ 两点，$D$ 为双曲线 $C$ 上一点，且 $\overrightarrow{BD}=4\overrightarrow{OA}$。
(i) 求 $m$ 的取值范围；
(ii) 求四边形 $OADB$ 的面积。`,
  },
  {
    n: 12, diff: 7.8, ans: '', fs: true,
    tags: ['Algebra', 'trigonometry', 'inequality', 'series'],
    statement: String.raw`已知 $f(x)=\sin x+\sin 2x-\lambda x\cos x$。
(1) 若 $0<x<\dfrac{\pi}{2}$ 时，$f(x)\ge 0$ 恒成立，求整数 $\lambda$ 的最大值；
(2) 求证：对任意正整数 $n$，$\sum\limits_{k=1}^{n}\left(\tan\dfrac{\pi}{4k}+2\sin\dfrac{\pi}{4k}\right)<\dfrac{10}{3}$。`,
  },
  {
    n: 13, diff: 7.3, ans: '', fs: true,
    tags: ['Geometry', 'circle', 'angles', 'coordinate-method'],
    statement: String.raw`给定直线 $l$，$A,P$ 是位于直线 $l$ 同侧的两个定点，$B,C$ 是直线 $l$ 上的两个动点，且 $\angle BAC=90^{\circ}$。求证：当点 $B,C$ 在直线 $l$ 上运动时，$\triangle BCP$ 的外接圆经过除 $P$ 外的另一个定点。`,
  },
  {
    n: 14, diff: 8.0, ans: '', fs: true,
    tags: ['NumberTheory', 'counting', 'divisibility'],
    statement: String.raw`将正整数 $1,2,\cdots,n$ 的每一个都染成红色或者蓝色，并且每一种颜色的数至少一个。若红色数中的每一个数都是两个不同的蓝色数的和，蓝色数中的每一个数都是两个红色数的差，求 $n$ 的最小可能值。`,
  },
  {
    n: 15, diff: 8.6, ans: '', fs: true,
    tags: ['NumberTheory', 'sequence', 'divisibility'],
    statement: String.raw`求证：对任意大于 $3$ 的整数 $n$，均存在一个由 $n$ 个正整数组成的数列 $a_1,a_2,\cdots,a_n$，同时满足以下三个条件：
(1) 数列各项之和等于它们的最小公倍数，即 $a_1+a_2+\cdots+a_n=[a_1,a_2,\cdots,a_n]$；
(2) 对于 $i=2,3,\cdots,n-1$，均有 $a_i$ 不整除 $a_{i+1}$；
(3) 相邻两项的最大公约数严格单调递增，即 $(a_1,a_2)<(a_2,a_3)<\cdots<(a_{n-1},a_n)$。`,
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
  tags: p.tags,
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

const total = await col.countDocuments({ id: /^CHSMLHFJ/ });
console.log(`\n库中 CHSMLHFJ* 总数: ${total}`);

await client.close();
