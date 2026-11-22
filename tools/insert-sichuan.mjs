// tools/insert-sichuan.mjs —— 2026 四川预赛（有官方答案）
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

const P = 'CHSMLHSC';       // 省份前缀
const PROV = '四川';

const problems = [
  {
    n: 1, diff: 4.5, ans: '0',
    tags: ['Algebra', 'symmetric', 'equation'],
    statement: String.raw`已知非零实数 $x,y,z$ 满足 $x+y+z=2026$，$\dfrac{1}{x}+\dfrac{1}{y}+\dfrac{1}{z}=\dfrac{1}{2026}$，则 $(x-2026)(y-2026)(z-2026)$ 的值为 ______。`,
  },
  {
    n: 2, diff: 6.0, ans: '-1',
    tags: ['Algebra', 'symmetric', 'sum'],
    statement: String.raw`设 $a,b\in\mathbb{R}$，若函数 $f(x)=\sum_{k=0}^{1012}\dfrac{x+2k}{x+2(k+1)}$ 的对称中心是 $(a,b)$，则 $a+b=$ ______。`,
  },
  {
    n: 3, diff: 5.5, ans: '29',
    tags: ['Algebra', 'polynomial', 'roots'],
    statement: String.raw`设 $a,b,c$ 为整数，若方程 $x^2-2x-1=0$ 的根都是方程 $x^4+ax^2+bx+c=0$ 的根，则 $a^2+b^2+c^2$ 的最小值为 ______。`,
  },
  {
    n: 4, diff: 5.5, ans: '0.449490',
    tags: ['Geometry', 'coordinate-method', 'area', 'optimization'],
    statement: String.raw`设 $O$ 为原点，$A$ 为抛物线 $y=x^2+1$ 上的动点，$B$ 为椭圆 $(x-2)^2+\dfrac{y^2}{4}=1$ 上的动点，则 $\triangle OAB$ 的面积的最小值为 ______。`,
  },
  {
    n: 5, diff: 5.0, ans: '0.5',
    tags: ['Algebra', 'roots', 'optimization'],
    statement: String.raw`已知复数 $z$ 满足 $|z+1|=2$，则 $|z^2-z+1|$ 的最小值为 ______。`,
  },
  {
    n: 6, diff: 6.5, ans: '6',
    tags: ['Geometry', 'solid-geometry', 'counting'],
    statement: String.raw`将三棱锥 $P-ABC$ 各棱所在的 $6$ 条直线，每两条组成一对，设这些直线对中有 $n$ 对互相垂直，则正整数 $n$ 的最大值为 ______。`,
  },
  {
    n: 7, diff: 7.0, ans: '8',
    tags: ['Combinatorics', 'probability'],
    statement: String.raw`设多边形 $A_1A_2\cdots A_8$ 为一个正八边形，有 $2$ 只兔子最初分别位于顶点 $A_4$ 和 $A_8$ 处。每过 $1$ 分钟，$2$ 只兔子同时随机、独立地跳到与其当前位置相邻的两个顶点中的一个。一旦 $2$ 只兔子跳到了同一个顶点，则停止跳跃。则当兔子停止跳跃时，跳跃时间的分钟数的期望是 ______。`,
  },
  {
    n: 8, diff: 7.5, ans: '756',
    tags: ['Combinatorics', 'counting', 'digits'],
    statement: String.raw`设 $L$ 为长为 $45$ 的数码链：$1121231234\cdots123456789$。现在这 $45$ 个数码中添加 $2$ 个逗号，将 $L$ 分割三段 $L_1,L_2,L_3$（顺序不变），则使得 $L_1$ 与 $L_2$、$L_2$ 与 $L_3$、$L_3$ 与 $L_1$ 均有相同数码的分割方式 $(L_1,L_2,L_3)$ 的总数为 ______。`,
  },
  {
    n: 9, diff: 6.5, ans: '', fs: true,
    tags: ['Geometry', 'coordinate-method', 'optimization'],
    statement: String.raw`过直线 $y=-1$ 上一动点 $P$ 向抛物线 $x^2=4y$ 作两条切线，切点分别为 $M,N$。求 $\triangle PMN$ 的外心的轨迹方程。`,
  },
  {
    n: 10, diff: 7.5, ans: '', fs: true,
    tags: ['Algebra', 'inequality', 'vectors'],
    statement: String.raw`给定整数 $n\ge 2$。设 $\overrightarrow{e_1},\overrightarrow{e_2},\cdots,\overrightarrow{e_n}$ 是平面单位向量，满足：对 $\forall 1\le i<j\le n$，均有 $\overrightarrow{e_i}\cdot\overrightarrow{e_j}\ge 0$。求 $\left|\sum_{i=1}^{n}\overrightarrow{e_i}\right|$ 的最小值。`,
  },
  {
    n: 11, diff: 8.0, ans: '', fs: true,
    tags: ['NumberTheory', 'modular-arithmetic', 'sequence'],
    statement: String.raw`设 $S_n$ 为数列 $\{a_n\}$ 的前 $n$ 项和，满足：$a_1=1,a_2=6,a_3=31,S_{n+3}=7S_{n+2}-11S_{n+1}+5S_n\ (n\in\mathbb{N}^*)$。求所有的整数 $m\ge 2$，使得 $a_1,a_2,\cdots,a_m$ 构成模 $m$ 的完全剩余系。`,
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
  console.log(`✅ 已插入 ${res.insertedCount} 题，ID: ${Object.values(res.insertedIds).length} 个`);
  for (const d of toInsert) console.log(`   ${d.id}  diff=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}`);
}

const total = await col.countDocuments({ id: /^CHSMLHSC/ });
console.log(`\n库中 CHSMLHSC* 总数: ${total}`);

await client.close();
