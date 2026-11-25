// assets/js/tutor.js —— 题目页右下角的答疑助手（前端）
//
// 只在 /problems/<id> 挂载。先向后端问一句「这道题现在能不能用」：
// 比赛期间的题不显示按钮，避免学生一边比赛一边问。
//
// 没有拟人化形象：一个胶囊按钮 + 一个面板。以后要做人物形象，换 FAB 里的内容即可。

(function () {
  'use strict';
  if (window.__MOJ_TUTOR__) return;
  window.__MOJ_TUTOR__ = true;

  var m = location.pathname.match(/^\/problems\/([^/]+)$/);
  if (!m) return;
  var problemId = decodeURIComponent(m[1]);

  var MAX_INPUT = 800;
  var state = { open: false, busy: false, mounted: false, messages: [] };

  function getToken() {
    try {
      if (typeof window.getToken === 'function') return window.getToken();
      return localStorage.getItem('auth_token') || '';
    } catch (e) { return ''; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 极简 markdown：粗体、行内代码。数学交给 KaTeX auto-render。
  function rich(text) {
    var html = esc(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
  }

  function typeset(el) {
    if (!el) return;
    if (typeof window.renderMathInElement !== 'function') return;
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\(', right: '\)', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* 公式渲染失败不该影响对话 */ }
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function build() {
    var fab = el('button', 'moj-tutor-fab');
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Open the tutor for this problem');
    fab.innerHTML = '<i class="fas fa-graduation-cap"></i><span>Tutor</span>';

    var panel = el('div', 'moj-tutor-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Tutor');
    panel.innerHTML = [
      '<div class="moj-tutor-head">',
      '  <div class="moj-tutor-head-icon"><i class="fas fa-graduation-cap"></i></div>',
      '  <div>',
      '    <div class="moj-tutor-title">Tutor</div>',
      '    <div class="moj-tutor-sub">This problem only</div>',
      '  </div>',
      '  <button type="button" class="moj-tutor-close" aria-label="Close"><i class="fas fa-xmark"></i></button>',
      '</div>',
      '<div class="moj-tutor-body"></div>',
      '<div class="moj-tutor-foot">',
      '  <textarea class="moj-tutor-input" rows="1" maxlength="' + MAX_INPUT + '" placeholder="Ask about this problem…"></textarea>',
      '  <button type="button" class="moj-tutor-send" aria-label="Send"><i class="fas fa-paper-plane"></i></button>',
      '</div>'
    ].join('');

    var body = panel.querySelector('.moj-tutor-body');
    var input = panel.querySelector('.moj-tutor-input');
    var sendBtn = panel.querySelector('.moj-tutor-send');
    var closeBtn = panel.querySelector('.moj-tutor-close');

    body.appendChild(el('div', 'moj-tutor-intro',
      'Ask about <strong>this problem</strong> — how to start, why a step fails, what a term means. '
      + 'It will not hand over the answer, and it will decline anything unrelated.'));

    fab.addEventListener('click', function () {
      state.open = !state.open;
      panel.classList.toggle('open', state.open);
      fab.setAttribute('aria-expanded', state.open ? 'true' : 'false');
      if (state.open) setTimeout(function () { input.focus(); }, 30);
    });
    closeBtn.addEventListener('click', function () {
      state.open = false;
      panel.classList.remove('open');
      fab.setAttribute('aria-expanded', 'false');
    });
    sendBtn.addEventListener('click', function () { send(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(110, input.scrollHeight) + 'px';
    });

    function addMessage(role, text) {
      var cls = role === 'user' ? 'user' : (role === 'error' ? 'error' : 'tutor');
      var node = el('div', 'moj-tutor-msg ' + cls, rich(text));
      body.appendChild(node);
      typeset(node);
      body.scrollTop = body.scrollHeight;
      return node;
    }

    function showTyping() {
      var node = el('div', 'moj-tutor-typing', '<span></span><span></span><span></span>');
      body.appendChild(node);
      body.scrollTop = body.scrollHeight;
      return node;
    }

    function setBusy(b) {
      state.busy = b;
      sendBtn.disabled = b;
      input.disabled = b;
    }

    async function send() {
      var q = input.value.trim();
      if (!q || state.busy) return;

      var history = state.messages.slice(-8).map(function (msg) {
        return { role: msg.role, content: msg.content };
      });

      addMessage('user', q);
      state.messages.push({ role: 'user', content: q });
      input.value = '';
      input.style.height = 'auto';
      setBusy(true);

      var typing = showTyping();
      var reply = '';
      var failed = false;

      try {
        var res = await fetch('/api/tutor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
          body: JSON.stringify({ problemId: problemId, question: q, history: history }),
        });
        var data = {};
        try { data = await res.json(); } catch (e) { data = {}; }
        if (!res.ok || !data.success) {
          failed = true;
          reply = data.message || 'The tutor is unavailable right now.';
        } else {
          reply = data.reply || '';
        }
      } catch (e) {
        failed = true;
        reply = 'Network error — please try again.';
      } finally {
        typing.remove();
        setBusy(false);
      }

      if (failed) {
        addMessage('error', reply);
      } else {
        addMessage('tutor', reply);
        state.messages.push({ role: 'tutor', content: reply });
      }
    }

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    state.mounted = true;
  }

  async function probe() {
    try {
      var res = await fetch('/api/tutor?action=info&problemId=' + encodeURIComponent(problemId), {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (!res.ok) return;                       // 401 / 403：不显示，静默
      var data = await res.json();
      if (data && data.allowed && !state.mounted) build();
    } catch (e) {
      // tutor 是附加功能，任何失败都不能影响题目页本身
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', probe);
  } else {
    probe();
  }
})();
