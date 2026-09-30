// resources/script/pageload.js
// 全站页面过渡：防闪白 + 揭幕 + 淡出
(function () {
  'use strict';

  var KEY = '__pt';

  // ⚠️ 颜色与 styles.css 的 --content-bg 保持一致
  var BG_LIGHT = '#f0f2f5';   // :root --content-bg
  var BG_DARK  = '#0d1117';   // [data-theme="dark"] --content-bg

  var COVER_MS  = 380;        // 离开时：遮罩铺满的时长
  var REVEAL_MS = 500;        // 进入时：遮罩收缩的时长

  function themeBg() {
    try {
      return (localStorage.getItem('theme') === 'dark') ? BG_DARK : BG_LIGHT;
    } catch (e) { return BG_LIGHT; }
  }

  function makeVeil(startOpen) {
    var v = document.createElement('div');
    v.id = '__pt-veil';
    v.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'pointer-events:none',
      'background:' + themeBg(),
      'clip-path:circle(' + (startOpen ? '160%' : '0%') + ' at 50% 50%)',
      'will-change:clip-path'
    ].join(';');
    // 挂到 documentElement —— body 未必存在
    document.documentElement.appendChild(v);
    return v;
  }

  // ── 新页面：揭幕（veil 从满屏收缩到 0）──
  function playReveal() {
    var v = makeVeil(true);
    // 强制 reflow，让浏览器确认起始状态
    void v.offsetWidth;

    requestAnimationFrame(function () {
      v.style.transition = 'clip-path ' + REVEAL_MS + 'ms cubic-bezier(.4,0,.2,1)';
      v.style.clipPath = 'circle(0% at 50% 50%)';
      setTimeout(function () {
        v.remove();
        // 清掉 inline 兜底背景，恢复主题切换能力
        document.documentElement.style.background = '';
      }, REVEAL_MS + 60);
    });
  }

  // ── 离开页面：遮罩从点击点扩散铺满 ──
  function playCover(url, x, y) {
    var v = makeVeil(false);
    if (x != null) {
      v.style.clipPath = 'circle(0% at ' + x + 'px ' + y + 'px)';
    }
    void v.offsetWidth;

    requestAnimationFrame(function () {
      v.style.transition = 'clip-path ' + COVER_MS + 'ms cubic-bezier(.4,0,.2,1)';
      v.style.clipPath = 'circle(160% at ' +
        (x != null ? x + 'px ' + y + 'px' : '50% 50%') + ')';
      setTimeout(function () {
        try { sessionStorage.setItem(KEY, 'in'); } catch (e) {}
        window.location.href = url;
      }, COVER_MS + 20);
    });
  }

  // ── 拦截 <a> 点击 ──
  function installLinkInterceptor() {
    document.addEventListener('click', function (e) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      var a = e.target.closest && e.target.closest('a');
      if (!a) return;

      var href = a.getAttribute('href');
      if (!href) return;
      if (href.startsWith('#') ||
          href.startsWith('javascript:') ||
          href.startsWith('mailto:') ||
          href.startsWith('tel:') ||
          a.target === '_blank' ||
          a.hasAttribute('download') ||
          a.dataset.noTransition === '1') return;

      var url;
      try { url = new URL(href, location.href); } catch (err) { return; }
      if (url.host !== location.host) return;
      if (url.pathname === location.pathname && url.search === location.search) return;

      e.preventDefault();
      playCover(url.pathname + url.search + url.hash, e.clientX, e.clientY);
    }, true);
  }

  // ── 页面就绪：如果是从过渡进来的，播揭幕 ──
  function onReady() {
    var came = false;
    try {
      came = sessionStorage.getItem(KEY) === 'in';
      if (came) sessionStorage.removeItem(KEY);
    } catch (e) {}

    if (came) playReveal();
    installLinkInterceptor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  // 主动跳转（替代 window.location.href）
  window.navigate = function (url) { playCover(url); };
})();