// tools/audit-chsmlh.mjs —— 校验所有已入库的 CHSMLH* 预赛题
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

const PROV = {
  BJ: '北京', SH: '上海', SC: '四川', HB: '湖北', XJ: '新疆', JS: '江苏',
  GZH: '广州', GX: '广西', ZJ: '浙江', NMG: '内蒙古', SD: '山东', FJ: '福建',
  JX: '江西', GZ: '贵州', CQ: '重庆', GD: '广东', GS: '甘肃', JL: '吉林',
  HN: '湖南', YN: '云南', CZ: '广州',
};

const MAIN_TAGS = ['Algebra', 'Geometry', 'NumberTheory', 'Combinatorics'];

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('problems');

const docs = await col.find({ id: /^CHSMLH/ }, {
  projection: { id: 1, name: 1, ans: 1, difficulty: 1, FS: 1, tags: 1, statement: 1, public: 1, _id: 0 },
}).sort({ id: 1 }).toArray();

console.log(`CHSMLH* 总数: ${docs.length}\n`);

// 按省份前缀分组
const byProv = new Map();
for (const d of docs) {
  const m = d.id.match(/^CHSMLH([A-Z]+?)(\d{2})$/);
  const code = m ? m[1] : '??';
  if (!byProv.has(code)) byProv.set(code, []);
  byProv.get(code).push(d);
}

const issues = [];

for (const [code, list] of [...byProv.entries()].sort()) {
  const name = PROV[code] || '未知';
  const diffs = list.map(d => d.difficulty);
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const empty = list.filter(d => d.ans === '' || d.ans === null).length;
  const fsCount = list.filter(d => d.FS === true).length;
  const pubCount = list.filter(d => d.public === true).length;
  console.log(`${code.padEnd(4)} ${(name).padEnd(5)} ${String(list.length).padStart(2)} 题  ` +
    `难度 ${Math.min(...diffs).toFixed(2)}–${Math.max(...diffs).toFixed(2)} (均 ${avg.toFixed(2)})  ` +
    `空答案 ${empty}  FS=${fsCount}` + (pubCount ? `  public=${pubCount}` : ''));

  // 校验
  for (const d of list) {
    if (!MAIN_TAGS.some(t => (d.tags || []).includes(t))) issues.push(`${d.id}: 缺主标签`);
    if (!(d.tags || []).includes('CHSML')) issues.push(`${d.id}: 缺 CHSML 标签`);
    // public 是管理员手动控制的开关，公开若干题是正常操作，不算校验失败。
    // 只在最后汇总里统计数量，供核对。故意设 public=true 的题会被跳过。
    if (typeof d.difficulty !== 'number' || d.difficulty < 0 || d.difficulty > 10) issues.push(`${d.id}: 难度异常 ${d.difficulty}`);
    // 题干可以完全没有数学符号（纯文字应用题），此时不需要 LaTeX，不算问题。
    // 只在「题干里出现了数学迹象却不是 $...$ 形式」时才提示。
    if (!d.statement || d.statement.length === 0) {
      issues.push(`${d.id}: 题面为空`);
    } else if (!d.statement.includes('$') && /\d+\s*[+\-*/=<>]|\\frac|\^|√/.test(d.statement)) {
      issues.push(`${d.id}: 题面含数学符号但未用 LaTeX`);
    }
    if (d.FS === true && d.ans !== '') {
      // 允许：非纯数字答案（区间/复数/集合/文字）配 FS=true 是正确用法。
      // 但纯数字配 FS=true 说明本该自动判题却被强制分步，属可疑。
      if (/^-?\d+(\.\d+)?$/.test(String(d.ans))) {
        issues.push(`${d.id}: 纯数字答案却 FS=true（"${d.ans}"）`);
      }
    }
    if (d.FS === false && d.ans === '') issues.push(`${d.id}: FS=false 但 ans 为空`);
    if (d.ans !== '' && d.ans !== null) {
      const s = String(d.ans);
      if (/^-?\d+\.\d{7,}$/.test(s)) issues.push(`${d.id}: 小数超过 6 位 "${s}"`);
      // 解集/区间的答案天然很长（如「x=kπ±π/12，…」），放宽到 200
      if (s.length > 200) issues.push(`${d.id}: ans 过长（${s.length} 字符）`);
      // 非纯数字答案必须强制分步作答
      if (!/^-?\d+(\.\d+)?$/.test(s) && d.FS !== true) {
        issues.push(`${d.id}: 非数字答案 "${s}" 但 FS 未设 true`);
      }
    }
  }
}

console.log('');
if (issues.length === 0) {
  console.log('✅ 全部校验通过');
} else {
  console.log(`⚠️ ${issues.length} 处问题：`);
  for (const s of issues) console.log('  ' + s);
}

// 重复 id
const dup = docs.map(d => d.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length) console.log('\n重复 id:', [...new Set(dup)].join(', '));

await client.close();
