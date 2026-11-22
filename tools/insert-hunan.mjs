// tools/insert-hunan.mjs —— 2026 湖南预赛（无官方答案，全部标 bug）
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

const PROV = '湖南';
const P = 'CHSMLHHN';

const items = [
  { n: 1, d: 4.0, a: '4096或1/4096', fs: true, tags: ['Algebra', 'logarithms', 'absolute-value'],
    s: String.raw`已知实数 $x$ 满足 $|\log_2 x+5i|=13$，其中 $i$ 为虚数单位，则 $x=$ ______。` },
  { n: 2, d: 6.5, a: '789730223053602822', tags: ['Combinatorics', 'counting', 'exponential'],
    s: String.raw`将集合 $\{2^x+0^y+2^z+6^w\mid x,y,z,w\in\mathbb{N}_+,\ x\le y\le z\le w\}$ 中的元素从小到大排列，则第 $2026$ 个数为 ______。` },
  { n: 3, d: 5.5, a: '2.188901', tags: ['Geometry', 'vectors', 'coordinate-method', 'optimization'],
    s: String.raw`在 $\triangle ABC$ 中，$AB=2$，$AC=4$，$\angle A=120^\circ$。动点 $P$ 满足 $(\overrightarrow{PA}+\overrightarrow{PB})\cdot(\overrightarrow{PA}+\overrightarrow{PC})=0$，则 $|PA|$ 的最大值是 ______。` },
  { n: 4, d: 7.0, a: '9.25', tags: ['Algebra', 'polynomial', 'symmetric'],
    s: String.raw`定义在 $\mathbb{R}$ 上的奇函数 $f(x)$ 满足其函数图像关于 $x+2y-5=0$ 对称，且当 $x\in[0,1]$ 时，$f(x)=3x-x^2$。则 $f\left(\dfrac{9}{2}\right)=$ ______。` },
  { n: 5, d: 7.5, a: '9.055385', tags: ['Algebra', 'optimization', 'roots', 'absolute-value'],
    s: String.raw`设复数 $\alpha,\beta,\gamma,z$ 满足 $|z|=3$，$\alpha+\beta+\gamma=\alpha\beta+\beta\gamma+\gamma\alpha=\alpha\beta\gamma=1$。则 $|\alpha-z|+3|\beta-z|$ 的最小值为 ______。` },
  { n: 6, d: 7.0, a: '0.882587', tags: ['Geometry', 'solid-geometry', 'ratios'],
    s: String.raw`在四棱锥 $P-ABCD$ 中，$DA=DC=DP=2$，$DA,DC,DP$ 两两垂直。其内部注入了一些水，液面交 $PA,PB,PC,PD$ 于点 $E,F,G,H$。若将四棱锥翻转后以 $\triangle PAD$ 所在平面为底面重新放置，待液体稳定后，液面离平面 $PAD$ 的高度为 $\dfrac{3}{2}$，则 $PH=$ ______。` },
  { n: 7, d: 7.0, a: '5.511352', tags: ['Geometry', 'coordinate-method', 'optimization', 'area'],
    s: String.raw`过点 $P(2,1)$ 作两条斜率互为相反数的直线交椭圆 $\dfrac{x^2}{6}+\dfrac{y^2}{3}=1$ 于 $A,B$ 两点（$A,B$ 均不与 $P$ 重合）。若椭圆上另一点 $Q$ 是位于直线 $AB$ 下方的动点，则 $\triangle QAB$ 面积的最大值为 ______。` },
  { n: 8, d: 6.5, a: '11025', tags: ['Combinatorics', 'counting'],
    s: String.raw`有 $2$ 个字母 $I$、$4$ 个字母 $M$、$8$ 个字母 $O$（相邻字母没有区别）。将它们排成一排，要求每个 $I$ 的左侧或右侧相邻的位置至少有一个 $M$。则所有满足条件的排列总数为 ______。` },
  { n: 9, d: 6.0, a: '', fs: true, tags: ['Algebra', 'sequence', 'optimization'],
    s: String.raw`（$16$ 分）设数列 $\{a_n\}$ 为等差数列，数列 $\{b_n\}$ 为等比数列。若 $a_1b_1=20$，$a_2b_2=26$，$a_3b_3>0$，求 $a_4b_4$ 的最大值。` },
  { n: 10, d: 7.5, a: '', fs: true, tags: ['Algebra', 'trigonometry', 'inequality'],
    s: String.raw`（$20$ 分）在 $\triangle ABC$ 中，若 $\cot\dfrac{A}{2}+2\cot\dfrac{B}{2}=19\cot\dfrac{C}{2}$，求 $\cos C$ 的最小值。` },
  { n: 11, d: 8.0, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'trigonometry', 'optimization'],
    s: String.raw`（$20$ 分）设椭圆 $\Gamma:\dfrac{x^2}{9}+\dfrac{y^2}{4}=1$，$\Gamma$ 的左右焦点为 $F_1,F_2$。$P$ 为 $\dfrac{x^2}{25}+\dfrac{y^2}{20}=1$ 上一个动点，$P$ 在 $\Gamma$ 外。过 $P$ 作 $\Gamma$ 的两条切线，切点为 $M,N$。求 $\cos\angle F_1PF_2-\cos\angle MPN$ 的取值范围。` },
  { n: 12, d: 8.5, a: '', fs: true, tags: ['Combinatorics', 'counting', 'sum'],
    s: String.raw`（$30$ 分）设整数 $m,n>1$。设正整数 $a_1,a_2,\cdots,a_n$ 和 $b_1,b_2,\cdots,b_m$ 满足 $\sum\limits_{i=1}^{n}a_i=\sum\limits_{j=1}^{m}b_j<mn$。求证：存在集合 $\{1,2,\cdots,n\}$ 的非空真子集 $A$ 以及集合 $\{1,2,\cdots,m\}$ 的非空真子集 $B$，满足 $\sum\limits_{i\in A}a_i=\sum\limits_{j\in B}b_j$。` },
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
