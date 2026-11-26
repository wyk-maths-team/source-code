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

  // 极简 markdown：粗体、斜体、行内代码。数学交给 KaTeX auto-render。
  function rich(text) {
    var html = esc(text);
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 单个星号的斜体。跳过含 $ 的内容 —— 数学里 a*b 很常见，
    // 一旦被当成斜体就会把公式拆开。
    html = html.replace(/(^|[^*])\*([^*$\n]{1,120})\*(?!\*)/g, '$1<em>$2</em>');
    return html;
  }

  // KaTeX 的 auto-render 是 defer 加载的，第一条回复往往比它先到 —— 之前
  // 函数还不存在就直接 return，整段公式就原样留在气泡里。现在改成轮询重试。
  // 另外补上 \[ \] 与修正 \( \) ：原来的字符串少了一个反斜杠，传进去的分隔符
  // 实际是 "(" 和 ")"，KaTeX 永远匹配不到。
  var KATEX_DELIMS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
  ];

  function typesetOnce(el) {
    if (typeof window.renderMathInElement !== 'function') return false;
    try {
      window.renderMathInElement(el, {
        delimiters: KATEX_DELIMS,
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function typeset(el) {
    if (!el) return;
    if (typesetOnce(el)) return;
    var tries = 0;
    var timer = setInterval(function () {
      if (typesetOnce(el) || ++tries > 24) clearInterval(timer);
    }, 150);
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

    // 画像提示：告诉学生这次会先讲哪一块，而不是笼统地说「个性化」
    var profileNote = el('div', 'moj-tutor-profile-note');
    profileNote.style.display = 'none';
    body.appendChild(profileNote);

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

    // ── AI 用 ⟦def⟧…⟦/def⟧ 包住的定义，渲染成卡片并给一个「有用吗」 ──
    // 点赞才入库：学生认可的定义才有价值，模型自己写的先当草稿。
    // 用 ASCII 方括号而不是 U+27E6/U+27E7：那两个字符在粘贴、日志、代理层
    // 里都可能被规范化掉，模型输出的又不可控，一旦变形就再也匹配不上。
    var DEF_RE = /\[def\]([\s\S]*?)\[\/def\]/g;

    function buildDefCard(bodyText) {
      var card = document.createElement('div');
      card.className = 'moj-def-card';

      var text = document.createElement('div');
      text.className = 'moj-def-body';
      text.innerHTML = rich(bodyText);
      card.appendChild(text);
      typeset(text);

      var row = document.createElement('div');
      row.className = 'moj-def-actions';

      var label = document.createElement('span');
      label.className = 'moj-def-label';
      label.textContent = 'Is this helpful?';

      var yes = document.createElement('button');
      yes.type = 'button';
      yes.className = 'moj-def-yes';
      yes.setAttribute('aria-label', 'This definition is helpful');
      yes.textContent = '👍';
      yes.addEventListener('click', function () {
        if (yes.disabled) return;
        yes.disabled = true;
        label.textContent = 'Saving…';
        apiCall('/api/definitions', 'POST', { body: bodyText.trim(), problemId: problemId })
          .then(function () {
            label.textContent = 'Saved — thanks!';
            card.classList.add('saved');
          })
          .catch(function (err) {
            yes.disabled = false;
            label.textContent = 'Could not save: ' + ((err && err.message) || 'unknown');
          });
      });

      row.appendChild(label);
      row.appendChild(yes);
      card.appendChild(row);
      return card;
    }

    function renderDefinitions(host) {
      if (!host) return;
      var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
      var targets = [];
      var n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.indexOf('[def]') >= 0) targets.push(n);
      }
      targets.forEach(function (textNode) {
        var text = textNode.nodeValue;
        var frag = document.createDocumentFragment();
        var last = 0;
        var m;
        DEF_RE.lastIndex = 0;
        while ((m = DEF_RE.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          frag.appendChild(buildDefCard(m[1]));
          last = m.index + m[0].length;
        }
        if (last === 0) return;                    // 没匹配到，别动它
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        if (textNode.parentNode) textNode.parentNode.replaceChild(frag, textNode);
      });
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
      var nextTokens = null;
      var streamNode = null;

      try {
        var res = await fetch('/api/tutor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
          body: JSON.stringify({ problemId: problemId, question: q, history: history }),
        });

        var ctype = res.headers.get('content-type') || '';
        if (!res.ok || ctype.indexOf('text/event-stream') < 0) {
          var data = {};
          try { data = await res.json(); } catch (e) { data = {}; }
          throw new Error(data.message || 'The tutor is unavailable right now.');
        }

        // 开流：先建一个空气泡，逐块往里长
        typing.remove();
        streamNode = addMessage('tutor', '');
        streamNode._raw = '';

        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';

        while (true) {
          var step = await reader.read();
          if (step.done) break;
          buf += decoder.decode(step.value, { stream: true });

          var cut;
          while ((cut = buf.indexOf('\n\n')) >= 0) {
            var chunk = buf.slice(0, cut);
            buf = buf.slice(cut + 2);

            var ev = 'message';
            var lines = [];
            chunk.split('\n').forEach(function (line) {
              if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
              else if (line.indexOf('data:') === 0) lines.push(line.slice(5).trim());
            });
            if (!lines.length) continue;

            var payload;
            try { payload = JSON.parse(lines.join('\n')); } catch (e) { continue; }

            if (ev === 'meta') {
              paintHint(payload.profile ? {
                gap: payload.profile.gap,
                fresh: payload.profile.fresh,
                focus: payload.profile.focus,
              } : null);
            } else if (ev === 'delta' && payload.text) {
              streamNode._raw += payload.text;
              // 流式期间只更新纯文本，结束后再整体排版 —— 每个 token 都跑一次
              // KaTeX + markdown 会把面板卡死
              streamNode.textContent = streamNode._raw;
              if (typeof scrollLatest === 'function') scrollLatest(body);
              else body.scrollTop = body.scrollHeight;
            } else if (ev === 'done') {
              reply = payload.reply || streamNode._raw;
              nextTokens = payload.tokens || null;
            } else if (ev === 'error') {
              throw new Error(payload.message || 'The tutor is unavailable right now.');
            }
          }
        }

        if (!reply) reply = streamNode._raw || '';
      } catch (e) {
        failed = true;
        reply = e.message || 'Network error — please try again.';
      } finally {
        if (typing.parentNode) typing.remove();
        setBusy(false);
        if (nextTokens && typeof window.updateTopbarTokens === 'function') {
          window.updateTopbarTokens(nextTokens.daily, nextTokens.global);
        }
      }

      if (streamNode) {
        // 收尾：把累积的原文一次性排版（markdown + KaTeX + 定义卡片）
        streamNode.innerHTML = rich(reply);
        // 顺序很重要：KaTeX 会把文本节点拆开（公式前后的文字变成独立节点），
        // 先排数学的话 ⟦def⟧…⟦/def⟧ 就被切碎，TreeWalker 再也找不到完整的一对。
        renderDefinitions(streamNode);
        typeset(streamNode);
      }

      if (failed) {
        if (!streamNode) addMessage('error', reply);
        else streamNode.textContent = reply;
      } else if (reply) {
        state.messages.push({ role: 'tutor', content: reply });
      }
    }

    initResize(panel);

    document.body.appendChild(fab);
    document.body.appendChild(panel);
    state.mounted = true;

    // 打开面板时才拉历史：不打开就不该多打一次请求
    fab.addEventListener('click', function () { loadHistory(); });
  }

  /** 拖拽调整大小，且不越过 topbar / sidebar */
  function initResize(panel) {
    var handle = document.createElement('div');
    handle.className = 'moj-tutor-resizer';
    handle.setAttribute('aria-hidden', 'true');
    panel.appendChild(handle);

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var rect = panel.getBoundingClientRect();
      var startX = e.clientX;
      var startY = e.clientY;
      var startW = rect.width;
      var startH = rect.height;

      function limits() {
        var topbar = document.querySelector('.topbar');
        var sidebar = document.querySelector('.sidebar');
        var topbarH = topbar ? topbar.getBoundingClientRect().height : 60;
        // 移动端侧栏是抽屉（position:static 或隐藏），宽度按 0 算
        var sideW = 0;
        if (sidebar) {
          var sb = sidebar.getBoundingClientRect();
          var sbStyle = getComputedStyle(sidebar);
          if (sbStyle.position !== 'static' && sb.width > 0 && sb.right > 0) sideW = sb.right;
        }
        return {
          maxW: Math.max(300, window.innerWidth - sideW - 24 - 16),
          maxH: Math.max(320, window.innerHeight - topbarH - 84 - 16),
        };
      }

      function onMove(ev) {
        var lim = limits();
        // 面板贴在右下角：向左拖 = 变宽，向上拖 = 变高
        var w = Math.min(lim.maxW, Math.max(300, startW + (startX - ev.clientX)));
        var h = Math.min(lim.maxH, Math.max(320, startH + (startY - ev.clientY)));
        panel.style.width = w + 'px';
        panel.style.height = h + 'px';
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
      }

      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // 视口变化时把面板收回边界内
    window.addEventListener('resize', function () {
      var rect = panel.getBoundingClientRect();
      var topbar = document.querySelector('.topbar');
      var topbarH = topbar ? topbar.getBoundingClientRect().height : 60;
      var maxH = Math.max(320, window.innerHeight - topbarH - 100);
      if (rect.height > maxH) panel.style.height = maxH + 'px';
    });
  }

  /** 拉取这个（用户, 题目）的历史对话 */
  async function loadHistory() {
    if (state.historyLoaded) return;
    state.historyLoaded = true;
    try {
      var res = await fetch('/api/tutor?action=history&problemId=' + encodeURIComponent(problemId), {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (!res.ok) return;
      var data = await res.json();
      var msgs = Array.isArray(data.messages) ? data.messages : [];
      if (!msgs.length) return;
      var body = document.querySelector('.moj-tutor-body');
      if (!body) return;
      // 清掉「首次使用」的说明，直接显示历史
      var intro = body.querySelector('.moj-tutor-intro');
      if (intro) intro.remove();
      msgs.forEach(function (m) {
        var role = m.role === 'user' ? 'user' : 'tutor';
        var node = document.createElement('div');
        node.className = 'moj-tutor-msg ' + role;
        node.textContent = String(m.content || '');
        body.appendChild(node);
        typeset(node);
        state.messages.push({ role: role, content: String(m.content || '') });
      });
      body.scrollTop = body.scrollHeight;
    } catch (e) { /* 历史拉不到不影响新提问 */ }
  }

  /**
   * 画像提示：告诉学生这次答疑会先补哪一块知识点。
   * 没有画像（新用户）或没有缺口时保持隐藏 —— 不要为了显得智能而废话。
   */
  function paintHint(hint) {
    var node = document.querySelector('.moj-tutor-profile-note');
    if (!node || !hint || !hint.focus) return;
    var name = hint.focus.name || hint.focus.id || '';
    if (!name) return;
    var why = hint.gap > 0 ? 'you have tried this before without getting it' : 'you have not met this yet';
    node.textContent = 'Starting from ' + name + ' — ' + why + '.';
    node.style.display = 'block';
  }

  async function probe() {
    try {
      var res = await fetch('/api/tutor?action=info&problemId=' + encodeURIComponent(problemId), {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (!res.ok) return;                       // 401 / 403：不显示，静默
      var data = await res.json();
      if (data && data.allowed && !state.mounted) {
        build();
        paintHint(data.hint);
      }
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
