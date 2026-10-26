// assets/js/core/net.js
//
// 自动捕获所有 /api/ 请求的失败，并给出可复现的错误信息。
//
// 为什么用拦截而不是逐页改：全站有 70+ 处裸 fetch，逐个改风险高、易漏。
// 这里劫持 window.fetch，**不需要任何页面配合**即可生效。
//
// 可见性策略（不打扰学生，但有据可查）：
//   5xx / 网络中断  -> 右下角红色 toast，点一下展开完整详情（错误码/请求ID/详情）
//   4xx             -> 只写 console（业务校验失败，页面自己会提示用户）
//   加 ?apiDebug=1  -> 所有失败都直接弹详情面板，并记住该设置
//
// 依赖 ui.js（应在它之后引入）。

(function () {
  'use strict';
  if (window.__DSH_NET_INSTALLED) return;
  window.__DSH_NET_INSTALLED = true;

  var DEBUG_KEY = 'dshApiDebug';
  function isDebug() {
    try {
      var q = new URLSearchParams(location.search);
      if (q.get('apiDebug') === '1') { localStorage.setItem(DEBUG_KEY, '1'); return true; }
      if (q.get('apiDebug') === '0') { localStorage.removeItem(DEBUG_KEY); return false; }
      return localStorage.getItem(DEBUG_KEY) === '1';
    } catch (e) { return false; }
  }

  function ui() { return window.DSHUI || null; }

  function urlOf(input) {
    if (typeof input === 'string') return input;
    if (input && typeof input.url === 'string') return input.url;
    return '';
  }

  function pathOf(abs) {
    try {
      if (abs.charAt(0) === '/') return abs.split('?')[0];
      return new URL(abs, location.href).pathname;
    } catch (e) { return abs; }
  }

  var DEFAULT_MSG = {
    400: '请求参数有误',
    401: '登录已过期，请重新登录',
    403: '没有权限执行此操作',
    404: '接口或资源不存在',
    409: '数据冲突，请刷新后重试',
    429: '操作太频繁，请稍后再试',
    500: '服务器内部错误',
    502: '上游服务无响应',
    503: '服务暂时不可用',
    504: '请求超时'
  };

  function defaultMessage(status) {
    return DEFAULT_MSG[status] || ('请求失败 (HTTP ' + status + ')');
  }

  // ══════════ 统一上报 ══════════
  function report(info) {
    var debug = isDebug();
    var status = info.status;
    var isServerSide = typeof status === 'number' ? status >= 500 : true; // 网络错误也归为此类

    // 控制台永远留一份完整记录，方便贴给别人看
    var tag = '[api] ' + (info.method || 'GET') + ' ' + (info.url || '') + ' -> ' + status;
    if (isServerSide) {
      console.error(tag, info);
    } else {
      console.warn(tag, info);
    }

    var U = ui();
    if (!U) return;

    if (debug) {
      U.showError(info);
      return;
    }
    if (isServerSide) {
      var msg = info.message || defaultMessage(status);
      U.toast(msg, 'err', {
        ms: 8000,
        note: [info.code || ('HTTP ' + status), info.requestId].filter(Boolean).join(' · ') + '  ·  点此查看详情',
        onClick: function () { U.showError(info); }
      });
    }
  }

  // ══════════ 解析响应体 ══════════
  function readError(res, url, method) {
    var out = {
      status: res.status,
      url: pathOf(url),
      method: method,
      code: null,
      message: '',
      detail: '',
      requestId: '',
      at: '',
      stack: ''
    };
    var clone;
    try { clone = res.clone(); } catch (e) { return out; }
    return clone.text().then(function (text) {
      if (!text) return out;
      var body = null;
      try { body = JSON.parse(text); } catch (e) { /* 不是 JSON */ }
      if (body && typeof body === 'object') {
        out.code = body.code || null;
        out.message = body.message || body.error || '';
        out.detail = body.detail || '';
        out.requestId = body.requestId || '';
        out.at = body.at || '';
        out.stack = body.stack || '';
        // 有些接口把错误信息塞在 error 对象里
        if (!out.detail && body.error && typeof body.error === 'object') {
          out.detail = body.error.message || JSON.stringify(body.error).slice(0, 500);
        }
      } else {
        // 非 JSON（例如 500 的 HTML 错误页）
        out.detail = String(text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
      }
      return out;
    }, function () { return out; });
  }

  // ══════════ 劫持 fetch ══════════
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var abs = urlOf(input);
      var method = (init && init.method) || (input && input.method) || 'GET';
      var isApi = abs.indexOf('/api/') !== -1;

      var p;
      try {
        p = origFetch.apply(this, arguments);
      } catch (e) {
        if (isApi) report({ status: 'NETWORK', url: pathOf(abs), method: method, message: '请求未能发出', detail: String(e && e.message || e) });
        throw e;
      }
      if (!isApi) return p;

      return p.then(function (res) {
        if (res && res.status >= 400) {
          readError(res, abs, method).then(function (info) {
            if (info.detail && !info.message) info.message = defaultMessage(info.status);
            report(info);
          });
        }
        return res;
      }, function (err) {
        // 网络层失败（DNS/断网/CORS/超时）
        report({
          status: 'NETWORK',
          url: pathOf(abs),
          method: method,
          code: 'NETWORK',
          message: '网络请求失败',
          detail: String(err && err.message || err)
        });
        throw err;
      });
    };
  }

  // ══════════ 全局兜底：未捕获异常 ══════════
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    // fetch 失败已经在上面的包装里报过了，避免重复
    if (r && (r.name === 'TypeError' || r.__dshReported)) return;
    console.error('[unhandledRejection]', r);
  });
  window.addEventListener('error', function (ev) {
    if (!ev || !ev.message) return;
    console.error('[window.error]', ev.message, ev.filename + ':' + ev.lineno);
  });

  // 供页面手动上报（页面自己 catch 到错误时调用）
  window.DSHREPORT = {
    error: report,
    show: function (info) { var U = ui(); if (U) U.showError(info); else console.error(info); },
    debug: isDebug,
    enableDebug: function () { try { localStorage.setItem(DEBUG_KEY, '1'); } catch (e) {} return true; },
    disableDebug: function () { try { localStorage.removeItem(DEBUG_KEY); } catch (e) {} return false; }
  };

  // 首次以调试模式载入时，给个提示
  if (isDebug() && window.console) {
    console.info('[net] API 调试模式已开启：所有接口失败都会弹出详情。关闭请访问 ?apiDebug=0');
  }
})();
