// tools/serve.mjs —— 本地开发服务器
//
// 一键跑起整站：静态文件 + api/* 全部按 Vercel 的方式挂上，
// 再把页面里引用的外网 CDN 资源代理并缓存到磁盘，第二次打开基本秒开。
//
//   node tools/serve.mjs            # 默认 3000
//   node tools/serve.mjs 4000       # 指定端口
//
// 缓存目录：.dev-cache/cdn（gitignored），可以随时删。

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], override: false });

import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const CACHE_DIR = path.join(ROOT, '.dev-cache', 'cdn');

await fsp.mkdir(CACHE_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '25mb' }));

// ── API：和 Vercel 一样，每个文件一个函数 ──────────────
// SERVE_NO_RELOAD=1 时缓存模块，行为更接近线上（线上不会每个请求重新求值模块）。
// 压测要的是这个模式；平时开发保持热重载。
const NO_RELOAD = process.env.SERVE_NO_RELOAD === '1' || process.argv.includes('--no-reload');
const _modCache = new Map();

app.use('/api', async (req, res) => {
  const seg = req.path.replace(/^\/+/, '').split('/')[0].replace(/\.js$/, '');
  const file = path.join(ROOT, 'api', seg + '.js');
  if (!seg || !fs.existsSync(file)) {
    return res.status(404).json({ success: false, message: 'Unknown API endpoint: ' + seg });
  }
  const started = Date.now();
  try {
    const spec = NO_RELOAD
      ? pathToFileURL(file).href
      : pathToFileURL(file).href + '?t=' + Date.now();   // 绕过模块缓存，改完即生效
    const mod = NO_RELOAD && _modCache.has(spec)
      ? _modCache.get(spec)
      : await import(spec);
    if (NO_RELOAD) _modCache.set(spec, mod);
    await mod.default(req, res);
  } catch (e) {
    console.error('[api:' + seg + ']', e);
    if (!res.headersSent) res.status(500).json({ success: false, message: String(e && e.message) });
  } finally {
    if (process.env.DEV_VERBOSE) {
      console.log('[api:' + seg + '] ' + req.method + ' ' + (Date.now() - started) + 'ms');
    }
  }
});

// ── CDN 代理：/__cdn/<host>/<path> ─────────────────────
// 页面里的外网地址在开发模式下会被改写成这个前缀，命中缓存就直接回本地文件。
const CDN_PREFIX = '/__cdn';

function cacheKeyFor(target) {
  return crypto.createHash('sha1').update(target).digest('hex');
}

function isFetchable(target) {
  try {
    const u = new URL(target);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch (e) { return false; }
}

// CSS 里的相对 url() 必须重写成代理地址。
// 否则浏览器以 /__cdn/x 为基准解析 "../webfonts/fa-solid-900.woff2"，
// 得到 /webfonts/...，本地必然 404 —— 图标全变空心方块，截图评审等于瞎的。
function rewriteCssUrls(text, cssUrl) {
  return text
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, q, ref) => {
      if (/^(data:|https?:|\/\/|#)/i.test(ref)) return m;
      try {
        const abs = new URL(ref, cssUrl).href;
        return 'url(' + CDN_PREFIX + '/x?u=' + encodeURIComponent(abs) + ')';
      } catch (e) { return m; }
    })
    .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, ref) => {
      if (/^(data:|https?:|\/\/)/i.test(ref)) return m;
      try {
        const abs = new URL(ref, cssUrl).href;
        return '@import url(' + CDN_PREFIX + '/x?u=' + encodeURIComponent(abs) + ')';
      } catch (e) { return m; }
    });
}

function applyCssRewrite(buf, cssUrl, type) {
  if (!/text\/css/i.test(type || '')) return buf;
  return Buffer.from(rewriteCssUrls(buf.toString('utf8'), cssUrl), 'utf8');
}

// Express 5 的 path-to-regexp 不再接受裸 '\*'，用挂载前缀代替
app.use(CDN_PREFIX, async (req, res) => {
  const target = req.query.u;
  if (!target || !isFetchable(target)) {
    return res.status(400).send('missing or invalid ?u=');
  }

  const key = cacheKeyFor(target);
  const metaFile = path.join(CACHE_DIR, key + '.json');
  const bodyFile = path.join(CACHE_DIR, key + '.bin');

  // 命中：直接吐本地文件，带强缓存头
  try {
    const meta = JSON.parse(await fsp.readFile(metaFile, 'utf8'));
    const raw = await fsp.readFile(bodyFile);
    res.setHeader('Content-Type', meta.type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-CDN-Cache', 'HIT');
    return res.end(applyCssRewrite(raw, meta.target || target, meta.type));
  } catch (e) { /* 没缓存，往下走 */ }

  try {
    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'moj-dev-server', 'Accept': '*/*' },
      redirect: 'follow',
    });
    if (!upstream.ok) {
      return res.status(upstream.status).send('upstream ' + upstream.status);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get('content-type') || 'application/octet-stream';

    await fsp.writeFile(bodyFile, buf);
    await fsp.writeFile(metaFile, JSON.stringify({ target, type, at: Date.now() }));

    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-CDN-Cache', 'MISS');
    return res.end(applyCssRewrite(buf, target, type));
  } catch (e) {
    console.error('[cdn] fetch failed:', target, e.message);
    return res.status(502).send('failed to fetch ' + target);
  }
});

// ── HTML 改写：把外网地址换成 /__cdn ───────────────────
// 只在开发服务器里做，线上文件不动。
function rewriteCdnUrls(html) {
  return html.replace(/(src|href)="(https?:\/\/[^"]+)"/g, (m, attr, url) => {
    if (/moj\.wyk\.edu\.hk|localhost|127\.0\.0\.1/.test(url)) return m;
    // preconnect / dns-prefetch 只有域名没有路径，没有可缓存的文件，别动它
    try {
      const u = new URL(url);
      if (!u.pathname || u.pathname === '/') return m;
    } catch (e) { return m; }
    return attr + '="' + CDN_PREFIX + '/x?u=' + encodeURIComponent(url) + '"';
  });
}

// HTML 要改写 CDN 地址，所以必须自己读一遍；静态中间件处理改不了内容。
async function tryServeHtml(req, res) {
  if (req.method !== 'GET') return false;
  let urlPath = decodeURIComponent(req.path);
  if (!urlPath || urlPath === '/') urlPath = '/index.html';
  if (!/\.html?$/i.test(urlPath)) return false;

  const candidates = [path.join(ROOT, urlPath), path.join(ROOT, urlPath + '.html')];
  for (const c of candidates) {
    try {
      const stat = await fsp.stat(c);
      if (!stat.isFile()) continue;
      const html = await fsp.readFile(c, 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(rewriteCdnUrls(html));
      return true;
    } catch (e) { /* 下一个 */ }
  }
  return false;
}

app.use(async (req, res, next) => {
  if (await tryServeHtml(req, res)) return;
  next();
});

app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

// 兜底：静态目录没命中时，如果是 .html 请求就把内容读出来改写 CDN 地址
app.use(async (req, res) => {
  const urlPath = decodeURIComponent(req.path);
  const candidates = [
    path.join(ROOT, urlPath),
    path.join(ROOT, urlPath + '.html'),
    path.join(ROOT, urlPath, 'index.html'),
  ];
  for (const c of candidates) {
    try {
      const stat = await fsp.stat(c);
      if (!stat.isFile()) continue;
      if (!c.endsWith('.html')) continue;
      const html = await fsp.readFile(c, 'utf8');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(rewriteCdnUrls(html));
    } catch (e) { /* 继续找 */ }
  }
  res.status(404).send('Not found: ' + urlPath);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  moj dev server');
  console.log('  http://127.0.0.1:' + PORT + '/index.html');
  console.log('');
  console.log('  cdn cache: ' + path.relative(ROOT, CACHE_DIR) + ' (delete anytime)');
  console.log('  html: ' + '(CDN urls rewritten to /__cdn, cached to disk on first hit)');
  console.log('');
});
