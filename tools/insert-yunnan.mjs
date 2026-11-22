// tools/insert-yunnan.mjs —— 2026 全国高中数学联赛（云南预赛）入库（无官方答案，答案自行计算，全部标 bug）
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

const PROV = '云南';
const P = 'CHSMLHYN';

const items = [
  { n: 1, d: 4.5, a: '1', tags: ['Algebra', 'logarithms', 'counting'],
    s: String.raw`已知集合 $A=\{a\in\mathbb{R}\mid 0\le\log_5 a\le 1\}$，集合 $B=\{b\in\mathbb{N}\mid 5<C_b^2<15\}$，集合 $C=\left\{x\ \middle|\ \exists b\in B,\ x+\dfrac{b}{x}\in A\right\}$。则 $C$ 中元素的最小值为 ______。` },
  { n: 2, d: 6, a: '0.980309', tags: ['Algebra', 'roots', 'optimization'],
    s: String.raw`设 $z$ 为复数，且 $z$ 的实部为 $1$。则 $\left|z^2+\dfrac{4}{z}\right|$ 的最小值为 ______。` },
  { n: 3, d: 6.5, a: '(1/2,5/8)∪(3/2,+∞)', tags: ['Algebra', 'logarithms', 'quadratic', 'inequality'],
    s: String.raw`已知函数 $f(x)=\log_a\left(ax^2-x+\dfrac{1}{2}\right)$ 在 $[1,2]$ 上恒正，则实数 $a$ 的取值范围是 ______。` },
  { n: 4, d: 5.5, a: '6.139015', tags: ['Geometry', 'solid-geometry', 'triangle', 'area'],
    s: String.raw`在正四面体 $ABCD$ 中，点 $E,F$ 分别在棱 $AB,AC$ 上，满足 $BE=2$，$EF=3$，且 $EF$ 与面 $BCD$ 平行，则 $\triangle DEF$ 的面积为 ______。` },
  { n: 5, d: 5, a: '0.4', tags: ['Geometry', 'triangle', 'trigonometry', 'ratios'],
    s: String.raw`在 $\triangle ABC$ 中，若三边满足 $a^2+b^2=6c^2$，则 $(\cot A+\cot B)\tan C$ 的值为 ______。` },
  { n: 6, d: 5.5, a: '(-7,-√14/2)∪(-√14/2,-1/2)', tags: ['Algebra', 'vectors', 'inequality'],
    s: String.raw`设向量 $\vec a,\vec b$ 满足 $|\vec a|=1$，$|\vec b|=2$，且 $\vec a$ 与 $\vec b$ 的夹角为 $\dfrac{\pi}{3}$。若 $7\vec a+2k\vec b$ 与 $k\vec a+\vec b$ 的夹角为钝角，则实数 $k$ 的取值范围为 ______。` },
  { n: 7, d: 5.5, a: '0.782609', tags: ['Combinatorics', 'probability', 'counting'],
    s: String.raw`两人轮流投掷骰子，每人每次投掷两颗。第一个使两颗骰子点数和不小于 $6$ 者为胜，否则，由另一人投掷。则先投掷人的获胜概率为 ______。` },
  { n: 8, d: 7.5, a: '11', tags: ['Combinatorics', 'counting', 'area'],
    s: String.raw`在边长为 $12$ 的正三角形中有 $n$ 个点，若用一个半径为 $\sqrt{3}$ 的圆形硬币总可以盖住其中的 $2$ 个点，则 $n$ 的最小值为 ______。` },
  { n: 9, d: 6, a: '', fs: true, tags: ['Algebra', 'inequality', 'equation', 'roots'],
    s: String.raw`设函数 $f(x)=\sqrt[3]{1+2x}-\lambda x$，其中 $\lambda>0$。(1) 求 $\lambda$ 的取值范围，使得 $f(x)$ 在 $[0,+\infty)$ 上单调递减；(2) 求解不等式：$3x-\sqrt[3]{1+2x}\le 36$。` },
  { n: 10, d: 6.5, a: '', fs: true, tags: ['Algebra', 'sequence', 'series', 'floor-function'],
    s: String.raw`已知数列 $\{a_n\}$ 满足 $a_1=3$，$a_n=\dfrac{2n+1}{n-1}(a_1+a_2+\cdots+a_{n-1})$，$n\ge 2$。(1) 求数列 $\{a_n\}$ 的通项公式；(2) 求 $\sum\limits_{n=1}^{100}[\log_3 a_n]$ 的值，其中 $[x]$ 表示不超过 $x$ 的最大整数。` },
  { n: 11, d: 6.5, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'area'],
    s: String.raw`已知直线 $l$ 过定点 $(0,3)$，且是抛物线 $y^2=4x$ 上动弦 $PQ$ 的垂直平分线。设 $l$ 与 $PQ$ 的交点为 $M$，求 $M$ 的轨迹方程。` },
  { n: 12, d: 7.5, a: '', fs: true, tags: ['Geometry', 'circle', 'triangle', 'angles'],
    s: String.raw`设 $\triangle ABC$ 外接圆的圆心为 $O$，过 $A$ 作圆 $O$ 的切线，交 $BC$ 的延长线于点 $P$。设 $\angle APB$ 的平分线依次交 $AB,AC$ 于点 $D,E$，设 $BE$ 与 $CD$ 交于点 $Q$。若 $\angle BAC=60^\circ$，求证：$O,P,Q$ 三点共线。` },
  { n: 13, d: 8, a: '', fs: true, tags: ['Algebra', 'inequality', 'symmetric', 'sum'],
    s: String.raw`设 $a,b,c$ 为正实数，且满足 $a^2+b^2+c^2+abc=4$。求证：$\dfrac{a^3}{b+c}+\dfrac{b^3}{c+a}+\dfrac{c^3}{a+b}+\dfrac{1}{abc}\ge\dfrac{5}{2}$。` },
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
