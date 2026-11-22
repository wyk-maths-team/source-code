#!/usr/bin/env node
// tools/migrate-escape.mjs
//
// 把各页面自己实现的 escapeHtml / esc 换成 core/ui.js 的 DSHUI.esc。
// 只替换函数定义，调用点一个不动（全站 200+ 次调用）。
//
// 用法：
//   node tools/migrate-escape.mjs --check
//   node tools/migrate-escape.mjs --only charts.html,calendar.html
//   node tools/migrate-escape.mjs
//
// 统一为 5 字符转义（& < > " '），顺带修掉只转 3 字符的 XSS 隐患。
// DSHUI 未加载时回退内联实现，单独打开页面也不会坏。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);
const CHECK = process.argv.includes('--check');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1].split(',').map(s => s.trim()).filter(Boolean) : null;

// 注意：必须把「取函数」和「调用」分开写清楚。
// 错误写法 return (A) || function(s){...}  返回的是函数对象本身，
// 于是 `${escapeHtml(x)}` 会把函数源码 toString 进 HTML（真实踩过的线上事故）。
const FALLBACK = String.raw`((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s)`;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

// 多行形态：非贪婪匹配到「行尾的 }」，并要求函数体里出现转义特征
const RE_FN = /(?:^|\n)([ \t]*)function\s+(esc|escapeHtml)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n[ \t]*\}[ \t]*(?=\r?\n|$)/g;
// 单行形态：function escapeHtml(s) { ... }   （函数体可能含 {} 如 ({...})[m]）
const RE_FN_ONELINE = /(?:^|\n)([ \t]*)function\s+(esc|escapeHtml)\s*\(([^)]*)\)\s*\{([^\n]*)\}[ \t]*(?=\r?\n|$)/g;

function hasEscapeTrait(body) {
  return (/&amp;|&lt;|&gt;/.test(body)) && body.length < 900;
}

function migrate(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const original = fs.readFileSync(file, 'utf8');
  let text = original;
  const notes = [];

  const replaceFn = (m, indent, name, params, body) => {
    // 幂等：已经是 DSHUI 版本的直接跳过。没有这一步，二次运行会让多行正则
    // 跨过这个单行函数、继续匹配到下一个函数的行尾 }，从而吞掉中间代码。
    if (/DSHUI/.test(body)) return m;
    if (!hasEscapeTrait(body)) { notes.push(`${name}: 看起来不是转义函数，跳过`); return m; }
    // 保险：转义函数体里不该出现别的 function 定义
    if (/function\s+\w+\s*\(/.test(body)) { notes.push(`${name}: 函数体内含其他 function，跳过`); return m; }
    notes.push(`${name}: 已统一`);
    return `\n${indent}function ${name}(s) { return ${FALLBACK} }`;
  };

  text = text.replace(RE_FN_ONELINE, replaceFn);   // 先处理单行
  text = text.replace(RE_FN, replaceFn);           // 再处理多行

  const changed = text !== original;
  if (changed && !CHECK) fs.writeFileSync(file, text, 'utf8');
  return { rel, changed, notes };
}

const files = walk(ROOT).filter(f => {
  if (!ONLY) return true;
  const norm = f.replace(/\\/g, '/');
  return ONLY.some(o => norm.endsWith(o));
});
const results = [];
for (const f of files.sort()) results.push(migrate(f));

const changed = results.filter(r => r.changed);
for (const r of changed) console.log(`  ${CHECK ? '[待改]' : '✓'} ${r.rel}  ${r.notes.join('; ')}`);
const skipped = results.filter(r => r.notes.some(n => n.includes('跳过')));
for (const r of skipped) console.log(`  [跳过] ${r.rel}  ${r.notes.join('; ')}`);

console.log(`\n${CHECK ? '需要修改' : '已修改'} ${changed.length} 个页面 / 检查了 ${files.length} 个`);
