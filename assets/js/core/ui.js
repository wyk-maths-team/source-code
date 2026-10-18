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
