// tools/insert-guangzhou.mjs —— 2026 广州预赛（无官方答案，答案由计算得出，全部标 bug）
// 一试：填空 1-10（每题 8 分）、解答 11-12（每题 20 分）；二试：13、14（各 40 分，证明题）
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

const PROV = '广州';
const P = 'CHSMLHCZ'; // CZ = 广州（GZ 留给贵州）

const items = [
  { n: 1, d: 3.20, a: '3\\pi', fs: true, tags: ['Algebra', 'trigonometry', 'equation'],
    s: String.raw`已知集合 $A=\{x\in[0,2\pi]\mid 2\sin^2x-3\cos x-3=0\}$，则 $A$ 中所有元素之和为 ______。` },
  { n: 2, d: 4.50, a: '4.155075', tags: ['Algebra', 'series', 'surds'],
    s: String.raw`数列 $\{a_n\}$ 的通项公式为 $a_n=\dfrac{1}{\sqrt{2n+2\sqrt{n^2+1}}}$，前 $n$ 项和为 $S_n$，则 $S_{24}=$ ______。` },
  { n: 3, d: 4.20, a: '4', tags: ['Geometry', 'coordinate-method', 'length'],
    s: String.raw`已知椭圆 $C:\dfrac{x^2}{25}+\dfrac{y^2}{16}=1$，$P$ 为 $C$ 上一点，$C$ 在点 $P$ 处的切线交 $x$ 轴于点 $B(15,0)$，$F$ 为 $C$ 的右焦点，则 $|PF|=$ ______。` },
  { n: 4, d: 5.00, a: '\\dfrac{e\\ln 2}{4}', fs: true, tags: ['Algebra', 'logarithms', 'roots'],
    s: String.raw`已知函数 $f(x)=x\ln x-ax^2$ 有两个极值点 $x_1,x_2$，若 $x_2=2x_1$，则 $a=$ ______。` },
  { n: 5, d: 4.80, a: '-0.09375', tags: ['Algebra', 'optimization', 'quadratic'],
    s: String.raw`设 $x,y,z>0$ 满足 $x^2-4xy+9y^2-16z=0$。当 $\dfrac{xy}{z}$ 取最大值时，$\dfrac{3}{x}-\dfrac{2}{y}+\dfrac{1}{z}$ 的最小值为 ______。` },
  { n: 6, d: 6.20, a: '\\dfrac{x^2}{4}-\\dfrac{y^2}{3}=1', fs: true, tags: ['Geometry', 'coordinate-method', 'ratios'],
    s: String.raw`已知双曲线 $\Gamma:x^2-\dfrac{y^2}{3}=1$，直线 $l_1,l_2$ 分别过 $\Gamma$ 的左、右焦点，$l_1$ 交 $\Gamma$ 左支于 $A,B$ 两点，$l_2$ 交 $\Gamma$ 右支于 $C,D$ 两点，$l_1$ 与 $l_2$ 相交于点 $P$。若 $k_{OA}+k_{OB}=k_{OC}+k_{OD}$，则动点 $P$ 的轨迹方程为 ______。` },
  { n: 7, d: 5.60, a: '34', tags: ['Geometry', 'vectors', 'optimization'],
    s: String.raw`在 $\triangle ABC$ 中，$AB=6$，$AC^2+BC^2=50$。以 $C$ 为圆心、$\sqrt{2}$ 为半径作 $\odot C$，$\odot C$ 上两点 $E,F$ 满足 $\angle ECF=90^\circ$。则 $\overrightarrow{AE}\cdot\overrightarrow{BE}+\overrightarrow{AF}\cdot\overrightarrow{BF}$ 的最大值为 ______。` },
  { n: 8, d: 6.60, a: '228\\pi', fs: true, tags: ['Geometry', 'solid-geometry', 'circle'],
    s: String.raw`已知四边形 $ABCD$ 内接于半径为 $7$ 的一个圆，且 $AC=10$。将 $\triangle ACD$ 沿 $AC$ 折叠至 $\triangle ACD'$，满足二面角 $B-AC-D'$ 为 $120^\circ$。则四面体 $ABCD'$ 的外接球表面积为 ______。` },
  { n: 9, d: 6.00, a: '140', tags: ['Combinatorics', 'counting'],
    s: String.raw`形状相同的 $13$ 张卡片中，有 $3$ 张标记数字“$0$”，$3$ 张标记数字“$1$”，$3$ 张标记数字“$2$”，剩下 $4$ 张为黑色卡片。将这些卡片排成一列，要求每张黑色卡片左右必须有数字卡片相邻，且这两数字之差为 $2$。则可能的排列方法数为 ______。` },
  { n: 10, d: 6.80, a: '(1,1)、(16,11)', fs: true, tags: ['NumberTheory', 'diophantine', 'square'],
    s: String.raw`称正整数对 $(a,b)(a\ge b)$ 为“强平方对”，若 $a^2+3b$ 和 $b^2+3a$ 均为完全平方数。则所有的“强平方对”为 ______。` },
  { n: 11, d: 5.50, a: '', fs: true, tags: ['Geometry', 'triangle', 'trigonometry'],
    s: String.raw`在 $\triangle ABC$ 中，$H$ 为垂心，记 $AH=l$。（1）若 $l=4$，$A=\dfrac{\pi}{3}$，求 $a$；（2）若 $\{b,c,l\}=\{3,4,5\}$，求 $4\cos^3\angle BAC-5\cos^2\angle BAC$ 的值。` },
  { n: 12, d: 6.50, a: '', fs: true, tags: ['Algebra', 'absolute-value', 'fractions'],
    s: String.raw`对非零复数 $z$，设 $f(z)=1-\dfrac{4}{z}$。（1）若 $\operatorname{Re}z=1$，求 $|f(z)|$ 的取值范围；（2）设复数 $z_1,z_2$ 满足 $\operatorname{Re}z_1=\operatorname{Re}z_2=2$，且 $|f(z_1)+f(z_2)|=\operatorname{Re}\left(\dfrac{f(z_1)}{f(z_2)}+\dfrac{f(z_2)}{f(z_1)}\right)$，求 $|z_1-z_2|$。` },
  { n: 13, d: 6.60, a: '', fs: true, tags: ['Algebra', 'inequality', 'symmetric'],
    s: String.raw`设 $a,b,c,d$ 为非负实数，求证：$(a^3+b^3+c^3+d^3+abc+bcd+cda+dab)^2\le(a^2+b^2+c^2+d^2)^3$。` },
  { n: 14, d: 7.50, a: '', fs: true, tags: ['Geometry', 'circle', 'triangle', 'angles'],
    s: String.raw`在 $\triangle ABC$ 中，点 $D,E$ 分别在边 $AB,AC$ 上，$F,G$ 分别为 $DE,BC$ 的中点，$\triangle ABE,\triangle ACD$ 的外心连线分别交边 $AB,AC$ 于点 $M,N$，$O$ 为 $\triangle AMN$ 的外心。求证：$AO\parallel FG$。` },
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
  for (const d of toInsert) console.log(`   ${d.id}  d=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}  tags=${d.tags.join(',')}`);
}
console.log(`库中 ${P}* 总数: ${await col.countDocuments({ id: new RegExp('^' + P) })}`);

await client.close();
