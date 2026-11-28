// assets/js/pages/admin-bots.js
//
// 管理员的 PyBot 试验台。
//
// 每一次提问都走 /api/bot，后端转发到独立的 wykpybot 项目。
// 没有记忆：每个问题都是全新的对话。
//
// 单个回合要 20-40 秒，所以按钮在等待期间是禁用的，并且显示已等待秒数。

(function () {
  'use strict';

  var logEl = document.getElementById('botLog');
  var emptyEl = document.getElementById('botEmpty');
  var inputEl = document.getElementById('botInput');
  var sendBtn = document.getElementById('botSend');
  var metaEl = document.getElementById('botMeta');
  var modelEl = document.getElementById('botModel');

  var busy = false;
  var ticker = null;

  function token() {
    try { return localStorage.getItem('auth_token') || ''; } catch (e) { return ''; }
  }

  function clearEmpty() {
    if (emptyEl && emptyEl.parentNode) emptyEl.parentNode.removeChild(emptyEl);
    emptyEl = null;
  }

  // 模型回的东西一多半带 markdown：列表、代码块、**加粗**、LaTeX 片段。
  // 用 marked 渲染再用 DOMPurify 洗一遍 —— 模型输出不能直接塞 innerHTML。
  // 用户自己的消息永远走 textContent，不给它任何被解释的机会。
  function renderMarkdown(text) {
    var raw = String(text || '');
    if (!window.marked || !window.DOMPurify) return null;
    try {
      var html = window.marked.parse(raw, { breaks: true, gfm: true });
      return window.DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
      });
    } catch (e) {
      return null;
    }
  }

  function add(role, text, extra) {
    clearEmpty();
    var node = document.createElement('div');
    node.className = 'bot-msg ' + role;

    var html = role === 'bot' ? renderMarkdown(text) : null;
    if (html) {
      var bodyNode = document.createElement('div');
      bodyNode.className = 'bot-md';
      bodyNode.innerHTML = html;
      node.appendChild(bodyNode);
    } else {
      node.textContent = text;
    }
    if (extra) {
      var tag = document.createElement('span');
      tag.className = 'bot-tag';
      tag.textContent = extra;
      node.appendChild(tag);
    }
    logEl.appendChild(node);
    logEl.scrollTop = logEl.scrollHeight;
    return node;
  }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    inputEl.disabled = b;
  }

  function startTicker(node) {
    var t0 = Date.now();
    node.textContent = 'Thinking… 0s';
    ticker = setInterval(function () {
      var s = Math.round((Date.now() - t0) / 1000);
      node.textContent = 'Thinking… ' + s + 's' +
        (s > 8 ? ' (cold start loads half a million lines of Python)' : '');
    }, 500);
  }

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  async function ask(text) {
    if (busy || !text) return;
    add('user', text);
    inputEl.value = '';
    inputEl.style.height = 'auto';

    var which = modelEl ? modelEl.value : 'pybot';
    var pending = document.createElement('div');
    pending.className = 'bot-msg bot thinking';
    logEl.appendChild(pending);
    logEl.scrollTop = logEl.scrollHeight;
    startTicker(pending);

    setBusy(true);
    metaEl.textContent = '';

    try {
      var res = await fetch('/api/bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify({ text: text, model: modelEl ? modelEl.value : 'pybot' }),
      });
      var data = await res.json();
      stopTicker();
      pending.remove();

      if (data && data.success && data.reply) {
        var tag = [];
        if (data.module) tag.push('module: ' + data.module);
        if (data.seconds) tag.push('turn ' + data.seconds + 's');
        if (data.elapsedMs) tag.push('round trip ' + (data.elapsedMs / 1000).toFixed(1) + 's');
        add('bot', data.reply, (which === 'pybot' ? '' : which + '  ·  ') + tag.join('  ·  '));
        metaEl.textContent = tag.join('  ·  ');
      } else {
        add('err', (data && data.message) || 'No reply.');
        metaEl.textContent = '';
      }
    } catch (e) {
      stopTicker();
      pending.remove();
      add('err', 'Request failed: ' + String(e && e.message || e).slice(0, 160));
    } finally {
      setBusy(false);
      inputEl.focus();
    }
  }

  // 换模型时提示条也跟着换：两个东西慢的原因完全不一样
  function paintModelHint() {
    var warnText = document.getElementById('botWarnText');
    if (!warnText || !modelEl) return;
    if (modelEl.value === 'deepseek-flash') {
      warnText.innerHTML = '<b>deepseek-flash</b> is a language model: no system prompt, no history. Usually 2&ndash;6&nbsp;s.';
    } else {
      warnText.innerHTML = '<b>PyBot</b> answers from 528 hand-written Python modules. First reply after a cold start can take 20&ndash;40&nbsp;s; warm ones take 1&ndash;3&nbsp;s.';
    }
  }
  if (modelEl) {
    modelEl.addEventListener('change', function () {
      paintModelHint();
      inputEl.focus();
    });
    paintModelHint();
  }

  sendBtn.addEventListener('click', function () {
    ask(inputEl.value.trim());
  });

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(inputEl.value.trim());
    }
  });

  inputEl.addEventListener('input', function () {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(130, inputEl.scrollHeight) + 'px';
  });

  inputEl.focus();
})();
