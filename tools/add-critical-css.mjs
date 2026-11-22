#!/usr/bin/env node
// tools/add-critical-css.mjs
//
// 把「首帧就必须正确」的样式内联到 head：
//   1) 背景色 —— 防止暗色模式白闪
//   2) 外壳布局 —— 防止 CSS 外链加载前，fixed 的顶栏/侧栏退化成文档流里的裸块，
//      加载完成后再跳回原位（表现为「向上抖一下再复位」）
//
// 只内联定位、尺寸与背景，颜色与细节全部交给 styles.css 接管。
//
// 幂等：已插入则替换旧内容。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);
const CHECK = process.argv.includes('--check');

// 数值必须与 styles.css 的 :root 保持一致（当前 --topbar-height: 60px / --sidebar-width: 250px）
const CRITICAL = [
  '<style id="critical-css">',
  ':root{--topbar-height:60px;--sidebar-width:250px}',
  'html{background:#f0f2f5;color-scheme:light}',
  'html[data-theme="dark"]{background:#0d1117;color-scheme:dark}',
  '.topbar{position:fixed;top:0;left:0;right:0;height:var(--topbar-height);z-index:1000}',
  /* 用 100lvh（地址栏收起时的最大视口高）而不是 bottom:0：
     iOS/Safari 导航时地址栏收起展开，动态视口高度会跳变，底部贴合视口的侧栏
     会跟着变矮，表现为「往上缩一下、底下露白、再弹回来」。
     lvh 是固定值，不受地址栏影响。旧浏览器不支持 lvh 时 height 声明被忽略，
     仍由 styles.css 的 bottom:0 兜底。 */
  '.sidebar{position:fixed;top:var(--topbar-height);left:0;bottom:0;height:calc(100lvh - var(--topbar-height));width:var(--sidebar-width);z-index:900;overflow-y:auto}',
  /* 窄屏侧栏是抽屉，默认收起，避免盖住内容 */
  '@media (max-width:768px){.sidebar{transform:translateX(-100%)}}',
  '</style>',
].join('');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

let done = 0, skipped = 0;

for (const f of walk(ROOT).sort()) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const raw = fs.readFileSync(f, 'utf8');

  // 移除旧的 critical-bg / critical-css
  let next = raw
    .replace(/<style id="critical-bg">[\s\S]*?<\/style>\r?\n?/g, '')
    .replace(/<style id="critical-css">[\s\S]*?<\/style>\r?\n?/g, '');

  const anchor = next.match(/<meta name="view-transition"[^>]*>/i) || next.match(/<head[^>]*>/i);
  if (!anchor) { console.log(`  ✗ ${rel} 无 head`); continue; }
  const at = anchor.index + anchor[0].length;
  next = next.slice(0, at) + '\n' + CRITICAL + next.slice(at);

  if (next === raw) { skipped++; continue; }
  if (!CHECK) fs.writeFileSync(f, next, 'utf8');
  done++;
}

console.log(`\n${CHECK ? '需要更新' : '已更新'} ${done} 个页面，跳过 ${skipped} 个\n`);
