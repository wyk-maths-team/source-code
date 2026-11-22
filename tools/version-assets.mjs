#!/usr/bin/env node
// tools/version-assets.mjs
//
// 给 /assets/ 下的静态资源加内容版本号（?v=xxxxxxxx）。
//
// 为什么需要：
//   生产环境给 /assets/*.js|css 配的是 `max-age=31536000, immutable`（见 vercel.json）。
//   immutable 意味着浏览器一年内不会重新请求——文件名不变的话，改了代码用户永远拿旧的。
//   而 settings 里的「Clear Cache」清的是 Cache Storage，清不掉 HTTP 磁盘缓存。
//
//   加 ?v=<内容hash> 后：
//     文件没改 -> URL 不变 -> 命中缓存，0 请求
//     文件改了 -> URL 变化 -> 浏览器自动重新下载
//   用户不需要清任何缓存。
//
// 用法：
//   node tools/version-assets.mjs          # 计算版本号并改写所有 HTML
//   node tools/version-assets.mjs --check  # 只检查是否已最新，不写入（CI 用）
//
// 已挂到 package.json 的 build：Vercel 每次部署会自动执行，开发者不用记得跑。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const SKIP_DIRS = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', 'private', 'grader', 'temp', '.vercel', '_template']);

// ══════════ 1. 计算 assets 的内容指纹 ══════════
function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|css)$/i.test(e.name)) out.push(p);
  }
  return out;
}

function buildFingerprint() {
  const files = walk(path.join(ROOT, 'assets')).sort();
  if (files.length === 0) throw new Error('assets/ 下没有找到任何 .js/.css');
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    h.update(rel);
    h.update(fs.readFileSync(f));
  }
  return { version: h.digest('hex').slice(0, 8), count: files.length };
}

// ══════════ 2. 收集 HTML ══════════
function collectHtml(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) collectHtml(path.join(dir, e.name), out); }
    else if (/\.html$/i.test(e.name)) out.push(path.join(dir, e.name));
  }
  return out;
}

// ══════════ 3. 改写 ══════════
const V = /[A-Za-z0-9_-]{1,24}/;          // 版本号字符集
const RE_ASSET = new RegExp(
  // 允许子目录（如 /assets/js/core/ui.js）
  '((?:src|href)\\s*=\\s*["\'])((?:/|\\.\\.?/)?assets/(?:js|css)/[\\w./\\-]+)(?:\\?v=' + V.source + ')?(["\'])',
  'g'
);
const RE_BUILDVAR = /(<script>window\.__BUILD_V='[^']*';<\/script>\s*)?/;

function processHtml(file, version) {
  const bytes = fs.readFileSync(file);
  const hadBom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  let text = bytes.toString('utf8');

  let changes = 0;

  // a) assets 引用加/更新 ?v=
  text = text.replace(RE_ASSET, (m, pre, url, post) => {
    const next = pre + url + '?v=' + version + post;
    if (next !== m) changes++;
    return next;
  });

  // b) 注入 / 更新 window.__BUILD_V（供 JS 内动态加载拼接用）
  const tag = `<script>window.__BUILD_V='${version}';</script>`;
  if (/<script>window\.__BUILD_V='[^']*';<\/script>/.test(text)) {
    text = text.replace(/<script>window\.__BUILD_V='[^']*';<\/script>/, (m) => {
      if (m !== tag) changes++;
      return tag;
    });
  } else {
    const m = text.match(/<head[^>]*>/i);
    if (m) {
      text = text.slice(0, m.index + m[0].length) + '\n' + tag + text.slice(m.index + m[0].length);
      changes++;
    }
  }

  if (changes > 0 && !CHECK_ONLY) {
    fs.writeFileSync(file, text, hadBom ? 'utf8' : 'utf8');
    if (hadBom) {
      // 保留原有 BOM
      const buf = fs.readFileSync(file);
      if (!(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)) {
        fs.writeFileSync(file, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), buf]));
      }
    }
  }
  return changes;
}

// ══════════ 主流程 ══════════
const { version, count } = buildFingerprint();
const htmls = collectHtml(ROOT);

let totalFiles = 0;
let totalChanges = 0;
const stale = [];

for (const f of htmls) {
  const n = processHtml(f, version);
  if (n > 0) { totalFiles++; totalChanges += n; stale.push(path.relative(ROOT, f)); }
}

console.log('');
console.log('  assets 版本号: \x1b[36m' + version + '\x1b[0m   (' + count + ' 个 js/css 文件参与计算)');
console.log('  HTML 文件数  : ' + htmls.length);
if (CHECK_ONLY) {
  if (totalFiles > 0) {
    console.log('  \x1b[33m未同步: ' + totalFiles + ' 个文件需要更新\x1b[0m');
    stale.slice(0, 10).forEach((f) => console.log('    - ' + f));
    process.exit(1);
  }
  console.log('  \x1b[32m全部已是最新\x1b[0m');
} else {
  console.log('  已更新       : ' + totalFiles + ' 个文件 / ' + totalChanges + ' 处引用');
  if (stale.length) stale.slice(0, 5).forEach((f) => console.log('    - ' + f));
}
console.log('');
