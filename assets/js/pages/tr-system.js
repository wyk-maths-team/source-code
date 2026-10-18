(function() {
  'use strict';

  if (!isLoggedIn()) {
    window.location.href = '/index.html';
    return;
  }
    // ═══════════════ 反選取 / 反翻譯 保護 ═══════════════
  (function guard() {
    // ── 1. 阻止 Ctrl+A 全選（除非在 input / textarea）──
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const inField = ['INPUT', 'TEXTAREA'].includes(tag) ||
                      (e.target && e.target.isContentEditable);
      if (inField) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
      }
      // ── 阻止 Ctrl+C 複製 ──
      if (mod && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
      }
      // ── 阻止 Ctrl+X 剪下 ──
      if (mod && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
      }
      // ── 阻止 Ctrl+P 列印（另存 PDF）──
      if (mod && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
      }
      // ── 阻止 Ctrl+S 儲存頁面 ──
      if (mod && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
      }
    }, true);

    // ── 2. 阻止 copy 事件 ──
    document.addEventListener('copy', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (!['INPUT', 'TEXTAREA'].includes(tag)) {
        e.preventDefault();
      }
    }, true);

    // ── 3. 阻止拖拽選取 ──
    document.addEventListener('dragstart', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (!['INPUT', 'TEXTAREA'].includes(tag)) {
        e.preventDefault();
      }
    }, true);

    // ── 4. 阻止 iframe 包裹（有人會用 iframe 嵌入後翻譯）──
    try {
      if (window.self !== window.top) {
        // 被嵌入 → 清空頁面 + 跳出去
        document.documentElement.innerHTML = '';
        window.top.location = window.self.location.href;
        return;
      }
    } catch (e) { /* 跨域 iframe 會拋錯，代表被嵌入 */ }

    // ── 5. 檢測翻譯注入 ──
    const TRANSLATE_SIGNS = [
      'translated-ltr',     // Google Translate / Chrome 內建
      'translated-rtl',
    ];
    const TRANSLATE_SELECTORS = [
      '#goog-gt-tt',
      '.goog-te-banner-frame',
      '.goog-te-balloon-frame',
      '.skiptranslate',
      'body > .skiptranslate',
      'iframe.goog-te-banner-frame',
    ];

    let _translationWarned = false;

    function detectTranslation() {
      const html = document.documentElement;
      let detected = false;

      // 檢查 class
      for (const cls of TRANSLATE_SIGNS) {
        if (html.classList.contains(cls)) {
          html.classList.remove(cls);
          detected = true;
        }
      }

      // 檢查 DOM 元素
      for (const sel of TRANSLATE_SELECTORS) {
        const el = document.querySelector(sel);
        if (el && el.parentNode) {
          try { el.remove(); } catch {}
          detected = true;
        }
      }

      // Chrome 翻譯會把 body 往下推
      const top = parseInt(getComputedStyle(document.body).top, 10);
      if (top > 0) {
        document.body.style.setProperty('top', '0', 'important');
        detected = true;
      }

      // 偵測到翻譯 → 顯示警告（只顯示一次）
      if (detected && !_translationWarned) {
        _translationWarned = true;
        showTranslateWarning();
        setTimeout(() => { _translationWarned = false; }, 5000);
      }

      return detected;
    }

    function showTranslateWarning() {
      // 建立警告浮層
      const warn = document.createElement('div');
      warn.id = 'tr-translate-warning';
      warn.innerHTML = `
        <div style="
          position:fixed;inset:0;z-index:999999;
          background:rgba(0,0,0,.75);
          display:flex;align-items:center;justify-content:center;
          padding:24px;backdrop-filter:blur(4px);
          font-family:'Segoe UI',system-ui,sans-serif;
        ">
          <div style="
            background:#fff;color:#2c3e50;
            padding:28px 32px;border-radius:12px;
            max-width:420px;text-align:center;
            box-shadow:0 20px 60px rgba(0,0,0,.4);
          ">
            <div style="font-size:2rem;color:#e67e22;margin-bottom:12px;">
              <i class="fas fa-language"></i>
            </div>
            <h2 style="margin:0 0 8px;font-size:1.1rem;">Auto-Translate Detected</h2>
            <p style="font-size:.88rem;color:#666;line-height:1.6;margin:0 0 18px;">
              This page cannot be translated.<br>
              Please disable browser translation and refresh.
            </p>
            <button id="tr-tw-close" style="
              padding:8px 24px;border:none;border-radius:6px;
              background:#4a90d9;color:#fff;font-size:.88rem;
              font-weight:600;cursor:pointer;font-family:inherit;
            ">OK</button>
          </div>
        </div>
      `;
      document.body.appendChild(warn);
      warn.querySelector('#tr-tw-close').addEventListener('click', () => {
        warn.remove();
      });
    }

    // ── 6. 用 MutationObserver 監測 DOM class 變化 ──
    const observer = new MutationObserver(() => {
      detectTranslation();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: false,
      subtree: false,
    });
    // 也監測 body 的子節點（翻譯工具會插入元素）
    observer.observe(document.body, {
      childList: true,
      subtree: false,
    });

    // ── 7. 週期性檢查（有些翻譯工具不加 class）──
    setInterval(detectTranslation, 800);

    // ── 8. 攔截 contextmenu（右鍵）中的翻譯選項 ──
    // 不阻止右鍵完全（會影響用戶體驗），但移除 Google 翻譯選項
    document.addEventListener('contextmenu', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (['INPUT', 'TEXTAREA'].includes(tag)) return;
      // 不 preventDefault，保留一般右鍵菜單
    }, false);

  })();
  // ═══════════════════════════════════════════════════════════
  // 🔧 設定
  // ═══════════════════════════════════════════════════════════
  const CDN_BASE = 'https://cdn.jsdelivr.net/gh/wyk-math-team/resources@main/script/tr-images/';
  const FILEMAP_URL = CDN_BASE + 'filemap.json';

  const CACHE_KEY_ITEMS     = 'tr_items_v1';
  const CACHE_KEY_FILEMAP   = 'tr_filemap_v1';
  const CACHE_KEY_PROGRESS  = 'tr_progress_v1';
  const CACHE_KEY_STATE     = 'tr_state_v1';         // 當前題 id / 過濾器
  const CACHE_KEY_SCROLL    = 'tr_scroll_v1';        // 主區 & 側欄滾動位置
  const CACHE_KEY_THEME     = 'tr_theme';

  const ITEMS_TTL     = 24 * 60 * 60 * 1000;   // 題庫快取 24h
  const FILEMAP_TTL   = 6 * 60 * 60 * 1000;    // filemap 快取 6h

  // ═══════════ 狀態 ═══════════
  const state = {
    items: [],
    filtered: [],
    currentId: null,
    currentDetail: null,
    selected: null,
    submitted: false,
    correct: false,
    progress: {},         // { id: { selected, correct, ts } }
    filters: { level: '', diff: '', cat: '', status: '', side: '' },
    fileMap: {},
    imageLoadFailed: new Set(),
    loading: false,
  };

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));

  // ═══════════ 主題 ═══════════
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      $('#trThemeIcon').className = 'fas fa-sun';
    } else {
      document.documentElement.removeAttribute('data-theme');
      $('#trThemeIcon').className = 'fas fa-moon';
    }
  }
  function initTheme() {
    let t = localStorage.getItem(CACHE_KEY_THEME) || localStorage.getItem('theme') || 'light';
    applyTheme(t);
    $('#trThemeBtn').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = cur === 'dark' ? 'light' : 'dark';
      localStorage.setItem(CACHE_KEY_THEME, next);
      applyTheme(next);
    });
  }

  // ═══════════ localStorage 工具 ═══════════
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) {
      console.warn(`[TR] localStorage.setItem failed for ${key}:`, e.message);
      return false;
    }
  }
  function lsDel(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  // ═══════════ 進度 ═══════════
  function loadProgress() {
    state.progress = lsGet(CACHE_KEY_PROGRESS, {}) || {};
  }
  function saveProgress() {
    lsSet(CACHE_KEY_PROGRESS, state.progress);
  }

  // ═══════════ 狀態（當前題 + 過濾器）═══════════
  function loadState() {
    const s = lsGet(CACHE_KEY_STATE, {});
    if (s.filters) state.filters = { ...state.filters, ...s.filters, side: '' };
    if (s.currentId) state.currentId = s.currentId;
  }
  function saveState() {
    lsSet(CACHE_KEY_STATE, {
      currentId: state.currentId,
      filters: {
        level: state.filters.level,
        diff: state.filters.diff,
        cat: state.filters.cat,
        status: state.filters.status,
      },
    });
  }

  // ═══════════ 滾動位置 ═══════════
  let _scrollSaveTimer = null;
  function saveScroll() {
    if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
    _scrollSaveTimer = setTimeout(() => {
      lsSet(CACHE_KEY_SCROLL, {
        main: $('#trMain')?.scrollTop || 0,
        side: $('#trSideList')?.scrollTop || 0,
        ts: Date.now(),
      });
    }, 150);
  }
  function restoreScroll() {
    const s = lsGet(CACHE_KEY_SCROLL, null);
    if (!s) return;
    // 滾動位置只在 5 分鐘內有效
    if (Date.now() - (s.ts || 0) > 5 * 60 * 1000) return;
    requestAnimationFrame(() => {
      if (s.main) $('#trMain').scrollTop = s.main;
      if (s.side) $('#trSideList').scrollTop = s.side;
    });
  }

  // ═══════════ 題庫快取 ═══════════
  function loadItemsCache() {
    const c = lsGet(CACHE_KEY_ITEMS, null);
    if (!c || !Array.isArray(c.items)) return null;
    if (Date.now() - (c.ts || 0) > ITEMS_TTL) return null;
    return c.items;
  }
  function saveItemsCache(items) {
    const ok = lsSet(CACHE_KEY_ITEMS, { ts: Date.now(), items });
    if (!ok) console.warn('[TR] items cache save failed (may be too large)');
    return ok;
  }
  function clearItemsCache() {
    lsDel(CACHE_KEY_ITEMS);
  }

  // ═══════════ filemap ═══════════
  async function loadFileMap() {
    // 1) 快取
    const cached = lsGet(CACHE_KEY_FILEMAP, null);
    if (cached && cached.map && Date.now() - (cached.ts || 0) < FILEMAP_TTL) {
      state.fileMap = cached.map;
      console.log(`[TR] filemap from cache: ${Object.keys(state.fileMap).length}`);
      return;
    }
    // 2) CDN
    try {
      const res = await fetch(FILEMAP_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map = await res.json();
      state.fileMap = map || {};
      lsSet(CACHE_KEY_FILEMAP, { ts: Date.now(), map: state.fileMap });
      console.log(`[TR] filemap from CDN: ${Object.keys(state.fileMap).length}`);
    } catch (e) {
      console.warn('[TR] filemap failed:', e.message);
      state.fileMap = {};
    }
  }

  function resolveImageSrc(id) {
    const filename = state.fileMap[id];
    if (!filename || state.imageLoadFailed.has(id)) return '';
    return CDN_BASE + encodeURIComponent(filename);
  }

  window.__trImgError = function(id, imgEl) {
    state.imageLoadFailed.add(id);
    const container = imgEl.parentElement;
    if (container) {
      container.innerHTML = `<div class="placeholder">
        <i class="fas fa-image" style="margin-right:6px;opacity:.5;"></i>圖片載入失敗
      </div>`;
    }
  };

  // ═══════════ 認證 ═══════════
  async function checkAccess() {
    try {
      const r = await apiCall('/api/tr-problems?action=whoami');
      return !!(r && r.canView);
    } catch { return false; }
  }

  // ═══════════ 從伺服器拉題庫 ═══════════
  async function fetchItemsFromServer() {
    const r = await apiCall('/api/tr-problems?action=list-all');
    if (!r.success) throw new Error(r.message || 'load failed');
    return r.items || [];
  }

  // ═══════════ 載入題庫（優先快取）═══════════
  async function loadItems(force = false) {
    if (force) {
      clearItemsCache();
    } else {
      const cached = loadItemsCache();
      if (cached) {
        state.items = cached;
        console.log(`[TR] items from cache: ${cached.length}`);
        return true;
      }
    }

    // 顯示載入
    $('#trCardWrap').innerHTML = `<div class="tr-loading">
      <i class="fas fa-spinner fa-spin"></i>
      <div>從伺服器載入題庫…</div>
    </div>`;

    try {
      const items = await fetchItemsFromServer();
      state.items = items;
      saveItemsCache(items);
      console.log(`[TR] items from server: ${items.length}`);
      return true;
    } catch (e) {
      console.error('[TR] loadItems failed:', e);
      $('#trCardWrap').innerHTML = `<div class="tr-empty">
        <i class="fas fa-triangle-exclamation"></i>
        <h2>載入失敗</h2>
        <div>${esc(e.message)}</div>
      </div>`;
      return false;
    }
  }

  // ═══════════ 建立過濾選項 ═══════════
  function buildFilterOptions() {
    // Level
    const levelSel = $('#trFilterLevel');
    const curLevel = levelSel.value;
    let levelHtml = '<option value="">All</option>';
    for (let i = 1; i <= 9; i++) levelHtml += `<option value="${i}">Lv.${i}</option>`;
    levelSel.innerHTML = levelHtml;
    levelSel.value = curLevel;

    // Category
    const catSel = $('#trFilterCat');
    const curCat = catSel.value;
    const cats = [...new Set(state.items.map(i => i.category).filter(Boolean))].sort();
    catSel.innerHTML = '<option value="">All</option>' +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    catSel.value = curCat;
  }

  // ═══════════ 過濾 ═══════════
  function applyFilters() {
    const { level, diff, cat, status } = state.filters;
    state.filtered = state.items.filter(it => {
      if (level && String(it.level) !== String(level)) return false;
      if (diff && it.difficulty !== diff) return false;
      if (cat && it.category !== cat) return false;

      if (status) {
        const p = state.progress[it.id];
        if (status === 'unanswered' && p) return false;
        if (status === 'correct'   && !(p && p.correct)) return false;
        if (status === 'wrong'     && !(p && !p.correct)) return false;
      }
      return true;
    });
  }

  // ═══════════ 側邊列表過濾 ═══════════
  function applySideFilter() {
    const q = (state.filters.side || '').trim().toLowerCase();
    if (!q) return state.filtered;
    return state.filtered.filter(it => it.id.toLowerCase().includes(q));
  }

  // ═══════════ 渲染側邊列表 ═══════════
  function renderSideList() {
    const el = $('#trSideList');
    const list = applySideFilter();

    if (!list.length) {
      el.innerHTML = `<div style="padding:16px;color:var(--text-secondary);font-size:.75rem;text-align:center;">
        No problems
      </div>`;
      return;
    }

    // 用 DocumentFragment 提升效能
    const frag = document.createDocumentFragment();
    for (const it of list) {
      const p = state.progress[it.id];
      const isActive = it.id === state.currentId;
      const cls = [
        'tr-side-item',
        isActive ? 'active' : '',
        p ? (p.correct ? 'correct' : 'wrong') : '',
      ].filter(Boolean).join(' ');

      const node = document.createElement('div');
      node.className = cls;
      node.dataset.id = it.id;
      node.title = it.id;
      node.innerHTML = `<span class="dot"></span><span class="id">${esc(it.id)}</span>`;
      frag.appendChild(node);
    }

    el.innerHTML = '';
    el.appendChild(frag);

    // 事件委派
    el.querySelectorAll('.tr-side-item').forEach(node => {
      node.addEventListener('click', () => {
        goToId(node.dataset.id);
      });
    });

    // 滾動到當前題（僅當選中項不在視窗內時）
    if (state.currentId) {
      const active = el.querySelector('.tr-side-item.active');
      if (active) {
        const rect = active.getBoundingClientRect();
        const listRect = el.getBoundingClientRect();
        if (rect.top < listRect.top || rect.bottom > listRect.bottom) {
          active.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
    }
  }

  // ═══════════ 更新統計 ═══════════
  function updateStats() {
    const list = state.filtered;
    const total = list.length;
    const done = list.filter(it => state.progress[it.id]).length;
    const correct = list.filter(it => state.progress[it.id]?.correct).length;
    const wrong = done - correct;

    $('#trCounter').textContent = `${done} / ${total}`;
    $('#trProgressFill').style.width = (total ? (done / total) * 100 : 0) + '%';
    $('#trAccuracy').textContent = done ? `${Math.round((correct / done) * 100)}%` : '—';
    $('#trLegGood').textContent = correct;
    $('#trLegBad').textContent = wrong;
    $('#trHeadStat').textContent = `${state.items.length} problems`;
  }

  // ═══════════ 載入單題詳情（純本地，不打 API）═══════════
  async function loadDetail(id) {
    if (state.currentDetail && state.currentDetail.id === id) return state.currentDetail;

    // ⭐ 1) 從已載入的題庫找（list-all 已含全部渲染所需欄位）
    const local = state.items.find(it => it.id === id);
    if (local) {
      state.currentDetail = local;
      return local;
    }

    // 2) 本地找不到（罕見：items 被清空 / 該題不在列表）→ 打 API 兜底
    try {
      const r = await apiCall(`/api/tr-problems?action=get&id=${encodeURIComponent(id)}`);
      if (!r.success) throw new Error(r.message);
      state.currentDetail = r.problem;
      return r.problem;
    } catch (e) {
      console.error('[TR] loadDetail failed:', e);
      return null;
    }
  }

  // ═══════════ 渲染題目 ═══════════
  async function renderCard() {
    const wrap = $('#trCardWrap');

    if (!state.filtered.length) {
      wrap.innerHTML = `<div class="tr-card"><div class="tr-empty">
        <i class="fas fa-inbox"></i>
        <h2>沒有題目</h2>
        <div>試著調整過濾條件。</div>
      </div></div>`;
      updateStats();
      return;
    }

    // 找當前題
    let meta = state.filtered.find(it => it.id === state.currentId);
    if (!meta) {
      meta = state.filtered[0];
      state.currentId = meta.id;
    }

    // 載入詳情
    wrap.innerHTML = `<div class="tr-card"><div class="tr-loading" style="padding:40px 0;">
      <i class="fas fa-spinner fa-spin"></i><div>載入中…</div>
    </div></div>`;

    const detail = await loadDetail(meta.id);
    if (!detail) {
      wrap.innerHTML = `<div class="tr-card"><div class="tr-empty">
        <i class="fas fa-triangle-exclamation"></i>
        <h2>載入失敗</h2>
      </div></div>`;
      return;
    }

    // 若已答過 → 帶入
    const p = state.progress[detail.id];
    if (p) {
      state.selected = p.selected;
      state.submitted = true;
      state.correct = p.correct;
    } else {
      state.selected = null;
      state.submitted = false;
      state.correct = false;
    }

    const diffLabel = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }[detail.difficulty] || detail.difficulty;

    // 圖片
    const imgSrc = resolveImageSrc(detail.id);
    let imageHtml = '';
    if (imgSrc) {
      imageHtml = `
        <div class="tr-image">
          <img src="${esc(imgSrc)}" alt="題目圖" id="trProblemImg"
               onerror="window.__trImgError('${esc(detail.id)}', this)">
        </div>`;
    }

    // 選項
    const choicesHtml = Object.keys(detail.choice).sort().map(k => {
      let cls = 'tr-choice';
      if (state.submitted) {
        if (k === detail.ans) cls += ' correct';
        else if (k === state.selected) cls += ' wrong';
      } else if (state.selected === k) {
        cls += ' selected';
      }
      return `
        <button class="${cls}" data-key="${esc(k)}" ${state.submitted ? 'disabled' : ''}>
          <span class="key">${esc(k)}</span>
          <span class="text">${esc(detail.choice[k])}</span>
        </button>`;
    }).join('');

    // 回饋
    let feedbackHtml = '';
    if (state.submitted) {
      const isCorrect = state.selected === detail.ans;
      feedbackHtml = `
        <div class="tr-feedback ${isCorrect ? 'good' : 'bad'}">
          <strong>${isCorrect ? '✓ 正確' : '✗ 錯誤'}</strong>
          ${isCorrect ? '' : `　正確答案：<b>${esc(detail.ans)}</b>`}
        </div>`;
    }

    const idx = state.filtered.findIndex(it => it.id === detail.id);
    const isFirst = idx <= 0;
    const isLast = idx >= state.filtered.length - 1;

    wrap.innerHTML = `
      <article class="tr-card">
        <div class="tr-meta">
          <span class="tr-tag id">${esc(detail.id)}</span>
          ${detail.category ? `<span class="tr-tag cat">${esc(detail.category)}</span>` : ''}
          <span class="tr-tag lvl">Lv.${detail.level}</span>
          <span class="tr-tag diff ${esc(detail.difficulty)}">${esc(diffLabel)}</span>
        </div>

        <div class="tr-statement">${esc(detail.statement)}</div>

        ${imageHtml}

        <div class="tr-choices" id="trChoices">${choicesHtml}</div>

        ${feedbackHtml}

        <div class="tr-actions">
          <button class="tr-btn ghost" id="trPrev" ${isFirst ? 'disabled' : ''}>
            <i class="fas fa-arrow-left"></i> 上一題
          </button>
          <div class="spacer"></div>
          <button class="tr-btn ghost" id="trClear" ${state.submitted ? 'disabled' : ''}>
            <i class="fas fa-eraser"></i> 清除
          </button>
          <button class="tr-btn primary" id="trSubmit" ${!state.selected || state.submitted ? 'disabled' : ''}>
            <i class="fas fa-check"></i> 提交
          </button>
          <button class="tr-btn primary" id="trNext" ${isLast ? 'disabled' : ''}>
            下一題 <i class="fas fa-arrow-right"></i>
          </button>
        </div>
      </article>
    `;

    bindCardEvents();
    renderKatex(wrap);
    updateStats();
    renderSideList();
    saveState();
  }

  // ⭐ KaTeX 渲染
  function renderKatex(root) {
    if (typeof renderMathInElement !== 'function') return;
    try {
      renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$',  right: '$',  display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
        errorColor: '#c62828',
        strict: false,
        trust: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
        ignoredClasses: ['no-katex'],
      });
    } catch (e) {
      console.warn('[TR] KaTeX render failed:', e);
    }
  }

  // ═══════════ 卡片事件 ═══════════
  function bindCardEvents() {
    $$('.tr-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.submitted) return;
        state.selected = btn.dataset.key;
        $$('.tr-choice').forEach(x => x.classList.remove('selected'));
        btn.classList.add('selected');
        $('#trSubmit').disabled = false;
      });
    });

    $('#trSubmit')?.addEventListener('click', submitAnswer);
    $('#trClear')?.addEventListener('click', () => {
      state.selected = null;
      $$('.tr-choice').forEach(x => x.classList.remove('selected'));
      $('#trSubmit').disabled = true;
    });
    $('#trPrev')?.addEventListener('click', () => goPrev());
    $('#trNext')?.addEventListener('click', () => goNext());

    $('#trProblemImg')?.addEventListener('click', (e) => {
      $('#trLightboxImg').src = e.target.src;
      $('#trLightbox').classList.add('show');
    });
  }

  function submitAnswer() {
    if (!state.selected || state.submitted) return;
    const detail = state.currentDetail;
    const isCorrect = state.selected === detail.ans;
    state.submitted = true;
    state.correct = isCorrect;
    state.progress[detail.id] = {
      selected: state.selected,
      correct: isCorrect,
      ts: Date.now(),
    };
    saveProgress();
    renderCard();
  }

  // ═══════════ 導航 ═══════════
  function goPrev() {
    const idx = state.filtered.findIndex(it => it.id === state.currentId);
    if (idx <= 0) return;
    goToId(state.filtered[idx - 1].id);
  }
  function goNext() {
    const idx = state.filtered.findIndex(it => it.id === state.currentId);
    if (idx < 0 || idx >= state.filtered.length - 1) return;
    goToId(state.filtered[idx + 1].id);
  }
  function goToId(id) {
    if (state.currentId === id && state.currentDetail?.id === id) return;
    state.currentId = id;
    state.currentDetail = null;
    state.selected = null;
    state.submitted = false;
    $('#trMain').scrollTop = 0;
    // 手機：點 sidebar 項目後收起
    if (window.innerWidth <= 700) {
      $('#trSidebar').classList.remove('open');
    }
    renderCard();
  }

  // ═══════════ Lightbox ═══════════
  $('#trLightbox')?.addEventListener('click', () => {
    $('#trLightbox').classList.remove('show');
  });

  // ═══════════ 鍵盤快捷鍵 ═══════════
  document.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const detail = state.currentDetail;
    if (!detail) return;

    const key = e.key.toUpperCase();

    if (/^[A-Z]$/.test(key) && detail.choice[key]) {
      if (state.submitted) return;
      state.selected = key;
      $$('.tr-choice').forEach(x => x.classList.toggle('selected', x.dataset.key === key));
      const btn = $('#trSubmit');
      if (btn) btn.disabled = false;
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (!state.submitted && state.selected) submitAnswer();
      else if (state.submitted) goNext();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft') { goPrev(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { goNext(); e.preventDefault(); }
    if (e.key === 'Escape' && !state.submitted) {
      state.selected = null;
      $$('.tr-choice').forEach(x => x.classList.remove('selected'));
      const btn = $('#trSubmit');
      if (btn) btn.disabled = true;
    }
  });

  // ═══════════ 過濾器事件 ═══════════
  function bindFilterEvents() {
    ['#trFilterLevel', '#trFilterDiff', '#trFilterCat', '#trFilterStatus'].forEach(sel => {
      $(sel)?.addEventListener('change', () => {
        state.filters.level  = $('#trFilterLevel').value;
        state.filters.diff   = $('#trFilterDiff').value;
        state.filters.cat    = $('#trFilterCat').value;
        state.filters.status = $('#trFilterStatus').value;
        applyFilters();
        // 若當前題被過濾掉 → 跳到第一篇
        if (!state.filtered.find(it => it.id === state.currentId)) {
          state.currentId = state.filtered[0]?.id || null;
          state.currentDetail = null;
          state.selected = null;
          state.submitted = false;
        }
        renderCard();
        saveState();
      });
    });

    // 側邊搜尋
    let _sideTimer = null;
    $('#trSideFilter')?.addEventListener('input', () => {
      clearTimeout(_sideTimer);
      _sideTimer = setTimeout(() => {
        state.filters.side = $('#trSideFilter').value;
        renderSideList();
      }, 150);
    });
  }

  // ═══════════ 滾動保存 ═══════════
  function bindScrollListeners() {
    $('#trMain')?.addEventListener('scroll', saveScroll, { passive: true });
    $('#trSideList')?.addEventListener('scroll', saveScroll, { passive: true });
  }

  // ═══════════ 刷新按鈕 ═══════════
  async function handleRefresh() {
    const btn = $('#trRefreshBtn');
    const mask = $('#trRefreshMask');
    if (btn.classList.contains('spinning')) return;

    btn.classList.add('spinning');
    mask.classList.add('show');
    $('#trRefreshMsg').textContent = 'Refreshing from server...';

    try {
      const ok = await loadItems(true);
      if (!ok) return;
      // 重建過濾選項
      buildFilterOptions();
      applyFilters();
      // 若當前題不在新題庫，跳到第一篇
      if (!state.filtered.find(it => it.id === state.currentId)) {
        state.currentId = state.filtered[0]?.id || null;
        state.currentDetail = null;
        state.selected = null;
        state.submitted = false;
      }
      await renderCard();
      $('#trRefreshMsg').textContent = 'Done!';
      setTimeout(() => mask.classList.remove('show'), 400);
    } catch (e) {
      $('#trRefreshMsg').textContent = 'Refresh failed: ' + e.message;
      setTimeout(() => mask.classList.remove('show'), 1500);
    } finally {
      btn.classList.remove('spinning');
    }
  }

  // ═══════════ 手機側欄 ═══════════
  function bindMobileMenu() {
    $('#trMobileMenuBtn')?.addEventListener('click', () => {
      $('#trSidebar').classList.toggle('open');
    });
    // 點主區關閉側欄
    $('#trMain')?.addEventListener('click', (e) => {
      if (window.innerWidth > 700) return;
      const sb = $('#trSidebar');
      if (sb.classList.contains('open')) {
        // 若點擊的是 sidebar 內部則不關
        if (!$('#trSidebar').contains(e.target)) {
          sb.classList.remove('open');
        }
      }
    });
  }

  // ═══════════ 啟動 ═══════════
  (async function init() {
    initTheme();

    const ok = await checkAccess();
    if (!ok) {
      window.location.replace('/404.html');
      return;
    }

    // 載入進度 & 狀態
    loadProgress();
    loadState();

    // 顯示布局
    $('#trLayout').style.display = 'grid';

    // 平行載入 filemap + 題庫（若快取有直接讀）
    await Promise.all([
      loadFileMap(),
      loadItems(false),
    ]);

    if (!state.items.length) {
      $('#trCardWrap').innerHTML = `<div class="tr-card"><div class="tr-empty">
        <i class="fas fa-inbox"></i>
        <h2>題庫為空</h2>
      </div></div>`;
      return;
    }

    // 建立過濾選項
    buildFilterOptions();

    // 還原過濾器 UI 值
    $('#trFilterLevel').value = state.filters.level || '';
    $('#trFilterDiff').value = state.filters.diff || '';
    $('#trFilterCat').value = state.filters.cat || '';
    $('#trFilterStatus').value = state.filters.status || '';

    // 過濾
    applyFilters();

    // 若無當前題（首次）→ 選第一篇
    if (!state.currentId || !state.filtered.find(it => it.id === state.currentId)) {
      state.currentId = state.filtered[0]?.id || null;
    }

    // 綁定事件
    bindFilterEvents();
    bindScrollListeners();
    bindMobileMenu();
    $('#trRefreshBtn').addEventListener('click', handleRefresh);

    // 渲染
    renderSideList();
    await renderCard();
    updateStats();

    // 恢復滾動位置
    restoreScroll();
  })();
})();
