/* moj core bundle [head] · 13 files
 * 位置是语义的：head 段不碰 DOM，body 段必须在 <body> 之后执行。
 * 由 tools/build-bundle.mjs 生成，勿手改。
 * 关闭方式：localStorage.removeItem('moj:perf:bundle') */
/* arch-render.js */
// lib/achievement-toast.js
// 全局成就通知 —— 右上角滑入
(function () {
  'use strict';
  if (document.getElementById('ach-toast-style')) return;
  const style = document.createElement('style');
  style.id = 'ach-toast-style';
  style.textContent = `
    #ach-toast-container{
      position:fixed;top:20px;right:20px;z-index:2147483647;
      display:flex;flex-direction:column;gap:12px;pointer-events:none;
    }
    .ach-toast{
      display:flex;align-items:center;gap:14px;
      padding:14px 18px;min-width:280px;max-width:380px;
      background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
      border:2px solid #ffd700;border-radius:12px;color:#fff;
      box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 30px rgba(255,215,0,.35);
      transform:translateX(140%);opacity:0;
      transition:transform .5s cubic-bezier(.34,1.56,.64,1),opacity .3s;
      pointer-events:auto;
      font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    }
    .ach-toast.show{transform:translateX(0);opacity:1}
    .ach-toast-icon{
      width:52px;height:52px;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      border-radius:50%;font-size:1.5rem;color:#1a1a2e;
      background:radial-gradient(circle,#ffd700 0%,#ff8c00 100%);
      box-shadow:0 0 20px rgba(255,215,0,.6);
      animation:achPulse 1.8s ease-in-out infinite;
    }
    @keyframes achPulse{
      0%,100%{transform:scale(1)}
      50%{transform:scale(1.1)}
    }
    .ach-toast-body{flex:1;min-width:0}
    .ach-toast-label{
      font-size:10px;text-transform:uppercase;letter-spacing:1.5px;
      color:#ffd700;font-weight:800;margin-bottom:3px;
    }
    .ach-toast-name{font-size:15px;font-weight:800;margin-bottom:2px;letter-spacing:-.2px}
    .ach-toast-desc{font-size:12px;color:rgba(255,255,255,.7);line-height:1.3}
    /* 稀有度 */
    .ach-toast.r-common{border-color:#9ca3af}
    .ach-toast.r-common .ach-toast-icon{background:radial-gradient(circle,#d1d5db,#6b7280)}
    .ach-toast.r-common .ach-toast-label{color:#d1d5db}
    .ach-toast.r-uncommon{border-color:#22c55e;box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 30px rgba(34,197,94,.35)}
    .ach-toast.r-uncommon .ach-toast-icon{background:radial-gradient(circle,#4ade80,#15803d)}
    .ach-toast.r-uncommon .ach-toast-label{color:#4ade80}
    .ach-toast.r-rare{border-color:#3b82f6;box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 30px rgba(59,130,246,.4)}
    .ach-toast.r-rare .ach-toast-icon{background:radial-gradient(circle,#60a5fa,#1d4ed8)}
    .ach-toast.r-rare .ach-toast-label{color:#60a5fa}
    .ach-toast.r-epic{border-color:#a855f7;box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 30px rgba(168,85,247,.4)}
    .ach-toast.r-epic .ach-toast-icon{background:radial-gradient(circle,#c084fc,#7e22ce)}
    .ach-toast.r-epic .ach-toast-label{color:#c084fc}
    .ach-toast.r-legendary{border-color:#f59e0b;box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 40px rgba(245,158,11,.6)}
    .ach-toast.r-legendary .ach-toast-icon{background:radial-gradient(circle,#fbbf24,#d97706)}
    .ach-toast.r-legendary .ach-toast-label{color:#fbbf24}
    @media (max-width:600px){
      #ach-toast-container{top:12px;left:12px;right:12px;align-items:stretch}
      .ach-toast{min-width:0;max-width:100%}
    }
  `;
  document.head.appendChild(style);
  const queue = [];
  let showing = false;
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }
  function getContainer() {
    let c = document.getElementById('ach-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'ach-toast-container';
      document.body.appendChild(c);
    }
    return c;
  }
  function processQueue() {
    if (showing || !queue.length) return;
    const a = queue.shift();
    showing = true;
    const el = document.createElement('div');
    el.className = 'ach-toast r-' + (a.rarity || 'common');
    const iconHtml = a.svg
      ? `<img src="${esc(a.svg)}" alt="" width="44" height="44" style="display:block;border-radius:10px">`
      : `<i class="${esc(a.icon || 'fa-solid fa-trophy')}"></i>`;
    el.innerHTML = `
      <div class="ach-toast-icon">${iconHtml}</div>
      <div class="ach-toast-body">
        <div class="ach-toast-label">Achievement Unlocked</div>
        <div class="ach-toast-name">${esc(a.name || a.id)}</div>
        <div class="ach-toast-desc">${esc(a.desc || '')}</div>
      </div>
    `;
    getContainer().appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => {
        el.remove();
        showing = false;
        processQueue();
      }, 500);
    }, 6000);
  }
  window.showAchievementToast = function (a) {
    if (!a || !a.id) return;
    queue.push(a);
    processQueue();
  };
  window.showAchievementToasts = function (arr) {
    if (!Array.isArray(arr) || !arr.length) {
      // 没有新成就时什么都不做；打一行日志方便排查「为什么没弹」
      if (window.console) console.debug('[achievement] nothing new to show');
      return;
    }
    if (window.console) console.debug('[achievement] showing', arr.map((a) => a && a.id));
    for (const a of arr) window.showAchievementToast(a);
  };
})();
;
/* core/ui.js */
// assets/js/core/ui.js
//
// 全站通用 UI 工具。零依赖，自注入样式，适配现有 light/dark 主题变量。
// 暴露 window.DSHUI。
//
// 用途：
//   DSHUI.toast('已保存', 'ok')            轻提示
//   DSHUI.showError(errInfo)               错误详情面板（API 失败时由 net.js 调用）
//   DSHUI.esc(unsafe)                      HTML 转义
(function () {
  'use strict';
  if (window.DSHUI) return;
  // ══════════ 转义 ══════════
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  // ══════════ 样式（只注入一次）══════════
  var STYLE_ID = 'dsh-ui-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '#dsh-toasts{position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:min(380px,calc(100vw - 32px));pointer-events:none}',
      '.dsh-toast{pointer-events:auto;cursor:pointer;background:var(--card-bg,#fff);color:var(--text-primary,#222);border:1px solid var(--border-color,#ddd);border-left:4px solid #4a90d9;border-radius:8px;padding:10px 14px;font-size:14px;line-height:1.45;box-shadow:0 6px 24px rgba(0,0,0,.16);animation:dsh-in .16s ease-out;word-break:break-word}',
      '.dsh-toast.ok{border-left-color:#2ea44f}',
      '.dsh-toast.warn{border-left-color:#e3a008}',
      '.dsh-toast.err{border-left-color:#d93025}',
      '.dsh-toast small{display:block;opacity:.65;margin-top:3px;font-size:12px}',
      '@keyframes dsh-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '#dsh-err-mask{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}',
      '#dsh-err-box{background:var(--card-bg,#fff);color:var(--text-primary,#222);border-radius:12px;max-width:640px;width:100%;max-height:82vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.35);font-size:14px}',
      '#dsh-err-box header{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--border-color,#e5e5e5);font-weight:600}',
      '#dsh-err-box header .dot{width:9px;height:9px;border-radius:50%;background:#d93025;flex:0 0 auto}',
      '#dsh-err-box .body{padding:14px 18px}',
      '#dsh-err-box .row{display:flex;gap:10px;margin-bottom:9px;align-items:flex-start}',
      '#dsh-err-box .k{flex:0 0 92px;opacity:.6;font-size:12.5px;padding-top:2px}',
      '#dsh-err-box .v{flex:1;min-width:0;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;background:rgba(127,127,127,.09);border-radius:5px;padding:3px 7px}',
      '#dsh-err-box .v.plain{font-family:inherit;font-size:13.5px;background:none;padding:0}',
      '#dsh-err-box footer{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--border-color,#e5e5e5)}',
      '#dsh-err-box button{font:inherit;cursor:pointer;border-radius:7px;padding:7px 15px;border:1px solid var(--border-color,#ccc);background:transparent;color:inherit}',
      '#dsh-err-box button.primary{background:#4a90d9;border-color:#4a90d9;color:#fff}'
    ].join('');
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }
  // ══════════ Toast ══════════
  function container() {
    var c = document.getElementById('dsh-toasts');
    if (!c) {
      c = document.createElement('div');
      c.id = 'dsh-toasts';
      document.body.appendChild(c);
    }
    return c;
  }
  /**
   * @param {string} msg
   * @param {'ok'|'warn'|'err'|''} type
   * @param {{ms?:number, note?:string, onClick?:Function}} [opt]
   */
  function toast(msg, type, opt) {
    ensureStyle();
    opt = opt || {};
    var el = document.createElement('div');
    el.className = 'dsh-toast ' + (type || '');
    el.innerHTML = esc(msg) + (opt.note ? '<small>' + esc(opt.note) + '</small>' : '');
    if (opt.onClick) el.addEventListener('click', opt.onClick);
    container().appendChild(el);
    var ms = opt.ms === undefined ? 4200 : opt.ms;
    if (ms > 0) {
      setTimeout(function () {
        el.style.transition = 'opacity .2s';
        el.style.opacity = '0';
        setTimeout(function () { el.parentNode && el.parentNode.removeChild(el); }, 220);
      }, ms);
    }
    return el;
  }
  // ══════════ 错误详情面板 ══════════
  var lastError = null;
  /**
   * @param {object} info {status, code, message, detail, requestId, at, url, stack}
   */
  function showError(info) {
    ensureStyle();
    info = info || {};
    lastError = info;
    var old = document.getElementById('dsh-err-mask');
    if (old) old.parentNode.removeChild(old);
    var rows = [];
    function row(k, v, plain) {
      if (v === undefined || v === null || v === '') return;
      rows.push('<div class="row"><div class="k">' + esc(k) + '</div><div class="v' + (plain ? ' plain' : '') + '">' + esc(v) + '</div></div>');
    }
    row('说明', info.message, true);
    row('错误码', info.code);
    row('HTTP', info.status);
    row('接口', info.url || info.at);
    row('请求ID', info.requestId);
    row('详情', info.detail);
    if (info.stack) row('堆栈', String(info.stack).split('\n').slice(0, 6).join('\n'));
    var mask = document.createElement('div');
    mask.id = 'dsh-err-mask';
    mask.innerHTML =
      '<div id="dsh-err-box" role="dialog" aria-modal="true">' +
        '<header><span class="dot"></span><span>操作失败</span></header>' +
        '<div class="body">' + rows.join('') + '</div>' +
        '<footer>' +
          '<button type="button" data-act="copy">复制详情</button>' +
          '<button type="button" class="primary" data-act="close">关闭</button>' +
        '</footer>' +
      '</div>';
    function close() { mask.parentNode && mask.parentNode.removeChild(mask); }
    mask.addEventListener('click', function (e) {
      if (e.target === mask) return close();
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'close') return close();
      if (act === 'copy') {
        var text = [
          '错误码: ' + (info.code || '-'),
          '说明: ' + (info.message || '-'),
          'HTTP: ' + (info.status || '-'),
          '接口: ' + (info.url || info.at || '-'),
          '请求ID: ' + (info.requestId || '-'),
          '详情: ' + (info.detail || '-'),
          '时间: ' + new Date().toISOString()
        ].join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            e.target.textContent = '已复制';
            setTimeout(function () { e.target.textContent = '复制详情'; }, 1500);
          }, function () { toast('复制失败，请手动选择文本', 'warn'); });
        } else {
          toast('当前浏览器不支持自动复制', 'warn');
        }
      }
    });
    document.addEventListener('keydown', function onKey(ev) {
      if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    document.body.appendChild(mask);
    return mask;
  }
  window.DSHUI = {
    esc: esc,
    toast: toast,
    showError: showError,
    lastError: function () { return lastError; }
  };
})();
;
/* core/net.js */
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
;
/* core/ban-guard.js */
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
;
/* core/latex-doc.js */
// assets/js/core/latex-doc.js —— 把整份 LaTeX 文档转成可在页面上渲染的形式
//
// 学生交上来的答案常常不是「一段公式」，而是完整的一份 .tex 源文件：
//   \documentclass[12pt]{ctexart}
//   \usepackage{amsmath,amssymb,amsthm}
//   \begin{document}
//   ...
//   \end{document}
//
// KaTeX 只认数学片段，这些包装会原样漏到屏幕上。这里只做「剥壳 + 把少数
// 文本命令换成 HTML」，真正的公式仍然交给 renderMathInElement 处理。
// 不追求完整实现 LaTeX —— 只保证这种作业能读。
(function () {
  'use strict';
  if (window.LatexDoc) return;
  // 整行级别的包装：直接删掉
  var DROP_PATTERNS = [
    /^\\documentclass(\[[^\]]*\])?\{[^}]*\}\s*$/gm,
    /^\\usepackage(\[[^\]]*\])?\{[^}]*\}\s*$/gm,
    /^\\begin\{document\}\s*$/gm,
    /^\\end\{document\}\s*$/gm,
    /^\\maketitle\s*$/gm,
    /^\\tableofcontents\s*$/gm,
    /^\\newpage\s*$/gm,
    /^\\clearpage\s*$/gm,
    /^\\pagestyle\{[^}]*\}\s*$/gm,
    /^\\thispagestyle\{[^}]*\}\s*$/gm,
  ];
  // 文本命令 → HTML。参数里若含 $...$ 会保留，公式照旧渲染。
  var TEXT_COMMANDS = [
    ['textbf', 'strong'],
    ['textit', 'em'],
    ['textsl', 'em'],
    ['emph', 'em'],
    ['underline', 'u'],
    ['texttt', 'code'],
  ];
  function expandTextCommand(src, name, tag) {
    // 处理 \textbf{...}，允许参数里嵌套一层花括号
    var re = new RegExp('\\\\' + name + '\\{((?:[^{}]|\\{[^{}]*\\})*)\\}', 'g');
    return src.replace(re, function (_, inner) {
      return '<' + tag + '>' + inner + '</' + tag + '>';
    });
  }
  /**
   * @param {string} input  已经过 HTML 转义的答案文本
   * @returns {string}      可交给 renderMathInElement 的 HTML
   */
  function convert(input) {
    var s = String(input == null ? '' : input);
    if (!s) return '';
    // 只在这种明确的文档包装存在时才动手，避免误伤普通答案
    var looksLikeDoc = /\\documentclass|\\begin\{document\}/.test(s);
    if (!looksLikeDoc) return s;
    DROP_PATTERNS.forEach(function (re) { s = s.replace(re, ''); });
    // 单行形式（整段挤在一行里的写法）
    s = s.replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}/g, '');
    s = s.replace(/\\usepackage(\[[^\]]*\])?\{[^}]*\}/g, '');
    s = s.replace(/\\begin\{document\}/g, '');
    s = s.replace(/\\end\{document\}/g, '');
    // 文本命令
    TEXT_COMMANDS.forEach(function (pair) {
      s = expandTextCommand(s, pair[0], pair[1]);
    });
    // 分段 / 换行：\ 在公式外是换行，公式内由 KaTeX 自己处理。
    // 这里只把「不在 $$...$$ 里」的 \ 换成 <br>。
    s = replaceOutsideMath(s, /\\\\/g, '<br>');
    // 空行 → 段落
    s = s.replace(/\n{2,}/g, '</p><p>');
    return s.trim();
  }
  /** 把 $...$ / $$...$$ 之外的内容交给 fn 处理 */
  function replaceOutsideMath(src, re, replacement) {
    var out = '';
    var i = 0;
    while (i < src.length) {
      var dd = src.indexOf('$$', i);
      var sd = src.indexOf('$', i);
      // 找最近的一个起始定界符（$$ 优先）
      if (dd !== -1 && (sd === -1 || dd <= sd)) {
        out += src.slice(i, dd).replace(re, replacement);
        var endDD = src.indexOf('$$', dd + 2);
        if (endDD === -1) { out += src.slice(dd); return out; }
        out += src.slice(dd, endDD + 2);
        i = endDD + 2;
      } else if (sd !== -1) {
        out += src.slice(i, sd).replace(re, replacement);
        var endSD = src.indexOf('$', sd + 1);
        if (endSD === -1) { out += src.slice(sd); return out; }
        out += src.slice(sd, endSD + 1);
        i = endSD + 1;
      } else {
        out += src.slice(i).replace(re, replacement);
        break;
      }
    }
    return out;
  }
  window.LatexDoc = { convert: convert, looksLikeDoc: function (s) { return /\\documentclass|\\begin\{document\}/.test(String(s || '')); } };
})();
;
/* core/status-badge.js */
// assets/js/core/status.js —— 提交状态的客户端解析
//
// 和后端 lib/submission-status.js 一一对应，只做三件事：
// 把 'AC' / 'PS60' / 'WA' / 'V60' / 'SE' 变成
//   - 解析后的对象
//   - 显示文案
//   - CSS 类名
//
// 页面上不再有第二套判断 —— 以前列表、详情页、工作台各自拼一遍，
// 改一处漏一处就是这么来的。
(function () {
  'use strict';
  if (window.SubStatus) return;
  var VERDICT_LABEL = {
    AC: 'Accepted',
    WA: 'Wrong Answer',
    SE: 'System Error',
    Pending: 'Pending',
  };
  var VERDICT_CLASS = {
    AC: 'status-accepted',
    WA: 'status-wrong',
    SE: 'status-system',
    Pending: 'status-pending',
    PS: 'status-partial',     // 黄色：部分分
    V: 'status-violation',    // 紫色：违规
  };
  function parse(status) {
    var s = String(status == null ? '' : status).trim().toUpperCase();
    if (s === 'AC') return { raw: 'AC', verdict: 'AC', score: 100, correct: true, systemError: false, violation: false };
    if (s === 'WA') return { raw: 'WA', verdict: 'WA', score: 0, correct: false, systemError: false, violation: false };
    if (s === 'SE') return { raw: 'SE', verdict: 'SE', score: 0, correct: false, systemError: true, violation: false };
    var m = /^PS(\d{1,2})$/.exec(s);
    if (m) {
      var ps = Math.max(1, Math.min(99, parseInt(m[1], 10)));
      return { raw: s, verdict: 'PS', score: ps, correct: false, systemError: false, violation: false };
    }
    m = /^V(\d{1,2})$/.exec(s);
    if (m) {
      var vs = Math.max(0, Math.min(99, parseInt(m[1], 10)));
      return { raw: s, verdict: 'V', score: vs, correct: false, systemError: false, violation: true };
    }
    // 空值 = 还没批（图片提交）
    if (!s) return { raw: '', verdict: 'Pending', score: 0, correct: false, systemError: false, violation: false };
    return { raw: s, verdict: 'WA', score: 0, correct: false, systemError: false, violation: false };
  }
  function label(status) {
    var p = parse(status);
    if (p.verdict === 'PS') return 'Partial Score (' + p.score + ')';
    if (p.verdict === 'V') return 'Violation';
    return VERDICT_LABEL[p.verdict] || 'Wrong Answer';
  }
  function cls(status) {
    var p = parse(status);
    return VERDICT_CLASS[p.verdict] || 'status-wrong';
  }
  window.SubStatus = { parse: parse, label: label, cls: cls };
})();
;
/* core/script-panel.js */
// assets/js/core/script-panel.js —— 管理员专用的「可疑脚本」面板
//
// 题目 statement 是管理员写的富文本，历史上被人塞过偷 auth_token 的 <script>。
// 现在的规则：
//   学生 → script 直接被净化掉，连痕迹都不留
//   管理员 → 不执行，但把代码原样显示出来，关键字标红，旁边一个 Execute 按钮，
//            真的要看它干什么，由管理员自己按下去
//
// 只做两件事：把 <script> 从 HTML 里摘出来，以及把它们渲染成一个带按钮的面板。
(function () {
  'use strict';
  if (window.ScriptPanel) return;
  // 危险关键字：出现就标红，扫一眼就知道这段代码想干什么
  var KEYWORDS = [
    'fetch', 'XMLHttpRequest', 'eval', 'Function', 'import', 'WebSocket',
    'localStorage', 'sessionStorage', 'document\.cookie', 'auth_token',
    'innerHTML', 'onerror', 'onload', 'javascript:', 'webhook', 'atob', 'btoa',
  ];
  var KEY_RE = new RegExp('\\b(' + KEYWORDS.join('|') + ')\\b', 'g');
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 在已经转义过的文本上打高亮标记
  function highlight(code) {
    var out = esc(code);
    out = out.replace(KEY_RE, '<mark class="sp-kw">$1</mark>');
    // 注释整行压暗
    out = out.replace(/(&lt;!--[\s\S]*?--&gt;|\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g, '<span class="sp-comment">$1</span>');
    return out;
  }
  /**
   * 从一段 HTML 里摘掉所有 <script>。
   * @returns {{ clean: string, scripts: Array<{src: string, code: string}> }}
   */
  function split(html) {
    // iframe 的 srcdoc 里也可能藏着 <script>，正则照样能匹配到它。
    // 那样这段代码会被抽进面板，管理员一按 Execute 就在**主页面**执行了 ——
    // 权限比它原本的沙箱大得多。先把 iframe 整块吃掉。
    var raw = String(html || '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
    var scripts = [];
    var clean = raw.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, function (_, attrs, body) {
      var srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs || '');
      scripts.push({ src: srcMatch ? srcMatch[1] : '', code: body || '' });
      return '';
    });
    return { clean: clean, scripts: scripts };
  }
  function runScript(entry) {
    var el = document.createElement('script');
    if (entry.src) {
      el.src = entry.src;
      el.async = false;
    } else {
      el.textContent = entry.code;
    }
    document.body.appendChild(el);
  }
  /**
   * 把脚本面板挂到宿主元素下面。
   * @param {HTMLElement} host   渲染 statement 的容器
   * @param {Array} scripts      split() 返回的脚本数组
   */
  function render(host, scripts, opts) {
    if (!host || !scripts || !scripts.length) return;
    var autoForStudents = !!(opts && opts.autoForStudents);
    var hasSrc = scripts.some(function (s) { return !!s.src; });
    var box = document.createElement('div');
    box.className = 'sp-box';
    var head = document.createElement('div');
    head.className = 'sp-head';
    head.innerHTML =
      '<i class="fas fa-triangle-exclamation"></i>' +
      '<span class="sp-title">This problem contains ' + scripts.length + ' script' + (scripts.length > 1 ? 's' : '') + '</span>' +
      '<span class="sp-note">' +
        (autoForStudents
          ? 'Students run this automatically. You do not.'
          : 'Not executed. Read it first.') +
      '</span>';
    var runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'sp-run';
    runBtn.innerHTML = '<i class="fas fa-play"></i> Execute';
    runBtn.addEventListener('click', function () {
      if (!confirm('Run this script in the current page?\n\nIt has full access to your session.')) return;
      scripts.forEach(runScript);
      runBtn.disabled = true;
      runBtn.innerHTML = '<i class="fas fa-check"></i> Executed';
      box.classList.add('sp-ran');
    });
    head.appendChild(runBtn);
    box.appendChild(head);
    scripts.forEach(function (s, i) {
      var item = document.createElement('div');
      item.className = 'sp-item';
      var label = document.createElement('div');
      label.className = 'sp-label';
      label.innerHTML = s.src
        ? 'script #' + (i + 1) + ' · src = ' + esc(s.src)
        : 'script #' + (i + 1) + ' · inline';
      item.appendChild(label);
      if (s.code) {
        var pre = document.createElement('pre');
        pre.className = 'sp-code';
        pre.innerHTML = highlight(s.code);
        item.appendChild(pre);
      }
      box.appendChild(item);
    });
    if (hasSrc) {
      var warn = document.createElement('div');
      warn.className = 'sp-warn';
      warn.textContent = 'One or more scripts load from another origin. Executing will fetch and run that file.';
      box.appendChild(warn);
    }
    host.appendChild(box);
  }
  /** 当前用户是不是管理员 —— 只有他们才该看到这个面板 */
  function isAdmin() {
    try {
      var u = typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null;
      return !!u && (u.role === 'admin' || u.role === 'root');
    } catch (e) { return false; }
  }
  /**
   * 直接执行一组脚本。
   * 管理员面板的 Execute 按钮走这里；学生端只有当题目被显式标记
   * allowScript 时才会调用 —— 两者执行的是同一份逻辑，行为一致。
   */
  function run(scripts) {
    if (!Array.isArray(scripts) || !scripts.length) return;
    scripts.forEach(runScript);
  }
  window.ScriptPanel = { split: split, render: render, run: run, isAdmin: isAdmin, highlight: highlight };
})();
;
/* core/api.js */
// assets/js/core/api.js
//
// 统一的 API 请求封装（新代码请用这个，不要再裸写 fetch）。
//
//   const data = await API.get('/api/problem?id=HA0001');
//   const res  = await API.post('/api/submit', { problemId, answer });
//
// 失败时抛 API.ApiError，字段：status / code / message / detail / requestId / url
// 5xx 的提示由 core/net.js 自动弹出，这里不重复弹。
//
// 注意：旧的 window.apiCall() 仍然保留（auth.js 里），不要混用。
(function () {
  'use strict';
  if (window.API) return;
  function getToken() {
    try {
      if (typeof window.getToken === 'function') return window.getToken();
      return localStorage.getItem('auth_token') || '';
    } catch (e) { return ''; }
  }
  function ApiError(info) {
    this.name = 'ApiError';
    this.status = info.status;
    this.code = info.code || ('HTTP_' + info.status);
    this.message = info.message || '请求失败';
    this.detail = info.detail || '';
    this.requestId = info.requestId || '';
    this.url = info.url || '';
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;
  ApiError.prototype.toString = function () {
    return this.code + ' (HTTP ' + this.status + '): ' + this.message;
  };
  function buildError(res, body, url) {
    return new ApiError({
      status: res.status,
      code: body && body.code,
      message: (body && (body.message || body.error)) || ('请求失败 (HTTP ' + res.status + ')'),
      detail: (body && body.detail) || '',
      requestId: (body && body.requestId) || '',
      url: url.split('?')[0]
    });
  }
  async function call(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    var token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var init = {
      method: opts.method || 'GET',
      headers: headers,
      credentials: opts.credentials || 'same-origin'
    };
    if (opts.body !== undefined && opts.body !== null) {
      if (opts.raw) {
        init.body = opts.body;
      } else {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
        init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      }
    }
    var res;
    try {
      res = await fetch(path, init);
    } catch (e) {
      throw new ApiError({
        status: 'NETWORK',
        code: 'NETWORK',
        message: '网络请求失败',
        detail: String(e && e.message || e),
        url: path
      });
    }
    var text = '';
    try { text = await res.text(); } catch (e) { /* ignore */ }
    var body = null;
    if (text) { try { body = JSON.parse(text); } catch (e) { body = null; } }
    if (!res.ok) throw buildError(res, body, path);
    if (body === null) {
      // 非 JSON 响应（少见），返回原文本，交给调用方判断
      return text;
    }
    return body;
  }
  window.API = {
    ApiError: ApiError,
    call: call,
    get: function (p, o) { return call(p, Object.assign({ method: 'GET' }, o || {})); },
    post: function (p, body, o) { return call(p, Object.assign({ method: 'POST', body: body }, o || {})); },
    put: function (p, body, o) { return call(p, Object.assign({ method: 'PUT', body: body }, o || {})); },
    del: function (p, o) { return call(p, Object.assign({ method: 'DELETE' }, o || {})); },
    token: getToken
  };
})();
;
/* core/padstore.js */
// assets/js/core/padstore.js —— 画板草稿的存储层
//
// 三个目标：
//   1. 省地方：坐标量化到 0-999 的整数、扁平数组、相邻点差值(delta)，
//      相比原来的浮点对象小一半以上；再按距离抽稀，肉眼几乎看不出差别。
//   2. 会用不完：localStorage 是同步 API、约 5MB。写满时自动转存 IndexedDB
//      (localforage)，读的时候两边都查，调用方不用管存在哪。
//   3. 会自己打扫：每份草稿带 savedAt，超过保留期的自动清掉，
//      保留期默认 30 天，可以在设置里改。
//
// 没有 IndexedDB / localforage 加载失败时，全部退回 localStorage，功能不受影响。
(function () {
  'use strict';
  const PAD_VERSION = 2;
  const COORD_SCALE = 1000;        // 坐标量化到 0..1000
  const MIN_DIST = 3;              // 相对 1000 尺度的最小采样距离（约 3px @ 1000px 宽）
  const DEFAULT_TTL_DAYS = 30;
  const TTL_KEY = 'padstore_ttl_days';
  let lfPromise = null;
  function loadLocalforage() {
    if (window.localforage) return Promise.resolve(window.localforage);
    if (lfPromise) return lfPromise;
    lfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js';
      s.onload = () => {
        if (!window.localforage) return reject(new Error('localforage missing'));
        resolve(window.localforage);
      };
      s.onerror = () => reject(new Error('localforage failed to load'));
      document.head.appendChild(s);
    }).catch((e) => { lfPromise = null; throw e; });
    return lfPromise;
  }
  async function idb() {
    const lf = await loadLocalforage();
    return lf.createInstance({ name: 'wyk_pads', storeName: 'pads' });
  }
  // ── 编解码 ──────────────────────────────────────────────
  /**
   * strokes: [{ color:'#111827', width:4, points:[{x,y}] }]
   * 返回紧凑字符串；style 表只在这种题里出现过的颜色/粗细各存一次。
   */
  function encode(strokes, w, h) {
    const colors = [];
    const widths = [];
    const out = [];
    for (const st of strokes) {
      if (!st || !st.points || !st.points.length) continue;
      let ci = colors.indexOf(st.color);
      if (ci < 0) { ci = colors.length; colors.push(st.color); }
      // 橡皮擦用「负的粗细」表示，省一个字段
      const widthVal = st.erase ? -Math.abs(st.width || 1) : (st.width || 4);
      let wi = widths.indexOf(widthVal);
      if (wi < 0) { wi = widths.length; widths.push(widthVal); }
      const flat = [];
      let lastX = null, lastY = null;
      for (const p of st.points) {
        // 传进来的是 0-1 归一化坐标（画板统一这么存），量化到 0-1000
        const qx = Math.round(p.x * COORD_SCALE);
        const qy = Math.round(p.y * COORD_SCALE);
        if (lastX == null) { flat.push(qx, qy); }
        else {
          // 抽稀：离上一个点太近就不记，笔迹看着一样但省很多
          const dx = qx - lastX, dy = qy - lastY;
          if (Math.abs(dx) + Math.abs(dy) < MIN_DIST) continue;
          flat.push(dx, dy);
        }
        lastX = qx; lastY = qy;
      }
      if (flat.length >= 2) out.push([ci, wi, flat]);
    }
    return JSON.stringify({ v: PAD_VERSION, w: Math.round(w || 0), h: Math.round(h || 0), c: colors, wd: widths, s: out, t: Date.now() });
  }
  function decode(raw) {
    if (!raw) return [];
    let d;
    try { d = JSON.parse(raw); } catch (e) { return []; }
    if (!d) return [];
    // v1（老的浮点对象格式）里存的是绝对像素、且没记原尺寸，
    // 现在画板统一按 0-1 解读，读进来只会画到错误的位置。
    // 宁可从空白开始，也不要把以前的笔迹画歪。
    if (!d.v || d.v < 2) return [];
    const colors = d.c || ['#111827'];
    const widths = d.wd || [4];
    const strokes = [];
    for (const item of (d.s || [])) {
      const [ci, wi, flat] = item;
      const pts = [];
      let x = 0, y = 0;
      for (let i = 0; i < flat.length; i += 2) {
        if (i === 0) { x = flat[0]; y = flat[1]; }
        else { x += flat[i]; y += flat[i + 1]; }
        // 一律还原成 0-1，交给画板自己按当前尺寸展开
        pts.push({ x: x / COORD_SCALE, y: y / COORD_SCALE });
      }
      if (pts.length) {
        const wv = widths[wi] != null ? widths[wi] : widths[0];
        strokes.push({ color: colors[ci] || colors[0], width: Math.abs(wv) || 4, erase: wv < 0, points: pts });
      }
    }
    return strokes;
  }
  // ── 存活期 ──────────────────────────────────────────────
  function ttlDays() {
    try {
      const v = Number(localStorage.getItem(TTL_KEY));
      if (Number.isFinite(v) && v > 0) return v;
    } catch (e) {}
    return DEFAULT_TTL_DAYS;
  }
  function setTtlDays(days) {
    const d = Math.max(1, Math.min(3650, Number(days) || DEFAULT_TTL_DAYS));
    try { localStorage.setItem(TTL_KEY, String(d)); } catch (e) {}
    return d;
  }
  function isExpired(raw) {
    if (!raw) return false;
    let t = 0;
    try { t = Number(JSON.parse(raw).t) || 0; } catch (e) { return false; }
    if (!t) return false;    // 老格式没有时间戳，先留着
    return Date.now() - t > ttlDays() * 86400_000;
  }
  // ── 读写 ────────────────────────────────────────────────
  function saveSync(storageKey, raw) {
    try { localStorage.setItem(storageKey, raw); return true; }
    catch (e) { return false; }   // QuotaExceeded
  }
  /**
   * 主存储是 IndexedDB（容量大、异步、不阻塞主线程）；
   * 只有在 IndexedDB 不可用或写入失败时才退回 localStorage。
   */
  async function save(storageKey, strokes, w, h) {
    if (!strokes || !strokes.length) { remove(storageKey); return 'removed'; }
    const raw = encode(strokes, w, h);
    try {
      const store = await idb();
      await store.setItem(storageKey, raw);
      // 顺手清掉 localStorage 里的旧副本，避免读到过期数据
      try { localStorage.removeItem(storageKey); } catch (e) {}
      return 'idb';
    } catch (e) {
      // IndexedDB 不可用（隐私模式 / 被禁用 / 写满）→ 兜底 localStorage
      if (saveSync(storageKey, raw)) return 'local';
      console.warn('[PadStore] could not persist', e && e.message);
      return 'failed';
    }
  }
  /** 同步读：只碰 localStorage。返回 { found, strokes, overflowed } */
  function loadSync(storageKey, w, h) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return { found: false, strokes: [] };
      if (raw === '') return { found: false, strokes: [], overflowed: true };
      if (isExpired(raw)) { localStorage.removeItem(storageKey); return { found: false, strokes: [] }; }
      return { found: true, strokes: decode(raw, w, h) };
    } catch (e) { return { found: false, strokes: [] }; }
  }
  /** 异步读：IndexedDB 优先，没有再退回 localStorage */
  async function load(storageKey, w, h) {
    try {
      const store = await idb();
      const raw = await store.getItem(storageKey);
      if (raw) {
        if (isExpired(raw)) { await store.removeItem(storageKey); return []; }
        return decode(raw);
      }
    } catch (e) {
      // IndexedDB 不可用 → 落到下面的 localStorage 分支
    }
    const sync = loadSync(storageKey);
    return sync.found ? sync.strokes : [];
  }
  function remove(storageKey) {
    try { localStorage.removeItem(storageKey); } catch (e) {}
    idb().then((s) => s.removeItem(storageKey)).catch(() => {});
  }
  // 扫一遍所有画板草稿，删掉过期的
  async function purgeExpired() {
    let removed = 0;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (/^(pd_scratchpad:|coursePad:|paperPad:|inlinePad:|pdfPad)/.test(k)) keys.push(k);
      }
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw === '') continue;    // 内容在 IDB，下面处理
        if (isExpired(raw)) { localStorage.removeItem(k); removed++; }
      }
      // IDB 里的
      const store = await idb();
      const idbKeys = await store.keys();
      for (const k of idbKeys) {
        const raw = await store.getItem(k);
        if (isExpired(raw)) { await store.removeItem(k); localStorage.removeItem(k); removed++; }
      }
    } catch (e) { /* 没有 IDB 就只清 localStorage */ }
    return removed;
  }
  // ── 自动打扫 ──────────────────────────────────────────────
  // 每次加载最多跑一次（按天节流），不用等学生想起来去点「Purge expired」
  const LAST_PURGE_KEY = 'padstore_last_purge';
  function autoPurge() {
    try {
      const last = Number(localStorage.getItem(LAST_PURGE_KEY)) || 0;
      if (Date.now() - last < 86400_000) return;     // 一天一次够了
      localStorage.setItem(LAST_PURGE_KEY, String(Date.now()));
    } catch (e) { return; }
    purgeExpired().catch(() => {});
  }
  window.addEventListener('load', () => setTimeout(autoPurge, 2500));
  window.PadStore = {
    encode, decode, save, load, loadSync, remove, purgeExpired,
    ttlDays, setTtlDays,
    DEFAULT_TTL_DAYS,
    VERSION: PAD_VERSION,
  };
})();
;
/* core/radial-menu.js */
// assets/js/core/radial-menu.js —— Alt 键环形导航
//
// 交互：
//   按住 Alt   → 在光标处张开圆环，移动鼠标高亮对应扇区
//   松开 Alt   → 执行高亮项
//   Esc / 点空白 → 取消
//   点顶栏时间  → 光标归位到屏幕中央并张开
//
// 圆环用 SVG 画：整圈按入口数量切成等分扇区，悬停时整份填满。
// 半径、厚度、缝隙都从 CSS 变量读，JS 只负责算路径。
(function () {
  'use strict';
  if (window.RadialMenu) return;
  const ITEMS = [
    { id: 'home',     label: 'Home',     icon: 'fa-house',          href: '/index.html' },
    { id: 'problems', label: 'Problems', icon: 'fa-list-check',     href: '/problems' },
    { id: 'subs',     label: 'Subs',     icon: 'fa-inbox',          href: '/submissions' },
    { id: 'rank',     label: 'Ranking',  icon: 'fa-ranking-star',   href: '/leaderboard' },
    { id: 'courses',  label: 'Course',   icon: 'fa-graduation-cap', href: '/course' },
    { id: 'contests', label: 'Contest',  icon: 'fa-trophy',         href: '/contest' },
    { id: 'tokens',   label: 'Tokens',   icon: 'fa-coins',          href: '/token-hub' },
    { id: 'settings', label: 'Settings', icon: 'fa-gear',           href: '/settings' },
  ];
  const N = ITEMS.length;
  const STEP = 360 / N;        // 每份的角度
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let root = null;
  let hub = null;
  let ring = null;
  let slices = [];
  let labels = [];
  let open = false;
  let activeIndex = -1;
  let anchor = { x: 0, y: 0 };
  function ensureCss() {
    if (document.getElementById('radialMenuCss')) return;
    const l = document.createElement('link');
    l.id = 'radialMenuCss';
    l.rel = 'stylesheet';
    l.href = '/assets/css/radial-menu.css' + (window.__BUILD_V ? '?v=' + window.__BUILD_V : '');
    document.head.appendChild(l);
  }
  // 圆环参数从 CSS 变量读，保证 JS 和样式用的是同一组数字
  function readGeom() {
    const cs = getComputedStyle(root);
    const radius = parseFloat(cs.getPropertyValue('--rm-radius')) || 150;
    const thickness = parseFloat(cs.getPropertyValue('--rm-thickness')) || 64;
    const gapDeg = parseFloat(cs.getPropertyValue('--rm-gap-deg')) || 0;
    return { R: radius, r: Math.max(8, radius - thickness), gapDeg };
  }
  function polar(cx, cy, radius, deg) {
    const rad = (deg - 90) * Math.PI / 180;   // 0 度 = 正上方
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }
  // 一个扇区的 path：外弧 → 内弧反向 → 闭合
  function slicePath(cx, cy, R, r, fromDeg, toDeg) {
    const large = (toDeg - fromDeg) > 180 ? 1 : 0;
    const o1 = polar(cx, cy, R, fromDeg);
    const o2 = polar(cx, cy, R, toDeg);
    const i2 = polar(cx, cy, r, toDeg);
    const i1 = polar(cx, cy, r, fromDeg);
    return [
      'M', o1.x.toFixed(2), o1.y.toFixed(2),
      'A', R, R, 0, large, 1, o2.x.toFixed(2), o2.y.toFixed(2),
      'L', i2.x.toFixed(2), i2.y.toFixed(2),
      'A', r, r, 0, large, 0, i1.x.toFixed(2), i1.y.toFixed(2),
      'Z',
    ].join(' ');
  }
  function buildRing() {
    const { R, r, gapDeg } = readGeom();
    const size = R * 2;
    const cx = R, cy = R;
    // SVG 尺寸跟着半径走
    ring.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    ring.setAttribute('width', String(size));
    ring.setAttribute('height', String(size));
    ring.innerHTML = '';
    slices = [];
    ITEMS.forEach((it, i) => {
      const start = i * STEP + gapDeg / 2;
      const end = (i + 1) * STEP - gapDeg / 2;
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', 'rm__slice');
      p.setAttribute('d', slicePath(cx, cy, R, r, start, end));
      p.dataset.index = String(i);
      p.addEventListener('pointerenter', () => setActive(i));
      ring.appendChild(p);
      slices.push(p);
    });
    // 图标 + 文字：叠在扇区中点
    labels.forEach((l) => l.remove());
    labels = ITEMS.map((it, i) => {
      const mid = (i + 0.5) * STEP;
      const midR = (R + r) / 2;
      const pos = polar(cx, cy, midR, mid);
      const el = document.createElement('div');
      el.className = 'rm__label';
      el.style.left = (pos.x - R) + 'px';
      el.style.top = (pos.y - R) + 'px';
      el.innerHTML = '<i class="fas ' + it.icon + '"></i><span>' + it.label + '</span>';
      hub.appendChild(el);
      return el;
    });
  }
  function build() {
    if (root) return;
    ensureCss();
    root = document.createElement('div');
    root.className = 'rm';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Quick navigation');
    // 关键定位内联写死：样式表是独立请求，在它到达之前先用 open()，
    // .rm 会退化成普通 div，hub 的坐标就变成相对文档流了。
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:none;pointer-events:none;';
    const scrim = document.createElement('div');
    scrim.className = 'rm__scrim';
    scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
    hub = document.createElement('div');
    hub.className = 'rm__hub';
    // 不要在 hub 上设 --rm-x / --rm-y：设在自身会盖掉从 .rm 继承的值
    ring = document.createElementNS(SVG_NS, 'svg');
    ring.setAttribute('class', 'rm__ring');
    const origin = document.createElement('div');
    origin.className = 'rm__origin';
    hub.appendChild(ring);
    hub.appendChild(origin);
    const hint = document.createElement('div');
    hint.className = 'rm__hint';
    hint.innerHTML = 'Move onto a slice and release <kbd>Alt</kbd> · <kbd>Esc</kbd> to cancel';
    root.appendChild(scrim);
    root.appendChild(hub);
    root.appendChild(hint);
    document.body.appendChild(root);
    root.addEventListener('pointermove', onPointerMove);
    // 窗口尺寸变化时重新算几何（半径可能被媒体查询改过）
    window.addEventListener('resize', () => { if (root && open) buildRing(); });
  }
  function setActive(i) {
    if (i === activeIndex) return;
    if (slices[activeIndex]) slices[activeIndex].classList.remove('is-active');
    if (labels[activeIndex]) labels[activeIndex].classList.remove('is-active');
    activeIndex = i;
    if (slices[i]) slices[i].classList.add('is-active');
    if (labels[i]) labels[i].classList.add('is-active');
  }
  function onPointerMove(e) {
    if (!open) return;
    const dx = e.clientX - anchor.x;
    const dy = e.clientY - anchor.y;
    const dist = Math.hypot(dx, dy);
    const { R, r } = readGeom();
    // 中心空盘：光标在环内圈里就什么都不选
    if (dist < r) { setActive(-1); return; }
    // 环外也退出（否则鼠标飘远还锁着上一份）
    if (dist > R * 1.6) { setActive(-1); return; }
    let deg = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    setActive(Math.floor(deg / STEP) % N);
  }
  function show(x, y) {
    build();
    if (!slices.length) buildRing();
    anchor = { x, y };
    root.style.setProperty('--rm-x', x + 'px');
    root.style.setProperty('--rm-y', y + 'px');
    root.dataset.open = 'true';
    root.style.display = 'block';
    root.style.pointerEvents = 'auto';
    open = true;
    setActive(-1);
  }
  function close() {
    if (!root) return;
    root.dataset.open = 'false';
    root.style.display = 'none';
    root.style.pointerEvents = 'none';
    open = false;
    setActive(-1);
  }
  function commit() {
    if (!open) return;
    if (activeIndex >= 0 && ITEMS[activeIndex]) {
      const href = ITEMS[activeIndex].href;
      close();
      if (href) location.href = href;
      return;
    }
    close();
  }
  // ── Alt ─────────────────────────────────────────────
  let altHeld = false;
  let lastX = Math.round(window.innerWidth / 2);
  let lastY = Math.round(window.innerHeight / 2);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { close(); return; }
    if (e.key !== 'Alt') return;
    e.preventDefault();
    if (altHeld) return;
    altHeld = true;
    show(lastX, lastY);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key !== 'Alt') return;
    if (!altHeld) return;
    altHeld = false;
    commit();
  }, true);
  window.addEventListener('blur', () => { altHeld = false; close(); });
  // 记住光标位置，供 Alt 使用。键盘事件本身不带坐标，只能靠这个缓存。
  //
  // 三个要点，缺一个就会出现「菜单开在上次点击的地方」：
  //   1. 用 capture 阶段监听 —— 页面里不少元素（画板、PDF、图表）会拦 pointermove
  //   2. 菜单打开时也继续更新 —— 否则关掉后缓存还停在打开时那一刻的位置
  //   3. pointerdown / click 也更新 —— 只移动不按（比如滚轮翻页后挪鼠标）时兜底
  function trackPointer(e) {
    if (typeof e.clientX !== 'number') return;
    // 菜单自身内的移动不算「用户把光标挪到了哪」——那是选扇区的动作
    if (open && root && root.contains(e.target)) return;
    lastX = e.clientX;
    lastY = e.clientY;
  }
  window.addEventListener('pointermove', trackPointer, { passive: true, capture: true });
  window.addEventListener('pointerdown', trackPointer, { passive: true, capture: true });
  window.addEventListener('mousemove', trackPointer, { passive: true, capture: true });
  // ── 点顶栏时间：光标归位到中央再张开 ─────────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('.clock, #clockTime, [data-radial-trigger]');
    if (!el) return;
    e.preventDefault();
    const cx = Math.round(window.innerWidth / 2);
    const cy = Math.round(window.innerHeight / 2);
    lastX = cx; lastY = cy;
    show(cx, cy);
  }, true);
  window.RadialMenu = {
    open: (x, y) => show(x == null ? window.innerWidth / 2 : x, y == null ? window.innerHeight / 2 : y),
    close,
    isOpen: () => open,
  };
})();
;
/* core/ban-screen.js */
// assets/js/core/ban-screen.js —— 被封禁账号的全屏提示
//
// 被踢出来时不再是一个 alert，而是整屏变红、所有交互失效，
// 并说明封禁是手动还是自动、原因是什么、什么时候到期。
//
// 只依赖 window.BanScreen.show({ type, reason, until })。
// 样式写在 assets/css/ban-screen.css，命名空间 .bs-。
(function () {
  'use strict';
  if (window.BanScreen) return;
  let root = null;
  function ensureCss() {
    if (document.getElementById('banScreenCss')) return;
    const l = document.createElement('link');
    l.id = 'banScreenCss';
    l.rel = 'stylesheet';
    l.href = '/assets/css/ban-screen.css' + (window.__BUILD_V ? '?v=' + window.__BUILD_V : '');
    document.head.appendChild(l);
  }
  function formatUntil(until) {
    if (!until) return '';
    try {
      return new Date(until).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    } catch (e) { return String(until); }
  }
  function show(info) {
    ensureCss();
    const { type = 'manually', reason = '', until = null } = info || {};
    if (root) root.remove();
    root = document.createElement('div');
    root.className = 'bs';
    root.setAttribute('role', 'alertdialog');
    const how = type === 'automatically' ? 'automatically' : 'manually';
    const why = reason || 'violating the site rules';
    const when = formatUntil(until);
    root.innerHTML =
      '<div class="bs__panel">' +
        '<div class="bs__icon"><i class="fas fa-ban"></i></div>' +
        '<h1 class="bs__title">You are banned</h1>' +
        '<p class="bs__line"><strong>' + how + '</strong> for <strong>' + escapeHtml(why) + '</strong>.</p>' +
        (when ? '<p class="bs__line">The ban lifts on <strong>' + escapeHtml(when) + '</strong> (Hong Kong time).</p>' : '') +
        '<p class="bs__hint">If you think this is a mistake, contact your teacher.</p>' +
      '</div>';
    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';
    // 整页禁用交互：不是靠 pointer-events，而是把不属于这一屏的元素都遮住
    document.documentElement.classList.add('bs-active');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  }
  function hide() {
    if (root) { root.remove(); root = null; }
    document.documentElement.classList.remove('bs-active');
    document.body.style.overflow = '';
  }
  window.BanScreen = { show, hide, isShown: () => !!root };
})();
;
/* core/ban-index.js */
// assets/js/core/ban-index.js —— 被封账号的首页提示
//
// 被封的人可以正常浏览全站、看资讯，只是所有 API 请求都被 ban-guard 拦住了。
// 这里只做两件事：给页面加一层红色调，并在顶部说明封禁情况。
(function () {
  'use strict';
  if (window.BanIndex) return;
  function getInfo() {
    try {
      if (typeof window.getBanInfo === 'function') return window.getBanInfo();
      const raw = localStorage.getItem('ban_info');
      if (!raw) return null;
      const info = JSON.parse(raw);
      if (info.until && new Date(info.until).getTime() <= Date.now()) {
        localStorage.removeItem('ban_info');
        return null;
      }
      return info;
    } catch (e) { return null; }
  }
  function fmtUntil(until) {
    if (!until) return '';
    try { return new Date(until).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }); }
    catch (e) { return String(until); }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function apply(info) {
    document.documentElement.classList.add('banned-mode');
    const how = info.type === 'automatically' ? 'automatically' : 'manually';
    const why = info.reason || 'violating the site rules';
    const when = fmtUntil(info.until);
    const bar = document.createElement('div');
    bar.className = 'ban-banner';
    bar.innerHTML =
      '<div class="ban-banner__icon"><i class="fas fa-ban"></i></div>' +
      '<div class="ban-banner__body">' +
        '<div class="ban-banner__title">You are banned</div>' +
        '<div class="ban-banner__line"><strong>' + how + '</strong> for <strong>' + esc(why) + '</strong>.</div>' +
        (when ? '<div class="ban-banner__line">The ban lifts on <strong>' + esc(when) + '</strong> (Hong Kong time).</div>'
              : '<div class="ban-banner__line">This ban is permanent until a teacher lifts it.</div>') +
        '<div class="ban-banner__line ban-banner__line--muted">You can still read the site, but submitting answers, sending messages and everything else that needs the server is turned off.</div>' +
      '</div>';
    document.body.insertBefore(bar, document.body.firstChild);
    // 导览弹窗对已经被封的人没有意义，收掉（它们用的是 id，不是 class）
    setTimeout(() => {
      document.querySelectorAll('[id^="tour-"], .tour-tip').forEach((el) => {
        if (!bar.contains(el)) el.style.display = 'none';
      });
    }, 500);
  }
  function init() {
    const info = getInfo();
    if (!info) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply(info));
    } else {
      apply(info);
    }
  }
  window.BanIndex = { init, getInfo };
  init();
})();
;
/* core/page.js */
// ── 导航配色：每个页面一进来就应用，默认蓝色 ──
// 默认值必须和 styles.css 里 :root 的兜底色一致，否则首帧会闪一下再换色。
(function applyNavThemeEarly() {
  try {
    var t = localStorage.getItem('navTheme');
    document.documentElement.setAttribute('data-nav-theme', t === 'green' ? 'green' : 'blue');
  } catch (e) {
    document.documentElement.setAttribute('data-nav-theme', 'blue');
  }
})();
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
