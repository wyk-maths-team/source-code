// assets/js/core/page.js
//
// 页面启动器。让「新建一个页面」只需要关心自己的业务。
//
// 用法（配合 _template/page.html）：
//   <script>
//     Page.boot({ title: '题库', requireAuth: true, skeleton: true });
//     Page.ready(function (user) {
//       // 这里写页面主逻辑
//     });
//   </script>
//
// 它负责：
//   - 设置 <title>
//   - 登录校验（未登录则跳转 /login.html?redirect=...）
//   - 页面级骨架屏的显示/隐藏
//   - 把未捕获错误统一交给 net.js 面板展示
//   - 暴露 currentUser

(function () {
  'use strict';
  if (window.Page) return;

  var _config = { title: '', requireAuth: false, skeleton: false };
  var _queue = [];
  var _booted = false;
  var _skeletonEl = null;

  function user() {
    try { return (typeof window.getCurrentUser === 'function') ? window.getCurrentUser() : null; }
    catch (e) { return null; }
  }

  function showSkeleton() {
    if (!_config.skeleton || _skeletonEl) return;
    var main = document.getElementById('mainContent') || document.body;
    _skeletonEl = document.createElement('div');
    _skeletonEl.id = 'pageSkeleton';
    _skeletonEl.style.cssText = 'padding:24px;display:flex;flex-direction:column;gap:12px';
    for (var i = 0; i < 4; i++) {
      var bar = document.createElement('div');
      bar.style.cssText = 'height:16px;border-radius:6px;background:linear-gradient(90deg,rgba(127,127,127,.12) 25%,rgba(127,127,127,.06) 50%,rgba(127,127,127,.12) 75%);background-size:200% 100%;animation:pageSkeletonShimmer 1.4s infinite';
      bar.style.width = (100 - i * 12) + '%';
      _skeletonEl.appendChild(bar);
    }
    if (!document.getElementById('pageSkeletonStyle')) {
      var st = document.createElement('style');
      st.id = 'pageSkeletonStyle';
      st.textContent = '@keyframes pageSkeletonShimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}';
      document.head.appendChild(st);
    }
    main.appendChild(_skeletonEl);
  }

  function hideSkeleton() {
    if (_skeletonEl && _skeletonEl.parentNode) _skeletonEl.parentNode.removeChild(_skeletonEl);
    _skeletonEl = null;
  }

  var _started = false;

  function run(fn) {
    var u = user();
    try {
      var r = fn(u);
      if (r && typeof r.catch === 'function') {
        r.catch(function (err) {
          hideSkeleton();
          reportPageError(err);
        });
      }
    } catch (err) {
      hideSkeleton();
      reportPageError(err);
    }
  }

  function flush() {
    _started = true;
    while (_queue.length) run(_queue.shift());
  }

  function reportPageError(err) {
    console.error('[page]', err);
    var R = window.DSHREPORT;
    if (R && R.show) {
      R.show({
        status: 'PAGE',
        code: 'PAGE_ERROR',
        message: '页面处理出错',
        detail: String(err && (err.detail || err.message) || err),
        requestId: err && err.requestId,
        url: location.pathname
      });
    }
  }

  function boot(cfg) {
    if (_booted) return;
    _booted = true;
    _config = Object.assign(_config, cfg || {});

    if (_config.title) document.title = _config.title;

    if (_config.requireAuth && typeof window.isLoggedIn === 'function' && !window.isLoggedIn()) {
      var back = encodeURIComponent(location.pathname + location.search);
      location.replace('/login.html?redirect=' + back);
      return;
    }

    if (_config.skeleton) showSkeleton();

    // 有 topbar/sidebar 容器时，等它们注入完成再跑页面逻辑
    var hasLayout = document.getElementById('topbarContainer') || document.getElementById('sidebarContainer');
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { setTimeout(flush, hasLayout ? 30 : 0); });
    } else {
      setTimeout(flush, hasLayout ? 30 : 0);
    }
  }

  function ready(fn) {
    if (typeof fn !== 'function') return;
    if (_started) { run(fn); return; }   // 已启动：立即执行
    _queue.push(fn);                      // 否则排队，等 boot 后按序执行
  }

  window.Page = {
    boot: boot,
    ready: ready,
    user: user,
    showSkeleton: showSkeleton,
    hideSkeleton: hideSkeleton,
    config: function () { return _config; },
    error: reportPageError
  };
})();
