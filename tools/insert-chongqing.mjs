// tools/insert-chongqing.mjs —— 2026 重庆预赛（无官方答案，全部标 bug）
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

const PROV = '重庆';
const P = 'CHSMLHCQ';

const items = [
  { n: 1, d: 5.5, a: '5或10', fs: true, tags: ['Algebra', 'counting', 'sum'],
    s: String.raw`设集合 $A=\{1,m\}$，其中 $m$ 为实数。令集合 $B=\{a+b\mid a\in A,b\in A\}$，若 $A\cap B$ 恰有一个元素，则 $A\cup B$ 的元素之和为 ______。` },
  { n: 2, d: 6, a: '-1', tags: ['Algebra', 'logarithms', 'exponential'],
    s: String.raw`已知两不相等的正实数 $a,b$ 均满足方程 $\left(\dfrac{4}{3}\right)^x=\log_{\frac{4}{3}}x$，则 $(a+b)\log_{ab}\dfrac{3}{4}$ 的值为 ______。` },
  { n: 3, d: 6, a: '[25/6, 29/6)', fs: true, tags: ['Algebra', 'trigonometry', 'angles'],
    s: String.raw`已知函数 $f(x)=A\sin\omega x\,(A>0,\omega>0)$ 的图象与直线 $y=1$ 在区间 $[0,\pi]$ 上恰有 $3$ 个交点，从左往右依次为 $P,Q,R$，且 $PR=3PQ$，则 $A+\omega$ 的取值范围为 ______。` },
  { n: 4, d: 4.5, a: '0.342857', tags: ['Algebra', 'equation'],
    s: String.raw`定义在 $[0,1]$ 上的函数 $f(x)$ 满足：对任意 $x\in[0,1]$，均有 $f(x)+f(1-x)=1$，且对任意 $x\in\left[0,\dfrac{1}{3}\right]$，均有 $f(3x)=2f(x)$。则 $f\left(\dfrac{1}{10}\right)+f\left(\dfrac{1}{13}\right)$ 的值为 ______。` },
  { n: 5, d: 5, a: '0.828125', tags: ['Geometry', 'solid-geometry', 'angles'],
    s: String.raw`四面体 $ABCD$ 满足 $AB=BC=CD=2$，$AC=AD=BD=3$，则二面角 $B-AD-C$ 的余弦值为 ______。` },
  { n: 6, d: 5.5, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'vectors'],
    s: String.raw`设双曲线 $C:x^2-y^2=4$ 的右焦点为 $F$，直线 $l:x=\sqrt{2}$，$C$ 右支上一点 $P$（非顶点）在 $l$ 上的投影为 $Q$，记 $\triangle PFQ$ 的面积为 $S$，则 $\dfrac{\overrightarrow{PF}\cdot\overrightarrow{PQ}}{S}+1$ 的最小值为 ______。` },
  { n: 7, d: 6, a: '63', tags: ['Combinatorics', 'counting'],
    s: String.raw`将 $3\times 3$ 方格表中 $9$ 个小方格的若干个涂成红色，要求被涂红的任意两个小方格均不能相邻（两个小方格相邻是指它们有一条公共边），则不同的涂色方案有 ______ 种。` },
  { n: 8, d: 5.5, a: '2.393939', tags: ['Algebra', 'sequence', 'floor-function'],
    s: String.raw`数列 $\{a_n\}$ 满足：$a_1=1$，且对任意正整数 $n$，均有 $a_{n+1}=\dfrac{1}{[a_n]-\{a_n\}}+1$（其中 $[a_n]$ 表示 $a_n$ 的整数部分，$\{a_n\}$ 表示 $a_n$ 的小数部分）。则 $a_{2026}=$ ______。` },
  { n: 9, d: 6.5, a: '', fs: true, tags: ['Algebra', 'trigonometry', 'equation'],
    s: String.raw`已知 $\triangle ABC$ 的内角 $A,B,C$ 满足 $\sin A+\cos B=\cos A+\sin B=\cot C$，求 $\cos C$ 的值。` },
  { n: 10, d: 7, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'circle'],
    s: String.raw`在平面直角坐标系中，椭圆 $\Gamma:\dfrac{x^2}{a^2}+y^2=1\,(a>1)$ 的左、右焦点分别为 $F_1,F_2$，圆 $\Omega$ 过 $F_1,F_2$ 且与 $\Gamma$ 相交。设 $\Omega$ 与 $\Gamma$ 的某一条公切线与圆 $\Omega$ 切于点 $P(x_0,y_0)$，求 $y_0$ 的所有可能值。` },
  { n: 11, d: 7.5, a: '', fs: true, tags: ['Algebra', 'inequality', 'absolute-value'],
    s: String.raw`(1) 求证：对任意复数 $a,b,c$，有 $|a+b|^2+|b+c|^2+|c+a|^2=|a|^2+|b|^2+|c|^2+|a+b+c|^2$。
(2) 若复数 $z_1,z_2,\cdots,z_{2026}$ 满足 $z_1+z_2+\cdots+z_{2026}=1$，求 $\sum\limits_{k=1}^{2026}\left(|z_k+i|-|z_k|\right)$ 的最大值，其中 $i$ 为虚数单位。` },
];

const isPureNumber = (a) => a !== '' && /^-?\d+(\.\d+)?$/.test(a);

const docs = items.map(p => {
  const fsFlag = p.fs === true || !isPureNumber(p.a);
  return {
    id: `${P}${String(p.n).padStart(2, '0')}`,
    name: `高中联赛预赛（${PROV}）第${p.n}题`,
    statement: p.s,
    ans: p.a,
    difficulty: p.d,
    public: false,
    FS: fsFlag,
    tags: [...p.tags, 'CHSML', 'bug'],
    logic: '',
  };
});

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
