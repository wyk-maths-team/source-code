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

  var busy = false;
  var ticker = null;

  function token() {
    try { return localStorage.getItem('auth_token') || ''; } catch (e) { return ''; }
  }

  function clearEmpty() {
    if (emptyEl && emptyEl.parentNode) emptyEl.parentNode.removeChild(emptyEl);
    emptyEl = null;
  }

  function add(role, text, extra) {
    clearEmpty();
    var node = document.createElement('div');
    node.className = 'bot-msg ' + role;
    node.textContent = text;
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
        body: JSON.stringify({ text: text }),
      });
      var data = await res.json();
      stopTicker();
      pending.remove();

      if (data && data.success && data.reply) {
        var tag = [];
        if (data.module) tag.push('module: ' + data.module);
        if (data.seconds) tag.push('turn ' + data.seconds + 's');
        if (data.elapsedMs) tag.push('round trip ' + (data.elapsedMs / 1000).toFixed(1) + 's');
        add('bot', data.reply, tag.join('  ·  '));
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
