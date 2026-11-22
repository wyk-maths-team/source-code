// tools/bundle-pages.mjs —— 把页面里的 21 个核心 script 换成「清单 + loader」
//
//   node tools/bundle-pages.mjs            # 预演
//   node tools/bundle-pages.mjs --apply    # 改写 HTML
//   node tools/bundle-pages.mjs --revert   # 退回
//
// 只动「完整引用全部 21 个核心脚本、且顺序一致」的页面。
//
// ⚠️ 这些 script 标签**不一定连续**：arch-render.js 在 <head> 里，
// 其余 20 个在 <body> 末尾。早先的版本把「第一个到最后一个」整段替换掉，
// 等于删掉了中间的整个页面骨架（index.html 从 27KB 变成 591 字节）。
// 现在逐个标签删除，再在原第一个的位置插入 loader 块。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const CORE = [
  'arch-render.js',
  'core/ui.js', 'core/net.js', 'core/ban-guard.js', 'core/latex-doc.js',
  'core/status.js', 'core/script-panel.js', 'core/api.js', 'core/padstore.js',
  'core/radial-menu.js', 'core/ban-screen.js', 'core/ban-index.js', 'core/page.js',
  'auth.js', 'app.js', 'topbar.js', 'sidebar.js', 'core/polling.js',
  'heartbeat.js', 'pk-invite.js', 'pk-notify.js',
];

const SKIP = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', 'private', 'grader', 'temp', 'dev', 'downloaded_pdfs', 'dse-data', '.dev-cache', 'assets']);
function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) collect(path.join(dir, e.name), out); }
    else if (/\.html$/i.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

const START = '<!-- moj-core:start -->';
const END = '<!-- moj-core:end -->';
const MARK = '__MOJ_CORE_INSERT__';
const built = `\n${START}\n  <script>window.__MOJ_CORE__=${JSON.stringify(CORE)};</script>\n  <script src="/assets/js/bundle-loader.js"></script>\n${END}\n`;

const TAG_RE = /<script[^>]+src=["']\/assets\/js\/([^"']+\.js)[^"']*["'][^>]*><\/script>[ \t]*\r?\n?/gi;

const pages = collect(ROOT);
let converted = 0, skipped = 0, already = 0, reverted = 0, rejected = 0;

for (const file of pages) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let s = fs.readFileSync(file, 'utf8');
  const originalLen = s.length;

  if (REVERT) {
    const re = new RegExp(`\\s*${START}[\\s\\S]*?${END}\\s*`);
    if (!re.test(s)) continue;
    const tags = CORE.map(f => `  <script src="/assets/js/${f}"></script>`).join('\n');
    const out = s.replace(re, '\n' + tags + '\n');
    if (APPLY) fs.writeFileSync(file, out, 'utf8');
    reverted++;
    continue;
  }

  if (s.includes(START)) { already++; continue; }

  // 收集该页的核心 script 标签（按出现顺序）
  const tags = [...s.matchAll(TAG_RE)].filter(m => CORE.includes(m[1]));
  const order = tags.map(m => m[1]);
  if (order.length !== CORE.length) { skipped++; continue; }
  if (order.join('|') !== CORE.join('|')) { skipped++; continue; }

  // 从后往前删，前面的 index 才不会失效；第一个位置留占位符
  let out = s;
  for (let i = tags.length - 1; i >= 0; i--) {
    const m = tags[i];
    const replacement = i === 0 ? MARK : '';
    out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
  }
  out = out.replace(MARK, built.trimStart());

  // 安全阀：合并后必然变短（21 个标签约 900 字节，loader 块约 150），
  // 所以不能按长度比例判断。真正要防的是「把页面骨架删掉了」，
  // 那就看结构标记还在不在。
  const lostStructure = !out.includes('</body>') || !out.includes('</html>')
    || !out.includes('<body') || out.length < 1000;
  if (lostStructure) {
    rejected++;
    console.log(`  ✗ 拒绝 ${rel}：改写后缺 </body> 或 </html>，疑似删多了（${originalLen} -> ${out.length} 字节）`);
    continue;
  }

  if (APPLY) fs.writeFileSync(file, out, 'utf8');
  converted++;
}

console.log(REVERT
  ? `可还原 ${reverted} 页${APPLY ? '（已写入）' : '（预演）'}`
  : `可转换 ${converted} 页 / 跳过 ${skipped} 页 / 已转换 ${already} 页 / 拒绝 ${rejected} 页${APPLY ? '（已写入）' : '（预演）'}`);
