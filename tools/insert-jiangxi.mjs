// tools/insert-jiangxi.mjs —— 2026 全国高中数学联赛（江西预赛）
// 题面：private/paper/2026江西.pdf（8 填空 + 4 解答）
// 答案：private/paper/2026年江西预赛参考答案.pdf 第 1–4 页
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

const P = 'CHSMLHJX'; // 江西
const PROV = '江西';

const problems = [
  {
    n: 1, diff: 4.50, ans: '-0.333333',
    tags: ['Algebra', 'trigonometry', 'equation'],
    statement: String.raw`若 $\cos\left(\dfrac{\pi}{3}-\theta\right)=\sqrt{2}\cos\left(\dfrac{\pi}{6}+\theta\right)$，则 $\cos\left(2\theta+\dfrac{\pi}{3}\right)=$ ______。`,
  },
  {
    n: 2, diff: 5.00, ans: '24',
    tags: ['Algebra', 'digits', 'symmetric'],
    statement: String.raw`实数 $a,b$ 满足集合 $\left\{a,\dfrac{b}{a},2025\right\}=\{a^2,a+2026b,0\}$，则 $a^{2026}+(b-1)^{2027}$ 末尾的两位数是 ______。`,
  },
  {
    n: 3, diff: 5.50, ans: '2',
    tags: ['Algebra', 'trigonometry', 'optimization'],
    statement: String.raw`已知函数 $f(x)=\sin^2 x+a\cos x+b$ 有零点，则 $a^2+(b-2)^2$ 的最小值为 ______。`,
  },
  {
    n: 4, diff: 6.00, ans: '1.456022',
    tags: ['Geometry', 'coordinate-method', 'optimization', 'length'],
    statement: String.raw`若点 $C,D$ 是直线 $y=2x+1$ 与曲线 $2x^2-3y^2=y$ 交点的两个三等分点，点 $P$ 在 $y$ 轴上，则 $|PC|+|PD|$ 的最小值为 ______。`,
  },
  {
    n: 5, diff: 6.50, ans: '0.238095',
    tags: ['Combinatorics', 'probability', 'counting'],
    statement: String.raw`正方体的顶点和它的中心构成的 $9$ 个点中取 $3$ 点能构成锐角三角形的概率为 ______。`,
  },
  {
    n: 6, diff: 7.50, ans: '5',
    tags: ['Algebra', 'series', 'sequence'],
    statement: String.raw`已知数列 $\{a_n\}$ 满足 $a_1=2$，$a_{n+1}=\sqrt{a_n^2-\dfrac{a_n(a_n-1)}{n}}\ (n\ge 1)$。则 $\left[\sum_{i=1}^{2026}\left(\dfrac{a_i}{i}\right)^2\right]=$ ______。`,
  },
  {
    n: 7, diff: 7.00, ans: '12',
    tags: ['Algebra', 'fractions', 'divisibility'],
    statement: String.raw`使得 $\dfrac{3m^2+20m+26}{m-1}$ 的值为整数的所有有理数 $m$ 的和为 ______。`,
  },
  {
    n: 8, diff: 8.00, ans: '361.395822',
    tags: ['Algebra', 'optimization', 'inequality'],
    statement: String.raw`已知复数 $z$ 满足 $|z|=2$，则 $\left|(z+2)^2(z-1)(z-4)^2\right|$ 的最大值为 ______。`,
  },
  {
    n: 9, diff: 7.50, ans: '', fs: true,
    tags: ['Algebra', 'inequality', 'symmetric'],
    statement: String.raw`关于 $x$ 的方程 $x^4-4x^3+ax^2+bx+c=0$ 的四正根 $\alpha,\beta,\gamma,\delta$，使得不等式 $(1+\alpha)(1+\alpha+\beta)(1+\alpha+\beta+\gamma)-k\sqrt{\alpha\beta\gamma\delta}\ge 0$ 恒成立。求 $k$ 的最大值。`,
  },
  {
    n: 10, diff: 7.50, ans: '', fs: true,
    tags: ['Geometry', 'trigonometry', 'area-method'],
    statement: String.raw`正实数 $a,b,c$ 满足 $a+b=\sqrt{36+ab}$，$a+c=\sqrt{16+2ac}$，$b+\sqrt{3}c=\sqrt{50-b^2+c^2}$。求 $(a-b-\sqrt{3}c)^2+3b^2$ 的值。`,
  },
  {
    n: 11, diff: 7.00, ans: '', fs: true,
    tags: ['Geometry', 'circle', 'angles'],
    statement: String.raw`$\triangle ABC$ 的内切圆 $\odot I$ 与边 $AC,AB$ 分别切于点 $E,F$，分别连接 $EI,FI$ 并延长交 $\odot I$ 于点 $J,K$。若 $AE=BC$，求证：$I,J,B,C,K$ 五点共圆。`,
  },
  {
    n: 12, diff: 9.00, ans: '', fs: true,
    tags: ['NumberTheory', 'prime', 'logarithms'],
    statement: String.raw`对给定的奇素数 $p$，试说明满足下述条件的正整数 $N$ 是否存在。若存在，求出其中最小的。（1）$(p-1)^p<N<p^p$；（2）其标准分解 $N=p_1^{\alpha_1}p_2^{\alpha_2}\cdots p_n^{\alpha_n}$ 满足 $\sum_{i=1}^{n}\dfrac{\alpha_i}{p_i}<1-\dfrac{1}{p\ln p}$。`,
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

if (toInsert.length > 0) {
  const res = await col.insertMany(toInsert);
  console.log(`✅ 已插入 ${res.insertedCount} 题`);
  for (const d of toInsert) console.log(`   ${d.id}  diff=${d.difficulty}  ans=${JSON.stringify(d.ans)}  FS=${d.FS}  tags=${d.tags.join('/')}`);
}

const total = await col.countDocuments({ id: /^CHSMLHJX/ });
console.log(`\n库中 CHSMLHJX* 总数: ${total}`);

await client.close();
