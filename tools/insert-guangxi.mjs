// tools/insert-guangxi.mjs —— 2026 广西预赛（有官方答案）
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

const P = 'CHSMLHGX';      // 省份前缀：CHSMLH + GX
const PROV = '广西';

const problems = [
  {
    n: 1, diff: 4.5, ans: '3/2+i',
    tags: ['Algebra', 'symmetric', 'equation'],
    statement: String.raw`一个九宫格，每个小方格内都填一个复数，它的每行、每列及对角线三个格内的复数和都相等。已知左上角一格填 $x$，第二行第三格填 $2i$，第三行第二格填 $3$，其余各格空格，则 $x$ 表示的复数是 ______。`,
  },
  {
    n: 2, diff: 4.5, ans: '(-2,2)',
    tags: ['Algebra', 'absolute-value', 'inequality'],
    statement: String.raw`集合 $A=\left\{x\ \middle|\ \dfrac{x-1}{x+1}<0\right\}$，$B=\left\{x\ \middle|\ |x-b|<a\right\}$。若 “$a=1$” 是 “$A\cap B\ne\varnothing$” 的充分条件，则 $b$ 的取值范围是 ______。`,
  },
  {
    n: 3, diff: 6.0, ans: '0.2',
    tags: ['Algebra', 'series', 'sequence', 'inequality'],
    statement: String.raw`设 $S_n$ 为数列 $\{a_n\}$ 的前 $n$ 项之和，若不等式 $a_n^2+\dfrac{S_n^2}{n^2}\ge\lambda\cdot a_1^2$ 对任何等差数列 $\{a_n\}$ 及任何正整数 $n$ 恒成立，则 $\lambda$ 的最大值为 ______。`,
  },
  {
    n: 4, diff: 7.0, ans: '3.863703',
    tags: ['Geometry', 'optimization', 'triangle', 'coordinate-method'],
    statement: String.raw`若函数 $f(x,y)=\sqrt{x^2+y^2-2\sqrt{2}y+2}+\sqrt{x^2+y^2+2\sqrt{2}x+2}+\sqrt{x^2+y^2-2\sqrt{2}x+2}$，则 $f(x,y)$ 的最小值是 ______。`,
  },
  {
    n: 5, diff: 5.5, ans: '(-∞,1/2]',
    tags: ['Algebra', 'inequality', 'exponential', 'optimization'],
    statement: String.raw`设函数 $f(x)=e^x-1-x-ax^2$，当 $x>0$ 时单调递增，则 $a$ 的取值范围是 ______。`,
  },
  {
    n: 6, diff: 6.0, ans: '6',
    tags: ['Geometry', 'circle', 'optimization', 'coordinate-method'],
    statement: String.raw`已知 $P$ 为直线 $y=x+1$ 上一点，$M,N$ 分别为圆 $C_1:(x-4)^2+(y-1)^2=4$ 与圆 $C_2:x^2+(y-2)^2=1$ 上的点，则 $|PM|-|PN|$ 的最大值为 ______。`,
  },
  {
    n: 7, diff: 5.5, ans: '4.898979',
    tags: ['Geometry', 'solid-geometry', 'angles', 'trigonometry'],
    statement: String.raw`在长方体 $ABCD-A_1B_1C_1D_1$ 中，$AB:BC:CC_1=1:1:2$。若二面角 $A-BD_1-A_1$ 的度数为 $\alpha$，则 $\tan\alpha=$ ______。`,
  },
  {
    n: 8, diff: 7.0, ans: '196',
    tags: ['NumberTheory', 'divisibility', 'counting', 'prime'],
    statement: String.raw`使得 $1\le a\le b\le 100$，且 $69\mid ab$ 的正整数对 $(a,b)$ 的个数是 ______。`,
  },
  {
    n: 9, diff: 7.0, ans: '', fs: true,
    tags: ['Combinatorics', 'probability', 'counting'],
    statement: String.raw`一个袋子中装有 $m$ 个红球和 $n$ 个白球（$m>n\ge4$），它们除了颜色不同外，其余都相同。现从中任取两个球。（1）若取出两个红球的概率等于取出一红一白两个球的概率的整数倍，求证：$m$ 必为奇数；（2）若取出两个球颜色相同的概率等于取出两个球颜色不同的概率，求满足 $m+n\le40$ 的所有数组 $(m,n)$。`,
  },
  {
    n: 10, diff: 7.5, ans: '', fs: true,
    tags: ['Geometry', 'coordinate-method', 'length', 'ratios'],
    statement: String.raw`设 $CD$ 是椭圆 $\dfrac{x^2}{a^2}+\dfrac{y^2}{b^2}=1$ 的一条过中心的弦，过椭圆的左顶点 $A$ 作 $CD$ 的平行线，交椭圆于另一点 $N$，交 $y$ 轴于点 $M$。求证：$AM\cdot AN=CO\cdot CD$。`,
  },
  {
    n: 11, diff: 7.5, ans: '', fs: true,
    tags: ['Algebra', 'sequence', 'series', 'inequality'],
    statement: String.raw`已知数列 $\{a_n\}$ 的前 $n$ 项之和为 $S_n$，且点 $(a_n,S_n)$ 位于直线 $y=2x-2$ 上。（1）求数列 $\{a_n\}$ 的通项公式 $a_n$；（2）设 $b_n=\dfrac{1}{a_n}-\dfrac{1}{n(n-1)}$，$T_n$ 是数列 $\{b_n\}$ 的前 $n$ 项之和，求正整数 $k$，使得对任意 $n\in\mathbb{N}_+$ 均有 $T_k\ge T_n$；（3）设 $c_n=\dfrac{a_{n+1}}{(1+a_n)(1+a_{n+1})}$，$R_n$ 是数列 $\{c_n\}$ 的前 $n$ 项之和，若对任意 $n\in\mathbb{N}_+$ 均有 $R_n<\lambda$ 成立，求 $\lambda$ 的最小值。`,
  },
  {
    n: 12, diff: 8.5, ans: '', fs: true,
    tags: ['Algebra', 'logarithms', 'roots', 'inequality'],
    statement: String.raw`已知函数 $f(x)=x\ln x-\dfrac{1}{2}mx^2-x$，$m\in\mathbb{R}$。（1）当 $m=-2$ 时，求函数 $f(x)$ 的所有零点；（2）设 $x_1,x_2$ 是函数 $f(x)$ 的两个极值点，求证：$x_1x_2>e^2$。`,
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

const total = await col.countDocuments({ id: /^CHSMLHGX/ });
console.log(`\n库中 CHSMLHGX* 总数: ${total}`);

await client.close();
