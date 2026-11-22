#!/usr/bin/env node
// tools/analyze-css-dup.mjs —— 检查跨页面重复选择器的声明是否一致
//
// 只有「选择器重复 + 声明完全一致」的规则才能安全合并到公共文件。
// 声明不一致的必须留在各页面，否则合并会改变外观。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/moj';
const SKIP = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** 从 CSS 文本里抽出 { 选择器: [声明块...] }（同一个选择器可能出现多次，合并） */
function parseRules(css) {
  const map = new Map();
  // 粗略但够用：selector { body }，跳过 @media 内部（先整体忽略）
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2].trim().replace(/\s+/g, ' ');
    if (!sel || !body) continue;
    if (!map.has(sel)) map.set(sel, []);
    map.get(sel).push(body);
  }
  return map;
}

const pages = walk(ROOT).sort();
// sel -> Map(页面 -> 声明)
const all = new Map();

for (const f of pages) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const t = fs.readFileSync(f, 'utf8');
  let css = '';
  for (const m of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += '\n' + m[1];
  if (!css.trim()) continue;
  const rules = parseRules(css);
  for (const [sel, bodies] of rules) {
    if (!all.has(sel)) all.set(sel, new Map());
    all.get(sel).set(rel, bodies.join(' '));
  }
}

// 按覆盖页数排序
const rows = [...all.entries()]
  .map(([sel, m]) => {
    const decl = [...new Set(m.values())];
    return { sel, pages: m.size, distinct: decl.length, sample: decl[0].slice(0, 80) };
  })
  .filter(r => r.pages >= 3)
  .sort((a, b) => b.pages - a.pages);

const consistent = rows.filter(r => r.distinct === 1);
const conflict = rows.filter(r => r.distinct > 1);

console.log(`\n覆盖 >=3 个页面的选择器: ${rows.length} 个`);
console.log(`  ├─ 声明完全一致（可安全合并）: ${consistent.length} 个`);
console.log(`  └─ 声明存在冲突（不能合并）  : ${conflict.length} 个\n`);

console.log('=== 可安全合并的（按页数） ===');
for (const r of consistent.slice(0, 30)) {
  console.log(`  ${r.sel.padEnd(34)} ${String(r.pages).padStart(2)} 页   ${r.sample}`);
}

console.log('\n=== 声明冲突的（必须留在各自页面） ===');
for (const r of conflict.slice(0, 15)) {
  console.log(`  ${r.sel.padEnd(34)} ${String(r.pages).padStart(2)} 页   ${r.distinct} 种写法`);
}
