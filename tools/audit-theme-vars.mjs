#!/usr/bin/env node
/**
 * tools/audit-theme-vars.mjs
 *
 * 检查每个样式文件（含 HTML 内联 <style>）里声明的 CSS 变量，
 * 找出「dark 有值、scifi 没值」的情况——这是目前主题崩坏的统一成因：
 * 页面自己抄了一份变量块，加了 dark 却忘了 scifi，于是该主题下
 * var(--x) 解析成无效值。
 *
 * 用法：
 *   node tools/audit-theme-vars.mjs          # 报告
 *   node tools/audit-theme-vars.mjs --fix    # 自动补 scifi（仅在文件已有 scifi 块时补；否则报告）
 *
 * 只报告，不做语义判断——补什么值需要人来看。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.(html|css)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 从一段 CSS 文本中提取「作用域 → 变量集合」。
 * 识别三种写法：
 *   :root { ... }
 *   :root[data-theme="dark"] { ... }
 *   [data-theme="dark"] { ... }
 */
function collectVars(css) {
  const scopes = { base: new Set(), dark: new Set(), scifi: new Set() };

  // 逐个匹配选择器 + 块体（用括号配对，容忍 @media 嵌套）
  const re = /(:root\s*\[data-theme=["']?(dark|scifi)["']?\]|\[data-theme=["']?(dark|scifi)["']?\]|:root)\s*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const selector = m[1];
    const theme = m[2] || m[3];
    const start = re.lastIndex;
    // 括号配对找块尾
    let depth = 1, i = start;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    const body = css.slice(start, i - 1);

    const vars = new Set();
    for (const v of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) vars.add(v[1]);

    if (theme === 'dark') vars.forEach(v => scopes.dark.add(v));
    else if (theme === 'scifi') vars.forEach(v => scopes.scifi.add(v));
    else vars.forEach(v => scopes.base.add(v));
  }
  return scopes;
}

const rows = [];

for (const file of walk(ROOT).sort()) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const text = fs.readFileSync(file, 'utf8');

  let css = '';
  if (file.endsWith('.css')) {
    css = text;
  } else {
    for (const b of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += b[1] + '\n';
  }
  if (!css.trim()) continue;

  const scopes = collectVars(css);
  const total = scopes.base.size + scopes.dark.size + scopes.scifi.size;
  if (total === 0) continue;

  // dark 声明了但 scifi 没有 —— 这就是会崩的那批
  const missingInScifi = [...scopes.dark].filter(v => !scopes.scifi.has(v));
  // base 有、dark 也有、scifi 漏了，属于同类问题
  const baseButNoScifi = [...scopes.base].filter(v => !scopes.scifi.has(v) && scopes.dark.has(v));

  if (missingInScifi.length > 0) {
    rows.push({
      file: rel,
      hasScifiBlock: scopes.scifi.size > 0,
      baseCount: scopes.base.size,
      darkCount: scopes.dark.size,
      scifiCount: scopes.scifi.size,
      missing: missingInScifi,
    });
  }
}

if (rows.length === 0) {
  console.log('\n没有发现「dark 有、scifi 无」的变量。\n');
  process.exit(0);
}

console.log(`\n发现 ${rows.length} 个文件存在缺失 scifi 取值的变量：\n`);
for (const r of rows) {
  const flag = r.hasScifiBlock ? '部分覆盖' : '完全缺 scifi 块';
  console.log(`  ${r.file}  [${flag}]  base=${r.baseCount} dark=${r.darkCount} scifi=${r.scifiCount}`);
  console.log(`    缺 ${r.missing.length} 个: ${r.missing.join(' ')}`);
}

const tally = {};
for (const r of rows) for (const v of r.missing) tally[v] = (tally[v] || 0) + 1;
const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log('\n最常缺的变量：');
for (const [v, n] of top) console.log(`  ${v}  (${n} 个文件)`);
console.log('');
