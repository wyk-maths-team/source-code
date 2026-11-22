#!/usr/bin/env node
// tools/add-view-transition.mjs
//
// 给所有页面启用跨文档 View Transitions：
//   浏览器会在跳转时保留「旧页面的快照」，直到新页面首帧就绪才交叉淡化过去。
//   这正好消除白屏/黑屏——用户看到的不是加载中的空白，而是上一页面的样子。
//
// 用法：
//   node tools/add-view-transition.mjs --check
//   node tools/add-view-transition.mjs
//
// 幂等：已有 meta 的页面跳过。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);
const CHECK = process.argv.includes('--check');

const META = '<meta name="view-transition" content="same-origin" />';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

let done = 0, skipped = 0, failed = [];

for (const f of walk(ROOT).sort()) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const raw = fs.readFileSync(f, 'utf8');

  if (raw.includes('name="view-transition"')) { skipped++; continue; }

  // 插在 <head> 之后（尽量靠前，确保浏览器在导航前读到）
  const m = raw.match(/<head[^>]*>/i);
  if (!m) { failed.push(rel + '（无 <head>）'); continue; }

  const at = m.index + m[0].length;
  const next = raw.slice(0, at) + '\n' + META + raw.slice(at);
  if (!CHECK) fs.writeFileSync(f, next, 'utf8');
  done++;
}

console.log(`\n${CHECK ? '需要添加' : '已添加'} ${done} 个页面，跳过 ${skipped} 个（已有）`);
if (failed.length) console.log('失败:', failed.join(', '));
console.log('');
