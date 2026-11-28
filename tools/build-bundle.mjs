// tools/build-bundle.mjs
//
//   node tools/build-bundle.mjs            # 生成两个 bundle
//   node tools/build-bundle.mjs --check    # 只报告是否最新
//
// 核心脚本分成两段，不能合成一个 —— 这是执行时机的要求，不是分类习惯：
//
//   <head> 里 13 个：arch-render, ui, net, ban-guard, latex-doc, status,
//                    script-panel, api, padstore, radial-menu, ban-screen,
//                    ban-index, page
//                    这些是基础设施，不碰 DOM，在 body 解析前跑没问题。
//
//   <body> 里 8 个：  auth, app, topbar, sidebar, polling, heartbeat,
//                    pk-invite, pk-notify
//                    app.js 的 initApp() 直接读 document.body.classList，
//                    topbar/sidebar 也都是往 DOM 里填内容 —— 它们必须在
//                    body 存在之后执行。
//
// 早先试图把 21 个合成一个塞进 head，结果后 8 个提前执行，initApp 在
// document.body 上抛错，它后面的 topbar/sidebar 初始化全被跳过：
// 页面看起来加载完了，顶栏和侧栏却是空的。
//
// 所以生成两个包，各自留在原来的位置。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkBundleLists } from './check-bundle-lists.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const JS_DIR = path.join(ROOT, 'assets', 'js');
const LOADER = path.join(JS_DIR, 'bundle-loader.js');

const PARTS = {
  head: [
    'arch-render.js',
    'core/ui.js', 'core/net.js', 'core/ban-guard.js', 'core/latex-doc.js',
    'core/status-badge.js', 'core/script-panel.js', 'core/api.js', 'core/padstore.js', 'core/img.js',
    'core/radial-menu.js', 'core/ban-screen.js', 'core/ban-index.js', 'core/page.js',
  ],
  body: [
    'auth.js', 'app.js', 'topbar.js', 'sidebar.js',
    'core/polling.js', 'heartbeat.js', 'pk-invite-widget.js', 'pk-notify.js',
  ],
};

/** 去掉行尾空白与纯空行，其余原样保留（不做注释剥离，见下方说明） */
function tidy(src) {
  return src.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0).join('\n');
}

// ══════════ 组装 ══════════
//
// 不做去注释。试过：topbar.js 的模板字符串里嵌着 HTML，手写状态机跟不了
// 嵌套的 ${...}，生成的包直接语法错误。而 brotli 本来就会吃掉注释，
// 合并的价值是「减少请求数」，不是「减少字节」。
// bundle-loader.js 里有第二份文件列表（useBundle=false 时走它）。
// 加文件只改一边，默认用户就会 ReferenceError —— core/img.js 就这么炸过。
const listProblems = checkBundleLists();
if (listProblems.length) {
  console.error('[bundle] bundle-loader.js 和 PARTS 对不上：');
  listProblems.forEach((x) => console.error('  - ' + x));
  process.exit(1);
}

const outputs = {};
for (const [part, files] of Object.entries(PARTS)) {
  const chunks = [];
  let raw = 0;
  for (const rel of files) {
    const f = path.join(JS_DIR, rel);
    if (!fs.existsSync(f)) { console.error(`缺文件: ${rel}`); process.exit(1); }
    const src = fs.readFileSync(f, 'utf8');
    raw += Buffer.byteLength(src);
    chunks.push(`/* ${rel} */\n${tidy(src)}`);
  }
  const banner = `/* moj core bundle [${part}] · ${files.length} files
 * 位置是语义的：head 段不碰 DOM，body 段必须在 <body> 之后执行。
 * 由 tools/build-bundle.mjs 生成，勿手改。
 * 关闭方式：localStorage.removeItem('moj:perf:bundle') */\n`;
  const text = banner + chunks.join('\n;\n') + '\n';
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
  outputs[part] = { text, hash, raw, bytes: Buffer.byteLength(text), files: files.length };
}

for (const [part, o] of Object.entries(outputs)) {
  console.log(`[${part}] ${o.files} 个文件，原始 ${(o.raw / 1024).toFixed(1)}KB -> ${(o.bytes / 1024).toFixed(1)}KB`);
}

// ══════════ 写文件（文件名带内容哈希）══════════
//
// vercel.json 给 *.js 配的是 immutable 一年缓存，文件名不变就永远拿旧的。
const wanted = {};
for (const [part, o] of Object.entries(outputs)) wanted[part] = `bundle.${part}.${o.hash}.js`;

if (CHECK_ONLY) {
  let stale = false;
  for (const [part, name] of Object.entries(wanted)) {
    const exists = fs.existsSync(path.join(JS_DIR, name));
    console.log(`  ${part}: ${name} ${exists ? "已存在" : "缺失"}`);
    if (!exists) stale = true;
  }
  process.exit(stale ? 1 : 0);
}

for (const [part, name] of Object.entries(wanted)) {
  fs.writeFileSync(path.join(JS_DIR, name), outputs[part].text, 'utf8');
}
// 清掉旧版本（保留本轮的）
const keep = new Set(Object.values(wanted));
for (const f of fs.readdirSync(JS_DIR)) {
  if (/^bundle\.(head|body)\.[0-9a-f]{10}\.js$/.test(f) && !keep.has(f)) {
    fs.unlinkSync(path.join(JS_DIR, f));
    console.log(`删除旧包: ${f}`);
  }
  // 早先的单体 bundle.<hash>.js 也清掉
  if (/^bundle\.[0-9a-f]{10}\.js$/.test(f)) {
    fs.unlinkSync(path.join(JS_DIR, f));
    console.log(`删除旧单体包: ${f}`);
  }
}

// ══════════ 更新 loader ══════════
let loader = fs.readFileSync(LOADER, 'utf8');
const patched = loader
  .replace(/var BUNDLE_HEAD = '[^']*';/, `var BUNDLE_HEAD = '${wanted.head}';`)
  .replace(/var BUNDLE_BODY = '[^']*';/, `var BUNDLE_BODY = '${wanted.body}';`);
if (patched !== loader) {
  fs.writeFileSync(LOADER, patched, 'utf8');
  console.log(`loader 指向 ${wanted.head} + ${wanted.body}`);
} else {
  console.log('loader 未变化');
}
