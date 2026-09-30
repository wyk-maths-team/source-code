// resources/script/pageload.js
// 全屏遮罩 + 进度条过渡
(function () {
  'use strict';

  var KEY = '__pt';
  var TOGGLE_KEY = 'pageTransition';

  // ⚠️ 遮罩颜色 —— 必须与 HTML <head> 里的 inline script 一致
  var VEIL_LIGHT = '#1a237e';   // 亮色：深蓝
  var VEIL_DARK  = '#000000';   // 暗色：纯黑

  var COVER_LIGHT_MS = 220;   // 亮色离开：铺满耗时
  var COVER_DARK_MS  = 450;   // 暗色离开：更慢
  var HOLD_MS        = 500;   // 加载完成后强制停留
  var REVEAL_MS      = 400;   // 淡出耗时
  var PROGRESS_TO_80 = 550;   // 进入时进度条到 80% 的时长

  function isEnabled() {
    try { return localStorage.getItem(TOGGLE_KEY) !== 'off'; } catch (e) { return true; }
  }
  function themeMode() {
    try { return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }
  function veilColor() {
    return themeMode() === 'dark' ? VEIL_DARK : VEIL_LIGHT;
  }

  // ⭐ 一次性注入 CSS
  var _cssDone = false;
  function injectCSS() {
    if (_cssDone) return;
    _cssDone = true;
    var s = document.createElement('style');
    s.setAttribute('data-pt-style', '1');
    s.textContent = [
      '#__pt-veil{',
        'position:fixed;inset:0;',
        'z-index:2147483647;',
        'display:flex;align-items:center;justify-content:center;',
        'opacity:0;pointer-events:none;',
        'will-change:opacity;',
        '-webkit-tap-highlight-color:transparent;',
        'transition:opacity .25s ease;',
      '}',
      // 禁用一切过渡（用于"立即铺满 / 立即消失"）
      '#__pt-veil.__pt-instant{transition:none !important}',
      // 进度条轨道
      '#__pt-veil .pt-bar{',
        'width:min(220px,55vw);height:3px;',
        'background:rgba(255,255,255,.16);',
        'border-radius:2px;overflow:hidden;',
        'box-shadow:0 0 24px rgba(255,255,255,.08);',
      '}',
      // 进度条填充
      '#__pt-veil .pt-fill{',
        'height:100%;width:0%;',
        'background:linear-gradient(90deg,rgba(255,255,255,.7),#ffffff);',
        'border-radius:2px;',
        'box-shadow:0 0 14px rgba(255,255,255,.5);',
        'transition:width .2s ease;',
      '}',
      // 过渡期间锁滚动
      'html.__pt-lock,html.__pt-lock body{overflow:hidden!important}',
    ].join('');
    document.head.appendChild(s);
  }

  function buildVeil() {
    injectCSS();
    var v = document.createElement('div');
    v.id = '__pt-veil';
    v.style.background = veilColor();

    var bar = document.createElement('div');
    bar.className = 'pt-bar';
    var fill = document.createElement('div');
    fill.className = 'pt-fill';
    bar.appendChild(fill);
    v.appendChild(bar);

    document.documentElement.appendChild(v);
    return { veil: v, fill: fill };
  }

  // ── 离开页面：遮罩铺满 ──
  function playCover(url) {
    var mode = themeMode();
    var duration = (mode === 'dark') ? COVER_DARK_MS : COVER_LIGHT_MS;

    var res = buildVeil();
    var v = res.veil;
    var fill = res.fill;

    // 1. 初始 instant 透明
    v.classList.add('__pt-instant');
    v.style.opacity = '0';
    void v.offsetWidth;   // 强制 reflow

    // 2. 解除 instant，设过渡，铺满
    v.classList.remove('__pt-instant');
    v.style.transition = 'opacity ' + duration + 'ms cubic-bezier(.4,0,.2,1)';
    v.style.opacity = '1';

    // 3. 进度条同步爬升
    requestAnimationFrame(function () {
      fill.style.transition =
        'width ' + (duration + 150) + 'ms cubic-bezier(.32,.72,0,1)';
      fill.style.width = '70%';
    });

    // 4. 铺满后跳转
    setTimeout(function () {
      try { sessionStorage.setItem(KEY, 'in'); } catch (e) {}
      window.location.href = url;
    }, duration + 30);
  }

  // ── 进入页面：揭幕 + 进度条 + 强制停留 ──
  function playReveal() {
    var res = buildVeil();
    var v = res.veil;
    var fill = res.fill;

    // 1. 立即铺满（与上一页同色，视觉上无缝）
    v.classList.add('__pt-instant');
    v.style.opacity = '1';
    void v.offsetWidth;
    v.classList.remove('__pt-instant');

    // 2. 锁滚动
    document.documentElement.classList.add('__pt-lock');

    // 3. 进度条 0% → 80%
    requestAnimationFrame(function () {
      fill.style.transition =
        'width ' + PROGRESS_TO_80 + 'ms cubic-bezier(.32,.72,0,1)';
      fill.style.width = '80%';
    });

    // 4. 结束流程
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;

      // → 100%
      fill.style.transition = 'width .22s ease-out';
      fill.style.width = '100%';

      // 强制停留 HOLD_MS，再淡出
      setTimeout(function () {
        v.style.transition = 'opacity ' + REVEAL_MS + 'ms ease';
        v.style.opacity = '0';

        setTimeout(function () {
          if (v.parentNode) v.parentNode.removeChild(v);
          document.documentElement.classList.remove('__pt-lock');
          document.documentElement.style.background = '';
        }, REVEAL_MS + 50);
      }, HOLD_MS);
    }

    if (document.readyState === 'complete') {
      setTimeout(finish, 120);
    } else {
      window.addEventListener('load', function () {
        setTimeout(finish, 100);
      }, { once: true });
      // 兜底：8 秒还没 load → 强制 finish
      setTimeout(finish, 8000);
    }
  }

  // ── 拦截 <a> ──
  function installLinkInterceptor() {
    document.addEventListener('click', function (e) {
      if (!isEnabled()) return;
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
      playCover(url.pathname + url.search + url.hash);
    }, true);
  }

  function onReady() {
    if (!isEnabled()) {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      document.documentElement.style.background = '';
      installLinkInterceptor();
      return;
    }

    var came = false;
    try {
      came = sessionStorage.getItem(KEY) === 'in';
      if (came) sessionStorage.removeItem(KEY);
    } catch (e) {}

    if (came) playReveal();
    else document.documentElement.style.background = '';

    installLinkInterceptor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }

  // ── 对外 API ──
  window.navigate = function (url) {
    if (!isEnabled()) { window.location.href = url; return; }
    playCover(url);
  };
  window.setPageTransition = function (enable) {
    try { localStorage.setItem(TOGGLE_KEY, enable ? 'on' : 'off'); } catch (e) {}
    if (!enable) {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      document.documentElement.style.background = '';
      document.documentElement.classList.remove('__pt-lock');
      var v = document.getElementById('__pt-veil');
      if (v) v.remove();
    }
  };
  window.isPageTransitionEnabled = isEnabled;
})();