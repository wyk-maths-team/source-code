// tools/insert-shandong.mjs —— 2026 山东预赛（有官方答案）
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

const P = 'CHSMLHSD';       // 省份前缀
const PROV = '山东';

const problems = [
  {
    n: 1, diff: 1.80, ans: '6',
    tags: ['Geometry', 'area'],
    statement: String.raw`对平面直角坐标系中的点 $(x,y)$，有映射 $f:(x,y)\mapsto(x-20,y+26)$。已知 $S_{\triangle ABC}=6$，$f(A)=D,f(B)=E,f(C)=F$，则 $S_{\triangle DEF}=$ ______。`,
  },
  {
    n: 2, diff: 3.20, ans: '0.571429',
    tags: ['Geometry', 'triangle', 'ratios'],
    statement: String.raw`若三角形三边长为 $5,2,4$，则以三角形长为 $4$ 的边的两端点为焦点且过另一顶点的椭圆的离心率为 ______。`,
  },
  {
    n: 3, diff: 4.20, ans: '[-1/45, 1/45]',
    tags: ['Algebra', 'trigonometry', 'optimization'],
    statement: String.raw`函数 $f(x)=\dfrac{\sin x}{\sqrt{2026+\cos x}}\ (x\in\mathbb{R})$ 的值域为 ______。`,
  },
  {
    n: 4, diff: 4.00, ans: '直角三角形',
    tags: ['Algebra', 'logarithms', 'triangle'],
    statement: String.raw`若三角形边长 $a,b,c$ 均大于 $1$ 且满足 $\log_{a+b}c+\log_{a-b}c=2\log_{a+b}c\cdot\log_{a-b}c$，则该三角形的形状为 ______。`,
  },
  {
    n: 5, diff: 5.00, ans: '2026',
    tags: ['Combinatorics', 'series', 'sum'],
    statement: String.raw`如图所示的数阵中，每一行中除了第一个和最后一个数为 $1$ 外，其他数都等于它“肩上”的两个数之和。则将最外层的 $1$ 全部删去后，前 $9$ 行的数字和为 ______。`,
  },
  {
    n: 6, diff: 6.00, ans: '3',
    tags: ['Algebra', 'exponential', 'symmetric'],
    statement: String.raw`设非空集合 $S,T$ 满足 $S\cap T=\varnothing$，$S\cup T=\mathbb{R}$。当 $x\in S$ 时，$f(x)=x+3$，当 $x\in T$ 时，$f(x)=2^x+2^{-x}$。若函数 $y=f(x)$ 为偶函数，则集合 $S$ 的元素个数的最大可能值为 ______。`,
  },
  {
    n: 7, diff: 7.00, ans: '1,2,3',
    tags: ['Geometry', 'solid-geometry', 'counting'],
    statement: String.raw`空间中的四面体 $ABCD$ 与平面 $\alpha$ 满足：
(1) 点 $A,B,C,D$ 不在平面 $\alpha$ 上也不都在平面 $\alpha$ 同侧；
(2) 若四面体 $ABCD$ 的某条棱与平面 $\alpha$ 有交点，则该点总是这条棱的中点或三等分点。
设集合 $S$ 为点 $A,B,C,D$ 到平面 $\alpha$ 的距离组成的集合，则集合 $S$ 的元素个数的所有可能值为 ______。`,
  },
  {
    n: 8, diff: 7.50, ans: '4',
    tags: ['Geometry', 'area', 'optimization'],
    statement: String.raw`在平面直角坐标系 $xOy$ 中，设 $n$ 为正整数，定义点集 $\Omega=\{(x,y)\mid y\ge e^x\}$。点集 $\Omega_1,\Omega_2,\cdots,\Omega_n$ 都由 $\Omega$ 经过任意有限次平移或以原点为中心的旋转所得到。若平面上的任意一点都属于 $\Omega_1\cup\Omega_2\cup\cdots\cup\Omega_n$，则 $n$ 的最小值为 ______。`,
  },
  {
    n: 9, diff: 6.50, ans: '', fs: true,
    tags: ['Geometry', 'coordinate-method', 'circle'],
    statement: String.raw`（本题满分 $16$ 分）如图所示，在平面直角坐标系 $xOy$ 中，设双曲线 $\Gamma:x^2-y^2=a^2\ (a\ne 0)$，两条不同直线 $l_1,l_2$ 分别与 $\Gamma$ 的左、右两支交于点 $A_1,B_1$ 与 $A_2,B_2$。点 $C_1,C_2$ 分别为线段 $A_1B_1,A_2B_2$ 的中点，分别过点 $C_1,C_2$ 作 $l_2,l_1$ 的平行线并相交于点 $D$。求证：
(1) 直线 $l_1,l_2,OC_1,OC_2$ 的斜率之积为定值；
(2) 点 $O,C_2,D,C_1$ 四点共圆。`,
  },
  {
    n: 10, diff: 6.50, ans: '', fs: true,
    tags: ['Algebra', 'probability', 'sequence'],
    statement: String.raw`（本题满分 $20$ 分）已知 $z_0=1$，投掷若干次硬币并根据投掷结果来定义复数数列 $\{z_n\}$，当第 $k\ (k=1,2,\cdots)$ 次投掷硬币时：若正面朝上，则 $z_k=\overline{z_{k-1}}$，若反面朝上，则 $z_k=\left(-\dfrac{1}{2}+\dfrac{\sqrt{3}}{2}i\right)z_{k-1}$。
(1) 求 $z_2=1$ 的概率；
(2) 对整数 $n\ge 3$，求 $z_n=1$ 的概率。`,
  },
  {
    n: 11, diff: 7.00, ans: '', fs: true,
    tags: ['Geometry', 'solid-geometry', 'area'],
    statement: String.raw`（本题满分 $20$ 分）如图所示，小东用 $8$ 块全等的三角形薄片，仅通过拼接（即若干个薄片共同组成几何体的一个面，或两个薄片沿公共边拼接并分别属于几何体共用一条棱的两个面）得到一个三棱柱 $ABC-A_1B_1C_1$。设三角形薄片的三边长为 $BC=a,CA=b,AB=c$，面积为 $S=1$。
(1) 求证：薄片的形状一定是等腰三角形；
(2) 求该三棱柱 $ABC-A_1B_1C_1$ 的体积。`,
  },
  {
    n: 12, diff: 8.00, ans: '', fs: true,
    tags: ['Algebra', 'sequence', 'sum'],
    statement: String.raw`（本题满分 $40$ 分）已知有无穷项的实数列 $\{a_n\}\ (n=0,1,2,\cdots)$ 满足对任意的非负整数 $i$，都有 $a_{i+2026}=a_i$。数列 $\{b_n\}\ (n=0,1,2,\cdots)$ 满足 $b_n=\dfrac{1}{2026}\sum\limits_{j=0}^{2025}a_j a_{j+n}$。
(1) 求证：存在正整数 $N$，使得对任意非负整数 $k$，都有 $b_{k+N}=b_k$；
(2) 求所有的非负整数 $N$，使得对任意满足题目条件的无穷项数列 $\{a_n\}$，都有 $b_N$ 是数列 $\{b_n\}$ 中的最大项。`,
  },
  {
    n: 13, diff: 7.80, ans: '', fs: true,
    tags: ['NumberTheory', 'divisibility', 'inequality'],
    statement: String.raw`（本题满分 $40$ 分）设整数 $m\ge 2$，记 $A=\dfrac{\varphi(m)}{m}$，其中欧拉函数 $\varphi(m)$ 是指不超过 $m$ 的正整数中与 $m$ 互素的数的个数。对正整数 $n$，用 $f_m(n)$ 表示 $\{1,2,\cdots,n\}$ 中与 $m$ 互素的正整数的个数。求证：对任意正整数 $n$，都有 $\left|f_m(n)-An\right|<\sqrt{m}$。`,
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
  tags: [...new Set([...p.tags, 'CHSML'])],
  logic: '',
}));

// —— 插入前自检：标签白名单 / 主标签 / 行内 LaTeX / 难度范围 ——
const MAIN = ['Algebra', 'Geometry', 'NumberTheory', 'Combinatorics'];
const AUX = new Set('triangle counting optimization digits equation area surds trigonometry circle polynomial modular-arithmetic diophantine series logarithms coordinate-method quadratic exponential divisibility roots angles sequence inequality fractions square prime sum symmetric area-method solid-geometry simplification ratios probability floor-function length absolute-value vectors'.split(' '));
const errs = [];
for (const d of docs) {
  if (!d.statement.includes('$')) errs.push(`${d.id}: statement 缺少行内 LaTeX`);
  if (d.statement.includes('$$')) errs.push(`${d.id}: statement 含 $$ 块公式`);
  if (d.tags.filter(t => MAIN.includes(t)).length !== 1) errs.push(`${d.id}: 主标签个数 != 1 (${d.tags})`);
  for (const t of d.tags.filter(t => !MAIN.includes(t) && t !== 'CHSML')) {
    if (!AUX.has(t)) errs.push(`${d.id}: 非白名单辅标签 "${t}"`);
  }
  if (d.tags.filter(t => !MAIN.includes(t) && t !== 'CHSML' && AUX.has(t)).length < 1) errs.push(`${d.id}: 缺少辅标签`);
  if (!d.tags.includes('CHSML')) errs.push(`${d.id}: 缺少 CHSML 标签`);
  if (typeof d.difficulty !== 'number' || d.difficulty < 1 || d.difficulty > 10) errs.push(`${d.id}: difficulty 非法`);
  if (!d.FS && d.ans === '') errs.push(`${d.id}: 填空题 ans 为空`);
  if (d.FS && d.ans !== '') errs.push(`${d.id}: 解答题 ans 非空`);
}
if (errs.length) {
  console.error('❌ 自检失败:\n' + errs.join('\n'));
  process.exit(1);
}
console.log(`✅ 自检通过：${docs.length} 题（填空 ${docs.filter(d => !d.FS).length}，解答 ${docs.filter(d => d.FS).length}）`);

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
  for (const d of toInsert) console.log(`   ${d.id}  diff=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}  tags=${d.tags.join('/')}`);
}

const total = await col.countDocuments({ id: /^CHSMLHSD/ });
console.log(`\n库中 CHSMLHSD* 总数: ${total}`);

await client.close();
