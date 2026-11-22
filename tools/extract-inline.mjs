#!/usr/bin/env node
// tools/extract-inline.mjs
//
// 把页面里内联的 <script> 抽成独立文件，让它们能被 immutable 缓存。
//
// 用法：
//   node tools/extract-inline.mjs --check              # 只报告
//   node tools/extract-inline.mjs --only admin.html   # 只处理某些页面
//   node tools/extract-inline.mjs --min-lines 15      # 改阈值（默认 15 行）
//   node tools/extract-inline.mjs --relative          # 用相对路径而非绝对路径
//   node tools/extract-inline.mjs                     # 全量执行
//
// 保留不抽的三类：
//   1. window.__BUILD_V 注入        —— 由 version-assets 管理，必须内联
//   2. 主题防闪白脚本               —— 在 <head> 里同步执行，抽成外部文件会多一次
//                                      网络等待，首屏反而更容易闪白
//   3. 行数小于阈值的碎片脚本       —— 抽出去省不了多少，却多一个请求
//
// 路径：默认用绝对路径 /assets/js/pages/xxx.js。
//   绝对路径与页面所在层级无关，根目录、admin/、problems/ 下都一样正确，
//   不需要 ../ 逃离——而且 URL 被 vercel.json rewrite 改写后也不会算错基准。
//
// 输出：assets/js/pages/<slug>.js（同一页面多个块时依次 -2、-3）
// 幂等：已抽过（页面里已有 assets/js/pages/ 引用）的块不会再动。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);

const CHECK = process.argv.includes('--check');
const RELATIVE = process.argv.includes('--relative');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1].split(',').map(s => s.trim()).filter(Boolean) : null;
const minIdx = process.argv.indexOf('--min-lines');
const MIN_LINES = minIdx >= 0 ? Number(process.argv[minIdx + 1]) : 15;

const OUT_DIR = path.join(ROOT, 'assets', 'js', 'pages');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** admin/users.html -> admin-users ; problems/[id].html -> problems-id */
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

const SKIP_SIGNS = [
  { re: /__BUILD_V/, why: 'BUILD_V 注入（version-assets 管理）' },
];

// 主题防闪白脚本：在 <head> 里同步执行的小片段，抽成外部文件会多一次网络等待，
// 首屏反而更容易闪白。用「含 theme + 很短」双条件识别——
// 不能只看含不含 theme，否则 settings 这类专门管理主题的大业务脚本会被误杀。
const THEME_RE = /localStorage\.getItem\(\s*['"]theme['"]\s*\)/;
const THEME_MAX_LINES = 30;

/** 相对路径：从页面所在目录到 assets/js/pages 的距离 */
function relPrefix(relPath) {
  const depth = relPath.split('/').length - 1;
  return depth === 0 ? '' : '../'.repeat(depth);
}

function processPage(file, existingNames) {
  const relPath = path.relative(ROOT, file).replace(/\\/g, '/');
  const original = fs.readFileSync(file, 'utf8');
  let text = original;
  const slug = slugOf(relPath);
  const notes = [];
  const writes = [];
  let idx = 0;

  // 逐个内联块处理（用函数式 replace 保证位置正确）
  text = text.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi, (whole, attrs, code) => {
    // 幂等：如果这个块其实是外部引用（不会命中，但保险）
    if (/\bsrc=/.test(attrs)) return whole;

    const trimmed = code.trim();
    if (!trimmed) return whole;

    const lines = code.split('\n').length;
    for (const s of SKIP_SIGNS) {
      if (s.re.test(code)) { notes.push(`保留：${s.why}`); return whole; }
    }
    if (/type\s*=\s*["']module["']/.test(attrs)) { notes.push('保留：type=module'); return whole; }
    if (THEME_RE.test(code) && lines <= THEME_MAX_LINES) { notes.push('保留：主题防闪白脚本'); return whole; }

    if (lines < MIN_LINES) { notes.push(`保留：仅 ${lines} 行（< ${MIN_LINES}）`); return whole; }

    idx++;
    const name = idx === 1 ? `${slug}.js` : `${slug}-${idx}.js`;
    const outName = existingNames.has(name) ? `${slug}-${Date.now().toString(36)}-${idx}.js` : name;
    existingNames.add(outName);

    const url = RELATIVE
      ? `/${relPrefix(relPath)}assets/js/pages/${outName}`.replace(/^\/\.\//, '')
      : `/assets/js/pages/${outName}`;

    // 内容原样写出（不包 IIFE，保持全局作用域；不加 defer，保持同步执行顺序）
    writes.push({ name: outName, content: code.replace(/^\n/, '') });
    notes.push(`抽出 ${lines} 行 -> ${outName}`);
    return `<script src="${url}"></script>`;
  });

  const changed = text !== original;
  if (changed && !CHECK) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const w of writes) fs.writeFileSync(path.join(OUT_DIR, w.name), w.content, 'utf8');
    fs.writeFileSync(file, text, 'utf8');
  }
  return { relPath, changed, notes, count: writes.length, slug };
}

// ── 主流程 ──
const files = walk(ROOT).filter(f => {
  if (!ONLY) return true;
  const norm = f.replace(/\\/g, '/');
  return ONLY.some(o => norm.endsWith(o));
});

const existingNames = new Set();
let totalPages = 0, totalBlocks = 0, totalLines = 0;

for (const f of files.sort()) {
  const r = processPage(f, existingNames);
  if (r.count > 0) {
    totalPages++; totalBlocks += r.count;
    const lines = r.notes.filter(n => n.startsWith('抽出')).reduce((a, n) => a + Number(n.match(/(\d+) 行/)?.[1] || 0), 0);
    totalLines += lines;
    console.log(`  ${CHECK ? '[待抽]' : '✓'} ${r.relPath.padEnd(30)} ${r.count} 块 / ${lines} 行`);
  }
}

console.log(`\n${CHECK ? '将抽离' : '已抽离'} ${totalBlocks} 个脚本 / ${totalPages} 个页面 / 共 ${totalLines} 行`);
console.log(`输出目录: assets/js/pages/`);
console.log(`\n下一步:  npm run version:assets   （给新文件加上 ?v= 版本号）\n`);
