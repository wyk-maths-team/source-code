// tools/inline-loader.mjs —— 把全局 CSS/JS 收进一段内联注入器
//
// 背景：84 个 HTML 各自写死了 /assets/css/styles.css?v=xxx 和 core/*.js?v=xxx。
// 每次发版都要全量改一遍，加一个全局文件又要改 84 处。
//
// 现在每个页面 <head> 里只保留一小段内联脚本，由它按统一版本号注入全局资源。
// 页面自己的 css/js 保持原样（不同页面本来就不同，不适合统一）。
//
// 用法：
//   node tools/inline-loader.mjs            写入
//   node tools/inline-loader.mjs --dry      只看会改哪些
//   node tools/inline-loader.mjs --version 20261108-01   指定版本号
//
// 版本号默认取当前时间戳（HKT），也可以传 --version 固定下来。

import fs from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const vIdx = process.argv.indexOf('--version');
const VERSION = vIdx > -1 && process.argv[vIdx + 1]
  ? process.argv[vIdx + 1]
  : new Date(Date.now() + 8 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 12);

// 哪些属于「全局」：每个页面都必须有、且版本统一
const GLOBAL_CSS = ['/assets/css/styles.css'];
const GLOBAL_JS = [
  '/assets/js/arch-render.js',
  '/assets/js/core/ui.js',
  '/assets/js/core/net.js',
  '/assets/js/core/api.js',
  '/assets/js/core/page.js',
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel', '.backup', '.acl-recovery', 'temp', 'private', 'process', 'dev', 'data', 'testcases', 'tools', 'bio', 'grader']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.name.endsWith('.html')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLoader(cssList, jsList) {
  const css = JSON.stringify(cssList);
  const js = JSON.stringify(jsList);
  return [
    '<script>',
    '  /* 全局资源注入器：版本号只改这一处；加全局 css/js 只加进数组 */',
    '  (function () {',
    '    var V = \'' + VERSION + '\';',
    '    var CSS = ' + css + ';',
    '    var JS = ' + js + ';',
    '    CSS.forEach(function (h) { document.write(\'<link rel="stylesheet" href="\' + h + \'?v=\' + V + \'">\'); });',
    '    JS.forEach(function (s) { document.write(\'<script src="\' + s + \'?v=\' + V + \'"><\\/script>\'); });',
    '  })();',
    '</script>',
  ].join('\n');
}

const files = walk('.');
let changed = 0;
const skipped = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');

  // 已经是注入器了就跳过（幂等），但版本号不同就更新
  const hasLoader = /全局资源注入器/.test(src);

  const foundCss = GLOBAL_CSS.filter((h) => new RegExp('href="' + escapeRe(h) + '(\\?v=[^"]*)?"').test(src));
  const foundJs = GLOBAL_JS.filter((s) => new RegExp('src="' + escapeRe(s) + '(\\?v=[^"]*)?"').test(src));

  if (!foundCss.length && !foundJs.length && !hasLoader) {
    skipped.push(file);
    continue;
  }

  const cssList = hasLoader ? GLOBAL_CSS : foundCss;
  const jsList = hasLoader ? GLOBAL_JS : foundJs;

  if (!cssList.length && !jsList.length) { skipped.push(file); continue; }

  let out = src;

  if (hasLoader) {
    // 只更新版本号
    out = out.replace(/var V = '[^']*';/, "var V = '" + VERSION + "';");
  } else {
    // 删掉旧的独立标签
    for (const h of cssList) {
      out = out.replace(new RegExp('\\s*<link rel="stylesheet" href="' + escapeRe(h) + '(\\?v=[^"]*)?"\\s*/?>\\s*\\n?', 'g'), '\n');
    }
    for (const s of jsList) {
      out = out.replace(new RegExp('\\s*<script src="' + escapeRe(s) + '(\\?v=[^"]*)?"\\s*>\\s*<\\/script>\\s*\\n?', 'g'), '\n');
    }

    // 插到 </head> 前（保持它们在 head 里、在页面脚本之前执行）
    const loader = buildLoader(cssList, jsList);
    if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, loader + '\n</head>');
    } else {
      skipped.push(file + ' (no </head>)');
      continue;
    }
  }

  if (out === src) { skipped.push(file + ' (unchanged)'); continue; }

  changed++;
  if (DRY) {
    console.log('[dry] ' + file + '  css=' + cssList.length + ' js=' + jsList.length);
  } else {
    fs.writeFileSync(file, out, 'utf8');
  }
}

console.log('');
console.log((DRY ? 'would change ' : 'changed ') + changed + ' files, skipped ' + skipped.length);
console.log('version: ' + VERSION);
if (skipped.length && DRY) console.log('skipped sample:', skipped.slice(0, 8).join(', '));
