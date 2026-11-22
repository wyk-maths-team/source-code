// tools/insert-neimenggu.mjs —— 2026 内蒙古预赛（无官方答案，答案均为自算，全部标 bug）
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

const PROV = '内蒙古';
const P = 'CHSMLHNMG';

const items = [
  { n: 1, d: 4.5, a: '0', tags: ['Algebra', 'roots', 'equation', 'circle'],
    s: String.raw`满足 $z^{2026}-z-1=0$ 且 $|z|=1$ 的复数 $z$ 有 ______ 个．` },
  { n: 2, d: 4.0, a: '0', tags: ['Algebra', 'polynomial', 'roots'],
    s: String.raw`已知三次函数 $f(x)$ 的三个零点分别为 $x_1,x_2,x_3$，在三个零点处的切线的斜率分别记为 $k_1,k_2,k_3$，则它们的倒数和 $\dfrac{1}{k_1}+\dfrac{1}{k_2}+\dfrac{1}{k_3}=$ ______．` },
  { n: 3, d: 5.0, a: '0.146484', tags: ['Combinatorics', 'probability', 'counting'],
    s: String.raw`从一副不含鬼牌的扑克牌中有放回地抽取扑克牌，在第六次抽取时得到全部四种花色的概率为 ______．` },
  { n: 4, d: 5.5, a: '0.414214', tags: ['Geometry', 'coordinate-method', 'optimization'],
    s: String.raw`设点 $P$ 为双曲线 $C_1:\dfrac{x^2}{2}-y^2=1$ 上一点，点 $Q$ 为圆 $C_2:x^2+(y-3)^2=4$ 上一点．记线段 $PQ$ 的中点为 $M$，$O$ 为坐标原点，则线段 $OM$ 长度的最小值为 ______．` },
  { n: 5, d: 6.0, a: '0.120239', tags: ['Geometry', 'solid-geometry', 'area'],
    s: String.raw`三棱锥 $A-BCD$ 中，$\angle BAC=\angle CAD=\angle DAB=60^{\circ}$，且三个侧面的面积分别为 $\dfrac{\sqrt3}{2},\dfrac{3\sqrt3}{2},\dfrac{3\sqrt3}{4}$，则三棱锥的内切球体积为 ______．` },
  { n: 6, d: 5.5, a: '0.362637', tags: ['Combinatorics', 'probability', 'counting'],
    s: String.raw`从正十六边形的顶点中任选四个顶点，两两不相邻的概率为 ______．` },
  { n: 7, d: 6.5, a: '1012', tags: ['NumberTheory', 'sequence', 'divisibility'],
    s: String.raw`设 $\{a_n\}$ 为整数列，且满足关系式 $(n-1)a_{n+1}=(n+1)a_n-2(n-1)$，$n\in\mathbb{N}_{+}$．若 $2026\mid a_{2025}$，则满足 $2026\mid a_n$ 且满足 $n\ge2$ 的最小正整数 $n$ 是 ______．` },
  { n: 8, d: 7.0, a: String.raw`$x=k\pi\pm\dfrac{\pi}{12}$，或 $x=k\pi\pm\dfrac{5\pi}{12}$，或 $x=k\pi\pm\dfrac{\pi}{10}$，或 $x=k\pi\pm\dfrac{3\pi}{10}$（$k\in\mathbb{Z}$）`,
    tags: ['Algebra', 'trigonometry', 'equation'],
    s: String.raw`方程 $\sin x\sin 7x=\dfrac{1}{4}$ 的所有解为 ______．` },
  { n: 9, d: 7.0, a: '', fs: true, tags: ['NumberTheory', 'series', 'divisibility'],
    s: String.raw`（16 分）已知数列 $\{a_n\}$ 为等差数列，且 $a_1^2,a_2^2,a_3^2$ 均为数列中的项．求证：对任意的 $n\in\mathbb{N}_{+}$，都有 $a_n$ 是整数．` },
  { n: 10, d: 4.5, a: '', fs: true, tags: ['Algebra', 'optimization', 'inequality'],
    s: String.raw`（20 分）求函数 $f(x)=\dfrac{\sqrt{x}}{x^2+1}$ 的最大值．` },
  { n: 11, d: 7.0, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'optimization'],
    s: String.raw`（20 分）已知双曲线 $C:(1-a^2)x^2+a^2y^2-a^2=0\ (a>0)$，设 $C$ 的上顶点为 $A$，$C$ 与直线 $y=-x$ 交于点 $P$．以 $A$ 为焦点，$M(0,m)$ 为顶点作开口向下的抛物线 $D$，且 $D$ 经过点 $P$．当 $C$ 的一条渐近线斜率取值范围为 $\left[\dfrac{\sqrt3}{2},\dfrac{2\sqrt2}{3}\right]$ 时，求直线 $PM$ 斜率的最大值．` },
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
