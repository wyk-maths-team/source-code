#!/usr/bin/env node
// tools/new-page.mjs
//
// 从 _template/ 生成一个新页面，并自动接好导航与路由。
//
// 用法：
//   node tools/new-page.mjs <name> [选项]
//
// 选项：
//   --title "显示名"     页面标题（默认由 name 生成）
//   --path  /custom      访问路径（默认 /<name>）
//   --icon  fa-star      侧栏图标（默认 fa-file）
//   --public             不需要登录
//   --admin              仅管理员可见（同时要求登录）
//   --no-nav             不往侧栏加条目
//   --no-route           不往 vercel.json 加 rewrite
//   --dry                只打印将要做什么，不写文件
//
// 例：
//   node tools/new-page.mjs stats --title "Statistics" --icon fa-chart-simple --public
//   node tools/new-page.mjs admin-review --title "Review" --admin --no-nav
//
// 生成后记得跑 `npm run version:assets` 让线上拿到新版本号。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ══════════ 参数解析 ══════════
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(`
  用法: node tools/new-page.mjs <name> [选项]

  选项:
    --title "显示名"   页面标题（默认由 name 生成）
    --path  /custom    访问路径（默认 /<name>）
    --icon  fa-star    侧栏图标（默认 fa-file）
    --public           不需要登录
    --admin            仅管理员可见
    --no-nav           不加侧栏条目
    --no-route         不加 vercel.json rewrite
    --dry              只打印，不写文件

  例:
    node tools/new-page.mjs stats --title "Statistics" --icon fa-chart-simple --public
`);
  process.exit(argv.length === 0 ? 1 : 0);
}

const name = argv.find((a) => !a.startsWith('-'));
if (!name) { console.error('缺少页面名'); process.exit(1); }
if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error(`页面名只能用小写字母、数字和连字符，且以字母开头（收到: ${name}）`);
  process.exit(1);
}

function opt(flag, fallback = null) {
  const i = argv.indexOf(flag);
  if (i < 0) return fallback;
  const v = argv[i + 1];
  return v && !v.startsWith('-') ? v : fallback;
}
const has = (f) => argv.includes(f);

const title = opt('--title') || name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const routePath = opt('--path') || '/' + name;
const icon = opt('--icon') || 'fa-file';
const isPublic = has('--public');
const isAdmin = has('--admin');
const addNav = !has('--no-nav');
const addRoute = !has('--no-route');
const dry = has('--dry');

const PAGE_ID = name;
const htmlFile = path.join(ROOT, `${name}.html`);
const jsRel = `assets/js/pages/${name}.js`;
const jsFile = path.join(ROOT, jsRel);
const jsUrl = `/${jsRel}`;

// ══════════ 冲突检查 ══════════
function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

if (fs.existsSync(htmlFile)) fail(`${name}.html 已存在`);
if (fs.existsSync(jsFile)) fail(`${jsRel} 已存在`);

const vercelPath = path.join(ROOT, 'vercel.json');
const vercelRaw = fs.readFileSync(vercelPath, 'utf8');
if (addRoute) {
  const cfg = JSON.parse(vercelRaw);
  const exists = (cfg.rewrites || []).some((r) => r.source === routePath);
  if (exists) fail(`vercel.json 里已有 ${routePath} 的 rewrite`);
}

// ══════════ 生成文件 ══════════
const tplHtml = fs.readFileSync(path.join(ROOT, '_template', 'page.html'), 'utf8');
const tplJs = fs.readFileSync(path.join(ROOT, '_template', 'page.js'), 'utf8');

let html = tplHtml
  .replaceAll('{{TITLE}}', title)
  .replaceAll('{{PAGE_ID}}', PAGE_ID)
  .replaceAll('{{REQUIRES_AUTH}}', isPublic ? 'false' : 'true')
  .replaceAll('{{PAGE_JS}}', jsUrl);

const js = tplJs
  .replaceAll('{{TITLE}}', title)
  .replaceAll('{{PAGE_ID}}', PAGE_ID);

// 公开页面：把 requireAuth 改成 false
const finalJs = isPublic ? js.replace('requireAuth: true', 'requireAuth: false') : js;

// ══════════ 写侧栏条目 ══════════
function patchSidebar() {
  const p = path.join(ROOT, 'assets', 'js', 'sidebar.js');
  let src = fs.readFileSync(p, 'utf8');
  const marker = 'const EXTRA_NAV = [';
  const i = src.indexOf(marker);
  if (i < 0) fail('sidebar.js 里找不到 EXTRA_NAV 锚点');

  const fields = [
    `href: '${routePath}'`,
    `page: '${PAGE_ID}'`,
    `icon: '${icon}'`,
    `label: '${title.replace(/'/g, "\\'")}'`,
  ];
  if (isAdmin) fields.push('adminOnly: true');
  if (isPublic) fields.push('guestOk: true');
  const entry = `    { ${fields.join(', ')} },\n`;

  // 插到数组开头（`const EXTRA_NAV = [` 那一行之后）
  const lineEnd = src.indexOf('\n', i) + 1;
  src = src.slice(0, lineEnd) + entry + src.slice(lineEnd);

  if (!dry) fs.writeFileSync(p, src, 'utf8');
  return `    { ${fields.join(', ')} },`;
}

// ══════════ 写 vercel.json rewrite ══════════
function patchVercel() {
  // 必须插在 404 兜底 (/(.*) -> /404.html) 之前，否则新页面会被兜走
  const catchAll = /(\s*)\{\s*"source"\s*:\s*"\/\(\.\*\)"\s*,\s*"destination"\s*:\s*"\/404\.html"\s*\}/;
  const m = vercelRaw.match(catchAll);
  if (!m) fail('vercel.json 里找不到 404 兜底规则，无法安全插入 rewrite');
  const entry = `{\n      "source": "${routePath}",\n      "destination": "/${name}.html"\n    },`;
  const out = vercelRaw.slice(0, m.index) + '\n    ' + entry + vercelRaw.slice(m.index);
  // 校验 JSON 仍合法
  try { JSON.parse(out); } catch (e) { fail('插入 rewrite 后 vercel.json 不再是合法 JSON：' + e.message); }
  if (!dry) fs.writeFileSync(vercelPath, out, 'utf8');
  return `${routePath} -> /${name}.html`;
}

// ══════════ 执行 ══════════
console.log('');
console.log(`  生成页面: ${name}`);
console.log(`  标题    : ${title}`);
console.log(`  路径    : ${routePath}`);
console.log(`  需要登录: ${isPublic ? '否' : '是'}${isAdmin ? '（仅管理员）' : ''}`);
console.log('');

if (!dry) {
  fs.mkdirSync(path.dirname(jsFile), { recursive: true });
  fs.writeFileSync(htmlFile, html, 'utf8');
  fs.writeFileSync(jsFile, finalJs, 'utf8');
}
console.log(`  ✓ ${name}.html`);
console.log(`  ✓ ${jsRel}`);

if (addNav) {
  const e = patchSidebar();
  console.log(`  ✓ 侧栏条目: ${e.trim()}`);
} else {
  console.log('  - 跳过侧栏条目');
}

if (addRoute) {
  const r = patchVercel();
  console.log(`  ✓ 路由: ${r}`);
} else {
  console.log('  - 跳过路由（用 /' + name + '.html 访问）');
}

console.log('');
console.log('  下一步:');
console.log(`    1. 编辑 ${jsRel} 写业务逻辑`);
console.log('    2. 运行 npm run version:assets  让线上拿到新版本号');
console.log('    3. 本地 vercel dev 预览');
console.log('');
if (dry) console.log('  (--dry：未写入任何文件)\n');
