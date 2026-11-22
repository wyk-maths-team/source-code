// assets/js/bundle-loader.js
//
// 决定「按原样加载 21 个文件」还是「加载合并后的 bundle」。
// 由 tools/build-bundle.mjs 改写 BUNDLE_FILE 常量，别手改。
//
// 为什么需要这个文件而不是直接把 21 个 script 换成 1 个：
// bundle 是可选功能，用户关掉开关必须能退回原路径。而 <script src> 一旦写进
// HTML 就会加载，没法「事后取消」，所以判断必须发生在加载之前。
//
// 这里用 document.write 而不是动态 appendChild：只有 write 出去的 script
// 才会按顺序同步阻塞执行，和原来 21 个标签的行为完全一致。appendChild 是
// async 的，会打乱依赖顺序。

(function () {
  var BUNDLE_FILE = 'bundle.1e8eb3e72c.js';   // 由构建脚本改写

  var self = document.currentScript;
  var v = (self && self.src && self.src.match(/[?&]v=([A-Za-z0-9_-]+)/) || [])[1];
  var q = v ? '?v=' + v : '';

  var CORE = window.__MOJ_CORE__ || [];
  if (!CORE.length) {
    console.error('[bundle-loader] window.__MOJ_CORE__ 为空，核心脚本未加载');
    return;
  }

  var useBundle = false;
  try { useBundle = localStorage.getItem('moj:perf:bundle') === '1'; } catch (e) {}

  var files = useBundle
    ? ['/assets/js/' + BUNDLE_FILE]
    : CORE.map(function (f) { return '/assets/js/' + f; });

  for (var i = 0; i < files.length; i++) {
    document.write('<script src="' + files[i] + q + '"><\/script>');
  }

  // 让设置页能显示当前状态，也方便在控制台确认
  window.__mojBundle = {
    enabled: useBundle,
    count: files.length,
    list: files,
  };
})();
