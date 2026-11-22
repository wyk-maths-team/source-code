#!/usr/bin/env node
// tools/analyze-problems.mjs —— 分析导出题库的结构特征
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('C:/moj/private/problems-export.json', 'utf8'));
console.log(`总题数: ${data.length}\n`);

// difficulty 分布
const diffs = data.map(d => d.difficulty).filter(d => typeof d === 'number');
const sorted = [...diffs].sort((a, b) => a - b);
const pct = (p) => sorted[Math.floor(sorted.length * p)];
console.log('difficulty 分布:');
console.log(`  min=${sorted[0]}  p25=${pct(.25)}  median=${pct(.5)}  p75=${pct(.75)}  max=${sorted[sorted.length-1]}`);
console.log(`  均值=${(diffs.reduce((a,b)=>a+b,0)/diffs.length).toFixed(2)}`);
const buckets = {};
for (const d of diffs) {
  const b = d < 2 ? '0-2' : d < 4 ? '2-4' : d < 6 ? '4-6' : d < 8 ? '6-8' : '8+';
  buckets[b] = (buckets[b] || 0) + 1;
}
for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(5)} ${v} 题`);

// ans 形态：纯数字 / 短表达式 / 长文本
let numeric = 0, short = 0, long_ = 0, empty = 0;
const samples = { numeric: [], short: [], long: [] };
for (const d of data) {
  const a = d.ans;
  if (a === undefined || a === null || String(a).trim() === '') { empty++; continue; }
  const s = String(a).trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) { numeric++; if (samples.numeric.length < 5) samples.numeric.push(s); }
  else if (s.length <= 20) { short++; if (samples.short.length < 8) samples.short.push(s); }
  else { long_++; if (samples.long.length < 3) samples.long.push(s.slice(0, 70)); }
}
console.log('\nans 形态:');
console.log(`  纯数字     ${numeric}`);
console.log(`  短答案(≤20) ${short}`);
console.log(`  长答案(>20) ${long_}`);
console.log(`  空         ${empty}`);
console.log(`  数字样例: ${samples.numeric.join(', ')}`);
console.log(`  短答案样例: ${samples.short.join(' | ')}`);
console.log(`  长答案样例: ${samples.long.join('\n              ')}`);

// statement 长度
const lens = data.map(d => String(d.statement || '').length).sort((a, b) => a - b);
console.log('\nstatement 长度:');
console.log(`  min=${lens[0]}  median=${lens[Math.floor(lens.length/2)]}  max=${lens[lens.length-1]}`);

// logic 字段（自定义判题脚本）
const withLogic = data.filter(d => d.logic && String(d.logic).trim()).length;
console.log(`\n含自定义判题脚本(logic): ${withLogic} 题`);

// tags
const tagCount = {};
for (const d of data) for (const t of (d.tags || [])) tagCount[t] = (tagCount[t] || 0) + 1;
const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('\n高频标签:');
console.log('  ' + topTags.map(([t, n]) => `${t}(${n})`).join('  '));
