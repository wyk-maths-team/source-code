/* ═══════════════════════════════════════════════════════════
 * Service Worker — WYK Maths Team Mobile
 * 讓 /mobile 在離線狀態下仍能啟動
 *
 * ⚠️ 部署新版本時，把 VERSION 改成 'v2'、'v3'…，
 *    舊快取才會被清掉、新資源才會被預快取。
 * ═══════════════════════════════════════════════════════════ */
const VERSION = 'v7';
const SHELL_CACHE = 'wyk-shell-' + VERSION;
const CDN_CACHE   = 'wyk-cdn-'   + VERSION;
const API_CACHE   = 'wyk-api-'   + VERSION;

// App shell 預快取清單
const SHELL_FILES = [
  '/mobile/index.html',
  '/mobile/styles.css',
  '/mobile/script.js',
  '/mobile/manifest.json',
  '/favicon.svg',
  '/icons/apple-touch-icon.png',
];

// CDN 預快取清單
const CDN_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js',
  'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/contrib/auto-render.min.js',
];

// ── install：預快取 ──
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_FILES.map(async (u) => {
      try { await shell.add(new Request(u, { cache: 'reload' })); }
      catch (err) { console.warn('[sw] precache shell failed:', u, err); }
    }));

    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN_FILES.map(async (u) => {
      try {
        const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
        if (res.ok) await cdn.put(u, res);
      } catch (err) { console.warn('[sw] precache cdn failed:', u, err); }
    }));

    self.skipWaiting();
  })());
});

// ── activate：清舊快取 + 立刻接管 ──
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('wyk-') && !k.endsWith(VERSION))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isCdn(url) {
  return url.hostname === 'cdnjs.cloudflare.com'
      || url.hostname === 'cdn.jsdelivr.net'
      || url.hostname === 'unpkg.com'
      || url.hostname === 'res.cloudinary.com'
      || url.hostname === 'raw.githubusercontent.com';
}

// ── fetch：策略分派 ──
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;      // 寫入類不處理，直接放行

  let url;
  try { url = new URL(req.url); } catch { return; }

  // 1) API：network-first，離線回退到快取
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const c = await caches.open(API_CACHE);
          c.put(req, res.clone());
        }
        return res;
      } catch {
        const c = await caches.open(API_CACHE);
        const cached = await c.match(req);
        if (cached) return cached;
        return new Response(
          JSON.stringify({ success: false, offline: true, message: '離線中' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
    })());
    return;
  }

  // 2) CDN：stale-while-revalidate
  if (isCdn(url)) {
    e.respondWith((async () => {
      const c = await caches.open(CDN_CACHE);
      const cached = await c.match(req);
      const netPromise = fetch(req).then(res => {
        if (res.ok) c.put(req, res.clone());
        return res;
      }).catch(() => null);

      if (cached) {
        e.waitUntil(netPromise);
        return cached;
      }
      const res = await netPromise;
      return res || new Response('', { status: 504 });
    })());
    return;
  }

  // 3) 導航請求：network-first，失敗回退到 index.html
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && url.pathname.startsWith('/mobile/')) {
          const c = await caches.open(SHELL_CACHE);
          c.put(req, res.clone());
        }
        return res;
      } catch {
        const c = await caches.open(SHELL_CACHE);
        let cached = await c.match(req);
        if (!cached) cached = await c.match('/mobile/index.html');
        if (cached) return cached;
        return new Response(
          '<h1 style="font-family:sans-serif;padding:2em">離線中</h1>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
    return;
  }

  // 4) 同源 /mobile/ 靜態資源：cache-first
  if (url.origin === self.location.origin && url.pathname.startsWith('/mobile/')) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL_CACHE);
      const cached = await c.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }
});

// 讓頁面可以主動叫 SW 立刻接手（更新用）
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});