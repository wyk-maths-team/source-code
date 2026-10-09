// pd-script.js — problem detail page (core)
// ═══════════════════════════════════════════════════════════════════
// 職責：快速渲染題目。其他功能由 pd-mcq.js / pd-extras.js 補上。
//
// 暴露：window.PD
//   ├─ 常數 / 狀態：S, problemId, mainContainer, PAGE_LOAD_AT
//   ├─ 工具函式：esc, debounce, executeScriptsIn, loadScript,
//   │            loadCssOnce, getTopbarHeight, clampInt
//   ├─ 答案存儲：answersStore, saveAnswerDebounced, saveAnswerNow
//   ├─ UI 輔助：setWorkbenchStatus, setWorkbenchStatusHtml,
//   │            statusBoxHtml, updateProblemDetailIcon
//   └─ 註冊槽：workbench, extras, mcq
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────
  // [1] 常數 & 全局狀態
  // ─────────────────────────────────────────────────────────────
  if (typeof isLoggedIn !== 'function' || !isLoggedIn()) {
    window.location.href = '/index.html';
    return;
  }

  const __pathMatch = location.pathname.match(/^\/problems\/([^/]+)$/);
  if (!__pathMatch) {
    const mc = document.getElementById('mainContent');
    if (mc) mc.innerHTML = '<div class="error-msg">Invalid problem URL.</div>';
    return;
  }

  const problemId    = decodeURIComponent(__pathMatch[1]);
  const PAGE_LOAD_AT = Date.now();
  const mainContainer = document.getElementById('mainContent');

  const S = {
    problem: null,
    userStates: {},
    imageData: '',
    cooldown: false,
    pollTimer: null,
    currentMode: 'numeric',
    problemName: '',
    favorites: new Set(),
    timer: { seconds: 0, interval: null, running: false },
  };

  // ─────────────────────────────────────────────────────────────
  // [2] 工具函式
  // ─────────────────────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function executeScriptsIn(el) {
    if (!el) return;
    el.querySelectorAll('script').forEach(old => {
      const s = document.createElement('script');
      for (const a of old.attributes) s.setAttribute(a.name, a.value);
      s.textContent = old.textContent;
      old.replaceWith(s);
    });
  }

  const getTopbarHeight = () => {
    const n = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height'), 10);
    return Number.isFinite(n) ? n : 60;
  };

  function clampInt(raw, min, max, fallback) {
    const n = parseInt(raw, 10);
    return (Number.isFinite(n) && n >= min && n <= max) ? n : fallback;
  }

  // 動態載入 script（同一 src 只載一次）
  const _scriptCache = new Map();
  function loadScript(src) {
      if (_scriptCache.has(src)) return _scriptCache.get(src);
      const p = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => {
          _scriptCache.delete(src);   // ⭐ 清掉失敗緩存
          reject(new Error(`Failed to load ${src}`));
        };
        document.head.appendChild(s);
      });
      _scriptCache.set(src, p);
      return p;
  }

  // 動態載入 CSS（同一 href 只載一次）
  const _cssCache = new Set();
  function loadCssOnce(href) {
    if (_cssCache.has(href)) return Promise.resolve();
    _cssCache.add(href);
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => { console.warn('[css] load fail:', href); resolve(); };
      document.head.appendChild(link);
    });
  }

  // ─────────────────────────────────────────────────────────────
  // [3] 本地儲存：Answers
  // ─────────────────────────────────────────────────────────────
  const ANSWERS_KEY = 'pd_user_answers';
  const answersStore = {
    _read()   { try { return JSON.parse(localStorage.getItem(ANSWERS_KEY) || '{}'); } catch { return {}; } },
    _write(o) { try { localStorage.setItem(ANSWERS_KEY, JSON.stringify(o)); } catch {} },
    get(pid)  { return this._read()[pid] || ''; },
    set(pid, val) {
      if (!pid || !val) return;
      const t = String(val).trim();
      if (!t) return;
      const o = this._read();
      o[pid] = t;
      this._write(o);
    },
  };
  const saveAnswerDebounced = debounce((pid, val) => answersStore.set(pid, val), 500);
  const saveAnswerNow       = (pid, val) => answersStore.set(pid, val);
    // ─────────────────────────────────────────────────────────────
  // [3.5] Statement 快取（顯示用，先讓用戶看到內容）
  // ─────────────────────────────────────────────────────────────
  const STMT_CACHE_KEY = 'pd_stmt_cache_v1';
  const STMT_CACHE_MAX = 200;         // 最多快取 200 題
  const STMT_CACHE_TTL = 7 * 864e5;   // 7 天

  function _readStmtCache() {
    try {
      const raw = localStorage.getItem(STMT_CACHE_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch { return {}; }
  }

  function _writeStmtCache(cache) {
    try {
      localStorage.setItem(STMT_CACHE_KEY, JSON.stringify(cache));
    } catch (e) {
      // 可能超額 → 清掉一半舊的再試一次
      try {
        const entries = Object.entries(cache)
          .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0))
          .slice(0, Math.floor(STMT_CACHE_MAX / 2));
        localStorage.setItem(STMT_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
      } catch {}
    }
  }

  function getCachedProblem(pid) {
    const cache = _readStmtCache();
    const entry = cache[pid];
    if (!entry) return null;
    // 過期不刪（stale-while-revalidate），但標記
    const stale = (Date.now() - (entry.updatedAt || 0)) > STMT_CACHE_TTL;
    return { ...entry, stale };
  }

  function setCachedProblem(pid, problem) {
    const cache = _readStmtCache();

    cache[pid] = {
      statement: problem.statement || '',
      name: problem.name || '',
      tags: Array.isArray(problem.tags) ? problem.tags : [],
      difficulty: Number(problem.difficulty) || 0,
      updatedAt: Date.now(),
    };

    // LRU 修剪
    const ids = Object.keys(cache);
    if (ids.length > STMT_CACHE_MAX) {
      const sorted = ids.sort((a, b) =>
        (cache[a].updatedAt || 0) - (cache[b].updatedAt || 0)
      );
      const toDrop = sorted.slice(0, ids.length - STMT_CACHE_MAX);
      for (const id of toDrop) delete cache[id];
    }

    _writeStmtCache(cache);
  }
    // ─────────────────────────────────────────────────────────────
  // [3.6] 用戶答題狀態快取（同步讀取，避免狀態閃爍）
  // ─────────────────────────────────────────────────────────────
  const USER_STATES_KEY = 'pd_user_states_v1';

  function readUserStatesCache() {
    try {
      const raw = localStorage.getItem(USER_STATES_KEY);
      if (!raw) return {};
      const obj = JSON.parse(raw);
      return (obj && typeof obj === 'object') ? obj : {};
    } catch { return {}; }
  }

  function getCachedState(pid) {
    return readUserStatesCache()[pid] || 'not_started';
  }

  function setCachedState(pid, state) {
    if (!pid || !state) return;
    const cache = readUserStatesCache();
    if (cache[pid] === state) return;
    cache[pid] = state;
    try { localStorage.setItem(USER_STATES_KEY, JSON.stringify(cache)); } catch {}
  }

  // ⭐ 同時更新 S.userStates 和 localStorage
  function setProblemState(pid, state) {
    if (!pid || !state) return;
    S.userStates[pid] = state;
    setCachedState(pid, state);
  }
  // ─────────────────────────────────────────────────────────────
  // [4] UI 輔助函式（被 mcq / extras 共用）
  // ─────────────────────────────────────────────────────────────
  function setWorkbenchStatus(text, cls = '') {
    const el = document.getElementById('wbStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'wb-status' + (cls ? ' ' + cls : '');
  }
  function setWorkbenchStatusHtml(html, cls = '') {
    const el = document.getElementById('wbStatus');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'wb-status' + (cls ? ' ' + cls : '');
  }
  function statusBoxHtml(subid, text, cls) {
    if (!subid) return esc(text);
    return `<a href="/submissions/${encodeURIComponent(subid)}/detail" class="feedback-box ${cls}">${esc(text)}</a>`;
  }
  function updateProblemDetailIcon() {
    const state = S.userStates[problemId] || 'not_started';
    const el = document.getElementById('detailStatusIcon');
    if (el) {
      el.innerHTML = state === 'passed' ? '<i class="fa fa-check-circle fa-green"></i>'
                   : state === 'failed' ? '<i class="fa fa-times-circle fa-red"></i>'
                   : '';
    }
  }

  // ⭐ 全局註冊表
  window.PD = {
    S, problemId, mainContainer, PAGE_LOAD_AT,
    esc, debounce, executeScriptsIn, loadScript, loadCssOnce,
    getTopbarHeight, clampInt,
    answersStore, saveAnswerDebounced, saveAnswerNow,
    setWorkbenchStatus, setWorkbenchStatusHtml, statusBoxHtml,
    updateProblemDetailIcon,
    // ⭐ 加這三個
    getCachedState,
    setCachedState,
    setProblemState,
    // 註冊槽
    workbench: null,
    extras: null,
    mcq: null,
  };

  // ─────────────────────────────────────────────────────────────
  // [5] 頁面資料載入
  // ─────────────────────────────────────────────────────────────
  async function loadPageData() {
    const apiData = await apiCall(`/api/problem?action=page&id=${encodeURIComponent(problemId)}`)
      .catch(() => null);
    if (!apiData?.success || !apiData.problem) return null;
    return {
      problem: apiData.problem,
      state: apiData.state || 'not_started',
      favorited: !!apiData.favorited,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // [6] 骨架 HTML
  // ─────────────────────────────────────────────────────────────
  function buildPageHTML(problem, opts = {}) {
    const diff = problem.difficulty ?? 0;
    const state = opts.state || 'not_started';
    const isFav = !!opts.favorited;

    // 命中快取時，用戶狀態未知 → 先按 not_started / 未收藏渲染
    const starClass = isFav ? 'fas fa-star' : 'far fa-star';
    const starColor = isFav ? '#f1c40f' : '#aaa';
    return `
      <div class="problem-detail" id="problemDetailShell">
        <div class="detail-header">
          <button class="back-btn" id="backToListBtn">← Back</button>
          <span class="problem-name-detail">
            <span id="detailProblemName">${esc(problemId)} - ${esc(S.problemName)}</span>
            <span id="detailStatusIcon"></span>
            <span id="detailSpinner" class="spinner" style="display:none"></span>
            <span id="detailStatusText" style="margin-left:.5rem;font-size:.9rem"></span>
            <span id="detailFavorite" style="margin-left:8px;cursor:pointer">
              <i class="${starClass}" style="font-size:1.2rem;color:${starColor}"></i>
            </span>
          </span>
          <span id="detailEditBtn"></span>
          <span style="margin-left:auto;font-size:.8rem">
            <span id="detailDifficulty">Lv.${diff === 0 ? '∞' : diff.toFixed(2)}</span>
          </span>
          <span style="font-size:0.8rem" id="detailTags">${(problem.tags || []).join(', ')}</span>
          <span style="display:flex;gap:0.5rem;align-items:center;">
            <span id="navButtons" style="display:flex;gap:0.5rem;"></span>
            <button id="similarBtn" class="back-btn" style="color:var(--accent);">
              <i class="fas fa-layer-group"></i> Similar
            </button>
            <button id="reportBtn" class="back-btn" style="color:var(--danger);">Report</button>
          </span>
        </div>

        <div class="answer-workbench" id="answerWorkbench">
          <div class="wb-tabs" role="tablist">
            <button type="button" class="wb-tab" data-mode="text" role="tab" title="Text">
              <i class="fas fa-keyboard"></i>
            </button>
            <button type="button" class="wb-tab" data-mode="photo" role="tab" title="Photo">
              <i class="fas fa-camera"></i>
            </button>
            <button type="button" class="wb-tab" data-mode="steps" role="tab" title="Steps (AI grading)">
              <i class="fas fa-wand-magic-sparkles"></i>
            </button>
          </div>

          <div class="wb-hint" id="wbHint" style="display:none"></div>

          <div class="wb-panes">
            <div class="wb-pane" data-pane="text">
              <input type="text" id="answerInput" class="wb-input"
                    autocomplete="off" spellcheck="false">
              <div class="wb-expr-preview" id="wbExprPreview" hidden>
                <i class="fas fa-calculator"></i>
                <span class="expr-label">preview:</span>
                <span class="expr-value" id="wbExprResult"></span>
              </div>
            </div>
            <div class="wb-pane" data-pane="photo">
              <label class="wb-dropzone" id="wbDropzone">
                <input type="file" id="imageFileInput" accept="image/*" hidden>
                <i class="fas fa-cloud-upload-alt"></i>
              </label>
              <div class="wb-photo-preview" id="wbPhotoPreview" hidden>
                <img id="imagePreview" alt="preview">
                <div class="wb-photo-actions">
                  <button type="button" id="wbRetake"><i class="fas fa-rotate"></i> Replace</button>
                  <button type="button" id="wbRemoveImage"><i class="fas fa-trash"></i> Remove</button>
                </div>
              </div>
            </div>

            <div class="wb-pane" data-pane="steps">
              <div class="wb-model-picker">
                <span class="wb-model-label"><i class="fas fa-microchip"></i> AI model</span>
                <button type="button" class="wb-model-btn" data-model="r1">
                  R1 <small>Slow but accurate</small>
                </button>
                <button type="button" class="wb-model-btn" data-model="v3">
                  V3 <small>Fast</small>
                </button>
              </div>
              <textarea id="stepsInput" class="wb-textarea" rows="10"
                maxlength="1000"></textarea>
              <div class="wb-counter"><span id="stepsCount">0</span> / 1000</div>
            </div>
          </div>

          <div class="wb-footer">
            <span class="wb-status" id="wbStatus"></span>
            <div class="wb-footer-actions">
              <button type="button" class="wb-btn-secondary" id="submissionsBtn">Submissions</button>
              <button type="button" class="wb-btn-secondary" id="timerToggleBtn">Timer</button>
              <button type="button" class="wb-btn-secondary" id="drawToggleBtn" title="Draw on page">
                <i class="fas fa-pen-fancy"></i> Draw
              </button>
              <button type="button" class="wb-submit" id="checkAnswerBtn" disabled>
                <i class="fas fa-paper-plane"></i>
                <span id="wbSubmitLabel">Submit</span>
              </button>
            </div>
          </div>
        </div>

        <div class="split-container" id="splitContainer">
          <div class="statement-content" id="statementContent"></div>
          <div class="split-divider" id="splitDivider" style="display:none"></div>
          <div class="drawpad-wrapper" id="drawpadWrapper" style="display:none"></div>
        </div>

        <div id="nekoContainer" style="display:none;margin:1rem 0;text-align:center;">
          <div id="nekoStatus" style="font-size:.9rem;color:var(--text-secondary);padding:.5rem;">Loading...</div>
          <img id="nekoImage" src="" alt="Neko" style="max-width:100%;max-height:300px;border-radius:8px;box-shadow:0 0 20px rgba(0,0,0,.2);display:none;">
        </div>

        <div id="discussionToggleArea" style="margin-top:2rem;border-top:1px solid var(--border-color);padding-top:1rem;display:none">
          <button id="expandDiscussionsBtn">Expand Discussions</button>
          <div id="discussionSection" style="display:none">
            <h3>Discussion</h3>
            <div id="discussionList"></div>
            <div class="new-post">
              <textarea id="discussionContent" rows="3" placeholder="Write a comment... (LaTeX supported)"></textarea>
              <button id="postDiscussionBtn">Post</button>
            </div>
          </div>
        </div>

        <div id="reportModal" class="report-modal-overlay" style="display:none">
          <div class="report-modal">
            <h3>Report Problem</h3>
            <p class="report-modal-hint">Please describe the issue you found. Your username will be recorded.</p>
            <textarea id="reportReason" rows="4" maxlength="1000"
              placeholder="e.g. Typo in statement, wrong answer key, broken image, unclear wording..."></textarea>
            <div class="report-modal-actions">
              <button class="btn-secondary" id="reportCancelBtn">Cancel</button>
              <button class="btn-primary" id="reportSubmitBtn">Submit Report</button>
            </div>
          </div>
        </div>

        <div id="similarModal" class="report-modal-overlay" style="display:none">
          <div class="report-modal" style="max-width:680px;">
            <h3><i class="fas fa-layer-group" style="color:var(--accent);"></i> Similar Problems</h3>
            <p class="report-modal-hint" id="similarHint">Based on shared tags and difficulty</p>
            <div id="similarList" style="max-height:60vh;overflow-y:auto;padding-right:4px;"></div>
            <div class="report-modal-actions">
              <button class="btn-secondary" id="similarCloseBtn">Close</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────────
  // [7] 動態載入器
  // ─────────────────────────────────────────────────────────────
  const MCQ_CSS_URL  = '/css/pd-pdf.css';        // PDF + MCQ 樣式（你自己建）
  const MCQ_JS_URL   = '/script/pd-mcq.js';
  const EXTRAS_JS_URL = '/script/pd-extras.js';

  let _mcqPromise = null;
  let _extrasPromise = null;

  function loadMcq() {
    if (window.PD.mcq) return Promise.resolve(window.PD.mcq);
    if (_mcqPromise) return _mcqPromise;
    _mcqPromise = Promise.all([
      loadCssOnce(MCQ_CSS_URL),
      loadScript(MCQ_JS_URL),
    ]).then(() => {
      window.PD.mcq = window.__PD_MCQ__ || null;
      return window.PD.mcq;
    }).catch((e) => {
      console.error('[loadMcq]', e);
      _mcqPromise = null;
      return null;
    });
    return _mcqPromise;
  }

  function loadExtras() {
    if (window.PD.extras) return Promise.resolve(window.PD.extras);
    if (_extrasPromise) return _extrasPromise;
    _extrasPromise = loadScript(EXTRAS_JS_URL).then(() => {
      window.PD.extras = window.__PD_EXTRAS__ || null;
      return window.PD.extras;
    }).catch((e) => {
      console.error('[loadExtras]', e);
      _extrasPromise = null;
      return null;
    });
    return _extrasPromise;
  }
    function renderStatement(statement) {
  const stmt = document.getElementById('statementContent');
  if (!stmt) return;
  stmt.innerHTML = statement || '';
  executeScriptsIn(stmt);

  const doRender = () => {
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(stmt, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$',  right: '$',  display: false },
        ],
      });
    }
  };

  // 快取命中時，等 DOM 完全載入
  if (document.readyState === 'complete') {
    doRender();
  } else {
    window.addEventListener('load', doRender, { once: true });
  }
}
  
  // ─────────────────────────────────────────────────────────────
  // [8] 主流程
  // ─────────────────────────────────────────────────────────────
  async function initPage() {
    try {
      mainContainer.innerHTML = '';

      // ═══════════════════════════════════════════════════
      // 階段 1：命中快取 → 立即渲染
      // ═══════════════════════════════════════════════════
      const cached = getCachedProblem(problemId);

      if (cached) {
        // ⭐ 從 localStorage 同步讀 state
        const cachedState = getCachedState(problemId);

        S.problem = {
          statement: cached.statement,
          name: cached.name,
          tags: cached.tags,
          difficulty: cached.difficulty,
        };
        S.problemName = cached.name || problemId;

        // ⭐ 用快取 state 渲染
        S.userStates = cachedState !== 'not_started'
          ? { [problemId]: cachedState }
          : {};

        mainContainer.innerHTML = buildPageHTML(S.problem, {
          state: cachedState,
          favorited: false,
        });
        renderStatement(cached.statement);

        updateProblemDetailIcon();
        document.title = S.problemName + ' - WYK Maths Team';

        // ✅ 用戶已經看到題目了（從快取）
      } else {
        // 沒快取 → 顯示骨架 loading
        mainContainer.innerHTML = `
          <div class="problem-detail">
            <div class="detail-header">
              <button class="back-btn" id="backToListBtn">← Back</button>
            </div>
            <div class="pd-loading">
              <span class="spinner"></span>
              <span>Loading problem…</span>
            </div>
          </div>`;
      }

      // ═══════════════════════════════════════════════════
      // 階段 2：拉 API（背景）
      // ═══════════════════════════════════════════════════
      const pageData = await loadPageData();

      if (!pageData?.problem) {
        // 快取也沒有 → 顯示錯誤
        mainContainer.innerHTML = '<div class="error-msg">Problem not found. Please try again later.</div>';
        return;
      }

      const problem = pageData.problem;
      S.problem = problem;
      S.problemName = problem.name || problemId;
      S.userStates = (pageData.state && pageData.state !== 'not_started')
        ? { [problemId]: pageData.state }
        : {};
              // ⭐ 同步到 localStorage（權威來源）
      setCachedState(problemId, pageData.state || 'not_started');
      S.favorites = new Set(pageData.favorited ? [problemId] : []);

      // ═══════════════════════════════════════════════════
      // 階段 3：更新畫面
      // ═══════════════════════════════════════════════════
      if (!cached) {
        // 沒快取 → 首次渲染完整頁面
        mainContainer.innerHTML = buildPageHTML(problem, {
          state: pageData.state,
          favorited: pageData.favorited,
        });
        renderStatement(problem.statement);
        updateProblemDetailIcon();
        document.title = S.problemName + ' - WYK Maths Team';
      } else {
        // ⭐ 有快取 → 只更新變化部分，不重渲染骨架
        const stmtChanged = (cached.statement || '') !== (problem.statement || '');

        if (stmtChanged) {
          // statement 變了 → 重渲染那部分（可能是老師改了題目）
          renderStatement(problem.statement);
        }
        // 否則完全不動 DOM，用戶看到的內容無縫

        // 更新細節（title、difficulty、tags）
        document.title = S.problemName + ' - WYK Maths Team';
        const tagsEl = document.getElementById('detailTags');
        if (tagsEl) tagsEl.textContent = (problem.tags || []).join(', ');
        const diffEl = document.getElementById('detailDifficulty');
        if (diffEl) {
          const d = problem.difficulty ?? 0;
          diffEl.textContent = 'Lv.' + (d === 0 ? '∞' : d.toFixed(2));
        }

        // 更新狀態 icon（可能從 not_started 變成 passed）
        updateProblemDetailIcon();

        // 更新收藏星
        const starIcon = document.querySelector('#detailFavorite i');
        if (starIcon) {
          const isFav = S.favorites.has(problemId);
          starIcon.className = isFav ? 'fas fa-star' : 'far fa-star';
          starIcon.style.color = isFav ? '#f1c40f' : '#aaa';
        }
      }

      // 寫回快取
      setCachedProblem(problemId, problem);

      // ═══════════════════════════════════════════════════
      // 階段 4：並行載入 mcq + extras
      // ═══════════════════════════════════════════════════
      const needMcq = !!(document.getElementById('pdf-quiz-split')
                      || document.getElementById('mc-quiz-mount'));

      await Promise.allSettled([
        needMcq ? loadMcq() : Promise.resolve(null),
        loadExtras(),
      ]);

      // ═══════════════════════════════════════════════════
      // 階段 5：依序初始化
      // ═══════════════════════════════════════════════════
      if (needMcq && window.PD.mcq) {
        try { await window.PD.mcq.init(); }
        catch (e) { console.error('[mcq init]', e); }
      }
      if (window.PD.extras) {
        try { await window.PD.extras.init(); }
        catch (e) { console.error('[extras init]', e); }
      }

    } catch (err) {
      console.error('initPage error:', err);
      mainContainer.innerHTML = `<div class="error-msg">Failed to load problem: ${esc(err.message)}</div>`;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // [9] 生命週期（僅答案存儲，其餘由 extras 處理）
  // ─────────────────────────────────────────────────────────────
  window.addEventListener('pagehide', () => {
    const ansEl = document.getElementById('answerInput');
    if (ansEl?.value) saveAnswerNow(problemId, ansEl.value);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    const ansEl = document.getElementById('answerInput');
    if (ansEl?.value) saveAnswerNow(problemId, ansEl.value);
  });

  // 啟動
  initPage();
})();