#!/usr/bin/env node
// tools/audit-pages.mjs
//
// 扫描所有页面，输出结构化档案（供 PAGEDETAIL.md 使用）。
// 用法：node tools/audit-pages.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);

// auth.js 的公开页白名单（硬编码部分）
const PUBLIC_WHITELIST = ['/', '/index.html', '/404', '/404.html', '/credits', '/credits.html',
  '/guide', '/guide.html', '/guides', '/guides.html', '/login', '/os', '/os.html', '/root-login',
  '/auth/forgot-password', '/auth/reset-password', '/ranklist.html', '/forgot-password.html',
  '/reset-password.html'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

// vercel.json：反查每个 html 有哪些访问路径
function buildRouteMap() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const map = new Map();
  for (const r of cfg.rewrites || []) {
    const dest = String(r.destination || '').replace(/^\//, '');
    if (!dest.endsWith('.html')) continue;
    if (!map.has(dest)) map.set(dest, []);
    map.get(dest).push(r.source);
  }
  return map;
}

const stat = (t) => {
  let js = 0;
  for (const m of t.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) js += m[1].split('\n').length;
  let css = 0;
  for (const m of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += m[1].split('\n').length;
  return { js, css };
};

const count = (t, re) => (t.match(re) || []).length;

function analyze(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const t = fs.readFileSync(file, 'utf8');
  const { js, css } = stat(t);

  const title = (t.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  const hasAuthMeta = /<meta\s+name=["']requires-auth["']\s+content=["']false["']/i.test(t);
  const isPublicByMeta = hasAuthMeta;

  // 引用的共享脚本
  const shared = [...t.matchAll(/src=["']\/assets\/js\/([\w./-]+\.js)/g)].map((m) => m[1]);
  // 页面自己的脚本（assets/js/pages/*）
  const ownScripts = shared.filter((s) => s.startsWith('pages/'));

  // API 引用
  const apis = new Set();
  for (const m of t.matchAll(/["'`](\/api\/[\w\-./]+)/g)) apis.add(m[1].split('?')[0]);
  for (const m of t.matchAll(/apiCall\(\s*[`'"]([^`'"]+)/g)) apis.add(m[1].split('?')[0]);

  // 重复实现
  const dup = {
    escapeHtml: count(t, /function\s+(?:esc|escapeHtml)\s*\(/g),
    fmtTime: count(t, /function\s+fmt\w+|function\s+format(?:Date|Time)\w*/g),
    showMessage: count(t, /function\s+(?:showMessage|showToast|toast)\s*\(/g),
    alert: count(t, /\balert\s*\(/g),
    fetch: count(t, /\bfetch\s*\(/g),
    apiCall: count(t, /\bapiCall\s*\(/g),
  };

  // 页内是否已用 core
  const usesCore = {
    ui: /core\/ui\.js/.test(t),
    net: /core\/net\.js/.test(t),
    api: /core\/api\.js/.test(t),
    page: /core\/page\.js/.test(t),
  };

  return {
    path: rel, title, jsLines: js, cssLines: css,
    isPublic: isPublicByMeta || PUBLIC_WHITELIST.includes('/' + rel.replace(/^\.\//, '')),
    isPublicByMeta,
    apis: [...apis].sort(),
    shared, ownScripts,
    dup, usesCore,
  };
}

const routeMap = buildRouteMap();
const files = walk(ROOT).sort();
const data = files.map((f) => {
  const d = analyze(f);
  d.routes = routeMap.get(d.path) || [];
  return d;
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(data, null, 2));
} else {
  console.log(`共 ${data.length} 个页面`);
  const total = data.reduce((a, d) => ({ js: a.js + d.jsLines, css: a.css + d.cssLines }), { js: 0, css: 0 });
  console.log(`内联 JS ${total.js} 行 / 内联 CSS ${total.css} 行`);
}
