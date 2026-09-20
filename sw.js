// sw.js — WYK Maths PWA Service Worker
const CACHE_NAME = 'wyk-maths-v2';   // ⭐ 手動 bump 版本
const PRECACHE_URLS = [
  '/problems',
  '/problems.html',
  '/os',
  '/favicon.svg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// 安裝：預緩存
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// 激活：清掉舊版本緩存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// 支援從頁面送 SKIP_WAITING 訊息
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch：Network-first
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只處理 GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 只處理同源
  if (url.origin !== self.location.origin) return;

  // API 不緩存
  if (url.pathname.startsWith('/api/')) return;

  // 排除 admin 頁面（管理員總是要最新）
  if (url.pathname.startsWith('/admin')) return;

  // 導航請求（用戶打開頁面）：network-first，失敗回退
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/problems.html'))
        )
    );
    return;
  }

  // 其他靜態資源（script / style / image）：network-first
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});