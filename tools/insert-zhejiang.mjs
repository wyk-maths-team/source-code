// tools/insert-zhejiang.mjs —— 2026 全国高中数学联赛浙江预赛（有官方参考解答）
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

const P = 'CHSMLHZJ';       // 省份前缀（浙江）
const PROV = '浙江';

const problems = [
  {
    n: 1, diff: 2.5, ans: '2027',
    tags: ['Algebra', 'fractions', 'floor-function'],
    statement: String.raw`设 $\alpha,\beta\in\mathbb{R}$，若 $\{\alpha\}=\{\beta\}$（$\{x\}$ 表示 $x$ 的小数部分），则称 $\alpha$ 与 $\beta$ 同类。设集合 $A=\left\{\dfrac{n}{2027}\ \middle|\ n\in\mathbb{N}^{*}\right\}$，则集合 $A$ 中所有元素可以分为 ______ 类。`,
  },
  {
    n: 2, diff: 5.5, ans: '1',
    tags: ['Algebra', 'sequence', 'floor-function'],
    statement: String.raw`已知数列 $\{a_n\}$ 满足：$a_1=\sqrt{2}$，$a_{n+1}=\sqrt{a_n+2}$，$n=1,2,\cdots$，则 $\left[\displaystyle\sum_{k=1}^{2026}\dfrac{a_k}{2^k}\right]=$ ______（$[x]$ 表示不超过 $x$ 的最大整数）。`,
  },
  {
    n: 3, diff: 4.5, ans: '3',
    tags: ['Algebra', 'quadratic', 'roots'],
    statement: String.raw`设关于 $x$ 的一元二次方程 $x^2+z_1x-z_2+a=0\ (z_1,z_2,a\in\mathbb{C})$ 的两个根为 $\alpha,\beta$，且 $|\alpha-\beta|=2\sqrt{2}$，$z_1^2+4z_2=2+2\sqrt{3}\,\mathrm{i}$。则 $|a|$ 的最大值为 ______。`,
  },
  {
    n: 4, diff: 6.5, ans: '1.520691',
    tags: ['Geometry', 'vectors', 'optimization'],
    statement: String.raw`设 $\vec{a},\vec{b}$ 为平面上的单位向量，且 $\langle\vec{a},\vec{b}\rangle=60^\circ$。若 $0\le t\le 1$，则 $\left|(1-t)\vec{a}+t\vec{b}\right|+\left|(1-t)\vec{a}+\left(t-\dfrac{1}{4}\right)\vec{b}\right|$ 的最小值为 ______。`,
  },
  {
    n: 5, diff: 7.0, ans: '3.535534',
    tags: ['Geometry', 'solid-geometry', 'vectors'],
    statement: String.raw`现有棱长为 $1$ 的正四面体 $O-ABC$，$O$ 为空间直角坐标系原点。设 $P$ 为空间一点，实数 $x,y,z$ 满足 $\overrightarrow{OP}=x\overrightarrow{OA}+y\overrightarrow{OB}+z\overrightarrow{OC}\ (0\le x\le 1,\ 0\le y\le 2,\ 0\le z\le 3)$。则当 $x+\dfrac{1}{2}y+\dfrac{1}{3}z\ge 1$ 时，$P$ 点形成的轨迹的体积为 ______。`,
  },
  {
    n: 6, diff: 7.5, ans: '675',
    tags: ['Algebra', 'sequence', 'inequality'],
    statement: String.raw`设函数 $f:\mathbb{N}^{*}\to\mathbb{N}$，满足：对任意正整数 $m,n$ 都有 $f(n+m)-f(n)-f(m)=0$ 或 $1$，且 $f(2)=0$，$f(3)>0$，$f(9999)=3333$。则 $f(2026)=$ ______。`,
  },
  {
    n: 7, diff: 7.0, ans: '672',
    tags: ['Combinatorics', 'counting'],
    statement: String.raw`如图，由 $16$ 个单位正方形组成网格。现从 $A$ 点沿网格线移动到 $B$ 点，要求：① 只允许向右、向上、向下移动；② 路径长度为 $12$ 个单位；③ 路径上无重复的点。则这样的路径数目为 ______。`,
  },
  {
    n: 8, diff: 7.5, ans: '18',
    tags: ['Algebra', 'inequality', 'absolute-value'],
    statement: String.raw`已知 $a_1,a_2,\cdots,a_{10}$ 满足：$a_1+a_2+\cdots+a_{10}=10$，$|a_i-a_{i-1}|\le 1\ (i=2,3,\cdots,10)$。则 $\max\limits_{1\le i\le j\le 10}\left|a_i+a_{i+1}+\cdots+a_j\right|$ 的最大值为 ______。`,
  },
  {
    n: 9, diff: 7.0, ans: '', fs: true,
    tags: ['Geometry', 'coordinate-method', 'circle'],
    statement: String.raw`已知椭圆 $C:\dfrac{x^2}{25}+\dfrac{y^2}{16}=1$，直线 $l:x=my-3\ (m\ne 0)$。若直线 $l$ 与椭圆 $C$ 分别相交于 $A,B$ 两点，$l$ 与 $x$ 轴相交于 $P$ 点。分别以 $PA,PB$ 为直径作圆 $\odot O_1,\odot O_2$。设 $\odot O_1$ 与 $\odot O_2$ 两条外公切线交于点 $Q$，求 $Q$ 点的轨迹方程。`,
  },
  {
    n: 10, diff: 7.5, ans: '', fs: true,
    tags: ['Algebra', 'trigonometry', 'inequality'],
    statement: String.raw`已知 $\triangle ABC$ 为锐角三角形，求 $\dfrac{\sin 2A}{3+2\cos 2A}+\dfrac{\sin 2B}{3+2\cos 2B}+\dfrac{\sin 2C}{3+2\cos 2C}$ 的最大值。`,
  },
  {
    n: 11, diff: 8.5, ans: '', fs: true,
    tags: ['Combinatorics', 'counting', 'prime'],
    statement: String.raw`设 $p$ 为素数，将 $n\times n$ 表格用 $p$ 种颜色染色。

(1) 若 $n=p^2+p$，证明无论如何染色必有两行两列交叉处的 $4$ 格同色；

(2) 若 $n=p^2$，证明存在一种染色使得不存在两行两列交叉处 $4$ 格同色。`,
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
  // 用 upsert 保证幂等（并发/重复执行都不产生重复文档）
  for (const d of toInsert) {
    await col.updateOne({ id: d.id }, { $setOnInsert: d }, { upsert: true });
  }
  console.log(`✅ 已写入 ${toInsert.length} 题`);
  for (const d of toInsert) console.log(`   ${d.id}  diff=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}`);
}

const total = await col.countDocuments({ id: /^CHSMLHZJ/ });
console.log(`\n库中 CHSMLHZJ* 总数: ${total}`);

await client.close();
