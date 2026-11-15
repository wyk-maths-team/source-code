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
    var raw = String(html || '');
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
  function render(host, scripts) {
    if (!host || !scripts || !scripts.length) return;

    var hasSrc = scripts.some(function (s) { return !!s.src; });

    var box = document.createElement('div');
    box.className = 'sp-box';

    var head = document.createElement('div');
    head.className = 'sp-head';
    head.innerHTML =
      '<i class="fas fa-triangle-exclamation"></i>' +
      '<span class="sp-title">This problem contains ' + scripts.length + ' script' + (scripts.length > 1 ? 's' : '') + '</span>' +
      '<span class="sp-note">Not executed. Read it first.</span>';

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

  window.ScriptPanel = { split: split, render: render, isAdmin: isAdmin, highlight: highlight };
})();
