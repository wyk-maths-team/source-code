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
                '<span class="solution-author"><i class="fas fa-user-circle"></i> ' + esc(s.displayName) + (s.mine ? ' <em>(you)</em>' : '') + '</span>' +
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
          '<div class="solution-preview-label"><i class="fas fa-eye"></i> Preview</div>' +
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
    if (input) {
      try { input.value = localStorage.getItem('sol_draft_' + problemId) || ''; } catch {}
      input.focus();
      input.addEventListener('input', onInput);
      onInput();
    }
  }

  function closeEditor() {
    const editor = document.getElementById('solEditor');
    if (editor) editor.hidden = true;
  }

  function onInput() {
    const input = document.getElementById('solInput');
    const preview = document.getElementById('solPreview');
    if (!input || !preview) return;
    const text = input.value;

    try { localStorage.setItem('sol_draft_' + problemId, text); } catch {}

    if (!text.trim()) {
      preview.innerHTML = '<span class="solution-preview-empty">Nothing to preview yet…</span>';
      return;
    }
    preview.innerHTML = toHtml(text);
    renderMath(preview);
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

  window.PDSolution = { activate, reload: loadSolutions };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
