(function () {
  const prefetched = new Set();
  let hoverTimer = null;

  function prefetch(url) {
    if (prefetched.has(url)) return;
    prefetched.add(url);
    // 用低优先级 fetch，不阻塞任何东西
    fetch(url, { priority: 'low' }).catch(() => {});
  }

  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;

    let url;
    try { url = new URL(href, location.href); } catch { return; }
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname) return;

    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => prefetch(url.href), 100);
  });

  document.addEventListener('mouseout', () => {
    clearTimeout(hoverTimer);
  });

  // 移動端：觸控時立即 prefetch
  document.addEventListener('touchstart', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    try {
      const url = new URL(href, location.href);
      if (url.origin === location.origin) prefetch(url.href);
    } catch {}
  }, { passive: true });
})();