#!/usr/bin/env node
// tools/extract-css.mjs
//
// 把页面内联的 <style> 抽成独立 CSS 文件，使其可被 immutable 缓存。
//
// 用法：
//   node tools/extract-css.mjs --check
//   node tools/extract-css.mjs --only user.html,ranklist.html
//   node tools/extract-css.mjs --min-lines 10
//   node tools/extract-css.mjs
//
// 输出：assets/css/pages/<slug>.css（与 assets/js/pages/ 结构对称，避免与
//       已有的 styles.css / pd.css / problems.css 等 7 个共享样式重名冲突）
//
// 一个页面有多个 <style> 块时合并到同一个文件，保持原有先后顺序。
// <link> 插在第一个 <style> 原来的位置，保证样式优先级与抽离前一致。
//
// 幂等：已抽过（页面里已有 assets/css/pages/ 引用）的不会再动。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);

const CHECK = process.argv.includes('--check');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1].split(',').map(s => s.trim()).filter(Boolean) : null;
const minIdx = process.argv.indexOf('--min-lines');
const MIN_LINES = minIdx >= 0 ? Number(process.argv[minIdx + 1]) : 10;

const OUT_DIR = path.join(ROOT, 'assets', 'css', 'pages');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

function slugOf(relPath) {
  return relPath
    .replace(/\\/g, '/')
    .replace(/\.html$/i, '')
    .replace(/\[|\]/g, '')
    .replace(/\//g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

let totalPages = 0, totalBlocks = 0, totalKB = 0;

for (const file of walk(ROOT).sort()) {
  const relPath = path.relative(ROOT, file).replace(/\\/g, '/');
  if (ONLY && !ONLY.some(o => relPath.endsWith(o))) continue;

  const original = fs.readFileSync(file, 'utf8');
  if (original.includes('/assets/css/pages/')) continue;   // 已抽离

  const blocks = [...original.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  if (blocks.length === 0) continue;

  const combined = blocks.map(b => b[1]).join('\n');
  const lines = combined.split('\n').length;
  if (lines < MIN_LINES) continue;

  const slug = slugOf(relPath);
  const outName = `${slug}.css`;
  const url = `/assets/css/pages/${outName}`;

  // 构造新 HTML：第一个 <style> 替换成 <link>，其余 <style> 删除
  let first = true;
  let text = original.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, () => {
    if (first) { first = false; return `<link rel="stylesheet" href="${url}" />`; }
    return '';
  });

  const changed = text !== original;
  if (!changed) continue;

  totalPages++; totalBlocks += blocks.length;
  totalKB += Buffer.byteLength(combined, 'utf8') / 1024;

  if (!CHECK) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, outName), combined.replace(/^\n+/, ''), 'utf8');
    fs.writeFileSync(file, text, 'utf8');
  }
  console.log(`  ${CHECK ? '[待抽]' : '✓'} ${relPath.padEnd(28)} ${blocks.length} 块 / ${lines} 行 -> ${outName}`);
}

console.log(`\n${CHECK ? '将抽离' : '已抽离'} ${totalBlocks} 个 style 块 / ${totalPages} 个页面 / ${totalKB.toFixed(1)} KB`);
console.log(`输出目录: assets/css/pages/`);
console.log(`\n下一步:  npm run version:assets\n`);
