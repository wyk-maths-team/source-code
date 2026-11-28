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

  // 模型回的是 markdown，数学式子用的是 \[ \] 和 \( \) 这两套 LaTeX 定界符。
  // marked 会把 \[ 当成转义吃掉，剩下孤零零的方括号 —— 看起来就是两个黑方块。
  // 所以先换成 $$ / $，交给 marked，最后由 KaTeX 的 auto-render 排版。
  //
  // 用函数形式做替换，不用字符串：替换串里的 $ 有特殊含义，
  // 写 '$$$$' 到底会变成几个 $ 得靠脑子算，容易错。
  function normaliseMath(text) {
    return String(text || '')
      .replace(/\\\[/g, function () { return '$$'; })
      .replace(/\\\]/g, function () { return '$$'; })
      .replace(/\\\(/g, function () { return '$'; })
      .replace(/\\\)/g, function () { return '$'; })
      // 块级公式通常长这样：$$ 单独占一行，公式在中间，$$ 再另起一行。
      // marked 会把三行拆成三个 <p>，KaTeX 的 auto-render 只在单个文本节点里
      // 找 $$...$$，跨节点就找不到，于是原样显示出来。
      // 把首尾那两个 $$ 周围的换行折掉，让整块落在同一个文本节点里。
      .replace(/\$\$[ \t]*\r?\n/g, function () { return '$$'; })
      .replace(/\r?\n[ \t]*\$\$/g, function () { return '$$'; });
  }

  // marked 开着 breaks:true，单个换行就会变成 <br>。块级公式几乎都是多行的，
  // 于是 $$...$$ 被 <br> 拆成好几段，KaTeX 的 auto-render 只在单个文本节点里
  // 找定界符，跨节点就放弃 —— 结果 $$ 原样留在屏幕上。
  //
  // 办法：渲染 markdown 之前先把公式整体抽出来换成占位符（单行、无特殊字符），
  // 渲染完再换回去。这样公式原文对 marked 是完全透明的。
  var MATH_PH = /\u0001M(\d+)\u0001/g;

  function extractMath(text) {
    var blocks = [];
    var put = function (open, close) {
      return function (whole, body) {
        blocks.push(open + body + close);
        return '\u0001M' + (blocks.length - 1) + '\u0001';
      };
    };
    var out = String(text || '')
      .replace(/\$\$([\s\S]*?)\$\$/g, put('$$', '$$'))
      .replace(/\\\[([\s\S]*?)\\\]/g, put('$$', '$$'))
      .replace(/\\\(([\s\S]*?)\\\)/g, put('$', '$'))
      .replace(/\$([^$\n]+?)\$/g, put('$', '$'));
    return { text: out, blocks: blocks };
  }

  function restoreMath(html, blocks) {
    return String(html || '').replace(MATH_PH, function (whole, idx) {
      var maths = blocks[Number(idx)];
      return maths == null ? whole : maths;
    });
  }

  function renderMarkdown(text) {
    var extracted = extractMath(normaliseMath(text));
    var raw = extracted.text;
    if (!window.marked || !window.DOMPurify) return null;
    try {
      var html = window.marked.parse(raw, { breaks: true, gfm: true });
      html = restoreMath(html, extracted.blocks);
      return window.DOMPurify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
        ADD_ATTR: ['class'],   // KaTeX 输出要它
      });
    } catch (e) {
      return null;
    }
  }

  function typesetMath(node) {
    if (!window.renderMathInElement || !node) return;
    try {
      window.renderMathInElement(node, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* 公式排版失败不该把整条消息吞掉 */ }
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
      typesetMath(bodyNode);
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
