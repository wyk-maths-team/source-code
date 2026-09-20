
(function () {
  'use strict';

  /* ═══════════ 0. 認證 ═══════════ */
  // 用户信息於 init() 時重新讀取（鎖屏期間可能剛登入）
  let user = {};
  let isAdmin = false;
  let isRoot  = false;
  let displayName = 'Guest';
  let APPS = [];
    /* ⭐ 設備檢測 */
  const UA = navigator.userAgent;
  const IS_IPAD = /iPad/.test(UA) ||
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IS_IPHONE = /iPhone|iPod/.test(UA);
  const IS_ANDROID = /Android/.test(UA);
  const IS_TOUCH = navigator.maxTouchPoints > 0;
  // Fullscreen API 在 iPad 和 Android 可用，iPhone 不可用
  const CAN_FULLSCREEN = (IS_IPAD || IS_ANDROID) && IS_TOUCH;

  const HIDE_STATUSBAR_KEY = 'osHideDeviceStatusBar';

  /* ═══════════ 1. 常量 ═══════════ */
  const CDN_BASE = 'https://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/';
  const HOME_PAGE = '/';

  // APPS 構建函式（於 init 時呼叫，此時 user 已確定）
  function buildApps() {
    const list = [
      { id:'problems',    title:'Problems',     icon:'fa-list-check',   url:'/problems',    category:'Core' },
      { id:'submissions', title:'Submissions',  icon:'fa-paper-plane',  url:'/submissions', category:'Core' },
      { id:'ranklist',    title:'Leaderboard',  icon:'fa-ranking-star', url:'/leaderboard', category:'Core' },
      { id:'charts',      title:'Progress',     icon:'fa-chart-line',   url:'/charts',      category:'Core' },
      { id:'contests',    title:'Contests',     icon:'fa-trophy',       url:'/contest',     category:'Core' },
      { id:'resources',   title:'Resources',    icon:'fa-folder-open',  url:'/resources',   category:'Core' },
      { id:'bookmarked',  title:'Bookmarks',    icon:'fa-star',         url:'/problems/bookmarked', category:'Core' },
      { id:'status',      title:'Judge Status', icon:'fa-heart-pulse',  url:'/status',      category:'System' },
      { id:'settings',    title:'Settings',     icon:'fa-gear',         url:'/settings',    category:'System' },
      { id:'profile',     title:'My Profile',   icon:'fa-user',         url:'/users/' + encodeURIComponent(user.username || ''), category:'System' },
      { id:'guide',       title:'Guide',        icon:'fa-book-open',    url:'/guide',       category:'System' },
      { id:'credits',     title:'Credits',      icon:'fa-heart',        url:'/credits',     category:'System' },
    ];
    if (isAdmin) list.push(
      { id:'admin-problems',     title:'Manage Problems',  icon:'fa-pen-to-square',   url:'/admin/problems',     category:'Admin' },
      { id:'admin-ssubmissions', title:'All Submissions',  icon:'fa-clipboard-check', url:'/admin/ssubmissions', category:'Admin' },
      { id:'admin-users',        title:'Manage Users',     icon:'fa-users-gear',      url:'/admin/users',        category:'Admin' },
      { id:'admin-updates',      title:'Manage Updates',   icon:'fa-bullhorn',        url:'/admin/updates',      category:'Admin' },
      { id:'admin-contest',      title:'Manage Contests',  icon:'fa-trophy',          url:'/admin/contest',      category:'Admin' },
      { id:'admin-reports',      title:'Bug Reports',      icon:'fa-flag',            url:'/admin/reports',      category:'Admin' },
      { id:'admin-marker',       title:'Marking Queue',    icon:'fa-marker',          url:'/admin/marker',       category:'Admin' },
      { id:'admin-log',          title:'Audit Log',        icon:'fa-scroll',          url:'/admin/log',          category:'Admin' },
    );
    if (isRoot) list.push(
      { id:'admin-terminal', title:'SQL Terminal', icon:'fa-terminal', url:'/admin/terminal', category:'Root' },
      { id:'admin-cmd',      title:'CMD Console',  icon:'fa-code',     url:'/admin/cmd',      category:'Root' },
    );
    return list;
  }

  // 外部應用（按需加載）
    const EXTERNAL_APPS = {
    calculator: {
      id:'calculator', title:'Calculator', icon:'fa-calculator',
      category:'Tools', width:340, height:520,
      scriptUrl: CDN_BASE + 'os-app-calculator.js',
    },
    paint: {
      id:'paint', title:'Paint', icon:'fa-palette',
      category:'Tools', width:940, height:660,
      scriptUrl: CDN_BASE + 'os-app-paint.js',
    },
    notepad: {
      id:'notepad', title:'Notepad', icon:'fa-pen',
      category:'Tools', width:720, height:520,
      scriptUrl: CDN_BASE + 'os-app-notepad.js',
    },
    // ⭐ 之前加過的
    pomodoro: {
      id:'pomodoro', title:'Pomodoro', icon:'fa-stopwatch',
      category:'Tools', width:420, height:640,
      scriptUrl: CDN_BASE + 'os-app-pomodoro.js',
    },
    todo: {
      id:'todo', title:'To-Do', icon:'fa-list-check',
      category:'Tools', width:560, height:640,
      scriptUrl: CDN_BASE + 'os-app-todo.js',
    },
    notes: {
      id:'notes', title:'Notes', icon:'fa-book',
      category:'Tools', width:1000, height:680,
      scriptUrl: CDN_BASE + 'os-app-notes.js',
    },
    matrix: {
      id:'matrix', title:'Matrix', icon:'fa-table-cells',
      category:'Tools', width:820, height:720,
      scriptUrl: CDN_BASE + 'os-app-matrix.js',
    },
    random: {
      id:'random', title:'Random', icon:'fa-dice',
      category:'Tools', width:560, height:600,
      scriptUrl: CDN_BASE + 'os-app-random.js',
    },

    // ⭐ 本次新增
    draw: {
      id:'draw', title:'Draw', icon:'fa-paintbrush',
      category:'Tools', width:1000, height:720,
      scriptUrl: CDN_BASE + 'os-app-draw.js',
    },
    graph: {
      id:'graph', title:'Graph', icon:'fa-chart-line',
      category:'Tools', width:1100, height:720,
      scriptUrl: CDN_BASE + 'os-app-graph.js',
    },
    stopwatch: {
      id:'stopwatch', title:'Stopwatch', icon:'fa-stopwatch-20',
      category:'Tools', width:520, height:660,
      scriptUrl: CDN_BASE + 'os-app-stopwatch.js',
    },
    converter: {
      id:'converter', title:'Converter', icon:'fa-arrows-rotate',
      category:'Tools', width:620, height:660,
      scriptUrl: CDN_BASE + 'os-app-converter.js',
    },
    formula: {
      id:'formula', title:'Formulas', icon:'fa-square-root-variable',
      category:'Tools', width:1000, height:720,
      scriptUrl: CDN_BASE + 'os-app-formula.js',
    },
  };
  const ICON_CHOICES = [
    'fa-globe','fa-house','fa-star','fa-heart','fa-bookmark','fa-tag',
    'fa-list-check','fa-paper-plane','fa-ranking-star','fa-chart-line','fa-trophy','fa-folder-open',
    'fa-heart-pulse','fa-gear','fa-user','fa-book-open','fa-pen-to-square','fa-clipboard-check',
    'fa-users-gear','fa-bullhorn','fa-flag','fa-marker','fa-scroll','fa-terminal','fa-code',
    'fa-file-lines','fa-circle-info','fa-medal','fa-flask','fa-calculator','fa-square-root-variable',
    'fa-infinity','fa-shapes','fa-brain','fa-lightbulb','fa-rocket','fa-fire','fa-bolt','fa-cube',
    'fa-cloud','fa-database','fa-server','fa-microchip','fa-robot','fa-gamepad','fa-palette','fa-camera',
    'fa-music','fa-video','fa-envelope','fa-comments','fa-bell','fa-clock','fa-calendar','fa-map',
    'fa-compass','fa-location-dot','fa-search','fa-filter','fa-wrench','fa-hammer','fa-key','fa-lock',
  ];

    /* ⭐ 詳情跳轉規則（用戶可在 Settings 個別開關）*/
  const DETAIL_RULES = [
    { id:'problem',    re:/^\/problems\/[^/?#]+$/,            icon:'fa-file-lines',  title:'Problem',         desc:'/problems/xxx' },
    { id:'submission', re:/^\/submissions\/[^/?#]+\/detail$/, icon:'fa-circle-info', title:'Submission',      desc:'/submissions/xxx/detail' },
    { id:'user',       re:/^\/users\/[^/?#]+$/,               icon:'fa-user',        title:'User Profile',    desc:'/users/xxx' },
    { id:'contest',    re:/^\/contest\/[^/?#]+$/,             icon:'fa-trophy',      title:'Contest',         desc:'/contest/xxx' },
    { id:'contest_results', re:/^\/contest\/[^/?#]+\/results$/, icon:'fa-medal',     title:'Contest Results', desc:'/contest/xxx/results' },
  ];

  const matchDetailUrl = (pathname) => {
    for (const r of DETAIL_RULES) {
      // ⭐ 用戶關掉的規則直接跳過
      if (state.detailRules[r.id] === false) continue;
      if (r.re.test(pathname)) return r;
    }
    return null;
  };

  /* ═══════════ 2. 狀態 ═══════════ */
    const state = {
    windows: new Map(),
    focusedId: null,
    nextZIndex: 100,
    cascade: 0,
    scale: parseFloat(localStorage.getItem('osScale') || '100'),
    desktopIcons: [],
    selectedIconId: null,
    fullscreen: false,
    taskviewOpen: false,
    // ⭐ 詳情跳轉開關：{ problem: true, submission: false, ... }
    //   缺省為 true（undefined 視作開啟）
    detailRules: (() => {
      try { return JSON.parse(localStorage.getItem('osDetailRules') || '{}'); }
      catch { return {}; }
    })(),
          hideStatusBar: (() => {
      try { return localStorage.getItem(HIDE_STATUSBAR_KEY) === 'true'; }
      catch { return false; }
    })(),
  };

  /* ═══════════ 3. 工具 ═══════════ */
  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const escapeHtml = str => String(str == null ? '' : str).replace(/[&<>"]/g, m =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[m]));
  const getScale = () => state.scale / 100;
  const uid = p => (p || 'i') + '-' + Math.random().toString(36).slice(2, 9);
      // ⭐ 從 iframe title 抽取乾淨的頁面名稱
    //    1. 去掉品牌後綴（如 " - WYK Maths Team"）
    //    2. 若只剩下品牌名 → 用 fallback
    //    3. 過長截斷
    const BRAND_SUFFIX_RE = /\s+[-|·—–]\s+WYK Maths Team\s*$/i;
    const BRAND_ONLY = /^WYK Maths Team$/i;

    function extractPageTitle(rawTitle, fallback) {
      if (!rawTitle || typeof rawTitle !== 'string') return fallback;
      let t = rawTitle.trim();
      if (!t) return fallback;

      // 去掉品牌後綴
      t = t.replace(BRAND_SUFFIX_RE, '').trim();

      // 只剩品牌名 → 保持 fallback
      if (!t || BRAND_ONLY.test(t)) return fallback;

      // 過長截斷
      if (t.length > 60) t = t.slice(0, 57) + '...';

      return t;
    }
  // 腳本按需加載
  const _loadedScripts = new Set();
  function loadScriptOnce(url) {
    if (_loadedScripts.has(url)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => { _loadedScripts.add(url); resolve(); };
      s.onerror = () => reject(new Error('Failed: ' + url));
      document.head.appendChild(s);
    });
  }

  // Toast
  let _toastTimer = null;
  function flashToast(msg) {
    let t = document.getElementById('os-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'os-toast';
      t.style.cssText = `
        position:fixed;bottom:70px;left:50%;transform:translateX(-50%);
        background:rgba(20,30,55,.95);color:#d6e4ff;padding:10px 20px;
        border-radius:20px;border:1px solid rgba(100,150,220,.5);
        font-size:13px;font-weight:600;z-index:99999;pointer-events:none;
        box-shadow:0 8px 24px rgba(0,0,0,.6);opacity:0;transition:opacity .2s`;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 1600);
  }
    // 儲存詳情跳轉開關
  function saveDetailRules() {
    try {
      localStorage.setItem('osDetailRules', JSON.stringify(state.detailRules));
    } catch (e) { /* quota 滿了，忽略 */ }
  }

  /* ═══════════ 4. 縮圖快取 ═══════════ */
  const thumbCache = new Map(); // winId → { dataUrl, ts }
  const THUMB_TTL = 2500;

  async function captureThumbnail(win) {
    if (typeof html2canvas !== 'function') return null;
    let target = null;
    try {
      if (win.iframe && win.iframe.contentDocument && win.iframe.contentDocument.body) {
        target = win.iframe.contentDocument.body;
      } else {
        target = win.el.querySelector('.os-win-body');
      }
    } catch (e) { /* cross-origin */ }
    if (!target) return null;
    try {
      const w = target.scrollWidth  || target.clientWidth  || 800;
      const h = target.scrollHeight || target.clientHeight || 600;
      const canvas = await html2canvas(target, {
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        width: w,
        height: h,
        windowWidth: w,
        windowHeight: h,
        scale: 0.4,
      });
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      console.warn('Thumbnail capture failed for', win.id, e);
      return null;
    }
  }

  /* ═══════════ 5. OSWindow ═══════════ */
  class OSWindow {
    constructor({ id, title, icon, url, x, y, w, h, customContent, onReady }) {
      this.id = id; this.title = title; this.icon = icon;
      this.url = url; this.minimized = false; this.maximized = false; this.prevRect = null;this.zoom = 1; 
      this.customContent = customContent;
      this._build(x, y, w, h);
      if (typeof onReady === 'function') onReady(this);
      this._bind();
      this.focus();
    }

    _build(x, y, w, h) {
      const el = document.createElement('div');
      el.className = 'os-window opening';
      el.dataset.id = this.id;
      el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
      const bodyHtml = this.customContent
        ? this.customContent
        : `<iframe src="${escapeHtml(this.url)}" referrerpolicy="no-referrer"></iframe>`;

      el.innerHTML = `
        <div class="os-win-header">
          <div class="os-win-title">
            <i class="fas ${escapeHtml(this.icon)}"></i>
            <span>${escapeHtml(this.title)}</span>
          </div>
          <!-- ⭐ 上一頁 / 下一頁 -->
          <div class="os-win-nav">
            <button class="os-win-btn nav-back"    title="Back"    disabled><i class="fas fa-chevron-left"></i></button>
            <button class="os-win-btn nav-forward" title="Forward" disabled><i class="fas fa-chevron-right"></i></button>
          </div>
          <div class="os-win-controls">
            <button class="os-win-btn copy"     title="Copy URL"><i class="fas fa-link"></i></button>
            <button class="os-win-btn snapshot" title="Screenshot (JPG)"><i class="fas fa-camera"></i></button>
            <button class="os-win-btn refresh"  title="Refresh"><i class="fas fa-rotate"></i></button>
            <!-- ⭐ 縮放控制 -->
            <button class="os-win-btn zoom-out" title="Zoom Out (Ctrl+-)"><i class="fas fa-magnifying-glass-minus"></i></button>
            <span class="os-win-zoom-val" title="Click to reset zoom">100%</span>
            <button class="os-win-btn zoom-in"  title="Zoom In (Ctrl+=)"><i class="fas fa-magnifying-glass-plus"></i></button>
            <!-- 原有按鈕 -->
            <button class="os-win-btn minimize" title="Minimize"><i class="fas fa-minus"></i></button>
            <button class="os-win-btn maximize" title="Maximize"><i class="fas fa-expand"></i></button>
            <button class="os-win-btn close"    title="Close"><i class="fas fa-times"></i></button>
          </div>
        </div>
        <div class="os-win-body">${bodyHtml}</div>
        <div class="os-resize n"></div><div class="os-resize s"></div>
        <div class="os-resize w"></div><div class="os-resize e"></div>
        <div class="os-resize nw"></div><div class="os-resize ne"></div>
        <div class="os-resize sw"></div><div class="os-resize se"></div>`;
      $('#os-windows').appendChild(el);

      this.el = el;
      this.header = $('.os-win-header', el);
      this.iframe = $('iframe', el);
      if (this.iframe) this.iframe.addEventListener('load', () => this._onIframeLoad());
      setTimeout(() => el.classList.remove('opening'), 320);
    }

    _onIframeLoad() {
      if (!this.iframe) return;
      let doc;
      try { doc = this.iframe.contentDocument; } catch (e) { return; }
      if (!doc) return;

      if (!doc.getElementById('__os_embed_style')) {
        const st = doc.createElement('style');
        st.id = '__os_embed_style';
        st.textContent = `
          #topbarContainer,#sidebarContainer,.topbar,.sidebar{display:none!important}
          body.index-body{padding-top:0!important;padding-left:0!important}
          body{overflow:auto!important}`;
        (doc.head || doc.documentElement).appendChild(st);

        // ⭐ 阻止 iframe 內的右鍵默認菜單
        doc.addEventListener('contextmenu', e => e.preventDefault(), true);
      }

      if (!this._detailHooked) {
        this._detailHooked = true;
        doc.addEventListener('click', (ev) => {
          if (ev.defaultPrevented) return;
          if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
          const a = ev.target.closest && ev.target.closest('a');
          if (!a || !a.href) return;
          if (a.target === '_blank' || a.hasAttribute('download')) return;
          if (a.href.startsWith('javascript:')) return;
          let u;
          try { u = new URL(a.href, location.origin); } catch (e) { return; }
          if (u.origin !== location.origin) return;
          const rule = matchDetailUrl(u.pathname);
          if (!rule) return;
          ev.preventDefault();
          ev.stopPropagation();
          OS.openDetail(u.pathname + u.search, rule);
        }, true);
                // ⭐ Ctrl + / Ctrl - 縮放
        doc.addEventListener('keydown', (ev) => {
          if (!ev.ctrlKey && !ev.metaKey) return;
          if (ev.key === '=' || ev.key === '+') {
            ev.preventDefault();
            this.zoomBy(+0.1);
          } else if (ev.key === '-') {
            ev.preventDefault();
            this.zoomBy(-0.1);
          } else if (ev.key === '0') {
            ev.preventDefault();
            this.resetZoom();
          }
        });
      }
            // ⭐ 從 iframe 讀取頁面標題，作為視窗標題
      try {
        const rawTitle = doc.title || '';
        const pageTitle = extractPageTitle(rawTitle, this.title);
        if (pageTitle && pageTitle !== this.title) {
          this.setTitle(pageTitle);
        }
      } catch (e) { /* cross-origin */ }

      // ⭐ 更新上一頁 / 下一頁按鈕可用狀態
      setTimeout(() => this.updateNavButtons(), 100);

      
      try {
        if (doc.documentElement) doc.documentElement.style.zoom = this.zoom || 1;
      } catch (e) {}
            // iframe 每次載入完成後再檢查一次 nav 狀態
      setTimeout(() => this.updateNavButtons(), 300);
    }

    _bind() {
      $('.os-win-btn.close',    this.el).addEventListener('click', e => { e.stopPropagation(); this.close(); });
      $('.os-win-btn.minimize', this.el).addEventListener('click', e => { e.stopPropagation(); this.minimize(); });
      $('.os-win-btn.maximize', this.el).addEventListener('click', e => { e.stopPropagation(); this.toggleMaximize(); });
      $('.os-win-btn.refresh',  this.el).addEventListener('click', e => { e.stopPropagation(); this.refresh(); });
      $('.os-win-btn.copy',     this.el).addEventListener('click', e => { e.stopPropagation(); this.copyUrl(); });
      $('.os-win-btn.snapshot', this.el).addEventListener('click', e => { e.stopPropagation(); this.snapshot(); });
      $('.os-win-btn.nav-back',    this.el).addEventListener('click', e => { e.stopPropagation(); this.goBack(); });
      $('.os-win-btn.nav-forward', this.el).addEventListener('click', e => { e.stopPropagation(); this.goForward(); });
      
      this.header.addEventListener('pointerdown', e => this._onDragStart(e));
      $$('.os-resize', this.el).forEach(h => {
        const dir = ['n','s','e','w','nw','ne','sw','se'].find(c => h.classList.contains(c));
        h.addEventListener('pointerdown', e => this._onResizeStart(e, dir));
      });
      this.el.addEventListener('pointerdown', () => this.focus(), true);
            // ⭐ 縮放控制
      $('.os-win-btn.zoom-in',  this.el).addEventListener('click', e => { e.stopPropagation(); this.zoomBy(+0.1); });
      $('.os-win-btn.zoom-out', this.el).addEventListener('click', e => { e.stopPropagation(); this.zoomBy(-0.1); });
      $('.os-win-zoom-val',     this.el).addEventListener('click', e => { e.stopPropagation(); this.resetZoom(); });

      // ⭐ Ctrl + 滾輪縮放
      const bodyEl = $('.os-win-body', this.el);
      if (bodyEl) {
        bodyEl.addEventListener('wheel', (ev) => {
          if (!ev.ctrlKey && !ev.metaKey) return;   // 只有 Ctrl/Cmd + 滾輪才縮放
          ev.preventDefault();
          const delta = ev.deltaY > 0 ? -0.1 : 0.1;
          this.zoomBy(delta);
        }, { passive: false });
      }
    }

    getCurrentUrl() {
      try {
        if (this.iframe && this.iframe.contentWindow) {
          const href = this.iframe.contentWindow.location.href;
          if (href && href !== 'about:blank') return href;
        }
      } catch (e) { /* cross-origin */ }
      return this.url || '';
    }
    setZoom(factor) {
      factor = Math.max(0.25, Math.min(5, factor));
      this.zoom = factor;

      // 應用到 iframe 內部（跨域會被 catch 跳過）
      try {
        const doc = this.iframe && this.iframe.contentDocument;
        if (doc && doc.documentElement) {
          doc.documentElement.style.zoom = factor;
        }
      } catch (e) { /* cross-origin */ }

      // 更新 UI
      const zEl = $('.os-win-zoom-val', this.el);
      if (zEl) zEl.textContent = Math.round(factor * 100) + '%';
      OS.scheduleSaveSession();
      return factor;
    }

    zoomBy(delta) {
      return this.setZoom((this.zoom || 1) + delta);
    }

    resetZoom() {
      return this.setZoom(1);
    }
    async copyUrl() {
      const url = this.getCurrentUrl();
      if (!url) { flashToast('No URL'); return; }
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        flashToast('Link copied ✓');
      } catch (e) { prompt('Copy this URL:', url); }
    }

    async snapshot() {
      if (typeof html2canvas !== 'function') {
        flashToast('Screenshot library not ready');
        return;
      }
      const btn = $('.os-win-btn.snapshot', this.el);
      const oldIcon = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      try {
        let target = null;
        try {
          if (this.iframe && this.iframe.contentDocument && this.iframe.contentDocument.body) {
            target = this.iframe.contentDocument.body;
          }
        } catch (e) {}
        if (!target) target = this.el.querySelector('.os-win-body');
        if (!target) throw new Error('No content');

        const w = target.scrollWidth  || target.clientWidth  || 800;
        const h = target.scrollHeight || target.clientHeight || 600;
        const canvas = await html2canvas(target, {
          useCORS: true, allowTaint: false,
          backgroundColor: '#ffffff', logging: false,
          width: w, height: h,
          windowWidth: w, windowHeight: h,
          scale: Math.min(2, window.devicePixelRatio || 1),
        });
        canvas.toBlob((blob) => {
          if (!blob) { flashToast('Screenshot failed'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          a.href = url;
          a.download = `${this.id.replace(/[^\w-]/g, '_')}-${ts}.jpg`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          flashToast('Screenshot saved ✓');
        }, 'image/jpeg', 0.92);
      } catch (err) {
        console.error(err);
        flashToast('Screenshot failed: ' + err.message);
      } finally {
        btn.innerHTML = oldIcon;
      }
    }

    _onDragStart(e) {
      if (e.button !== 0 || this.maximized) return;
      if (e.target.closest('.os-win-btn')) return;
      e.preventDefault();
      const scale = getScale();
      const startX = e.clientX, startY = e.clientY;
      const startLeft = this.el.offsetLeft, startTop = this.el.offsetTop;
      const parent = this.el.parentElement;
      const maxW = parent.clientWidth, maxH = parent.clientHeight;
      const onMove = (ev) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        this.el.style.left = Math.max(0, Math.min(maxW - 80, startLeft + dx)) + 'px';
        this.el.style.top  = Math.max(0, Math.min(maxH - 40, startTop + dy)) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.body.style.cursor = '';
        OS.scheduleSaveSession();   // ⭐ 拖動結束後保存
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.body.style.cursor = 'grabbing';
    }

    _onResizeStart(e, dir) {
      if (this.maximized) return;
      e.preventDefault(); e.stopPropagation();
      const scale = getScale();
      const startX = e.clientX, startY = e.clientY;
      const startLeft = this.el.offsetLeft, startTop = this.el.offsetTop;
      const startW = this.el.offsetWidth, startH = this.el.offsetHeight;
      const MIN_W = 280, MIN_H = 180;
      const onMove = (ev) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        let nl = startLeft, nt = startTop, nw = startW, nh = startH;
        if (dir.includes('e')) nw = Math.max(MIN_W, startW + dx);
        if (dir.includes('s')) nh = Math.max(MIN_H, startH + dy);
        if (dir.includes('w')) { nw = Math.max(MIN_W, startW - dx); nl = startLeft + (startW - nw); }
        if (dir.includes('n')) { nh = Math.max(MIN_H, startH - dy); nt = startTop + (startH - nh); }
        this.el.style.left = nl + 'px';
        this.el.style.top  = nt + 'px';
        this.el.style.width  = nw + 'px';
        this.el.style.height = nh + 'px';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        OS.scheduleSaveSession();   // ⭐ 縮放結束後保存
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    }

    focus() {
      if (state.focusedId === this.id && !this.minimized) return;
      state.focusedId = this.id;
      this.el.style.zIndex = ++state.nextZIndex;
      $$('.os-window').forEach(w => w.classList.remove('focused'));
      this.el.classList.add('focused');
      OS.renderTaskbar();
    }
    minimize() {
      this.minimized = true;
      this.el.classList.add('minimized');
      this.el.classList.remove('focused');
      if (state.focusedId === this.id) state.focusedId = null;
      OS.renderTaskbar();
      OS.scheduleSaveSession();
    }
    restore() {
      this.minimized = false;
      this.el.classList.remove('minimized');
      this.focus();
      OS.renderTaskbar();          // ⭐ 強制重繪任務欄
      OS.scheduleSaveSession();
    }
    toggleMaximize() {
      if (this.maximized) {
        const r = this.prevRect;
        this.el.style.left = r.left + 'px';
        this.el.style.top  = r.top + 'px';
        this.el.style.width  = r.width + 'px';
        this.el.style.height = r.height + 'px';
        this.maximized = false;
        $('.os-win-btn.maximize i', this.el).className = 'fas fa-expand';
      } else {
        this.prevRect = {
          left: this.el.offsetLeft, top: this.el.offsetTop,
          width: this.el.offsetWidth, height: this.el.offsetHeight,
        };
        this.el.style.left = '0px'; this.el.style.top = '0px';
        this.el.style.width = '100%'; this.el.style.height = '100%';
        this.maximized = true;
        $('.os-win-btn.maximize i', this.el).className = 'fas fa-compress';
      }
      OS.scheduleSaveSession();
    }
    refresh() {
      if (!this.iframe) {
        const btn = $('.os-browser-btn[data-act="reload"]', this.el);
        if (btn) btn.click();
        return;
      }
      try { this.iframe.contentWindow.location.reload(); }
      catch (e) { this.iframe.src = this.url; }
    }
        // ⭐ 上一頁 / 下一頁
    goBack() {
      try {
        this.iframe.contentWindow.history.back();
        // 讓瀏覽器有時間更新 history，之後刷新按鈕狀態
        setTimeout(() => this.updateNavButtons(), 120);
      } catch (e) { /* cross-origin */ }
    }

    goForward() {
      try {
        this.iframe.contentWindow.history.forward();
        setTimeout(() => this.updateNavButtons(), 120);
      } catch (e) { /* cross-origin */ }
    }

    // 檢查 iframe 內是否能前進 / 後退（同源才看得到 history）
    // 跨域時一律顯示為「可用」，讓使用者自己試
    updateNavButtons() {
      const backBtn = $('.os-win-btn.nav-back',    this.el);
      const fwdBtn  = $('.os-win-btn.nav-forward', this.el);
      if (!backBtn || !fwdBtn) return;

      let canBack = true, canForward = true;
      try {
        const win = this.iframe && this.iframe.contentWindow;
        if (win && win.history) {
          // history.length 只知道總長度，不能直接判斷位置
          // 但我們可以比較：如果 length <= 1 則兩個都不可用
          const len = win.history.length;
          if (len <= 1) { canBack = false; canForward = false; }
          else {
            // 有歷史記錄 → 後退通常可用；前進則未知，預設可用
            canBack = true;
            canForward = true;
          }
        }
      } catch (e) {
        // 跨域 → 保持可用（讓使用者嘗試）
      }

      backBtn.disabled = !canBack;
      fwdBtn.disabled  = !canForward;
    }
    setTitle(t) {
      this.title = t;
      const span = $('.os-win-title span', this.el);
      if (span) span.textContent = t;
      OS.renderTaskbar();
    }
    close() {
      thumbCache.delete(this.id);
      this.el.classList.add('closing');
      setTimeout(() => {
        this.el.remove();
        state.windows.delete(this.id);
        if (state.focusedId === this.id) state.focusedId = null;
        OS.renderTaskbar();
        OS.scheduleSaveSession();   // ⭐ 關閉後保存
      }, 180);
    }
  }

  /* ═══════════ 6. 瀏覽器視窗 ═══════════ */
  function buildBrowserContent() {
    return `
      <div class="os-browser">
        <div class="os-browser-toolbar">
          <button class="os-browser-btn" data-act="back"    title="Back"><i class="fas fa-arrow-left"></i></button>
          <button class="os-browser-btn" data-act="forward" title="Forward"><i class="fas fa-arrow-right"></i></button>
          <button class="os-browser-btn" data-act="reload"  title="Reload"><i class="fas fa-rotate"></i></button>
          <button class="os-browser-btn" data-act="home"    title="Home"><i class="fas fa-house"></i></button>
          <input class="os-browser-url" type="text" placeholder="Enter URL or search..." value="${escapeHtml(HOME_PAGE)}" spellcheck="false">
          <button class="os-browser-btn primary" data-act="go" title="Go"><i class="fas fa-arrow-right-to-bracket"></i></button>
        </div>
        <iframe class="os-browser-frame" src="${escapeHtml(HOME_PAGE)}" referrerpolicy="no-referrer" allow="fullscreen"></iframe>
      </div>`;
  }

  function bindBrowserWindow(win) {
    const root = win.el.querySelector('.os-browser');
    if (!root) return;
    const frame = win.el.querySelector('.os-browser-frame');
    const urlInput = win.el.querySelector('.os-browser-url');
    win.iframe = frame;
    frame.addEventListener('load', () => win._onIframeLoad());

    function normalizeUrl(input) {
      if (!input) return '';
      let s = input.trim();
      if (!s) return '';
      if (/^https?:\/\//i.test(s) || /^\/\//.test(s) || /^about:/.test(s)) return s;
      if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return 'https://' + s;
      if (s.startsWith('/')) return location.origin + s;
      return 'https://www.bing.com/search?q=' + encodeURIComponent(s);
    }
    function navigate(url) {
      if (!url) return;
      frame.src = url;
      urlInput.value = url;
    }
    root.querySelectorAll('.os-browser-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'go') {
          const url = normalizeUrl(urlInput.value);
          if (url) navigate(url);
        } else if (act === 'home') {
          navigate(HOME_PAGE);
        } else if (act === 'back') {
          try { frame.contentWindow.history.back(); } catch (e) {}
        } else if (act === 'forward') {
          try { frame.contentWindow.history.forward(); } catch (e) {}
        } else if (act === 'reload') {
          try { frame.contentWindow.location.reload(); }
          catch (e) { frame.src = frame.src; }
        }
      });
    });
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = normalizeUrl(urlInput.value);
        if (url) navigate(url);
      }
    });
    urlInput.addEventListener('focus', () => urlInput.select());
  }
    /* ═══════════ 6.5 會話持久化 ═══════════ */
  const SESSION_KEY = 'os_session_v1';
  const SESSION_SAVE_DELAY = 250;
  let _saveTimer = null;
  let _restoringSession = false;

  function scheduleSaveSession() {
    if (_restoringSession) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(saveSession, SESSION_SAVE_DELAY);
  }

  function saveSession() {
    try {
      // 按 z-index 升序排列，恢復時依序建立（最後一個在最上層）
      const list = Array.from(state.windows.values())
        .sort((a, b) => (parseInt(a.el.style.zIndex) || 0) - (parseInt(b.el.style.zIndex) || 0));

      const windows = list.map(w => {
        const item = {
          id: w.id,
          title: w.title,
          icon: w.icon,
          url: w.url,
          x: w.el.offsetLeft,
          y: w.el.offsetTop,
          w: w.el.offsetWidth,
          h: w.el.offsetHeight,
          zoom: w.zoom || 1,
          minimized: !!w.minimized,
          maximized: !!w.maximized,
        };

        // 外部應用（os-app-xxx.js）
        if (w.id.startsWith('app:')) {
          item.isExternal = true;
          item.externalAppId = w.id.slice(4);
        }
        // 瀏覽器視窗：保存 iframe 當前 URL
        if (w.id === 'browser' && w.iframe) {
          item.isBrowser = true;
          try {
            const href = w.iframe.contentWindow.location.href;
            if (href && href !== 'about:blank') item.url = href;
          } catch (e) { /* 跨域 → 保持原始 HOME_PAGE */ }
        }
        return item;
      });

      const session = {
        version: 1,
        savedAt: Date.now(),
        focusedId: state.focusedId,
        windows,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      console.warn('saveSession failed:', e);
    }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function applyRestoreState(win, item) {
    if (!win || !item) return;
    if (typeof item.zoom === 'number' && item.zoom !== 1) win.setZoom(item.zoom);
    if (item.maximized) win.toggleMaximize();
    if (item.minimized) win.minimize();
  }

  async function restoreSession() {
    let session;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      session = JSON.parse(raw);
      if (!session || session.version !== 1 || !Array.isArray(session.windows)) return false;
    } catch (e) {
      console.warn('restoreSession parse failed:', e);
      return false;
    }
    if (!session.windows.length) return false;

    _restoringSession = true;
    try {
      for (const item of session.windows) {
        try {
          if (item.isExternal) {
            // 外部應用（按需載入腳本，非同步）
            await OS.openExternalApp(item.externalAppId);
            const win = state.windows.get('app:' + item.externalAppId);
            if (win) {
              // 覆蓋位置尺寸
              if (item.w) win.el.style.width = item.w + 'px';
              if (item.h) win.el.style.height = item.h + 'px';
              if (item.x !== undefined) win.el.style.left = item.x + 'px';
              if (item.y !== undefined) win.el.style.top = item.y + 'px';
              applyRestoreState(win, item);
            }
          } else if (item.isBrowser) {
            const win = OS.openBrowser();
            if (item.w) win.el.style.width = item.w + 'px';
            if (item.h) win.el.style.height = item.h + 'px';
            if (item.x !== undefined) win.el.style.left = item.x + 'px';
            if (item.y !== undefined) win.el.style.top = item.y + 'px';
            // 導航至保存的 URL（避免與 HOME_PAGE 重複載入）
            if (item.url && item.url !== HOME_PAGE && win.iframe) {
              try { win.iframe.src = item.url; } catch (e) {}
            }
            applyRestoreState(win, item);
          } else {
            // 普通視窗 / 詳情視窗
            const win = OS.openWindow({
              id: item.id,
              title: item.title,
              icon: item.icon,
              url: item.url,
              w: item.w, h: item.h,
              x: item.x, y: item.y,
            });
            applyRestoreState(win, item);
          }
        } catch (e) {
          console.warn('Failed to restore window:', item.id, e);
        }
      }

      // 恢復焦點
      if (session.focusedId) {
        const w = state.windows.get(session.focusedId);
        if (w) {
          if (w.minimized) {
            w.minimized = false;
            w.el.classList.remove('minimized');
            w.el.style.display = '';
          }
          w.focus();
        }
      }
    } finally {
      _restoringSession = false;
    }
    return true;
  }
  /* ═══════════ 7. OS API ═══════════ */
  const OS = {
    openApp(app) {
      return this.openWindow({ id: app.id, title: app.title, icon: app.icon, url: app.url });
    },

    async openExternalApp(appId) {
      const def = EXTERNAL_APPS[appId];
      if (!def) { flashToast('App not found: ' + appId); return; }
      const windowId = 'app:' + appId;
      if (state.windows.has(windowId)) {
        const w = state.windows.get(windowId);
        if (w.minimized) w.restore(); else w.focus();
        return w;
      }
      try {
        await loadScriptOnce(def.scriptUrl);
      } catch (e) {
        flashToast('Failed to load app');
        return;
      }
      const mod = window.OSApps && window.OSApps[appId];
      if (!mod || typeof mod.mount !== 'function') {
        flashToast('App not registered: ' + appId);
        return;
      }
      const host = '<div class="os-app-host" style="width:100%;height:100%;overflow:hidden"></div>';
      const win = this.openWindow({
        id: windowId,
        title: def.title,
        icon: def.icon,
        url: 'os://' + appId,
        customContent: host,
        w: def.width, h: def.height,
      });
      setTimeout(() => {
        const hostEl = win.el.querySelector('.os-app-host');
        if (!hostEl) return;
        try {
          mod.mount(hostEl, { win, OS: this, flashToast, escapeHtml });
        } catch (e) {
          console.error('App mount error:', e);
          hostEl.innerHTML = `<div style="padding:20px;color:#e74c3c;font-family:monospace">App crashed: ${escapeHtml(e.message)}</div>`;
        }
      }, 20);
      return win;
    },

    openBrowser() {
      const existing = state.windows.get('browser');
      if (existing) { existing.restore(); return existing; }
      return this.openWindow({
        id: 'browser', title: 'Browser', icon: 'fa-globe',
        url: HOME_PAGE,
        customContent: buildBrowserContent(),
        w: 1100, h: 720,
        onReady: win => bindBrowserWindow(win),
      });
    },

    openDetail(url, rule) {
      const id = 'detail:' + url;
      const seg = url.split('?')[0].split('/').filter(Boolean).pop() || 'Detail';
      const title = (rule ? rule.title : 'Detail') + ' — ' + seg;
      return this.openWindow({
        id, title, icon: rule ? rule.icon : 'fa-file-lines', url, w: 1000, h: 680,
      });
    },

    openWindow(opts) {
      if (state.windows.has(opts.id)) {
        const w = state.windows.get(opts.id);
        if (w.minimized) w.restore(); else w.focus();
        return w;
      }
      const defW = opts.w || Math.min(1100, Math.max(600, window.innerWidth - 140));
      const defH = opts.h || Math.min(720,  Math.max(400, window.innerHeight - 180));
      const offset = (state.cascade % 6) * 28;
      state.cascade++;
      const x = opts.x !== undefined ? opts.x
        : Math.max(20, Math.floor((window.innerWidth  - defW) / 2) + offset);
      const y = opts.y !== undefined ? opts.y
        : Math.max(20, Math.floor((window.innerHeight - defH) / 2 - 20) + offset);
      const win = new OSWindow({ ...opts, x, y, w: defW, h: defH });
      state.windows.set(opts.id, win);
      this.renderTaskbar();
      this.scheduleSaveSession();   // ⭐ 開窗後保存
      return win;
    },

    renderTaskbar() {
  const container = $('#os-taskbar-tasks');
  const list = Array.from(state.windows.values());
  container.innerHTML = list.map(w => {
    const active = state.focusedId === w.id && !w.minimized;
    const mini   = w.minimized ? ' minimized' : '';
    return `<div class="os-task-item${active ? ' active' : ''}${mini}" data-id="${escapeHtml(w.id)}" title="${escapeHtml(w.title)}">
      <i class="fas ${escapeHtml(w.icon)}"></i><span>${escapeHtml(w.title)}</span>
    </div>`;
  }).join('');
  container.querySelectorAll('.os-task-item').forEach(el => {
    el.addEventListener('click', () => {
      const w = state.windows.get(el.dataset.id);
      if (!w) return;
      if (w.minimized) w.restore();
      else if (state.focusedId === w.id) w.minimize();
      else w.focus();
    });
  });
},
    cycleWindows() {
      const list = Array.from(state.windows.values());
      if (list.length < 2) return;
      const idx = list.findIndex(w => w.id === state.focusedId);
      const next = list[(idx + 1) % list.length];
      if (next.minimized) next.restore(); else next.focus();
    },

    minimizeAll() {
      state.windows.forEach(w => { if (!w.minimized) w.minimize(); });
    },

    restoreAll() {
      state.windows.forEach(w => { if (w.minimized) w.restore(); });
    },

    applyScale(percent) {
      state.scale = percent;
      const ratio = percent / 100;
      document.getElementById('os-root').style.zoom = ratio;
      localStorage.setItem('osScale', String(percent));
      $('#os-zoom-value').textContent = percent + '%';
      $('#os-zoom-slider').value = percent;

      // ⭐ 同步給所有同源 iframe（跨域 iframe 會被 try/catch 跳過）
      state.windows.forEach(w => this.applyScaleToWindow(w, ratio));
    },

    // ⭐ 給單一視窗的 iframe 內容注入 zoom
    applyScaleToWindow(win, ratio) {
      if (!win || !win.iframe) return;
      try {
        const doc = win.iframe.contentDocument;
        if (doc && doc.documentElement) {
          doc.documentElement.style.zoom = ratio;
        }
      } catch (e) {
        /* 跨域 iframe，無法訪問，靜默跳過 */
      }
    },
    scheduleSaveSession,
    restoreSession,
    clearSession,
        // ⭐ 請求全屏
    async requestFullscreen() {
      if (!CAN_FULLSCREEN) return false;
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (!fn) return false;
      try {
        await fn.call(el);
        return true;
      } catch (e) {
        console.warn('Fullscreen request failed:', e);
        return false;
      }
    },

    // ⭐ 退出全屏
    async exitFullscreen() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) return true;
      const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (!fn) return false;
      try {
        await fn.call(document);
        return true;
      } catch (e) {
        return false;
      }
    },

    // ⭐ 應用 hideStatusBar 設定
    async applyHideStatusBar(enabled, { silent = false } = {}) {
      state.hideStatusBar = !!enabled;
      try { localStorage.setItem(HIDE_STATUSBAR_KEY, enabled ? 'true' : 'false'); }
      catch (e) {}

      const toggle = $('#os-hide-statusbar-toggle');
      if (toggle) toggle.checked = !!enabled;

      if (!CAN_FULLSCREEN) {
        if (!silent) flashToast('此設備不支援隱藏狀態欄');
        return;
      }

      if (enabled) {
        const ok = await this.requestFullscreen();
        if (!ok && !silent) {
          flashToast('全屏請求被拒。請確認手勢或權限。');
          // 失敗了就把 toggle 恢復
          state.hideStatusBar = false;
          try { localStorage.setItem(HIDE_STATUSBAR_KEY, 'false'); } catch (e) {}
          if (toggle) toggle.checked = false;
        }
      } else {
        await this.exitFullscreen();
      }
    },
        openSettings() {
      renderDetailRulesSettings();
      initStatusBarToggle();
      $('#os-settings-modal').classList.add('show');
    },
    openTaskView() {
      state.taskviewOpen = true;
      $('#os-taskview-btn').classList.add('active');
      renderTaskView();
      $('#os-taskview-modal').classList.add('show');
    },

    closeTaskView() {
      state.taskviewOpen = false;
      $('#os-taskview-btn').classList.remove('active');
      $('#os-taskview-modal').classList.remove('show');
    },

    // ⭐ 顯示桌面：最小化所有 + 打開縮圖任務視圖
        // ⭐ 顯示桌面：toggle 行為，僅最小化 / 恢復視窗（不打開任務視圖）
    showDesktop() {
      const tray = $('#os-show-desktop-btn');
      if (tray && tray.dataset.tempFullscreen === '1') {
        delete tray.dataset.tempFullscreen;
        tray.innerHTML = '<i class="fas fa-tv"></i>';
        tray.title = 'Show Desktop / All Windows';
        this.toggleFullscreen();
        return;
      }
      const list = Array.from(state.windows.values());
      if (!list.length) return;
      const allMinimized = list.every(w => w.minimized);
      if (allMinimized) {
        this.restoreAll();
      } else {
        this.minimizeAll();
      }
    },

    toggleFullscreen() {
      const root = document.documentElement;
      if (!document.fullscreenElement) {
        (root.requestFullscreen || root.webkitRequestFullscreen || root.msRequestFullscreen)
          .call(root)
          .catch(err => flashToast('Fullscreen failed: ' + err.message));
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen)
          .call(document).catch(() => {});
      }
    },

    async loadDesktop() {
      try {
        const res = await apiCall('/api/status?action=os.getDesktop');
        if (res.success && Array.isArray(res.icons)) {
          state.desktopIcons = res.icons;
          this.renderIcons();
        }
      } catch (e) { console.warn('loadDesktop failed', e); }
    },

    async saveDesktop() {
      try {
        await apiCall('/api/status?action=os.saveDesktop', 'POST', { icons: state.desktopIcons });
      } catch (e) { console.warn('saveDesktop failed', e); }
    },

    renderIcons() {
      const container = $('#os-icons');
      container.innerHTML = state.desktopIcons.map(it => `
        <div class="os-icon${state.selectedIconId === it.id ? ' selected' : ''}"
             data-icon-id="${escapeHtml(it.id)}" title="${escapeHtml(it.title)}">
          <i class="fas ${escapeHtml(it.icon)}"></i>
          <span>${escapeHtml(it.title)}</span>
        </div>
      `).join('');

            container.querySelectorAll('.os-icon').forEach(el => {
        const id = el.dataset.iconId;
        let lastClickTime = 0;

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const now = Date.now();

          // ⭐ 500ms 內第二次點擊 → 視作雙擊，直接打開
          if (now - lastClickTime < 300) {
            lastClickTime = 0;
            OS.launchIcon(id);
            return;
          }

          // 第一次點擊：選中
          lastClickTime = now;
          state.selectedIconId = id;
          $$('.os-icon').forEach(x => x.classList.remove('selected'));
          el.classList.add('selected');
        });
      });
    },

    launchIcon(iconId) {
      const it = state.desktopIcons.find(x => x.id === iconId);
      if (!it) return;
      if (it.type === 'app') {
        const app = APPS.find(a => a.id === it.appId);
        if (app) this.openApp(app);
        else if (EXTERNAL_APPS[it.appId]) this.openExternalApp(it.appId);
        else flashToast('App not found: ' + it.appId);
      } else if (it.type === 'external') {
        this.openExternalApp(it.appId);
      } else {
        let url = it.url || '';
        if (url.startsWith('/')) url = location.origin + url;
        this.openWindow({ id: 'url:' + url, title: it.title, icon: it.icon, url });
      }
    },

    addIcon(icon) {
      icon.id = icon.id || uid('d');
      state.desktopIcons.push(icon);
      this.renderIcons();
      this.saveDesktop();
    },
    removeIcon(iconId) {
      state.desktopIcons = state.desktopIcons.filter(x => x.id !== iconId);
      if (state.selectedIconId === iconId) state.selectedIconId = null;
      this.renderIcons();
      this.saveDesktop();
    },
    renameIcon(iconId, newTitle) {
      const it = state.desktopIcons.find(x => x.id === iconId);
      if (!it) return;
      it.title = String(newTitle || '').slice(0, 60) || 'Shortcut';
      this.renderIcons();
      this.saveDesktop();
    },
  };

  window.osOpen = (url, title, icon) => OS.openWindow({
    id: 'ext:' + url, title: title || url, icon: icon || 'fa-file-lines', url,
  });

  /* ═══════════ 8. 縮圖任務視圖 ═══════════ */
  function renderTaskView() {
    const grid = $('#os-taskview-grid');
    const list = Array.from(state.windows.values());

    if (!list.length) {
      grid.innerHTML = `<div class="os-taskview-empty">
        <i class="fas fa-window-restore"></i>No open windows.
      </div>`;
      return;
    }

    // 先渲染卡片骨架（含 spinner）
    grid.innerHTML = list.map(w => {
      const active = state.focusedId === w.id && !w.minimized ? ' active' : '';
      const cached = thumbCache.get(w.id);
      const isFresh = cached && (Date.now() - cached.ts < THUMB_TTL);
      const thumbInner = isFresh
        ? `<img src="${cached.dataUrl}" alt="">`
        : `<i class="fas fa-spinner fa-spin spinner"></i>`;
      return `<div class="os-tv-item${active}" data-id="${escapeHtml(w.id)}" title="${escapeHtml(w.title)}">
        <div class="os-tv-name">
          <i class="fas ${escapeHtml(w.icon)}"></i>
          <span>${escapeHtml(w.title)}</span>
        </div>
        <div class="os-tv-thumb" data-thumb-id="${escapeHtml(w.id)}">${thumbInner}</div>
      </div>`;
    }).join('');

    // 綁定點擊
    grid.querySelectorAll('.os-tv-item').forEach(el => {
      el.addEventListener('click', () => {
        const w = state.windows.get(el.dataset.id);
        if (!w) return;
        if (w.minimized) w.restore(); else w.focus();
        OS.closeTaskView();
      });
    });

    // 異步捕獲縮圖（快取未命中時）
    list.forEach(w => {
      const cached = thumbCache.get(w.id);
      if (cached && (Date.now() - cached.ts < THUMB_TTL)) return;
      captureThumbnail(w).then(dataUrl => {
        const thumbEl = grid.querySelector(`.os-tv-thumb[data-thumb-id="${CSS.escape(w.id)}"]`);
        if (!thumbEl) return;
        if (dataUrl) {
          thumbCache.set(w.id, { dataUrl, ts: Date.now() });
          thumbEl.innerHTML = `<img src="${dataUrl}" alt="">`;
        } else {
          thumbEl.innerHTML = `<div class="os-tv-thumb-fallback"><i class="fas ${escapeHtml(w.icon)}"></i></div>`;
        }
      });
    });
  }

  /* ═══════════ 9. 右鍵選單 ═══════════ */
  function openContextMenu(x, y, target) {
    const menu = $('#os-context-menu');
    let html = '';

    if (target.type === 'icon') {
      const it = state.desktopIcons.find(i => i.id === target.iconId);
      if (!it) return;
      html += `<div class="os-ctx-header">${escapeHtml(it.title)}</div>`;
      html += `<div class="os-ctx-item" data-act="open"><i class="fas fa-folder-open"></i> Open</div>`;
      html += `<div class="os-ctx-item" data-act="rename"><i class="fas fa-pen"></i> Rename</div>`;
      html += `<div class="os-ctx-sep"></div>`;
      html += `<div class="os-ctx-item danger" data-act="delete"><i class="fas fa-trash"></i> Delete</div>`;
    } else if (target.type === 'window') {
      const w = state.windows.get(target.winId);
      if (!w) return;
      html += `<div class="os-ctx-header">${escapeHtml(w.title)}</div>`;
      html += `<div class="os-ctx-item" data-act="w-restore"><i class="fas fa-window-restore"></i> Restore / Focus</div>`;
      html += `<div class="os-ctx-item" data-act="w-minimize"><i class="fas fa-minus"></i> Minimize</div>`;
      html += `<div class="os-ctx-item" data-act="w-maximize"><i class="fas fa-expand"></i> Maximize / Restore</div>`;
      html += `<div class="os-ctx-sep"></div>`;
      html += `<div class="os-ctx-item" data-act="w-refresh"><i class="fas fa-rotate"></i> Refresh</div>`;
      html += `<div class="os-ctx-item" data-act="w-copy"><i class="fas fa-link"></i> Copy URL</div>`;
      html += `<div class="os-ctx-item" data-act="w-snapshot"><i class="fas fa-camera"></i> Screenshot</div>`;
      html += `<div class="os-ctx-sep"></div>`;
      html += `<div class="os-ctx-item danger" data-act="w-close"><i class="fas fa-times"></i> Close</div>`;
    } else {
      html += `<div class="os-ctx-header">Desktop</div>`;
      html += `<div class="os-ctx-item" data-act="new-shortcut"><i class="fas fa-plus"></i> New Shortcut...</div>`;
      html += `<div class="os-ctx-item" data-act="refresh-desktop"><i class="fas fa-rotate"></i> Refresh</div>`;
      html += `<div class="os-ctx-sep"></div>`;
      html += `<div class="os-ctx-item" data-act="show-desktop"><i class="fas fa-tv"></i> Show Desktop</div>`;
      html += `<div class="os-ctx-item" data-act="restore-all"><i class="fas fa-window-restore"></i> Restore All Windows</div>`;
      html += `<div class="os-ctx-item" data-act="close-all"><i class="fas fa-xmark"></i> Close All Windows</div>`;
      html += `<div class="os-ctx-sep"></div>`;
      html += `<div class="os-ctx-item" data-act="tile-icons"><i class="fas fa-table-cells"></i> Arrange Icons</div>`;
    }

    menu.innerHTML = html;
    menu.classList.add('show');

    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = Math.min(x, vw - rect.width - 8) + 'px';
    menu.style.top  = Math.min(y, vh - rect.height - 8) + 'px';

    menu.querySelectorAll('.os-ctx-item').forEach(item => {
      item.addEventListener('click', () => {
        handleContextAction(item.dataset.act, target);
        closeContextMenu();
      });
    });
  }

  function closeContextMenu() { $('#os-context-menu').classList.remove('show'); }

  function handleContextAction(act, target) {
    if (target.type === 'icon') {
      if (act === 'open') OS.launchIcon(target.iconId);
      else if (act === 'rename') {
        const it = state.desktopIcons.find(i => i.id === target.iconId);
        if (!it) return;
        const nt = prompt('Rename shortcut:', it.title);
        if (nt != null) OS.renameIcon(target.iconId, nt);
      } else if (act === 'delete') {
        if (confirm('Delete this shortcut?')) OS.removeIcon(target.iconId);
      }
      return;
    }
    if (target.type === 'window') {
      const w = state.windows.get(target.winId);
      if (!w) return;
      if (act === 'w-restore') { if (w.minimized) w.restore(); else w.focus(); }
      else if (act === 'w-minimize') w.minimize();
      else if (act === 'w-maximize') w.toggleMaximize();
      else if (act === 'w-refresh') w.refresh();
      else if (act === 'w-copy') w.copyUrl();
      else if (act === 'w-snapshot') w.snapshot();
      else if (act === 'w-close') w.close();
      return;
    }
    // desktop
    if (act === 'new-shortcut') openAddIconModal();
    else if (act === 'refresh-desktop') { OS.loadDesktop(); flashToast('Desktop refreshed'); }
    else if (act === 'show-desktop') OS.showDesktop();
    else if (act === 'restore-all') OS.restoreAll();
    else if (act === 'close-all') {
      if (confirm('Close all windows?')) Array.from(state.windows.values()).forEach(w => w.close());
    } else if (act === 'tile-icons') { OS.renderIcons(); flashToast('Icons arranged'); }
  }

  /* ═══════════ 10. Start Menu ═══════════ */
  function renderStartMenu() {
    const container = $('#os-start-menu');
    const byCat = {};
    APPS.forEach(a => (byCat[a.category] = byCat[a.category] || []).push(a));
    // 加入外部應用
    Object.values(EXTERNAL_APPS).forEach(a => {
      (byCat[a.category] = byCat[a.category] || []).push({ ...a, isExternal: true });
    });

    let html = `
      <div class="os-start-user">
        <i class="fas fa-user-circle"></i>
        <div class="os-start-user-info">
          <div class="os-start-user-name">${escapeHtml(displayName)}</div>
          <div class="os-start-user-sub">@${escapeHtml(user.username || 'guest')} · ${escapeHtml(user.role || 'student')}</div>
        </div>
      </div>`;

    html += `<div class="os-start-section"><h4>Tools</h4><div class="os-start-grid">
      <div class="os-start-item" id="os-fullscreen-btn"><i class="fas fa-expand"></i><span>Fullscreen</span></div>
      <div class="os-start-item" id="os-browser-btn"><i class="fas fa-globe"></i><span>Browser</span></div>
    </div></div>`;

    ['Core','Tools','Admin','Root','System'].forEach(cat => {
      if (!byCat[cat]) return;
      html += `<div class="os-start-section"><h4>${cat}</h4><div class="os-start-grid">`;
      byCat[cat].forEach(a => {
        const attrs = a.isExternal ? `data-ext-id="${escapeHtml(a.id)}"` : `data-app-id="${escapeHtml(a.id)}"`;
        html += `<div class="os-start-item" ${attrs}>
          <i class="fas ${escapeHtml(a.icon)}"></i><span>${escapeHtml(a.title)}</span>
        </div>`;
      });
      html += '</div></div>';
    });

    html += `<div class="os-start-section"><h4>Session</h4><div class="os-start-grid">
      <div class="os-start-item" id="os-open-settings"><i class="fas fa-gear"></i><span>System Settings</span></div>
      <div class="os-start-item" id="os-close-all-btn"><i class="fas fa-xmark"></i><span>Close All</span></div>
      <div class="os-start-item danger" id="os-logout-btn"><i class="fas fa-right-from-bracket"></i><span>Logout</span></div>
      <div class="os-start-item" id="os-go-home-btn"><i class="fas fa-house"></i><span>Exit OS</span></div>
    </div></div>`;

    container.innerHTML = html;

    container.querySelectorAll('.os-start-item[data-app-id]').forEach(el => {
      el.addEventListener('click', () => {
        const app = APPS.find(a => a.id === el.dataset.appId);
        if (app) OS.openApp(app);
        hideStartMenu();
      });
    });
    container.querySelectorAll('.os-start-item[data-ext-id]').forEach(el => {
      el.addEventListener('click', () => {
        OS.openExternalApp(el.dataset.extId);
        hideStartMenu();
      });
    });
    $('#os-fullscreen-btn').addEventListener('click', () => { OS.toggleFullscreen(); hideStartMenu(); });
    $('#os-browser-btn').addEventListener('click', () => { OS.openBrowser(); hideStartMenu(); });
    $('#os-open-settings').addEventListener('click', () => { OS.openSettings(); hideStartMenu(); });
    $('#os-close-all-btn').addEventListener('click', () => {
      if (!confirm('Close all windows?')) return;
      Array.from(state.windows.values()).forEach(w => w.close());
      hideStartMenu();
    });
        $('#os-logout-btn').addEventListener('click', () => {
      if (!confirm('Are you sure to log out? All the windows will be closed.')) return;

      // 1. 清空 session（視窗狀態）
      OS.clearSession();

      // 2. 登出（清 token）
      if (typeof logout === 'function') logout();
      else localStorage.removeItem('auth_token');

      // 3. 留在 OS：重新載入 /os → 鎖屏邏輯會回到時鐘頁
      location.reload();
    });
    $('#os-go-home-btn').addEventListener('click', () => {
      const hasWindows = state.windows.size > 0;
      if (hasWindows) {
        if (!confirm('All the windows will be closed')) return;
      }
      hideStartMenu();
      OS.clearSession();   // ⭐ 明確退出時清空
      window.location.href = '/';
    });
  }

  const hideStartMenu = () => $('#os-start-menu').classList.remove('show');
  const toggleStartMenu = () => $('#os-start-menu').classList.toggle('show');

  /* ═══════════ 11. Add Icon Modal ═══════════ */
  function openAddIconModal() {
    const modal = $('#os-add-icon-modal');
    modal.classList.add('show');

    const sel = $('#os-icon-app-select');
    // 合併內建 + 外部應用
    const allApps = [
      ...APPS.map(a => ({ id: a.id, title: a.title, icon: a.icon, type: 'builtin' })),
      ...Object.values(EXTERNAL_APPS).map(a => ({ id: a.id, title: a.title, icon: a.icon, type: 'external' })),
    ];
    sel.innerHTML = allApps.map(a => `<option value="${escapeHtml(a.id)}" data-icon="${escapeHtml(a.icon)}" data-type="${a.type}">${escapeHtml(a.title)}</option>`).join('');

    const picker = $('#os-icon-picker');
    picker.innerHTML = ICON_CHOICES.map(ic => `<div class="os-icon-picker-item" data-icon="${ic}"><i class="fas ${ic}"></i></div>`).join('');
    if (picker.firstChild) picker.firstChild.classList.add('selected');
    picker.querySelectorAll('.os-icon-picker-item').forEach(el => {
      el.addEventListener('click', () => {
        picker.querySelectorAll('.os-icon-picker-item').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    $('#os-icon-title').value = '';
    $('#os-icon-url').value = '';
    $$('input[name="icon-type"]').forEach(r => { r.checked = r.value === 'app'; });
    $('#os-icon-app-row').style.display = '';
    $('#os-icon-url-row').style.display = 'none';

    sel.onchange = () => {
      const opt = sel.options[sel.selectedIndex];
      if (!opt) return;
      $('#os-icon-title').value = opt.textContent;
      const iconName = opt.dataset.icon;
      picker.querySelectorAll('.os-icon-picker-item').forEach(x => x.classList.remove('selected'));
      const m = picker.querySelector(`[data-icon="${iconName}"]`);
      if (m) m.classList.add('selected');
    };
    sel.dispatchEvent(new Event('change'));
  }

  function bindAddIconForm() {
    $$('input[name="icon-type"]').forEach(r => {
      r.addEventListener('change', () => {
        const t = r.value;
        $('#os-icon-app-row').style.display = t === 'app' ? '' : 'none';
        $('#os-icon-url-row').style.display = t === 'url' ? '' : 'none';
      });
    });
    $('#os-icon-save').addEventListener('click', () => {
      const type = ($$('input[name="icon-type"]').find(r => r.checked) || {}).value || 'app';
      const title = $('#os-icon-title').value.trim();
      const iconEl = $('#os-icon-picker .os-icon-picker-item.selected');
      const icon = iconEl ? iconEl.dataset.icon : 'fa-globe';
      if (!title) { alert('Please enter a name'); return; }

      if (type === 'app') {
        const sel = $('#os-icon-app-select');
        const opt = sel.options[sel.selectedIndex];
        const appId = sel.value;
        const appType = opt?.dataset.type || 'builtin';
        if (appType === 'external') {
          OS.addIcon({ title, icon, type: 'external', appId });
        } else {
          OS.addIcon({ title, icon, type: 'app', appId });
        }
      } else {
        const url = $('#os-icon-url').value.trim();
        if (!url) { alert('Please enter a URL'); return; }
        OS.addIcon({ title, icon, type: 'url', url });
      }
      $('#os-add-icon-modal').classList.remove('show');
      flashToast('Shortcut added ✓');
    });
  }

  /* ═══════════ 12. 壁紙 ═══════════ */
  function setWallpaper(url) {
    const el = $('#os-wallpaper');
    if (url) {
      el.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
      el.style.opacity = '1';
    } else {
      el.style.backgroundImage = ''; el.style.opacity = '0';
    }
  }
  async function loadWallpaper() {
    try {
      const res = await apiCall('/api/status?action=os.getWallpaper');
      if (res.success && res.url) { setWallpaper(res.url); showWallpaperPreview(res.url); }
    } catch (e) {}
  }
  function readAndCompressImage(file, maxWidth = 1920, quality = 0.85) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) return reject(new Error('Not an image'));
      if (file.size > 2 * 1024 * 1024) return reject(new Error('Image too large (max 2MB)'));
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Cannot load image'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Cannot read file'));
      reader.readAsDataURL(file);
    });
  }
  async function handleWallpaperUpload(file) {
    const pickBtn = $('#os-wallpaper-pick');
    pickBtn.disabled = true;
    pickBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
    try {
      const base64 = await readAndCompressImage(file);
      const res = await apiCall('/api/status?action=os.uploadWallpaper', 'POST', { image: base64 });
      if (!res.success) throw new Error(res.message || 'Upload failed');
      setWallpaper(res.url); showWallpaperPreview(res.url);
      pickBtn.innerHTML = '<i class="fas fa-check"></i> Done';
      setTimeout(() => {
        pickBtn.innerHTML = '<i class="fas fa-upload"></i> Choose Image';
        pickBtn.disabled = false;
      }, 1200);
    } catch (err) {
      alert('Wallpaper upload failed: ' + err.message);
      pickBtn.innerHTML = '<i class="fas fa-upload"></i> Choose Image';
      pickBtn.disabled = false;
    }
  }
  async function handleWallpaperClear() {
    if (!confirm('Remove wallpaper?')) return;
    try {
      await apiCall('/api/status?action=os.clearWallpaper', 'POST');
      setWallpaper('');
      const pv = $('#os-wallpaper-preview');
      pv.classList.remove('show'); pv.src = '';
    } catch (err) { alert('Failed to clear: ' + err.message); }
  }
  function showWallpaperPreview(url) {
    const pv = $('#os-wallpaper-preview');
    if (url) { pv.src = url; pv.classList.add('show'); }
    else { pv.src = ''; pv.classList.remove('show'); }
  }
    /* ⭐ 初始化 Hide Status Bar toggle */
  let _statusBarToggleBound = false;
  function initStatusBarToggle() {
    const row = $('#os-statusbar-row');
    if (!row) return;

    // 只在支援的設備顯示
    if (!CAN_FULLSCREEN) {
      row.style.display = 'none';
      return;
    }
    row.style.display = '';

    const toggle = $('#os-hide-statusbar-toggle');
    if (!toggle) return;

    // 反映當前狀態
    toggle.checked = !!state.hideStatusBar;

    // 綁定一次
    if (!_statusBarToggleBound) {
      _statusBarToggleBound = true;
      toggle.addEventListener('change', async (e) => {
        await OS.applyHideStatusBar(e.target.checked);
      });
    }
  }
    /* ═══════════ 12.5 詳情規則開關 ═══════════ */

  function renderDetailRulesSettings() {
    const container = $('#os-detail-rules-list');
    if (!container) return;

    container.innerHTML = DETAIL_RULES.map(r => {
      const on = state.detailRules[r.id] !== false;
      return `
        <label class="os-rule-toggle${on ? '' : ' off'}">
          <i class="fas ${escapeHtml(r.icon)}"></i>
          <span class="os-rule-info">
            <span class="os-rule-name">${escapeHtml(r.title)}</span>
            <span class="os-rule-desc">${escapeHtml(r.desc || '')}</span>
          </span>
          <input type="checkbox" data-rule-id="${escapeHtml(r.id)}" ${on ? 'checked' : ''}>
        </label>`;
    }).join('');

    // 個別切換
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        state.detailRules[cb.dataset.ruleId] = cb.checked;
        // 立即反映視覺（把 off class 切掉/加上）
        cb.closest('.os-rule-toggle').classList.toggle('off', !cb.checked);
        saveDetailRules();
        flashToast(cb.checked ? 'Popup enabled' : 'Popup disabled');
      });
    });

    // 全開 / 全關
    const allOnBtn  = $('#os-rules-all-on');
    const allOffBtn = $('#os-rules-all-off');

    // 避免重複綁定（每次 openSettings 都會呼叫）
    if (allOnBtn && !allOnBtn.dataset.bound) {
      allOnBtn.dataset.bound = '1';
      allOnBtn.addEventListener('click', () => {
        DETAIL_RULES.forEach(r => { state.detailRules[r.id] = true; });
        saveDetailRules();
        renderDetailRulesSettings();
        flashToast('All detail popups enabled');
      });
    }
    if (allOffBtn && !allOffBtn.dataset.bound) {
      allOffBtn.dataset.bound = '1';
      allOffBtn.addEventListener('click', () => {
        DETAIL_RULES.forEach(r => { state.detailRules[r.id] = false; });
        saveDetailRules();
        renderDetailRulesSettings();
        flashToast('All detail popups disabled');
      });
    }
  }

  /* ═══════════ 13. 時鐘 ═══════════ */
  function updateClock() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    $('#os-clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /* ═══════════ 14. 全局事件 ═══════════ */
  function bindGlobalEvents() {
    $('#os-taskbar-start').addEventListener('click', e => { e.stopPropagation(); toggleStartMenu(); });
    $('#os-taskview-btn').addEventListener('click', e => {
      e.stopPropagation(); hideStartMenu();
      if (state.taskviewOpen) OS.closeTaskView();
      else OS.openTaskView();
    });
    $('#os-settings-btn').addEventListener('click', e => {
      e.stopPropagation(); hideStartMenu(); OS.openSettings();
    });
    // ⭐ 顯示桌面按鈕（時間右邊）
    $('#os-show-desktop-btn').addEventListener('click', e => {
      e.stopPropagation(); hideStartMenu(); OS.showDesktop();
    });

    // ⭐ 全局阻止右鍵默認菜單（捕獲階段，最先執行）
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      const iconEl = e.target.closest && e.target.closest('.os-icon');
      if (iconEl) {
        const id = iconEl.dataset.iconId;
        state.selectedIconId = id;
        $$('.os-icon').forEach(x => x.classList.remove('selected'));
        iconEl.classList.add('selected');
        openContextMenu(e.clientX, e.clientY, { type: 'icon', iconId: id });
        return;
      }

      const winEl = e.target.closest && e.target.closest('.os-window');
      if (winEl) {
        // 若右鍵發生在 iframe 內部，事件不會冒泡到這裡
        openContextMenu(e.clientX, e.clientY, { type: 'window', winId: winEl.dataset.id });
        return;
      }

      if (e.target.closest && e.target.closest('#os-desktop')) {
        state.selectedIconId = null;
        $$('.os-icon').forEach(x => x.classList.remove('selected'));
        openContextMenu(e.clientX, e.clientY, { type: 'desktop' });
      }
    }, true);

    // 點空白關閉選單
    document.addEventListener('pointerdown', (e) => {
      const menu = $('#os-start-menu');
      const start = $('#os-taskbar-start');
      if (menu.classList.contains('show')
          && !menu.contains(e.target)
          && !start.contains(e.target)) hideStartMenu();

      const ctx = $('#os-context-menu');
      if (ctx.classList.contains('show') && !ctx.contains(e.target)) closeContextMenu();
    }, true);

    // Modal 關閉
    $$('.os-modal').forEach(modal => {
      modal.addEventListener('click', e => {
        if (e.target === modal) {
          modal.classList.remove('show');
          if (modal.id === 'os-taskview-modal') OS.closeTaskView();
        }
      });
    });
    $$('.os-modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.close;
        if (id) {
          $('#' + id).classList.remove('show');
          if (id === 'os-taskview-modal') OS.closeTaskView();
        }
      });
    });

    $('#os-zoom-slider').addEventListener('input', e => OS.applyScale(parseInt(e.target.value, 10)));

    // 壁紙
    $('#os-wallpaper-pick').addEventListener('click', () => $('#os-wallpaper-input').click());
    $('#os-wallpaper-input').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) handleWallpaperUpload(f);
      e.target.value = '';
    });
    $('#os-wallpaper-clear').addEventListener('click', handleWallpaperClear);

    // 點桌面空白取消選中
    $('#os-desktop').addEventListener('click', (e) => {
      if (e.target.id === 'os-desktop' || e.target.id === 'os-icons' || e.target.id === 'os-wallpaper') {
        state.selectedIconId = null;
        $$('.os-icon').forEach(x => x.classList.remove('selected'));
      }
    });

    // 全屏狀態
        const onFsChange = () => {
      const wasFullscreen = state.fullscreen;
      state.fullscreen = !!document.fullscreenElement;

      const btn = $('#os-fullscreen-btn i');
      if (btn) btn.className = state.fullscreen ? 'fas fa-compress' : 'fas fa-expand';

      // ⭐ 若原本是全屏，但現在不是 → 表示被系統手勢退出
      if (wasFullscreen && !state.fullscreen && window.innerWidth <= 768) {
        flashToast('Fullscreen exited — tap ⛶ to re-enter');
        // 讓右下角的「顯示桌面」按鈕暫時變成「恢復全屏」
        const tray = $('#os-show-desktop-btn');
        if (tray) {
          tray.dataset.tempFullscreen = '1';
          tray.innerHTML = '<i class="fas fa-expand"></i>';
          tray.title = 'Re-enter Fullscreen';
        }
      }
      if (state.hideStatusBar && wasFullscreen && !state.fullscreen) {
        flashToast('Click ⛶ to restore fullscreen');
      }
      // ⭐ 如果使用者沒開 Hide Status Bar 但進入了全屏 → 同步 toggle
      if (!state.hideStatusBar && !wasFullscreen && state.fullscreen) {
        // 不強制寫 localStorage，只在本次會話同步
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);

    // 快捷鍵
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideStartMenu(); closeContextMenu();
        $$('.os-modal').forEach(m => m.classList.remove('show'));
        OS.closeTaskView();
      }
      if (e.altKey && e.key === '`') { e.preventDefault(); OS.cycleWindows(); }
      if (e.altKey && (e.key === 'q' || e.key === 'Q')) { e.preventDefault(); OS.openTaskView(); }
      if (e.altKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); OS.showDesktop(); }
      if (e.ctrlKey && e.altKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault(); OS.openApp(APPS[0]);
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault(); OS.toggleFullscreen();
      }
    });

    // postMessage
    window.addEventListener('message', (e) => {
      if (e.source === window) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'os:openWindow' && typeof d.url === 'string') {
        OS.openWindow({
          id: d.id || ('ext:' + d.url),
          title: d.title || d.url,
          icon: d.icon || 'fa-file-lines',
          url: d.url,
        });
      }
      if (d.type === 'os:setTitle' && e.source) {
        const win = Array.from(state.windows.values()).find(w => w.iframe && w.iframe.contentWindow === e.source);
        if (win && d.title) win.setTitle(d.title);
      }
    });

    window.addEventListener('resize', () => {
      const parent = $('#os-windows');
      const maxW = parent.clientWidth, maxH = parent.clientHeight;
      state.windows.forEach(w => {
        if (w.maximized) return;
        w.el.style.left = Math.min(w.el.offsetLeft, Math.max(0, maxW - 80)) + 'px';
        w.el.style.top  = Math.min(w.el.offsetTop,  Math.max(0, maxH - 40)) + 'px';
      });
    });
        // ⭐ 長按 = 右鍵（觸控 / 觸控筆）
        /* ⭐ 長按 = 右鍵（觸控 / 觸控筆） */
    let _lpTimer = null;
    let _lpStart = null;
    let _lpTarget = null;
    let _lpFired = false;

    function _clearLongPressClass() {
      if (!_lpTarget) return;
      const iconEl = _lpTarget.closest && _lpTarget.closest('.os-icon');
      if (iconEl) iconEl.classList.remove('lp-pressing');
    }

    function _clearLongPress() {
      if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; }
      _clearLongPressClass();
      _lpStart = null;
      _lpTarget = null;
    }

    function _startLongPress(e) {
      // 只處理觸控 / 觸控筆（滑鼠走原生 contextmenu）
      if (e.pointerType === 'mouse') return;
      if (e.button !== 0) return;
      if (!e.target.closest) return;
      if (e.target.closest('.os-window')) return;
      if (!e.target.closest('#os-desktop')) return;

      _lpFired = false;
      _lpStart = { x: e.clientX, y: e.clientY };
      _lpTarget = e.target;

      // 視覺回饋
      const iconEl = e.target.closest('.os-icon');
      if (iconEl) iconEl.classList.add('lp-pressing');

      _lpTimer = setTimeout(() => {
        _lpTimer = null;
        _lpFired = true;

        const t = _lpTarget;
        if (!t) return;
        const iconEl = t.closest && t.closest('.os-icon');
        const x = _lpStart ? _lpStart.x : 0;
        const y = _lpStart ? _lpStart.y : 0;

        // 先移除視覺回饋
        _clearLongPressClass();

        if (iconEl) {
          const id = iconEl.dataset.iconId;
          state.selectedIconId = id;
          $$('.os-icon').forEach(el => el.classList.remove('selected'));
          iconEl.classList.add('selected');
          openContextMenu(x, y, { type: 'icon', iconId: id });
        } else {
          state.selectedIconId = null;
          $$('.os-icon').forEach(el => el.classList.remove('selected'));
          openContextMenu(x, y, { type: 'desktop' });
        }

        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) {} }
      }, 550);
    }

    function _moveLongPress(e) {
      if (!_lpStart) return;
      const dx = e.clientX - _lpStart.x;
      const dy = e.clientY - _lpStart.y;
      // 移動超過 12px 視為拖動，取消長按
      if (Math.hypot(dx, dy) > 12) _clearLongPress();
    }

    function _endLongPress() {
      _clearLongPress();
    }

    // 攔截長按後緊接而來的 click（避免觸發「選中」或「雙擊」）
    function _blockClickAfterLongPress(e) {
      if (_lpFired) {
        _lpFired = false;
        e.stopPropagation();
        e.preventDefault();
      }
    }

    document.addEventListener('pointerdown', _startLongPress, { passive: true });
    document.addEventListener('pointermove', _moveLongPress, { passive: true });
    document.addEventListener('pointerup',   _endLongPress,   { passive: true });
    document.addEventListener('pointercancel', _endLongPress, { passive: true });
    document.addEventListener('click', _blockClickAfterLongPress, true);
  }

  /* ═══════════ 15. 啟動 ═══════════ */
  function init() {
    // ⭐ 重新讀用户信息（鎖屏期間可能剛登入）
    user = (typeof getCurrentUser === 'function' ? getCurrentUser() : null) || {};
    isAdmin = user.role === 'admin' || user.role === 'root';
    isRoot  = user.role === 'root';
    displayName = user.displayName || user.username || 'Guest';
    APPS = buildApps();

    $('#os-user-name').textContent = displayName;
    $('#os-user-chip').title = `@${user.username || ''} · ${user.role || 'student'}`;

    renderStartMenu();
    renderDetailRulesSettings();
    bindAddIconForm();
    bindGlobalEvents();
    setInterval(updateClock, 1000);
    updateClock();
    OS.applyScale(state.scale);
    loadWallpaper();
    OS.loadDesktop();

    // ⭐ 嘗試從會話恢復；若無 → 開預設 App
    OS.restoreSession();
        // ⭐ 若設定了 Hide Status Bar，等第一次手勢再自動進全屏
    if (state.hideStatusBar && CAN_FULLSCREEN) {
      const onceFullscreen = async () => {
        document.removeEventListener('pointerdown', onceFullscreen, true);
        document.removeEventListener('touchstart', onceFullscreen, true);
        // 只在使用者尚未處於全屏時才請求
        if (!document.fullscreenElement) {
          await OS.applyHideStatusBar(true, { silent: true });
        }
      };
      document.addEventListener('pointerdown', onceFullscreen, true);
      document.addEventListener('touchstart', onceFullscreen, true);
    }
  }

  // ⭐ 每次載入都先顯示鎖屏；解鎖後才啟動 OS
  const boot = () => {
    if (typeof window.__setupOSLockScreen !== 'function') {
      // 保險：無鎖屏函式時直接啟動
      init();
      return;
    }
    window.__setupOSLockScreen({
      onUnlock: () => init()
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
    // ⭐ 頁面卸載前，最後保存一次（避免 debounce 還未觸發）
  window.addEventListener('pagehide', () => {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
      saveSession();
    }
  });
})();
