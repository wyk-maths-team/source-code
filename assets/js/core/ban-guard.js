// assets/js/core/ban-guard.js —— 被封账号的只读网络层
//
// 被封禁的学生照样能进网站、能看页面上的内容，
// 但除了登录之外的任何 API 调用都会被拦下来，不发出去。
//
// 做法是在 fetch / XMLHttpRequest 外面套一层闸门，
// 这样不用改任何调用点，全站统一生效。

(function () {
  'use strict';
  if (window.__banGuardInstalled) return;
  window.__banGuardInstalled = true;

  // 封禁期间仍允许的接口：只有登录。
  // 连登录都不放的话，本人根本看不到自己为什么被封。
  const ALLOWED = [/^\/api\/login(\?|$)/];

  function banInfo() {
    try {
      const raw = localStorage.getItem('ban_info');
      if (!raw) return null;
      const info = JSON.parse(raw);
      if (info && info.until && new Date(info.until).getTime() <= Date.now()) {
        localStorage.removeItem('ban_info');
        return null;
      }
      return info;
    } catch (e) { return null; }
  }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function pathOf(url) {
    try { return new URL(url, location.origin).pathname; } catch (e) { return url; }
  }

  function isApi(url) {
    try {
      const u = new URL(url, location.origin);
      return u.origin === location.origin && u.pathname.indexOf('/api/') === 0;
    } catch (e) { return false; }
  }

  function allowed(url) {
    const p = pathOf(url);
    return ALLOWED.some((re) => re.test(p));
  }

  // guardBlocked 是给 auth.js 看的：这个 403 是本地闸门造出来的，
  // 不代表会话失效，绝不能再触发一次全屏封禁遮挡。
  const BODY = JSON.stringify({
    success: false,
    banned: true,
    guardBlocked: true,
    message: 'Your account is banned. Requests are disabled.',
  });

  function blockResponse() {
    return new Response(BODY, { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // ── fetch ────────────────────────────────────────────
  const realFetch = window.fetch;
  if (typeof realFetch === 'function') {
    window.fetch = function (input, init) {
      const info = banInfo();
      const url = urlOf(input);
      if (info && isApi(url) && !allowed(url)) {
        // 让调用方拿到一个正常的 403，而不是一个奇怪的异常
        return Promise.resolve(blockResponse());
      }
      return realFetch.apply(this, arguments);
    };
  }

  // ── XMLHttpRequest ───────────────────────────────────
  if (window.XMLHttpRequest) {
    const RealXHR = window.XMLHttpRequest;
    const open = RealXHR.prototype.open;
    const send = RealXHR.prototype.send;

    RealXHR.prototype.open = function (method, url) {
      this.__banBlocked = !!(banInfo() && isApi(url) && !allowed(url));
      return open.apply(this, arguments);
    };

    RealXHR.prototype.send = function () {
      if (!this.__banBlocked) return send.apply(this, arguments);
      const self = this;
      // 伪造成一次 403 完成，调用方的 onreadystatechange / onload 逻辑不用改
      setTimeout(() => {
        try {
          Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
          Object.defineProperty(self, 'status', { value: 403, configurable: true });
          Object.defineProperty(self, 'responseText', { value: BODY, configurable: true });
          if (typeof self.onreadystatechange === 'function') self.onreadystatechange();
          if (typeof self.onload === 'function') self.onload();
        } catch (e) {
          // 拦截失败就让原请求继续，别把人卡死在半路
          send.apply(self, arguments);
        }
      }, 0);
    };
  }

  window.BanGuard = { isBanned: () => !!banInfo(), info: banInfo };
})();
