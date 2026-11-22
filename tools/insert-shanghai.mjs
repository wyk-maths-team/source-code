// tools/insert-shanghai.mjs —— 2026 上海高三数学竞赛（无官方答案，全部标 bug）
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

const PROV = '上海';
const P = 'CHSMLHSH';

// 说明：本卷无官方答案，ans 均为独立求解所得（填空题）；解答题/证明题 ans 留空并置 FS。
const items = [
  // ---------- 一、填空题（第 1~4 题 7 分，第 5~8 题 8 分，共 60 分） ----------
  { n: 1, d: 4.5, a: '20.566371', tags: ['Geometry', 'area', 'absolute-value', 'circle'],
    s: String.raw`在平面直角坐标系中，曲线 $(|x|-1)^2+(|y|-1)^2=2$ 围成的封闭图形的面积为 ______。` },
  { n: 2, d: 3.0, a: '2-i', tags: ['Algebra', 'simplification', 'symmetric'],
    s: String.raw`复数 $z_1,z_2,z_3$ 满足 $|z_1|=|z_2|=|z_3|=1$，且 $\dfrac{1}{z_1}+\dfrac{1}{z_2}+\dfrac{1}{z_3}=2+i$，则 $z_1+z_2+z_3=$ ______。` },
  { n: 3, d: 4.5, a: '5.567764', tags: ['Geometry', 'circle', 'trigonometry', 'equation'],
    s: String.raw`在圆内接六边形 $ABCDEF$ 中，$AB=CD=EF=4$，$BC=DE=FA=7$，则其外接圆的半径为 ______。` },
  { n: 4, d: 3.0, a: '252', tags: ['Combinatorics', 'counting', 'digits'],
    s: String.raw`设 $\{a,b,c\}\subseteq\{1,2,\cdots,9\}$，且 $b=3a$。则用 $a,a,b,c$ 能组成 ______ 个不同的四位数。` },
  { n: 5, d: 6.0, a: String.raw`\frac{\sqrt{2(a^2+b^2+c^2)}}{4}`, tags: ['Geometry', 'solid-geometry', 'surds'],
    s: String.raw`已知一个四面体的四个面全等，每个面的三条边长均为 $a,b,c$，则其外接球的半径为 ______。` },
  { n: 6, d: 4.5, a: '7', tags: ['Geometry', 'coordinate-method', 'optimization', 'inequality'],
    s: String.raw`椭圆 $\dfrac{x^2}{16}+\dfrac{y^2}{9}=1$ 的一条切线分别交 $x$ 轴、$y$ 轴正半轴于点 $A,B$，则 $|AB|$ 的最小值为 ______。` },
  { n: 7, d: 3.5, a: '2002', tags: ['Combinatorics', 'counting', 'sequence', 'absolute-value'],
    s: String.raw`在数列 $\{a_n\}$ 中，$a_1=0$，$a_{15}=8$，且对任意 $k=1,2,\cdots,14$，有 $|a_{k+1}-a_k|=2$。则满足要求的数列有 ______ 个。` },
  { n: 8, d: 6.0, a: '-2', tags: ['Algebra', 'polynomial', 'roots', 'coordinate-method'],
    s: String.raw`函数 $f(x)=x^3+ax^2+bx+c$ 与 $x$ 轴的交点从大到小依次为 $A,B,C$。设过 $A,C$ 的切线交 $f(x)$ 的图像分别于另一点 $T_1,T_2$。则线段 $T_1T_2$ 在 $\overrightarrow{AC}$ 上的数量投影与 $|AC|$ 的比值为 ______。` },

  // ---------- 二、解答题（每小题 15 分，共 60 分） ----------
  { n: 9, d: 5.5, a: '', fs: true, tags: ['Algebra', 'trigonometry', 'optimization', 'surds'],
    s: String.raw`求函数 $f(x)=3x+(2x+3)\sqrt{1-x^2}$ 的最小值与最大值。` },
  { n: 10, d: 6.5, a: '', fs: true, tags: ['Geometry', 'coordinate-method', 'angles'],
    s: String.raw`椭圆 $\dfrac{x^2}{8}+\dfrac{y^2}{4}=1$ 的上顶点为 $A$，右焦点为 $F$。设 $P,Q$ 为椭圆上的两个点，满足 $FA$ 平分 $\angle PFQ$。求证：直线 $PQ$ 过定点，并求出该定点的坐标。` },
  { n: 11, d: 7.0, a: '', fs: true, tags: ['Combinatorics', 'counting'],
    s: String.raw`设集合 $A$ 有 $12$ 个元素，$A_1,A_2,\cdots,A_k$ 是 $A$ 的子集，满足 $A_1\cup A_2\cup\cdots\cup A_k=A$，且其中任意 $5$ 个子集的交集非空，任意 $6$ 个子集的交集为空集。求 $k$ 的最大值。` },
  { n: 12, d: 8.0, a: '', fs: true, tags: ['Geometry', 'area', 'inequality', 'length'],
    s: String.raw`在六边形 $ABCDEF$ 中，$\angle A=\angle B=\angle D=\angle E=\angle F=90^\circ$，$\angle C=270^\circ$。设 $AB,BC,CD,DE$ 的长 $a,b,c,d$ 均为正整数。记六边形 $ABCDEF$ 的周长为 $l$，面积为 $S$。
(1) 求证：$l>4\sqrt{S}$；
(2) 若 $a=b$，求 $l-4\sqrt{S}$ 的最小值；
(3) 求证：对任意整数 $n\ge 5$，存在六边形 $ABCDEF$，使得 $l=n\sqrt{S}$。` },
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

// 自检：四大主标签唯一、辅标签数量 1~3、必含 CHSML/bug、FS 与 ans 一致性
const MAINS = new Set(['Algebra', 'Geometry', 'NumberTheory', 'Combinatorics']);
for (const d of docs) {
  const mains = d.tags.filter(t => MAINS.has(t));
  const aux = d.tags.filter(t => !MAINS.has(t) && t !== 'CHSML' && t !== 'bug');
  const bad = [];
  if (mains.length !== 1) bad.push(`mains=${mains.length}`);
  if (aux.length < 1 || aux.length > 3) bad.push(`aux=${aux.length}`);
  if (!d.tags.includes('CHSML')) bad.push('no CHSML');
  if (!d.tags.includes('bug')) bad.push('no bug');
  if (d.FS && d.ans !== '') bad.push('FS with ans');
  if (bad.length) console.error(`⚠️  ${d.id} 标签/FS 异常: ${bad.join(', ')}`);
}
console.log('自检完成，共', docs.length, '题');

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
