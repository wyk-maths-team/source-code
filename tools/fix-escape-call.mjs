#!/usr/bin/env node
// tools/fix-escape-call.mjs —— 一次性修复：escapeHtml 返回函数对象而非调用结果
//
// 错误形态（migrate-escape.mjs 旧版生成）：
//   function esc(s) { return (window.DSHUI && DSHUI.esc) || function (s) {...}; }
//   这返回的是「函数本身」，于是 `${esc(x)}` 把函数源码 toString 进了 HTML。
//
// 正确形态：
//   function esc(s) { return ((...) || function (s) {...})(s); }

import fs from 'node:fs';
import path from 'node:path';

const DIRS = ['C:/moj/assets/js/pages', 'C:/moj/assets/js', 'C:/moj/lib'];

const MARK = '(window.DSHUI && window.DSHUI.esc) || function';
const GOOD = `function NAME(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }`;

let fixedFiles = 0, fixedLines = 0;

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(js|html)$/i.test(name)) continue;
    const p = path.join(dir, name);
    if (!fs.statSync(p).isFile()) continue;

    const src = fs.readFileSync(p, 'utf8');
    if (!src.includes(MARK)) continue;

    const lines = src.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(MARK)) continue;
      const m = lines[i].match(/^(\s*)function\s+(esc|escapeHtml)\s*\(\s*s\s*\)/);
      if (!m) continue;
      // 已经是正确形态（结尾有 })(s)）就跳过
      if (/\)\(\s*s\s*\)\s*;\s*\}\s*$/.test(lines[i])) continue;
      lines[i] = m[1] + GOOD.replace('NAME', m[2]);
      changed = true;
      fixedLines++;
    }
    if (changed) {
      fs.writeFileSync(p, lines.join('\n'), 'utf8');
      fixedFiles++;
      console.log(`  修复 ${path.relative('C:/moj', p).replace(/\\/g, '/')}`);
    }
  }
}

console.log(`\n共修复 ${fixedLines} 处 / ${fixedFiles} 个文件`);
