// tools/bundle-pages.mjs —— 把两段核心 script 分别换成 loader
//
//   node tools/bundle-pages.mjs            # 预演
//   node tools/bundle-pages.mjs --apply    # 改写
//   node tools/bundle-pages.mjs --revert   # 退回
//
// 段的位置是语义的：
//   HEAD 段 13 个 -> 换成 <script src="bundle-loader.js" data-part="head">
//   BODY 段 8 个  -> 换成 <script src="bundle-loader.js" data-part="body">
//
// 只动「该段完整、顺序一致」的页面。少一个的保持原样 —— 依赖关系没理清的
// 页面合并了只会把问题藏起来。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const HEAD_FILES = [
  'arch-render.js',
  'core/ui.js', 'core/net.js', 'core/ban-guard.js', 'core/latex-doc.js',
  'core/status-badge.js', 'core/script-panel.js', 'core/api.js', 'core/padstore.js',
  'core/radial-menu.js', 'core/ban-screen.js', 'core/ban-index.js', 'core/page.js',
];
const BODY_FILES = [
  'auth.js', 'app.js', 'topbar.js', 'sidebar.js',
  'core/polling.js', 'heartbeat.js', 'pk-invite-widget.js', 'pk-notify.js',
];

const SKIP = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', 'private', 'grader', 'temp', 'dev', 'downloaded_pdfs', 'dse-data', '.dev-cache', 'assets']);
function collect(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) collect(path.join(dir, e.name), out); }
    else if (/\.html$/i.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

const MARK = { head: '__MOJ_HEAD__', body: '__MOJ_BODY__' };
const START = { head: '<!-- moj-core-head:start -->', body: '<!-- moj-core-body:start -->' };
const END = { head: '<!-- moj-core-head:end -->', body: '<!-- moj-core-body:end -->' };

const REPL = {
  head: `${START.head}\n  <script src="/assets/js/bundle-loader.js" data-part="head"></script>\n${END.head}`,
  body: `${START.body}\n  <script src="/assets/js/bundle-loader.js" data-part="body"></script>\n${END.body}`,
};

const TAG_RE = /<script[^>]+src=["']\/assets\/js\/([^"']+\.js)[^"']*["'][^>]*><\/script>[ \t]*\r?\n?/gi;

const pages = collect(ROOT);
let done = 0, skipped = 0, already = 0, reverted = 0, rejected = 0;
const notes = [];

for (const file of pages) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let s = fs.readFileSync(file, 'utf8');

  if (REVERT) {
    let touched = false;
    for (const part of ['head', 'body']) {
      const re = new RegExp(`\\s*${START[part]}[\\s\\S]*?${END[part]}\\s*`);
      if (!re.test(s)) continue;
      const files = part === 'head' ? HEAD_FILES : BODY_FILES;
      const tags = files.map(f => `  <script src="/assets/js/${f}"></script>`).join('\n');
      s = s.replace(re, '\n' + tags + '\n');
      touched = true;
    }
    if (!touched) continue;
    if (APPLY) fs.writeFileSync(file, s, 'utf8');
    reverted++;
    continue;
  }

  if (s.includes(START.head) || s.includes(START.body)) { already++; continue; }

  let out = s;
  let converted = 0;

  for (const part of ['head', 'body']) {
    const want = part === 'head' ? HEAD_FILES : BODY_FILES;

    // 每次都从**当前的 out** 重新匹配。head 段替换完字符串长度就变了，
    // body 段若还拿着最初 s 的索引去 slice，占位符会落到 </html> 后面，
    // 同时漏删标签 —— auth.js 留在页面上、和 bundle 里的 auth 重复声明
    // currentUser，就是这么来的。
    const cur = [...out.matchAll(TAG_RE)];
    const mine = cur.filter(m => want.includes(m[1]));
    const order = mine.map(m => m[1]);
    if (order.length !== want.length) { continue; }             // 该段不全，跳过这一段
    if (order.join('|') !== want.join('|')) { continue; }        // 顺序不一致
    converted++;
    // 从后往前替换，前面的 index 才不失效
    for (let i = mine.length - 1; i >= 0; i--) {
      const m = mine[i];
      const repl = i === 0 ? MARK[part] : '';
      out = out.slice(0, m.index) + repl + out.slice(m.index + m[0].length);
    }
  }

  if (!converted) { skipped++; continue; }

  for (const part of ['head', 'body']) {
    if (out.includes(MARK[part])) out = out.replace(MARK[part], REPL[part]);
  }

  // 安全阀：只检查结构标记，不按长度 —— 合并后必然变短
  if (!out.includes('</body>') || !out.includes('</html>') || out.length < 1000) {
    rejected++;
    notes.push(`  ✗ 拒绝 ${rel}：改写后缺 </body> 或 </html>`);
    continue;
  }

  if (APPLY) fs.writeFileSync(file, out, 'utf8');
  done++;
}

if (REVERT) console.log(`可还原 ${reverted} 页${APPLY ? '（已写入）' : '（预演）'}`);
else console.log(`已转换 ${done} 页 / 跳过 ${skipped} 页 / 已转换 ${already} 页 / 拒绝 ${rejected} 页${APPLY ? '（已写入）' : '（预演）'}`);
notes.forEach(n => console.log(n));
