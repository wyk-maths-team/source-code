// assets/js/bundle-loader.js
//
// 按位置决定加载哪个包。由 tools/build-bundle.mjs 改写两个文件名，别手改。
//
// 页面里出现两次，各自负责自己那一段：
//
//   <head> 里：  <script src="/assets/js/bundle-loader.js" data-part="head"></script>
//   <body> 里：  <script src="/assets/js/bundle-loader.js" data-part="body"></script>
//
// 为什么会这样：核心脚本本来就分两段执行。head 里 13 个是基础设施，
// 不碰 DOM；body 里 8 个（app/topbar/sidebar 等）必须等 <body> 解析出来
// 才能跑。曾经把 21 个合成一个塞进 head，后 8 个提前执行，app.js 的
// initApp() 在 document.body.classList 上抛错，它后面的 topbar / sidebar
// 初始化全被跳过 —— 页面看着加载完了，顶栏侧栏却是空的。
//
// 用 document.write 而不是 appendChild：只有 write 出去的脚本才按顺序
// 同步阻塞执行，和原来那些标签的行为完全一致。appendChild 是 async 的，
// 会打乱依赖顺序。

(function () {
  var BUNDLE_HEAD = 'bundle.head.3c5cc11450.js';   // 由构建脚本改写
  var BUNDLE_BODY = 'bundle.body.09135868c2.js';   // 由构建脚本改写

  var self = document.currentScript;
  var part = (self && self.getAttribute('data-part')) || 'body';

  var v = (self && self.src && self.src.match(/[?&]v=([A-Za-z0-9_-]+)/) || [])[1];
  var q = v ? '?v=' + v : '';

  var LISTS = {
    head: {
      bundle: BUNDLE_HEAD,
      files: [
        'arch-render.js',
        'core/ui.js', 'core/net.js', 'core/ban-guard.js', 'core/latex-doc.js',
        'core/status-badge.js', 'core/script-panel.js', 'core/api.js', 'core/padstore.js',
        'core/radial-menu.js', 'core/ban-screen.js', 'core/ban-index.js', 'core/page.js',
      ],
    },
    body: {
      bundle: BUNDLE_BODY,
      files: [
        'auth.js', 'app.js', 'topbar.js', 'sidebar.js',
        'core/polling.js', 'heartbeat.js', 'pk-invite-widget.js', 'pk-notify.js',
      ],
    },
  };

  var cfg = LISTS[part];
  if (!cfg) {
    console.error('[bundle-loader] 未知的 data-part:', part);
    return;
  }

  var useBundle = false;
  try { useBundle = localStorage.getItem('moj:perf:bundle') === '1'; } catch (e) {}

  var files = useBundle
    ? ['/assets/js/' + cfg.bundle]
    : cfg.files.map(function (f) { return '/assets/js/' + f; });

  for (var i = 0; i < files.length; i++) {
    document.write('<script src="' + files[i] + q + '"><\/script>');
  }

  // 汇总两个 loader 的状态，设置页和调试用
  window.__mojBundle = window.__mojBundle || { enabled: useBundle, parts: {} };
  window.__mojBundle.parts[part] = { count: files.length, list: files };
})();
