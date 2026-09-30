// resources/script/pageload.js
// 全屏遮罩 + mobile 风格加载画面
(function () {
  'use strict';

  var KEY = '__pt';
  var TOGGLE_KEY = 'pageTransition';

var VEIL_LIGHT = '#0f3460';   // 亮色：深蓝
  var VEIL_DARK  = '#0d1117';   // 暗色：纯黑

  var COVER_LIGHT_MS = 220;
  var COVER_DARK_MS  = 450;
  var HOLD_MS        = 500;
  var REVEAL_MS      = 400;
  var PROGRESS_TO_80 = 550;

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

  var _cssDone = false;
  function injectCSS() {
    if (_cssDone) return;
    _cssDone = true;
    var s = document.createElement('style');
    s.setAttribute('data-pt-style', '1');
    s.textContent = [
      '#__pt-veil{',
        'position:fixed;inset:0;z-index:2147483647;',
        'display:flex;align-items:center;justify-content:center;',
        'opacity:0;pointer-events:none;will-change:opacity;',
        '-webkit-tap-highlight-color:transparent;',
        'transition:opacity .25s ease;',
        'color:#e6edf3;',
        'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;',
      '}',
      '#__pt-veil.__pt-instant{transition:none !important}',
      '#__pt-veil .pt-box{text-align:center;width:min(280px,80vw)}',
      '#__pt-veil .pt-logo{',
        'font-size:44px;color:#4a90d9;margin-bottom:16px;opacity:.9;',
      '}',
      '#__pt-veil .pt-title{',
        'font-size:15px;font-weight:600;color:#e6edf3;',
        'margin-bottom:24px;letter-spacing:.3px;',
      '}',
      '#__pt-veil .pt-bar{',
        'height:3px;background:rgba(255,255,255,.16);',
        'border-radius:2px;overflow:hidden;margin-bottom:10px;',
      '}',
      '#__pt-veil .pt-fill{',
        'height:100%;width:0%;',
        'background:linear-gradient(90deg,#4a90d9,#58a6ff);',
        'border-radius:2px;',
      '}',
      '#__pt-veil .pt-pct{',
        'font-size:11px;font-family:"SF Mono",Consolas,monospace;',
        'color:rgba(255,255,255,.55);letter-spacing:.5px;',
      '}',
      'html.__pt-lock,html.__pt-lock body{overflow:hidden!important}',
    ].join('');
    document.head.appendChild(s);
  }

  function buildVeil() {
    injectCSS();
    var v = document.createElement('div');
    v.id = '__pt-veil';
    v.style.background = veilColor();
    v.innerHTML =
      '<div class="pt-box">' +
        '<div class="pt-logo"><i class="fas fa-cube"></i></div>' +
        '<div class="pt-title">WYK Maths Team</div>' +
        '<div class="pt-bar"><div class="pt-fill"></div></div>' +
        '<div class="pt-pct">0%</div>' +
      '</div>';
    document.documentElement.appendChild(v);
    return {
      veil: v,
      fill: v.querySelector('.pt-fill'),
      pctEl: v.querySelector('.pt-pct'),
    };
  }

  // rAF 驱动进度条（同时更新宽度 + 百分比）
  function animateProgress(res, from, to, duration, cb) {
    var start = performance.now();
    function tick(now) {
      var t = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      var v = from + (to - from) * eased;
      res.fill.style.width = v + '%';
      if (res.pctEl) res.pctEl.textContent = Math.floor(v) + '%';
      if (t < 1) requestAnimationFrame(tick);
      else if (cb) cb();
    }
    requestAnimationFrame(tick);
  }

  // ── 离开页面 ──
  function playCover(url) {
    var mode = themeMode();
    var duration = (mode === 'dark') ? COVER_DARK_MS : COVER_LIGHT_MS;

    var res = buildVeil();
    var v = res.veil;

    v.classList.add('__pt-instant');
    v.style.opacity = '0';
    void v.offsetWidth;

    v.classList.remove('__pt-instant');
    v.style.transition = 'opacity ' + duration + 'ms cubic-bezier(.4,0,.2,1)';
    v.style.opacity = '1';

    animateProgress(res, 0, 70, duration + 100);

    setTimeout(function () {
      try { sessionStorage.setItem(KEY, 'in'); } catch (e) {}
      window.location.href = url;
    }, duration + 30);
  }

  // ── 进入页面 ──
  function playReveal() {
    var res = buildVeil();
    var v = res.veil;

    v.classList.add('__pt-instant');
    v.style.opacity = '1';
    void v.offsetWidth;
    v.classList.remove('__pt-instant');

    document.documentElement.classList.add('__pt-lock');

    animateProgress(res, 0, 80, PROGRESS_TO_80);

    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;

      var cur = parseFloat(res.fill.style.width) || 0;
      animateProgress(res, cur, 100, 220, function () {
        setTimeout(function () {
          v.style.transition = 'opacity ' + REVEAL_MS + 'ms ease';
          v.style.opacity = '0';
          setTimeout(function () {
            if (v.parentNode) v.parentNode.removeChild(v);
            document.documentElement.classList.remove('__pt-lock');
            document.documentElement.style.background = '';
          }, REVEAL_MS + 50);
        }, HOLD_MS);
      });
    }

    if (document.readyState === 'complete') {
      setTimeout(finish, 150);
    } else {
      window.addEventListener('load', function () {
        setTimeout(finish, 120);
      }, { once: true });
      setTimeout(finish, 8000);
    }
  }

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

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      document.documentElement.classList.remove('__pt-lock');
      var v = document.getElementById('__pt-veil');
      if (v) v.remove();
      document.documentElement.style.background = '';
    }
  });

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