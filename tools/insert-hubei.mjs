// tools/insert-hubei.mjs —— 2026 全国高中数学联赛预赛（湖北）（有官方答案）
// 来源：private/completed/2026湖北.pdf + 2026年湖北预赛参考答案.pdf（扫描件，答案汇总在第 1 页）
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

const P = 'CHSMLHHB';       // 湖北
const PROV = '湖北';

const problems = [
  {
    n: 1, diff: 3.5, ans: '5',
    tags: ['Algebra', 'equation'],
    statement: String.raw`已知 $x,y\in\mathbb{R}$ 且 $y>0$，集合 $A=\{x^2+x+1,-x,-x-1\}$，$B=\{-y,-\dfrac{y}{2},\dfrac{3y}{2}\}$。若 $A=B$，则 $x^2+y^2=$ ______。`,
  },
  {
    n: 2, diff: 4.5, ans: '179',
    tags: ['NumberTheory', 'logarithms', 'exponential'],
    statement: String.raw`已知正整数 $a,b,c,d$ 满足：$\log_a b=\dfrac{3}{2}$，$\log_c d=\dfrac{5}{4}$，$c-a=65$。则 $d-b=$ ______。`,
  },
  {
    n: 3, diff: 3.5, ans: '0.157407',
    tags: ['Combinatorics', 'probability', 'counting'],
    statement: String.raw`随机投掷 $3$ 枚质地均匀的正方体骰子（$6$ 个面的点数分别为 $1,2,3,4,5,6$），则 $3$ 枚骰子正面朝上的点数之和为完全平方数的概率为 ______。`,
  },
  {
    n: 4, diff: 5.0, ans: '1.414214',
    tags: ['Geometry', 'triangle', 'trigonometry'],
    statement: String.raw`在 $\triangle ABC$ 中，$\angle CAB=120^\circ$，作 $AD\perp AB$ 交 $BC$ 于点 $D$。若 $AB=CD=1$，则 $BD=$ ______。`,
  },
  {
    // 官方答案 √2(2^2025 - 1/2) 是精确表达式，数值约 1.45e609，无法用 6 位小数表示，故 ans 留空
    n: 5, diff: 6.0, ans: '',
    tags: ['Algebra', 'series', 'exponential'],
    statement: String.raw`设 $a_n=\dfrac{1}{2^n}$，$p_n\in\{1,i\}$，其中 $i$ 为虚数单位，$n\in\mathbb{N}^*$。设所有能表示为 $p_1a_1+p_2a_2+\cdots+p_{2026}a_{2026}$ 形式的数之和为复数 $T$，则 $|T|=$ ______。`,
  },
  {
    n: 6, diff: 6.0, ans: '0.527046',
    tags: ['Geometry', 'solid-geometry', 'vectors'],
    statement: String.raw`在正三棱锥 $P-ABC$ 中，$D$ 为 $PB$ 的中点，$E$ 为 $PC$ 的靠近 $P$ 点的三等分点，且 $AD\perp DE$。设 $PA=2$，则三棱锥 $P-ABC$ 的体积为 ______。`,
  },
  {
    n: 7, diff: 6.5, ans: '0.857143',
    tags: ['Geometry', 'triangle', 'ratios'],
    statement: String.raw`在 $\triangle QAC$ 中，$B,D$ 分别在 $QC,QA$ 上，$AB$ 和 $CD$ 交于点 $P$，直线 $PQ$ 分别与 $DB,AC$ 交于点 $M,N$。若 $QM=2$，$MN=3$，则 $MP=$ ______。`,
  },
  {
    n: 8, diff: 7.5, ans: '2',
    tags: ['Combinatorics', 'digits', 'square'],
    statement: String.raw`一个各位数字互不相同的四位数 $M$ 是完全平方数，它的各位数字之和 $N$ 和 $\dfrac{M}{N}$ 也都是完全平方数。这样的四位数 $M$ 共有 ______ 个。`,
  },
  {
    n: 9, diff: 6.5, ans: '', fs: true,
    tags: ['Geometry', 'coordinate-method', 'optimization'],
    statement: String.raw`设 $A,B$ 是椭圆 $\Gamma:\dfrac{x^2}{4}+y^2=1$ 上不同于顶点的两个动点，$O$ 为坐标原点，直线 $OA,OB$ 的斜率分别记为 $k_1,k_2$。如果椭圆 $\Gamma$ 上存在点 $C$ 满足 $\overrightarrow{OC}=\cos\theta\overrightarrow{OA}+\sin\theta\overrightarrow{OB}$，其中 $\theta\in\left(0,\dfrac{\pi}{2}\right)$。
(1) 证明：$k_1\cdot k_2$ 为定值；
(2) 求 $|OA|\cdot|OB|$ 的最大值。`,
  },
  {
    n: 10, diff: 7.5, ans: '', fs: true,
    tags: ['Algebra', 'polynomial', 'diophantine'],
    statement: String.raw`已知 $a,b$ 都是正整数，函数 $f(x)=ax^2+bx+1$ 的图象与 $x$ 轴有两个不同的交点 $A(m,0),B(n,0)$。如果 $|m|\le 1$，$|n|\le 1$，求 $a+b$ 的最小值。`,
  },
  {
    n: 11, diff: 7.5, ans: '', fs: true,
    tags: ['Algebra', 'trigonometry', 'inequality'],
    statement: String.raw`设 $a,b,c,d$ 为实数，如果不等式 $a\cos x+b\sin x+c\cos 2x+d\sin 2x\ge -1$ 对任意 $x\in\mathbb{R}$ 恒成立，求证：$a^2+b^2+c^2+d^2\le 3$。`,
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
  tags: [...p.tags, 'CHSML'],
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

// 幂等修缮：已存在文档补齐 CHSML 标签（旧版本脚本漏加）
if (existingIds.size > 0) {
  const fix = await col.updateMany(
    { id: { $in: [...existingIds] }, tags: { $ne: 'CHSML' } },
    { $addToSet: { tags: 'CHSML' } },
  );
  console.log(`补齐 CHSML 标签: matched=${fix.matchedCount} modified=${fix.modifiedCount}`);
}

if (toInsert.length > 0) {
  const res = await col.insertMany(toInsert);
  console.log(`✅ 已插入 ${res.insertedCount} 题`);
  for (const d of toInsert) console.log(`   ${d.id}  diff=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}`);
}

const total = await col.countDocuments({ id: /^CHSMLHHB/ });
console.log(`\n库中 CHSMLHHB* 总数: ${total}`);

await client.close();
