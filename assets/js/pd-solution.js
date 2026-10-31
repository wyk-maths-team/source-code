// pd-solution.js —— 题目页的「题解」面板 + Hints 区
//
// 题解：
//   - 只有 AC 过的题才有 Solution 这一栏（tab 由 pd-script.js 渲染）
//   - 每篇题解发一次扣 10,000 token（后端扣，前端只负责提示）
//   - 点赞每人每篇一次、不能取消；被赞的作者每天结算 +1,000
// Hints：
//   - 管理员在题目里配好提示和价格，未解锁只显示价格
(function () {
  'use strict';

  const m = location.pathname.match(/^\/problems\/([^/]+)$/);
  if (!m) return;
  const problemId = decodeURIComponent(m[1]);
  const PD_SOLUTION_BUILD = '2026-10-31c';   // 换版时改这里，方便在控制台确认缓存

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const when = (t) => {
    try { return new Date(t).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }); }
    catch { return ''; }
  };

  let solutions = [];
  let meta = { postCost: 10000, likeReward: 1000 };
  let loaded = false;
  let busy = false;

  // 文字 → 安全的 HTML（保留换行），交给 KaTeX 渲染公式
  function toHtml(text) {
    return esc(text).replace(/\n/g, '<br>');
  }

  function renderMath(el) {
    if (typeof renderMathInElement !== 'function' || !el) return;
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* 渲染失败不影响阅读 */ }
  }

  // ───────── 题解面板 ─────────

  async function activate() {
    if (loaded) return;
    loaded = true;
    await loadSolutions();
  }

  async function loadSolutions() {
    const pane = document.getElementById('solutionPane');
    if (!pane) return;
    pane.innerHTML = '<div class="solution-loading"><span class="spinner"></span> Loading solutions…</div>';
    try {
      const data = await apiCall('/api/solution?problemId=' + encodeURIComponent(problemId));
      if (!data.success) throw new Error(data.message || 'Failed to load solutions');
      solutions = data.solutions || [];
      if (data.postCost) meta.postCost = data.postCost;
      if (data.likeReward) meta.likeReward = data.likeReward;
      render();
    } catch (e) {
      pane.innerHTML = '<div class="solution-empty"><i class="fas fa-lock"></i> ' + esc(e.message || 'Failed to load solutions') + '</div>';
    }
  }

  // 作者：头像 + 可点开的用户名（跳到个人主页）
  function avatarHtml(s) {
    const initial = esc(String(s.displayName || s.username || '?').trim().charAt(0).toUpperCase() || '?');
    const href = '/users/' + encodeURIComponent(s.username || '');
    const name = esc(s.displayName || s.username);
    const mine = s.mine ? ' <em>(you)</em>' : '';
    const avatar = s.pfp
      ? '<img class="solution-avatar" src="' + esc(s.pfp) + '" alt="" loading="lazy" ' +
        'onerror="this.style.display=\'none\';var f=this.nextElementSibling;if(f)f.style.display=\'inline-flex\';">' +
        '<span class="solution-avatar solution-avatar-fb" style="display:none">' + initial + '</span>'
      : '<span class="solution-avatar solution-avatar-fb">' + initial + '</span>';

    return '<a class="solution-user" href="' + href + '" target="_blank" rel="noopener" title="' + esc(s.username || '') + '">' +
      avatar + '<span class="solution-name">' + name + '</span>' + mine + '</a>';
  }

  function render() {
    const pane = document.getElementById('solutionPane');
    if (!pane) return;

    const cards = solutions.length
      ? solutions.map((s) => {
          const canLike = !s.mine && !s.liked;
          const heart = s.liked ? 'fas' : 'far';
          return (
            '<div class="solution-card">' +
              '<div class="solution-card-head">' +
                avatarHtml(s) +
                '<span class="solution-meta">' + when(s.createdAt) + '</span>' +
              '</div>' +
              '<div class="solution-content">' + s.content + '</div>' +
              '<div class="solution-card-actions">' +
                '<button class="sol-like ' + (s.liked ? 'liked' : '') + '" data-id="' + esc(s._id) + '"' + (canLike ? '' : ' disabled') + '>' +
                  '<i class="' + heart + ' fa-heart"></i> <span>' + fmt(s.likes) + '</span>' +
                '</button>' +
              '</div>' +
            '</div>'
          );
        }).join('')
      : '<div class="solution-empty"><i class="fas fa-feather-pointed"></i> No solutions yet — be the first to write one.</div>';

    pane.innerHTML =
      '<div class="solution-head">' +
        '<div class="solution-title"><i class="fas fa-book-open"></i> Solutions <span class="solution-count">' + solutions.length + '</span></div>' +
        '<button class="solution-write-btn" id="solWriteBtn"><i class="fas fa-pen"></i> Write a solution · ' + fmt(meta.postCost) + ' tokens</button>' +
      '</div>' +
      '<div class="solution-editor" id="solEditor" hidden>' +
        '<textarea id="solInput" class="solution-input" spellcheck="false" placeholder="Write your solution here… LaTeX with $...$ is supported.&#10;&#10;Line breaks are kept as typed."></textarea>' +
        '<div class="solution-preview-wrap">' +
          '<div class="solution-preview-label"><i class="fas fa-eye"></i> Preview <span class="solution-preview-status" id="solPreviewStatus"></span></div>' +
          '<div class="solution-preview" id="solPreview"><span class="solution-preview-empty">Nothing to preview yet…</span></div>' +
        '</div>' +
        '<div class="solution-editor-actions">' +
          '<span class="solution-cost"><i class="fas fa-coins"></i> ' + fmt(meta.postCost) + ' tokens will be charged</span>' +
          '<button class="solution-cancel" id="solCancelBtn">Cancel</button>' +
          '<button class="solution-publish" id="solPublishBtn">Publish</button>' +
        '</div>' +
      '</div>' +
      '<div class="solution-list" id="solutionList">' + cards + '</div>';

    renderMath(document.getElementById('solutionList'));

    const writeBtn = document.getElementById('solWriteBtn');
    if (writeBtn) writeBtn.addEventListener('click', openEditor);
    const cancelBtn = document.getElementById('solCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', closeEditor);
    const publishBtn = document.getElementById('solPublishBtn');
    if (publishBtn) publishBtn.addEventListener('click', publish);

    document.querySelectorAll('#solutionList .sol-like:not([disabled])').forEach((btn) => {
      btn.addEventListener('click', () => likeSolution(btn.dataset.id, btn));
    });
  }

  function openEditor() {
    const editor = document.getElementById('solEditor');
    if (!editor) return;
    editor.hidden = false;
    const input = document.getElementById('solInput');
    if (!input) return;

    try { input.value = localStorage.getItem('sol_draft_' + problemId) || ''; } catch {}
    input.focus();

    input.addEventListener('input', onInput);

    // 保险丝：每 400ms 对一次值。万一 input 事件没挂上（DOM 被重建、浏览器怪癖），
    // 也能保证预览跟着内容走，不会出现「写了字但预览空白」。
    if (_editorWatch) clearInterval(_editorWatch);
    _watchLast = input.value;
    _editorWatch = setInterval(() => {
      const el = document.getElementById('solInput');
      if (!el) return;
      if (el.value !== _watchLast) {
        _watchLast = el.value;
        try { localStorage.setItem('sol_draft_' + problemId, el.value); } catch {}
        renderPreview(el.value);
      }
    }, 400);

    renderPreview(input.value);
  }

  function closeEditor() {
    const editor = document.getElementById('solEditor');
    if (editor) editor.hidden = true;
    if (_editorWatch) { clearInterval(_editorWatch); _editorWatch = null; }
  }

  let _previewTimer = null;
  let _editorWatch = null;
  let _watchLast = null;
  let _katexWaits = 0;

  function onInput() {
    const input = document.getElementById('solInput');
    if (!input) return;

    try { localStorage.setItem('sol_draft_' + problemId, input.value); } catch {}

    clearTimeout(_previewTimer);
    _previewTimer = setTimeout(() => renderPreview(input.value), 150);
  }

  // 把文本拆成「普通文字 / 行内公式 / 行间公式」，方便逐段渲染并定位错误
  function splitMath(text) {
    const out = [];
    // 行内 $...$ 故意允许跨行：学生经常把一条长公式折成两行写，
    // 以前那种写法会整段不渲染，看起来就像预览坏了。
    const re = /\$\$([\s\S]+?)\$\$|\$([^$]{1,4000}?)\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) });
      const raw = m[0];
      if (m[1] !== undefined) out.push({ type: 'display', value: m[1], raw });
      else if (m[2] !== undefined) out.push({ type: 'inline', value: m[2], raw });
      else if (m[3] !== undefined) out.push({ type: 'display', value: m[3], raw });
      else out.push({ type: 'inline', value: m[4], raw });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
  }

  // 预览：逐段用 KaTeX 渲染，出错的那一段标红显示，状态栏告诉学生错在哪
  function renderPreview(text) {
    const preview = document.getElementById('solPreview');
    const status = document.getElementById('solPreviewStatus');
    if (!preview) return;

    if (!text || !text.trim()) {
      preview.innerHTML = '<span class="solution-preview-empty">Nothing to preview yet…</span>';
      if (status) status.innerHTML = '';
      return;
    }

    const katexReady = !!window.katex && typeof window.katex.renderToString === 'function';

    // 关键：先把纯文本铺上去。KaTeX 没加载好（CDN 慢/被挡）时，
    // 学生至少看得到自己写了什么，而不是一片 "Nothing to preview yet"。
    if (!katexReady) {
      preview.innerHTML = esc(text).replace(/\n/g, '<br>');
      if (_katexWaits < 15) {
        _katexWaits++;
        if (status) status.innerHTML = '<span class="st-wait"><i class="fas fa-spinner fa-spin"></i> loading maths…</span>';
        setTimeout(() => renderPreview(text), 400);
      } else if (status) {
        status.innerHTML = '<span class="st-bad">⚠ maths renderer not loaded — showing plain text</span>';
      }
      return;
    }

    _katexWaits = 0;

    let errors = 0;
    let formulas = 0;

    const html = splitMath(text).map((part) => {
      if (part.type === 'text') return esc(part.value).replace(/\n/g, '<br>');
      formulas++;
      try {
        return window.katex.renderToString(part.value, {
          displayMode: part.type === 'display',
          throwOnError: true,
          strict: false,
          output: 'html',
        });
      } catch (err) {
        errors++;
        return '<span class="solution-latex-err" title="' +
          esc(err && err.message ? err.message : 'LaTeX error') + '">' +
          esc(part.raw) + ' <i class="fas fa-triangle-exclamation"></i></span>';
      }
    }).join('');

    preview.innerHTML = html;

    const dollarCount = (text.match(/\$/g) || []).length;

    if (errors) {
      status.innerHTML = '<span class="st-bad"><i class="fas fa-circle-exclamation"></i> ' +
        errors + ' formula' + (errors > 1 ? 's' : '') + ' failed</span>';
    } else if (dollarCount % 2 === 1) {
      status.innerHTML = '<span class="st-bad"><i class="fas fa-circle-exclamation"></i> unclosed $ — formula not rendered</span>';
    } else if (formulas > 0) {
      status.innerHTML = '<span class="st-ok"><i class="fas fa-check"></i> rendered · ' + formulas + ' formula' + (formulas > 1 ? 's' : '') + '</span>';
    } else {
      status.innerHTML = '<span class="st-ok"><i class="fas fa-check"></i> rendered</span>';
    }
  }

  async function publish() {
    if (busy) return;
    const input = document.getElementById('solInput');
    const btn = document.getElementById('solPublishBtn');
    if (!input) return;

    const raw = input.value.trim();
    if (raw.length < 10) return alert('Solution is too short (min 10 characters)');

    busy = true;
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Publishing…'; }

    try {
      const res = await apiCall('/api/solution', 'POST', { problemId, content: raw });
      if (!res.success) throw new Error(res.message || 'Failed to publish');

      if (res.tokens && window.updateTopbarTokens) {
        window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
      }
      try { localStorage.removeItem('sol_draft_' + problemId); } catch {}

      solutions.unshift(res.solution);
      input.value = '';
      if (window.DSHUI) DSHUI.toast('Solution published', 'ok');
      render();
    } catch (e) {
      alert(e.message || 'Failed to publish');
      if (btn) { btn.disabled = false; btn.innerHTML = 'Publish'; }
    } finally {
      busy = false;
    }
  }

  async function likeSolution(id, btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      const res = await apiCall('/api/solution', 'POST', { action: 'like', solutionId: id });
      if (!res.success) throw new Error(res.message || 'Failed to like');

      const sol = solutions.find((s) => String(s._id) === String(id));
      if (sol) { sol.liked = true; sol.likes = res.likes; }
      btn.classList.add('liked');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fas fa-heart';
      const num = btn.querySelector('span');
      if (num) num.textContent = fmt(res.likes);
      btn.disabled = true;
      if (window.DSHUI) DSHUI.toast('Liked · author earns ' + fmt(meta.likeReward) + ' tokens daily', 'ok');
    } catch (e) {
      alert(e.message || 'Failed to like');
      btn.disabled = false;
    } finally {
      busy = false;
    }
  }

  // ───────── Hints 区 ─────────

  async function loadHints() {
    const sec = document.getElementById('hintsSection');
    if (!sec || sec.dataset.loaded === '1') return;
    sec.dataset.loaded = '1';

    try {
      const data = await apiCall('/api/hint?problemId=' + encodeURIComponent(problemId));
      if (!data.success || !Array.isArray(data.hints) || !data.hints.length) return;

      sec.style.display = '';
      sec.innerHTML =
        '<div class="hints-head"><i class="fas fa-lightbulb"></i> Hints</div>' +
        '<div class="hints-list">' + data.hints.map((h, i) => renderHint(h, i)).join('') + '</div>';

      renderMath(sec);
      sec.querySelectorAll('.hint-buy').forEach((btn) => {
        btn.addEventListener('click', () => buyHint(btn.dataset.id, btn));
      });
    } catch (e) {
      console.warn('[hints]', e);
    }
  }

  function renderHint(h, i) {
    const label = 'Hint ' + (i + 1);
    if (h.purchased) {
      return (
        '<div class="hint-card unlocked">' +
          '<div class="hint-head"><span class="hint-label">' + label + '</span><span class="hint-state">Unlocked</span></div>' +
          '<div class="hint-content">' + (h.content || '') + '</div>' +
        '</div>'
      );
    }
    return (
      '<div class="hint-card locked" data-id="' + esc(h.id) + '">' +
        '<div class="hint-head"><span class="hint-label">' + label + '</span>' +
          '<span class="hint-price"><i class="fas fa-coins"></i> ' + (h.price > 0 ? fmt(h.price) : 'Free') + '</span></div>' +
        '<div class="hint-locked"><i class="fas fa-lock"></i> Unlock this hint to read it.</div>' +
        '<button class="hint-buy" data-id="' + esc(h.id) + '">' + (h.price > 0 ? 'Unlock · ' + fmt(h.price) + ' tokens' : 'Reveal') + '</button>' +
      '</div>'
    );
  }

  async function buyHint(hintId, btn) {
    btn.disabled = true;
    const old = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
      const res = await apiCall('/api/hint', 'POST', { problemId, hintId });
      if (!res.success) throw new Error(res.message || 'Failed to unlock');

      const card = btn.closest('.hint-card');
      if (card) {
        card.classList.remove('locked');
        card.classList.add('unlocked');
        const priceEl = card.querySelector('.hint-price');
        if (priceEl) priceEl.textContent = 'Unlocked';
        const locked = card.querySelector('.hint-locked');
        if (locked) locked.remove();
        const body = document.createElement('div');
        body.className = 'hint-content';
        body.innerHTML = res.content || '';
        card.appendChild(body);
        renderMath(body);
        btn.remove();
      }
      if (window.DSHUI) DSHUI.toast(res.already ? 'Already unlocked' : 'Hint unlocked', 'ok');
    } catch (e) {
      alert(e.message || 'Failed to unlock');
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }

  // ───────── 启动 ─────────
  function boot() {
    // 页面的 hints 区是 pd-script 渲染的，等它出现
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const sec = document.getElementById('hintsSection');
      if (sec) { clearInterval(timer); loadHints(); }
      else if (tries > 40) clearInterval(timer);
    }, 250);
  }

  window.PDSolution = { activate, reload: loadSolutions, build: PD_SOLUTION_BUILD };
  try { console.log('[pd-solution] build', PD_SOLUTION_BUILD); } catch (e) {}
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
