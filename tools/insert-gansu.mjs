// tools/insert-gansu.mjs —— 2026 甘肃预赛（无官方答案，答案自算，全部标 bug）
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

const PROV = '甘肃';
const P = 'CHSMLHGS';

const items = [
  { n: 1, d: 4.0, a: '-1,3', tags: ['NumberTheory', 'diophantine', 'circle'],
    s: String.raw`数学中把实、虚部均为整数的复数称为高斯整数. 已知复数 $z$ 是高斯整数，且满足 $|z-i|=2\sqrt{2}$（$i$ 为虚数单位），则满足条件的复数 $z$ 的虚部为 ______.` },
  { n: 2, d: 4.5, a: String.raw`\left[1,+\infty\right)`, tags: ['Algebra', 'logarithms', 'inequality', 'quadratic'],
    s: String.raw`若不等式 $\log_2(2x+1)\le\log_4(3x^2+2x+k)$ 对任意 $x\in\left(-\dfrac{1}{2},0\right]$ 成立，则实数 $k$ 的取值范围为 ______.` },
  { n: 3, d: 5.0, a: '1013', tags: ['Algebra', 'sequence', 'sum', 'symmetric'],
    s: String.raw`已知定义在 $\mathbb{R}$ 上的函数 $f(x)$ 满足对任意的实数 $x$ 有：① $f(x)+f(-x)=0$；② $f(1+x)-f(1-x)=0$，且当 $x\in[0,1]$ 时，$f(x)=x$。则 $\sum\limits_{a=1}^{2026}af(a)$ 的值为 ______.` },
  { n: 4, d: 4.5, a: '480', tags: ['Combinatorics', 'counting'],
    s: String.raw`设全集 $U=\{1,2,3,4,5,6\}$，若子集 $A,B\subseteq U$ 满足：$A\cap B$ 恰有 $2$ 个元素，$A\cup B$ 恰有 $5$ 个元素，则这样的有序集合对 $(A,B)$ 的个数为 ______.` },
  { n: 5, d: 6.0, a: String.raw`100\pi`, tags: ['Geometry', 'solid-geometry', 'coordinate-method', 'optimization'],
    s: String.raw`在长方体 $ABCD-A_1B_1C_1D_1$ 中，$AB=8$，$AD=AA_1=6$。点 $P$ 在线段 $AC$ 上，当三角形 $BB_1P$ 的面积最小时，三棱锥 $A-BB_1P$ 的外接球的表面积是 ______.` },
  { n: 6, d: 6.5, a: String.raw`\left(6,4+2\sqrt{7}\right]`, tags: ['Geometry', 'circle', 'vectors', 'optimization'],
    s: String.raw`已知圆 $C:x^2+y^2+8x+12=0$，点 $M(0,-\sqrt{3})$。过原点的直线与圆 $C$ 相交于两个不同的点 $A,B$，则 $|\overrightarrow{MA}+\overrightarrow{MB}|$ 的取值范围为 ______.` },
  { n: 7, d: 5.5, a: String.raw`\frac{\sqrt{7}}{4}`, tags: ['Geometry', 'trigonometry', 'triangle', 'sequence'],
    s: String.raw`三角形 $ABC$ 中，角 $A,B,C$ 的对边 $a,b,c$ 成等差数列，且 $\sin^2A-\sin^2C=\sin B$。则 $\sin B=$ ______.` },
  { n: 8, d: 5.5, a: '7', tags: ['Algebra', 'sequence', 'simplification'],
    s: String.raw`已知数列 $\{a_n\}$ 满足：$a_1=1$，$a_2=2$，$a_{n+1}=\dfrac{a_n^2+2^n}{a_{n-1}}$（$n\ge 2$）。若对任意的正整数 $n$，均存在常数 $p,q$，使得 $\dfrac{a_{n+2}+pa_n}{a_{n+1}}=q$，则 $p+q$ 的值为 ______.` },
  { n: 9, d: 5.5, a: '2.25', tags: ['Geometry', 'vectors', 'inequality', 'optimization'],
    s: String.raw`泛函分析中，范数是向量“长度”的推广，是该领域的基础概念。现定义平面向量 $\vec a=(x,y)$ 的“Rickie 范数”：$\|\vec a\|_R=\sqrt{x^2+2y^2}$。设 $M,N$ 分别为椭圆 $\dfrac{x^2}{16}+\dfrac{y^2}{8}=1$ 与 $\dfrac{x^2}{36}+\dfrac{y^2}{18}=1$ 上两点，记 $\overrightarrow{OM}=\vec m,\ \overrightarrow{ON}=\vec n$，则 $\dfrac{\|3\vec m-4\vec n\|_R}{\|\vec m\|_R+2\|\vec n\|_R}$ 的最大值为 ______.` },
  { n: 10, d: 6.0, a: '123,124,125', tags: ['Combinatorics', 'counting', 'floor-function'],
    s: String.raw`深耕实业匠心，践行精益生产。某精密仪器加工厂共有 $N$ 个工位（$N$ 为正整数），单件产品加工时长为 $1$ 小时，每个工位仅在完成一件产品加工后方可记 $1$ 个工作量。该工厂实行错峰开工机制，即相邻工位间隔 $\dfrac{1}{N}$ 小时开工（如 $N=3$ 时，若首个工位 $8:00$ 开工，则第二个工位 $8:20$ 开工，第三个工位 $8:40$ 开工）。已知该工厂上午 $7:50-12:10$ 各工位进行连续生产，且在该时段内 $N$ 个工位的工作总量不少于 $410$ 且不超过 $418$，则 $N$ 的所有可能取值为 ______.` },
  { n: 11, d: 6.5, a: '', fs: true, tags: ['Geometry', 'triangle', 'trigonometry', 'inequality'],
    s: String.raw`若 $\triangle ABC$ 的内角 $A,B,C$ 的对边分别为 $a,b,c$，$\triangle ABC$ 的面积为 $S$，$a=2$ 且 $bc\cos A(\cos B-\sin C)=2S(\cos C+\sin B)$。（1）若 $B=\dfrac{\pi}{6}$，求 $A$；（2）求 $b-c$ 的取值范围。` },
  { n: 12, d: 7.0, a: '', fs: true, tags: ['Geometry', 'solid-geometry', 'coordinate-method', 'angles'],
    s: String.raw`在四棱锥 $P-ABCD$ 中，$AB\parallel CD$，$AB\perp BC$，$AB=3$，$BC=CD=PD=2$，$\angle PDC=120^\circ$，$PD$ 与平面 $ABCD$ 所成角的大小为 $60^\circ$。若在线段 $PB$ 上存在一点 $Q$ 满足 $CQ\parallel$ 平面 $PAD$。（1）求证：平面 $PCD\perp$ 平面 $ABCD$；（2）求直线 $AB$ 与平面 $AQC$ 所成角的正弦值。` },
  { n: 13, d: 6.5, a: '', fs: true, tags: ['Combinatorics', 'probability', 'sequence'],
    s: String.raw`小明参加了一场智力挑战赛，每轮比赛在难度系数较低的甲类问题以及难度系数较高的乙类问题中随机答一道题。小明遇到每类问题的概率均为 $\dfrac{1}{2}$。小明遇到甲类问题时回答正确的概率为 $\dfrac{1}{2}$，回答正确记 $1$ 分，否则记 $0$ 分；小明遇到乙类问题时回答正确的概率为 $\dfrac{1}{4}$，回答正确记 $2$ 分，否则记 $0$ 分。小明回答每个问题正确与否相互独立。（1）当进行完 $2$ 轮比赛时，求小明的总得分 $X$ 的分布列与数学期望；（2）设小明在每轮比赛中均回答正确且累计得分为 $n$ 分的概率为 $P(n)$，求 $P(n)$ 的解析式。` },
  { n: 14, d: 7.5, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'area', 'optimization'],
    s: String.raw`抛物线 $y^2=8x$ 上的两个动点 $A,B$ 及一定点 $M(2,4)$，$F$ 为焦点，已知 $|AF|,|MF|,|BF|$ 成等差数列。（1）求证：线段 $AB$ 的垂直平分线过定点 $Q$；（2）求 $\triangle AQB$ 面积的最大值。` },
  { n: 15, d: 7.5, a: '', fs: true, tags: ['Algebra', 'inequality', 'trigonometry', 'optimization'],
    s: String.raw`已知函数 $f(x)=a(x-\sin x)$。（1）当 $a=1$ 时，求证：$\forall x\in\left(0,\dfrac{\pi}{2}\right)$，$f(2x)<\tan x$；（2）若 $f(x)\le x^2$ 在 $(0,+\infty)$ 上恒成立，求实数 $a$ 的取值范围。` },
  { n: 16, d: 8.5, a: '', fs: true, tags: ['Combinatorics', 'counting', 'sequence', 'absolute-value'],
    s: String.raw`若数列 $A:a_1,a_2,\cdots,a_n$ 满足以下两个性质，则 $A$ 为 $T$ 数列。① $a_1,a_2,\cdots,a_n$ 是 $1,2,\cdots,n$ 的一个排列；② $|a_2-a_1|,|a_3-a_2|,\cdots,|a_n-a_{n-1}|$ 是 $1,2,\cdots,n-1$ 的一个排列。（1）若数列 $A:a_1,a_2,\cdots,a_7$ 为 $T$ 数列且 $a_1=1$，直接写出数列 $A$；（2）若数列 $A:a_1,a_2,\cdots,a_{20}$ 满足 $a_1=3$，$a_{20}=18$，求证：数列 $A:a_1,a_2,\cdots,a_{20}$ 不是 $T$ 数列；（3）对于给定的整数 $n\ge 2$，若数列 $A:a_1,a_2,\cdots,a_n$ 为 $T$ 数列，求 $a_1+a_n$ 的最小值。` },
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
