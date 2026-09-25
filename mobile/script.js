/* ═══════════════════════════════════════════════════════════
 * WYK Maths Team — Mobile App
 * 獨立於桌面版 auth.js / app.js：自己實作 token / apiCall
 * ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

// ═══════════════════════════════════════════════════════════
// 0. Auth（從 auth.js 照抄簡化版，避免引入桌面版重定向邏輯）
// ═══════════════════════════════════════════════════════════
const TOKEN_KEY = 'auth_token';

// 從 URL 拿 token（微軟回調）
(function () {
  try {
    const p = new URLSearchParams(location.search);
    const t = p.get('token');
    if (t) {
      localStorage.setItem(TOKEN_KEY, t);
      const newUrl = location.pathname + location.search.replace(/[?&]token=[^&]*/, '').replace(/^&/, '?');
      history.replaceState({}, document.title, newUrl);
      location.reload();
    }
  } catch {}
})();

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}
function parseJwt(t) {
  try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; }
}
function isLoggedIn() {
  const t = getToken();
  if (!t) return false;
  const p = parseJwt(t);
  if (!p || p.exp * 1000 < Date.now()) { setToken(null); return false; }
  return true;
}
function getCurrentUser() {
  const t = getToken();
  if (!t) return null;
  const p = parseJwt(t);
  if (!p) return null;
  return {
    username: p.username,
    role: p.role || 'student',
    displayName: p.displayName || p.username,
    pfp: p.pfp || '',
  };
}
async function doLogin(username, password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success) setToken(data.token);
    return data;
  } catch {
    return { success: false, message: 'Network error' };
  }
}
async function apiCall(endpoint, method = 'GET', body = null) {
  const url = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers['Authorization'] = 'Bearer ' + t;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (res.status === 401) {
    setToken(null);
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const d = await res.json().catch(() => ({ message: 'HTTP ' + res.status }));
    throw new Error(d.message || ('HTTP ' + res.status));
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════
// 1. 常量 & 狀態
// ═══════════════════════════════════════════════════════════
const LS = {
  problems: 'mobile_problems_v1',
  states:   'mobile_states_v1',
  fav:      'mobile_fav_v1',
  settings: 'mobile_settings_v1',
};

const DEFAULT_SETTINGS = {
  theme: 'dark',
  showDifficulty: true,
  showTags: true,
  showSolves: true,
  showFavorite: true,
  compact: false,
  animations: true,
  pageSize: 30,
};

const TABS = [
  { id: 'home',        icon: 'fa-house',        label: 'Home',        match: /^\/?$/ },
  { id: 'problems',    icon: 'fa-list-check',   label: 'Problems',    match: /^\/problems/ },
  { id: 'submissions', icon: 'fa-paper-plane',  label: 'Submissions', match: /^\/submissions/ },
  { id: 'contests',    icon: 'fa-trophy',       label: 'Contests',    match: /^\/contests/ },
  { id: 'rank',        icon: 'fa-ranking-star', label: 'Rank',        match: /^\/rank/ },
  { id: 'me',          icon: 'fa-user',         label: 'Me',          match: /^\/(me|settings)/ },
];

const state = {
  user: null,
  problems: null,
  states: null,
  favorites: null,
  settings: { ...DEFAULT_SETTINGS },
  route: { path: '/', parts: [] },
  problemsLoaded: false,
  lastScrollTop: 0,
  appReady: false,
};

// ═══════════════════════════════════════════════════════════
// 2. 工具
// ═══════════════════════════════════════════════════════════
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function escAttr(s) { return esc(s); }

function toast(msg) {
  let t = $('#ml-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ml-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return { date: '—', time: '—' };
  const pad = n => String(n).padStart(2, '0');
  const local = new Date(d.getTime() + 8 * 3600000);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`,
  };
}
function faviconOf(name) {
  return String(name || '?').trim()[0]?.toUpperCase() || '?';
}

// ═══════════════════════════════════════════════════════════
// 3. 進度條
// ═══════════════════════════════════════════════════════════
const _progressStart = Date.now();
function tickProgress() {
  const fill = $('#mlFill');
  const pct  = $('#mlPct');
  const wrap = $('#ml-loading');
  if (!fill || !pct || !wrap) return;

  let target;
  if (state.appReady) {
    const cur = parseFloat(fill.style.width) || 0;
    target = cur + (100 - cur) * 0.25;
    if (target > 99.5) {
      fill.style.width = '100%';
      pct.textContent = '100%';
      setTimeout(() => {
        wrap.classList.add('ml-hide');
        setTimeout(() => wrap.remove(), 400);
      }, 160);
      return;
    }
  } else {
    const elapsed = Date.now() - _progressStart;
    const t = Math.min(1, elapsed / 4500);
    const eased = 1 - Math.pow(1 - t, 3);
    target = eased * 88;
    if (elapsed > 5000) {
      const over = Math.min(1, (elapsed - 5000) / 3000);
      target = 88 + over * 11;
    }
    target = Math.min(target, 99);
    const cur = parseFloat(fill.style.width) || 0;
    if (cur > target) target = cur;
  }
  fill.style.width = target.toFixed(2) + '%';
  pct.textContent = Math.floor(target) + '%';
  requestAnimationFrame(tickProgress);
}

// ═══════════════════════════════════════════════════════════
// 4. LocalStorage
// ═══════════════════════════════════════════════════════════
function lsRead(key, ttl) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (ttl && data.ts && Date.now() - data.ts > ttl) return null;
    return data;
  } catch { return null; }
}
function lsWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v: value })); } catch {}
}

function loadSettings() {
  const c = lsRead(LS.settings);
  if (c && c.v && typeof c.v === 'object') Object.assign(state.settings, c.v);
  applyTheme();
}
function saveSettings() {
  lsWrite(LS.settings, state.settings);
  applyTheme();
}
function applyTheme() {
  const t = state.settings.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : state.settings.theme;
  document.documentElement.setAttribute('data-theme', t);
}

function loadProblemsCache() {
  const c = lsRead(LS.problems, 24 * 60 * 60 * 1000);
  if (c && c.v && Array.isArray(c.v.problems)) {
    state.problems = c.v.problems;
    state.problemsLoaded = true;
    return true;
  }
  return false;
}
function saveProblemsCache(problems) { lsWrite(LS.problems, { problems }); }

function loadStatesCache() {
  const c = lsRead(LS.states, 24 * 60 * 60 * 1000);
  if (c && c.v) { state.states = c.v; return true; }
  return false;
}
function saveStatesCache(states) { lsWrite(LS.states, states); }

function loadFavCache() {
  const c = lsRead(LS.fav, 24 * 60 * 60 * 1000);
  if (c && Array.isArray(c.v)) { state.favorites = new Set(c.v); return true; }
  return false;
}
function saveFavCache() { lsWrite(LS.fav, Array.from(state.favorites || [])); }

// ═══════════════════════════════════════════════════════════
// 5. 路由
// ═══════════════════════════════════════════════════════════
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: '/' + parts.join('/'), parts };
}
function navigate(path) {
  const h = '#' + path;
  if (location.hash === h) renderRoute();
  else location.hash = h;
}
function routeTitle() {
  const p = state.route.parts;
  if (p.length === 0) return 'WYK Maths Team';
  const head = p[0];
  if (head === 'me' || head === 'settings') return '';
  const headName = head.charAt(0).toUpperCase() + head.slice(1);
  if (head === 'submissions') return 'Submissions';
  if (head === 'rank') return 'Rank';
  if (p.length === 1) return headName;
  return headName + ' - ' + p[p.length - 1];
}

// ═══════════════════════════════════════════════════════════
// 6. AppBar / TabBar
// ═══════════════════════════════════════════════════════════
function renderAppBar(opts) {
  opts = opts || {};
  const bar = $('#ml-appbar');
  if (!bar) return;
  const title = routeTitle();
  const leftIcon = opts.leftIcon || 'fa-chevron-left';
  const rightIcon = opts.rightIcon || 'fa-chevron-right';

  bar.innerHTML = `
    <button class="ml-ab-btn" id="ml-ab-back" ${opts.leftDisabled ? 'disabled' : ''}>
      <i class="fas ${leftIcon}"></i>
    </button>
    <div class="ml-ab-title${title ? '' : ' hidden'}">${esc(title)}</div>
    <button class="ml-ab-btn" id="ml-ab-fwd" ${opts.rightDisabled ? 'disabled' : ''}>
      <i class="fas ${rightIcon}"></i>
    </button>`;

  const back = $('#ml-ab-back');
  const fwd  = $('#ml-ab-fwd');
  back.onclick = () => { if (opts.onLeft) opts.onLeft(); else history.back(); };
  fwd.onclick  = () => { if (opts.onRight) opts.onRight(); else history.forward(); };
}

function renderTabBar() {
  const bar = $('#ml-tabbar');
  if (!bar) return;
  const path = state.route.path;
  bar.innerHTML = TABS.map(t => {
    const active = t.match.test(path) ? ' active' : '';
    return `<button class="ml-tb-btn${active}" data-tab="${t.id}" aria-label="${t.label}">
      <i class="fas ${t.icon}"></i>
    </button>`;
  }).join('');
  $$('.ml-tb-btn', bar).forEach(btn => {
    btn.onclick = () => {
      const target = {
        home: '/', problems: '/problems', submissions: '/submissions',
        contests: '/contests', rank: '/rank', me: '/me',
      }[btn.dataset.tab];
      navigate(target);
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 7. 預取
// ═══════════════════════════════════════════════════════════
async function prefetchAll() {
  await Promise.allSettled([
    (async () => {
      try {
        if (loadProblemsCache()) return;
        const d = await apiCall('/api/problem?all=1');
        if (d && d.success && Array.isArray(d.problems)) {
          state.problems = d.problems;
          state.problemsLoaded = true;
          saveProblemsCache(d.problems);
        }
      } catch (e) { console.warn('prefetch problems failed', e); }
    })(),
    (async () => {
      try {
        if (loadStatesCache() && loadFavCache()) return;
        const d = await apiCall('/api/users?action=preload');
        if (d && d.success) {
          state.states = d.states || {};
          state.favorites = new Set(d.favorites || []);
          saveStatesCache(state.states);
          saveFavCache();
        }
      } catch (e) { console.warn('prefetch preload failed', e); }
    })(),
    (async () => {
      try {
        const d = await fetch('/api/updates').then(r => r.json());
        if (d && d.success && Array.isArray(d.updates)) state._updates = d.updates;
      } catch (e) {}
    })(),
  ]);
}

// ═══════════════════════════════════════════════════════════
// 8. 頁面：Home
// ═══════════════════════════════════════════════════════════
async function renderHome() {
  const content = $('#ml-content');
  const u = state.user || {};
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' :
                hour < 18 ? 'Good afternoon' : 'Good evening';
  const totalProblems = state.problems ? state.problems.length : 0;
  let solvedCount = 0;
  if (state.states) solvedCount = Object.values(state.states).filter(v => v === 'passed').length;

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-greet">
        <h1 class="ml-greet-h1">${esc(greet)},<br><em>${esc(u.displayName || u.username || 'Guest')}</em></h1>
        <p class="ml-greet-sub">What are we solving today?</p>
      </div>

      <div class="ml-stats-grid">
        <div class="ml-stat">
          <i class="fas fa-check-circle ml-stat-icon"></i>
          <div class="ml-stat-val">${solvedCount}</div>
          <div class="ml-stat-lbl">Solved</div>
        </div>
        <div class="ml-stat">
          <i class="fas fa-book ml-stat-icon"></i>
          <div class="ml-stat-val">${totalProblems}</div>
          <div class="ml-stat-lbl">Total</div>
        </div>
      </div>

      <div class="ml-section-title">Quick Access</div>
      <div class="ml-quick-grid">
        <a class="ml-quick" data-nav="/problems" data-filter="unsolved">
          <i class="fas fa-fire"></i>
          <div class="ml-quick-t">Continue</div>
          <div class="ml-quick-d">Unsolved problems</div>
        </a>
        <a class="ml-quick" data-nav="/problems" data-filter="fav">
          <i class="fas fa-star"></i>
          <div class="ml-quick-t">Bookmarks</div>
          <div class="ml-quick-d">Saved for later</div>
        </a>
        <a class="ml-quick" data-nav="/submissions">
          <i class="fas fa-paper-plane"></i>
          <div class="ml-quick-t">My Submissions</div>
          <div class="ml-quick-d">Latest attempts</div>
        </a>
        <a class="ml-quick" data-nav="/contests">
          <i class="fas fa-trophy"></i>
          <div class="ml-quick-t">Contests</div>
          <div class="ml-quick-d">Join events</div>
        </a>
      </div>

      <div class="ml-section-title">Recent Updates</div>
      <div id="ml-updates">${renderUpdatesSkeleton()}</div>
    </div>`;

  $$('.ml-quick[data-nav]', content).forEach(el => {
    el.onclick = () => {
      if (el.dataset.filter) sessionStorage.setItem('ml_prob_filter', el.dataset.filter);
      navigate(el.dataset.nav);
    };
  });
  loadUpdates();
}

function renderUpdatesSkeleton() {
  let h = '';
  for (let i = 0; i < 3; i++) {
    h += `<div class="ml-skel-card">
      <div class="ml-skel ml-skel-line" style="width:30%"></div>
      <div class="ml-skel ml-skel-line" style="width:85%"></div>
      <div class="ml-skel ml-skel-line" style="width:60%"></div>
    </div>`;
  }
  return h;
}

async function loadUpdates() {
  const wrap = $('#ml-updates');
  if (!wrap) return;
  try {
    let updates = state._updates;
    if (!updates) {
      const d = await fetch('/api/updates').then(r => r.json());
      updates = d.success ? d.updates : [];
      state._updates = updates;
    }
    if (!updates.length) {
      wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No updates yet</div>`;
      return;
    }
    wrap.innerHTML = updates.map((u, i) => `
      <div class="ml-update" data-i="${i}">
        <div class="ml-update-head">
          <span class="ml-badge ${esc(u.badge)}">${esc(u.badgeText || u.badge)}</span>
          <span class="ml-update-time">${esc(u.time || '')}</span>
        </div>
        ${u.title ? `<div class="ml-update-title">${esc(u.title)}</div>` : ''}
        <div class="ml-update-excerpt" data-excerpt>${esc(stripHtml(u.content || '').slice(0, 120))}</div>
        <div class="ml-update-body">${u.content || ''}</div>
      </div>`).join('');
    $$('.ml-update', wrap).forEach(el => {
      el.onclick = () => {
        const open = el.classList.toggle('open');
        const ex = el.querySelector('[data-excerpt]');
        if (ex) ex.style.display = open ? 'none' : '';
      };
    });
  } catch (e) {
    wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load updates</div>`;
  }
}
function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return (d.textContent || '').trim();
}

// ═══════════════════════════════════════════════════════════
// 9. 頁面：Problems 列表
// ═══════════════════════════════════════════════════════════
async function renderProblems() {
  const content = $('#ml-content');
  const savedFilter = sessionStorage.getItem('ml_prob_filter') || 'all';
  sessionStorage.removeItem('ml_prob_filter');

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-prob-filters" id="ml-prob-filters">
        <button class="ml-chip" data-f="all">All</button>
        <button class="ml-chip" data-f="unsolved">Unsolved</button>
        <button class="ml-chip" data-f="solved">Solved</button>
        <button class="ml-chip" data-f="fav">Bookmarks</button>
      </div>
      <div id="ml-prob-list">${renderProblemsSkeleton()}</div>
    </div>`;

  let filter = savedFilter;
  const setFilter = (f) => {
    filter = f;
    $$('#ml-prob-filters .ml-chip').forEach(b => b.classList.toggle('active', b.dataset.f === f));
    renderProbList(f);
  };
  $$('#ml-prob-filters .ml-chip').forEach(b => b.onclick = () => setFilter(b.dataset.f));

  if (!state.problemsLoaded) {
    const wait = setInterval(() => {
      if (state.problemsLoaded) { clearInterval(wait); setFilter(filter); }
    }, 100);
    setTimeout(() => { clearInterval(wait); if (!state.problemsLoaded) setFilter(filter); }, 4000);
  } else {
    setFilter(filter);
  }
}

function renderProblemsSkeleton() {
  let h = '';
  for (let i = 0; i < 6; i++) {
    h += `<div class="ml-skel-card">
      <div class="ml-skel ml-skel-line" style="width:20%"></div>
      <div class="ml-skel ml-skel-line" style="width:70%"></div>
      <div class="ml-skel ml-skel-line" style="width:40%"></div>
    </div>`;
  }
  return h;
}

function renderProbList(filter) {
  const wrap = $('#ml-prob-list');
  if (!wrap) return;
  const all = state.problems || [];
  const s = state.settings;
  const states = state.states || {};
  const favs = state.favorites || new Set();

  let items = all.slice();
  if (filter === 'unsolved') items = items.filter(p => states[p.id] !== 'passed');
  else if (filter === 'solved') items = items.filter(p => states[p.id] === 'passed');
  else if (filter === 'fav') items = items.filter(p => favs.has(p.id));

  if (!items.length) {
    wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No problems</div>`;
    return;
  }

  const limit = s.pageSize || 30;
  const shown = items.slice(0, limit);
  const hasMore = items.length > limit;
  wrap.innerHTML = shown.map(p => probCardHtml(p, s, states, favs)).join('')
    + (hasMore ? `<button class="ml-btn ghost full" id="ml-load-more" style="margin-top:8px">Load ${items.length - limit} more</button>` : '');

  bindProbCards(wrap);
  if (hasMore) {
    const btn = $('#ml-load-more');
    btn.onclick = () => {
      btn.remove();
      const rest = items.slice(limit);
      const html = rest.map(p => probCardHtml(p, s, states, favs)).join('');
      wrap.insertAdjacentHTML('beforeend', html);
      bindProbCards(wrap);
    };
  }
}

function probCardHtml(p, s, states, favs) {
  const st = states[p.id] || 'not_started';
  const cls = st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : '';
  const isFav = favs.has(p.id);
  const diff = p.difficulty;
  const diffText = !diff ? '∞' : diff.toFixed(2);

  let statusHtml = '';
  if (st === 'passed') statusHtml = `<span class="ml-prob-status passed"><i class="fas fa-check"></i> AC</span>`;
  else if (st === 'failed') statusHtml = `<span class="ml-prob-status failed"><i class="fas fa-times"></i> WA</span>`;

  return `
    <div class="ml-prob ${cls}" data-id="${escAttr(p.id)}">
      <div class="ml-prob-main">
        <div class="ml-prob-top">
          <span class="ml-prob-id">${esc(p.id)}</span>
          <span class="ml-prob-name">${esc(p.name || '')}</span>
          ${statusHtml}
        </div>
        <div class="ml-prob-meta">
          ${s.showDifficulty ? `<span class="ml-prob-diff">Lv.${diffText}</span>` : ''}
          ${s.showSolves ? `<span><i class="fas fa-user-check"></i> ${p.solves || 0}</span>` : ''}
          ${s.showTags && p.tags && p.tags.length
            ? `<div class="ml-prob-tags">${p.tags.slice(0, 3).map(t => `<span class="ml-tag">${esc(t)}</span>`).join('')}${p.tags.length > 3 ? `<span class="ml-tag">+${p.tags.length - 3}</span>` : ''}</div>`
            : ''}
        </div>
      </div>
      ${s.showFavorite ? `<button class="ml-prob-fav${isFav ? ' on' : ''}" data-fav="${escAttr(p.id)}"><i class="fas fa-star"></i></button>` : ''}
    </div>`;
}

function bindProbCards(root) {
  $$('.ml-prob', root).forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('[data-fav]')) return;
      navigate('/problems/' + encodeURIComponent(el.dataset.id));
    };
  });
  $$('[data-fav]', root).forEach(btn => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.dataset.fav;
      const isOn = btn.classList.contains('on');
      btn.classList.toggle('on');
      if (isOn) state.favorites.delete(id); else state.favorites.add(id);
      saveFavCache();
      try {
        const d = await apiCall('/api/users?action=favorite', 'POST', { problemId: id });
        if (d && d.success && Array.isArray(d.favorites)) {
          state.favorites = new Set(d.favorites);
          saveFavCache();
        }
      } catch {
        btn.classList.toggle('on');
        if (isOn) state.favorites.add(id); else state.favorites.delete(id);
        saveFavCache();
      }
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 10. 頁面：Problem Detail
// ═══════════════════════════════════════════════════════════
async function renderProblemDetail(id) {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;

  const all = state.problems || [];
  const idx = all.findIndex(p => p.id === id);
  const prevId = idx > 0 ? all[idx - 1].id : null;
  const nextId = idx >= 0 && idx < all.length - 1 ? all[idx + 1].id : null;

  renderAppBar({
    leftDisabled: !prevId,
    rightDisabled: !nextId,
    onLeft: prevId ? () => navigate('/problems/' + encodeURIComponent(prevId)) : null,
    onRight: nextId ? () => navigate('/problems/' + encodeURIComponent(nextId)) : null,
  });

  try {
    const d = await apiCall('/api/problem?action=page&id=' + encodeURIComponent(id));
    if (!d || !d.success || !d.problem) throw new Error('Not found');
    const p = d.problem;
    const fav = !!d.favorited;
    if (!state.favorites) state.favorites = new Set();
    if (fav) state.favorites.add(id); else state.favorites.delete(id);
    saveFavCache();

    const s = state.settings;
    const diffText = !p.difficulty ? '∞' : Number(p.difficulty).toFixed(2);

    content.innerHTML = `
      <div class="ml-page">
        <div class="ml-pd-title">${esc(p.name || p.id)}</div>
        <div class="ml-pd-meta">
          <span class="ml-prob-id">${esc(p.id)}</span>
          ${s.showDifficulty ? `<span>Lv.${diffText}</span>` : ''}
          ${s.showTags && p.tags && p.tags.length
            ? `<div class="ml-prob-tags">${p.tags.map(t => `<span class="ml-tag">${esc(t)}</span>`).join('')}</div>` : ''}
          <button class="ml-prob-fav${fav ? ' on' : ''}" data-fav="${escAttr(id)}" style="margin-left:auto">
            <i class="fas fa-star"></i>
          </button>
        </div>
        <div class="ml-pd-statement" id="ml-pd-statement"></div>

        <div id="ml-pd-answer-zone">
          <div class="ml-answer-row">
            <input type="text" class="ml-input" id="ml-pd-answer" placeholder="Your answer" autocomplete="off" inputmode="decimal">
            <button class="ml-btn" id="ml-pd-submit">Submit</button>
          </div>
          <div class="ml-feedback" id="ml-pd-feedback"></div>
        </div>
      </div>`;

    const stmt = $('#ml-pd-statement');
    if (stmt) {
      let html = p.statement || '';
      if (window.DOMPurify) {
        html = DOMPurify.sanitize(html, {
          ADD_TAGS: ['svg','path','g','defs','clipPath','rect','circle','line','polyline','polygon','text','tspan','linearGradient','radialGradient','stop','use','foreignObject'],
          ADD_ATTR: ['viewBox','d','cx','cy','r','x','y','x1','x2','y1','y2','points','fill','stroke','stroke-width','transform','xmlns'],
        });
      }
      stmt.innerHTML = html;
      if (typeof renderMathInElement === 'function') {
        renderMathInElement(stmt, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
          ],
        });
      }
    }

    const favBtn = $('[data-fav]', content);
    if (favBtn) {
      favBtn.onclick = async () => {
        const on = favBtn.classList.toggle('on');
        if (on) state.favorites.add(id); else state.favorites.delete(id);
        saveFavCache();
        try {
          const r = await apiCall('/api/users?action=favorite', 'POST', { problemId: id });
          if (r && r.success && Array.isArray(r.favorites)) {
            state.favorites = new Set(r.favorites);
            saveFavCache();
          }
        } catch {}
      };
    }

    const answerInp = $('#ml-pd-answer');
    const submitBtn = $('#ml-pd-submit');
    const fb = $('#ml-pd-feedback');

    try {
      const saved = JSON.parse(localStorage.getItem('pd_user_answers') || '{}');
      if (saved[id] && answerInp) answerInp.value = saved[id];
    } catch {}

    const doSubmit = async () => {
      const ans = (answerInp.value || '').trim();
      if (!ans) { toast('Enter an answer'); return; }
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="ml-spinner" style="width:14px;height:14px;border-width:2px"></span>';
      try {
        const r = await apiCall('/api/submit', 'POST', { problemId: id, answer: ans, type: 'text', image: '' });
        if (r && r.success) {
          const correct = r.correct || r.score === 100;
          const score = typeof r.score === 'number' ? r.score : (correct ? 100 : 0);
          if (correct) {
            fb.className = 'ml-feedback show ac';
            fb.textContent = '✓ Accepted';
            state.states = state.states || {};
            state.states[id] = 'passed';
            saveStatesCache(state.states);
          } else if (score > 0) {
            fb.className = 'ml-feedback show partial';
            fb.textContent = `Partial ${score}%`;
          } else {
            fb.className = 'ml-feedback show wa';
            fb.textContent = '✗ Wrong Answer';
            state.states = state.states || {};
            if (state.states[id] !== 'passed') state.states[id] = 'failed';
            saveStatesCache(state.states);
          }
        } else {
          fb.className = 'ml-feedback show wa';
          fb.textContent = r.message || 'Error';
        }
      } catch (e) {
        fb.className = 'ml-feedback show wa';
        fb.textContent = 'Network error';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit';
      }
    };
    submitBtn.onclick = doSubmit;
    answerInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
    });

  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Problem not found</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// 11. 頁面：Submissions
// ═══════════════════════════════════════════════════════════
async function renderSubmissions() {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div id="ml-subs-list"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div></div>`;
  try {
    const d = await apiCall('/api/submissions?all=1&page=1&limit=50');
    if (!d || !d.success) throw new Error();
    const subs = d.submissions || [];
    if (!subs.length) {
      $('#ml-subs-list').innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No submissions</div>`;
      return;
    }
    $('#ml-subs-list').innerHTML = subs.map(subCardHtml).join('');
    $$('.ml-sub', content).forEach(el => {
      el.onclick = () => {
        if (el.dataset.subid) navigate('/submissions/' + encodeURIComponent(el.dataset.subid));
      };
    });
  } catch (e) {
    $('#ml-subs-list').innerHTML = `<div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load</div>`;
  }
}

function subCardHtml(s) {
  const dt = fmtDateTime(s.timestamp);
  const cls = statusCls(s.status);
  return `
    <div class="ml-sub" data-subid="${escAttr(s.subid || '')}">
      <div class="ml-sub-date">
        <span class="d">${esc(dt.date)}</span>
        <span class="t">${esc(dt.time)}</span>
      </div>
      <div class="ml-sub-main">
        <div class="ml-sub-prob">${esc(s.problemName || s.problemId || '—')}</div>
        <div class="ml-sub-user">${esc(s.displayName || s.username || '')}</div>
      </div>
      <span class="ml-sub-status ${cls}">${esc(s.status || 'Pending')}</span>
    </div>`;
}

function statusCls(st) {
  if (!st) return 'pending';
  if (st === 'Accepted') return 'ac';
  if (st === 'Wrong Answer') return 'wa';
  if (st.startsWith('Partial')) return 'partial';
  if (st === 'System Error') return 'system';
  return 'pending';
}

async function renderSubmissionDetail(subid) {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;
  renderAppBar();
  try {
    const d = await apiCall('/api/submissions?action=detail&subid=' + encodeURIComponent(subid));
    if (!d || !d.success) throw new Error();
    const s = d.submission;
    const dt = fmtDateTime(s.timestamp);
    const cls = statusCls(d.status || (s.correct ? 'Accepted' : 'Wrong Answer'));

    content.innerHTML = `
      <div class="ml-page">
        <div class="ml-card">
          <div style="font-size:16px;font-weight:700;margin-bottom:6px">${esc(d.problemName || s.problemId)}</div>
          <div style="font-size:12px;color:var(--fg-muted);margin-bottom:12px">
            ${esc(dt.date)} ${esc(dt.time)} · ${esc(s.username)}
          </div>
          <div class="ml-sub-status ${cls}" style="display:inline-block">${esc(d.status || 'Pending')}</div>
        </div>
        ${s.answer !== undefined ? `
          <div class="ml-section-title" style="margin-top:18px">Answer</div>
          <div class="ml-card" style="font-family:Consolas,monospace;font-size:14px;word-break:break-all">${esc(s.answer || '(empty)')}</div>
        ` : s.answerHidden ? `
          <div class="ml-section-title" style="margin-top:18px">Answer</div>
          <div class="ml-card" style="color:var(--fg-muted);font-style:italic">Hidden</div>
        ` : ''}
        ${s.comment ? `
          <div class="ml-section-title" style="margin-top:18px">Comment</div>
          <div class="ml-card">${esc(s.comment)}</div>
        ` : ''}
      </div>`;
  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Not found</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// 12. 頁面：Contests
// ═══════════════════════════════════════════════════════════
async function renderContests() {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div id="ml-contests-list"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div></div>`;
  try {
    const d = await apiCall('/api/contests?action=list&page=1&limit=30');
    if (!d || !d.success) throw new Error();
    const cs = d.contests || [];
    if (!cs.length) {
      $('#ml-contests-list').innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No contests</div>`;
      return;
    }
    const now = Date.now();
    $('#ml-contests-list').innerHTML = cs.map(c => {
      const start = new Date(c.startTime).getTime();
      const end = start + (Number(c.duration) || 0) * 60000;
      let status = 'upcoming';
      if (now > end) status = 'ended';
      else if (now >= start) status = 'ongoing';
      return contestCardHtml(c, status);
    }).join('');
    $$('.ml-sub', content).forEach(el => {
      el.onclick = () => navigate('/contests/' + encodeURIComponent(el.dataset.cid));
    });
  } catch (e) {
    $('#ml-contests-list').innerHTML = `<div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load</div>`;
  }
}

function contestCardHtml(c, status) {
  const start = new Date(c.startTime);
  const pad = n => String(n).padStart(2, '0');
  const local = new Date(start.getTime() + 8 * 3600000);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const statusMap = { upcoming: 'Pending', ongoing: 'Ongoing', ended: 'Ended' };
  const cls = { upcoming: 'partial', ongoing: 'ac', ended: 'pending' };
  return `
    <div class="ml-sub" data-cid="${escAttr(c.id)}">
      <div class="ml-sub-date">
        <span class="d">${esc(date)}</span>
        <span class="t">${esc(time)}</span>
      </div>
      <div class="ml-sub-main">
        <div class="ml-sub-prob">${esc(c.name || ('Contest #' + c.id))}</div>
        <div class="ml-sub-user">${c.contestantCount || 0} participants · ${Number(c.duration) || 0}m</div>
      </div>
      <span class="ml-sub-status ${cls[status]}">${statusMap[status]}</span>
    </div>`;
}

async function renderContestDetail(id) {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;
  renderAppBar();
  try {
    const d = await apiCall('/api/contests?action=page&id=' + encodeURIComponent(id));
    if (!d || !d.success) throw new Error();
    const c = d.contest;
    const start = new Date(c.startTime);
    const pad = n => String(n).padStart(2, '0');
    const local = new Date(start.getTime() + 8 * 3600000);
    const dateStr = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    const canSee = c.problems && c.problems.length && (c.status === 'ongoing' || c.status === 'ended') && c.isParticipant;

    content.innerHTML = `
      <div class="ml-page">
        <h2 style="font-size:20px;font-weight:800;margin-bottom:6px">${esc(c.name)}</h2>
        <div style="font-size:12px;color:var(--fg-muted);margin-bottom:16px">
          ${esc(dateStr)} · ${c.duration}m · ${c.participantCount} participants
        </div>
        ${canSee ? `
          <div class="ml-section-title">Problems</div>
          ${c.problems.map(p => {
            const st = (c.userContestStates || {})[p.id] || 'not_started';
            const cls = st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : '';
            return `<div class="ml-prob ${cls}" data-pid="${escAttr(p.id)}" style="cursor:pointer">
              <div class="ml-prob-main">
                <div class="ml-prob-top">
                  <span class="ml-prob-id">${esc(p.id)}</span>
                  <span class="ml-prob-name">${esc(p.name || '')}</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        ` : `
          <div class="ml-empty"><i class="fas fa-lock"></i>${c.status === 'upcoming' ? 'Contest not started' : 'Problems not available'}</div>
        `}
      </div>`;

    $$('.ml-prob[data-pid]', content).forEach(el => {
      el.onclick = () => navigate('/problems/' + encodeURIComponent(el.dataset.pid));
    });
  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Not found</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// 13. 頁面：Rank
// ═══════════════════════════════════════════════════════════
async function renderRank() {
  const content = $('#ml-content');
  content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;
  try {
    const d = await apiCall('/api/users?action=leaderboard');
    if (!d || !d.success) throw new Error();
    const list = d.leaderboard || [];
    let html = `<div class="ml-page">`;

    if (list.length >= 3) {
      html += `<div class="ml-rank-top">
        ${rankPodiumHtml(list[1], 2)}
        ${rankPodiumHtml(list[0], 1)}
        ${rankPodiumHtml(list[2], 3)}
      </div>`;
    }
    const rest = list.slice(3);
    if (rest.length) html += `<div>${rest.map(u => rankItemHtml(u)).join('')}</div>`;

    const me = state.user && state.user.username;
    if (me) {
      const meIdx = list.findIndex(x => x.username === me);
      if (meIdx >= 0) html += `<div class="ml-rank-self">${rankItemHtml(list[meIdx], true)}</div>`;
    }
    html += `</div>`;
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load</div></div>`;
  }
}

function rankPodiumHtml(u, r) {
  const name = u.displayName || u.username;
  const avatar = u.pfp ? `<img src="${escAttr(u.pfp)}" alt="">` : faviconOf(name);
  return `<div class="ml-rank-podium r${r}">
    <div class="ml-rank-avatar">${avatar}</div>
    <div class="ml-rank-name">${esc(name)}</div>
    <div class="ml-rank-solves">${u.solves || 0}</div>
  </div>`;
}
function rankItemHtml(u, isSelf) {
  const name = u.displayName || u.username;
  const avatar = u.pfp ? `<img src="${escAttr(u.pfp)}" alt="">` : faviconOf(name);
  return `<div class="ml-rank-item${isSelf ? ' me' : ''}">
    <div class="rk">#${u.rank}</div>
    <div class="av">${avatar}</div>
    <div class="nm">${esc(name)}</div>
    <div class="sc">${u.solves || 0}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
// 14. 頁面：Me
// ═══════════════════════════════════════════════════════════
async function renderMe() {
  const content = $('#ml-content');
  const u = state.user || {};
  const states = state.states || {};
  const solved = Object.values(states).filter(v => v === 'passed').length;
  const total = state.problems ? state.problems.length : 0;
  const pct = total ? Math.round(solved / total * 100) : 0;
  const avatar = u.pfp ? `<img src="${escAttr(u.pfp)}" alt="">` : '<i class="fas fa-user"></i>';

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-me-head">
        <div class="ml-me-avatar">${avatar}</div>
        <div class="ml-me-name">${esc(u.displayName || u.username || 'Guest')}</div>
        <div class="ml-me-sub">@${esc(u.username || '')}</div>
      </div>
      <div class="ml-me-stats">
        <div class="ml-me-stat"><div class="ml-me-stat-v">${solved}</div><div class="ml-me-stat-l">Solved</div></div>
        <div class="ml-me-stat"><div class="ml-me-stat-v">${pct}%</div><div class="ml-me-stat-l">Progress</div></div>
        <div class="ml-me-stat"><div class="ml-me-stat-v">${total}</div><div class="ml-me-stat-l">Total</div></div>
      </div>

      <div class="ml-list">
        <div class="ml-list-item" data-nav="/submissions">
          <i class="fas fa-paper-plane ico"></i>
          <span class="lbl">My Submissions</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item" data-filter="fav">
          <i class="fas fa-star ico"></i>
          <span class="lbl">Bookmarks</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item" data-nav="/contests">
          <i class="fas fa-trophy ico"></i>
          <span class="lbl">Contests</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
      </div>

      <div class="ml-list">
        <div class="ml-list-item" data-nav="/settings">
          <i class="fas fa-gear ico"></i>
          <span class="lbl">Settings</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item danger" id="ml-me-logout">
          <i class="fas fa-right-from-bracket ico"></i>
          <span class="lbl">Sign Out</span>
        </div>
      </div>
    </div>`;

  $$('[data-nav]', content).forEach(el => el.onclick = () => navigate(el.dataset.nav));
  const favNav = $('[data-filter="fav"]', content);
  if (favNav) favNav.onclick = () => {
    sessionStorage.setItem('ml_prob_filter', 'fav');
    navigate('/problems');
  };
  $('#ml-me-logout').onclick = () => {
    if (!confirm('Sign out?')) return;
    setToken(null);
    setTimeout(() => location.reload(), 60);
  };
}

// ═══════════════════════════════════════════════════════════
// 15. 頁面：Settings
// ═══════════════════════════════════════════════════════════
async function renderSettings() {
  const content = $('#ml-content');
  const s = state.settings;

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-section-title">Appearance</div>
      <div class="ml-set-group">
        <div class="ml-set-item">
          <span class="lbl">Theme</span>
          <div class="ml-seg" data-seg="theme">
            <button class="ml-seg-btn${s.theme === 'dark' ? ' active' : ''}" data-v="dark">Dark</button>
            <button class="ml-seg-btn${s.theme === 'light' ? ' active' : ''}" data-v="light">Light</button>
            <button class="ml-seg-btn${s.theme === 'auto' ? ' active' : ''}" data-v="auto">Auto</button>
          </div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Compact Mode</span>
          <div class="ml-switch${s.compact ? ' on' : ''}" data-sw="compact"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Animations</span>
          <div class="ml-switch${s.animations ? ' on' : ''}" data-sw="animations"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Cards per Page</span>
          <div class="ml-seg" data-seg="pageSize">
            <button class="ml-seg-btn${s.pageSize === 20 ? ' active' : ''}" data-v="20">20</button>
            <button class="ml-seg-btn${s.pageSize === 30 ? ' active' : ''}" data-v="30">30</button>
            <button class="ml-seg-btn${s.pageSize === 50 ? ' active' : ''}" data-v="50">50</button>
          </div>
        </div>
      </div>

      <div class="ml-section-title">Problem List</div>
      <div class="ml-set-group">
        <div class="ml-set-item">
          <span class="lbl">Show Difficulty</span>
          <div class="ml-switch${s.showDifficulty ? ' on' : ''}" data-sw="showDifficulty"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Show Tags</span>
          <div class="ml-switch${s.showTags ? ' on' : ''}" data-sw="showTags"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Show Solve Count</span>
          <div class="ml-switch${s.showSolves ? ' on' : ''}" data-sw="showSolves"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl">Show Favorite Star</span>
          <div class="ml-switch${s.showFavorite ? ' on' : ''}" data-sw="showFavorite"></div>
        </div>
      </div>

      <div class="ml-section-title">Account</div>
      <div class="ml-list">
        <div class="ml-list-item" data-act="password">
          <i class="fas fa-key ico"></i>
          <span class="lbl">Change Password</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item" data-act="name">
          <i class="fas fa-signature ico"></i>
          <span class="lbl">Change Display Name</span>
          <i class="fas fa-chevron-right chev"></i>
        </div>
        <div class="ml-list-item danger" data-act="logout">
          <i class="fas fa-right-from-bracket ico"></i>
          <span class="lbl">Sign Out</span>
        </div>
      </div>
    </div>`;

  $$('[data-sw]', content).forEach(el => {
    el.onclick = () => {
      const k = el.dataset.sw;
      const next = !state.settings[k];
      state.settings[k] = next;
      el.classList.toggle('on', next);
      saveSettings();
    };
  });
  $$('[data-seg]', content).forEach(seg => {
    const k = seg.dataset.seg;
    $$('.ml-seg-btn', seg).forEach(btn => {
      btn.onclick = () => {
        let v = btn.dataset.v;
        if (k === 'pageSize') v = parseInt(v, 10);
        state.settings[k] = v;
        $$('.ml-seg-btn', seg).forEach(b => b.classList.toggle('active', b === btn));
        saveSettings();
      };
    });
  });
  $$('[data-act]', content).forEach(el => {
    el.onclick = async () => {
      const a = el.dataset.act;
      if (a === 'password') {
        const oldP = prompt('Current password');
        if (!oldP) return;
        const newP = prompt('New password (min 4 chars)');
        if (!newP) return;
        try {
          const r = await apiCall('/api/users?action=changepassword', 'POST', { oldPassword: oldP, newPassword: newP });
          toast(r.success ? 'Password updated' : (r.message || 'Failed'));
        } catch { toast('Network error'); }
      } else if (a === 'name') {
        const cur = state.user ? (state.user.displayName || state.user.username) : '';
        const nn = prompt('New display name', cur);
        if (!nn || !nn.trim()) return;
        try {
          const r = await apiCall('/api/users?action=changename', 'POST', { newname: nn.trim() });
          if (r.success) { state.user.displayName = nn.trim(); toast('Updated'); }
          else toast(r.message || 'Failed');
        } catch { toast('Network error'); }
      } else if (a === 'logout') {
        if (!confirm('Sign out?')) return;
        setToken(null);
        setTimeout(() => location.reload(), 60);
      }
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 16. 路由分派
// ═══════════════════════════════════════════════════════════
async function renderRoute() {
  state.route = parseRoute();
  const p = state.route.parts;
  renderTabBar();
  const content = $('#ml-content');
  if (content) content.scrollTop = 0;
  renderAppBar({ leftDisabled: p.length <= 1, rightDisabled: true });

  if (p.length === 0) await renderHome();
  else if (p[0] === 'problems') {
    if (p[1]) await renderProblemDetail(decodeURIComponent(p[1]));
    else await renderProblems();
  } else if (p[0] === 'submissions') {
    if (p[1]) await renderSubmissionDetail(decodeURIComponent(p[1]));
    else await renderSubmissions();
  } else if (p[0] === 'contests') {
    if (p[1]) await renderContestDetail(decodeURIComponent(p[1]));
    else await renderContests();
  } else if (p[0] === 'rank') await renderRank();
  else if (p[0] === 'me') await renderMe();
  else if (p[0] === 'settings') await renderSettings();
  else await renderHome();
}

// ═══════════════════════════════════════════════════════════
// 17. 滾動隱藏 AppBar
// ═══════════════════════════════════════════════════════════
function bindScrollBehavior() {
  const content = $('#ml-content');
  if (!content) return;
  content.addEventListener('scroll', () => {
    const st = content.scrollTop;
    const diff = st - state.lastScrollTop;
    if (st > 60 && diff > 6) document.body.classList.add('ml-scrolling');
    else if (diff < -6 || st < 60) document.body.classList.remove('ml-scrolling');
    state.lastScrollTop = st;
  }, { passive: true });
}

// ═══════════════════════════════════════════════════════════
// 18. Login 頁
// ═══════════════════════════════════════════════════════════
function renderLogin() {
  const root = $('#ml-root');
  document.getElementById('ml-loading')?.remove();
  document.body.style.overflow = 'auto';

  root.innerHTML = `
    <div id="ml-login">
      <div class="ml-login-card">
        <div class="ml-login-logo">
          <i class="fas fa-cube"></i>
          <h1>WYK Maths Team</h1>
          <p>Sign in to continue</p>
        </div>
        <form class="ml-login-form" id="ml-login-form" autocomplete="on">
          <input type="text" class="ml-input" id="ml-login-u" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">
          <input type="password" class="ml-input" id="ml-login-p" placeholder="Password" autocomplete="current-password">
          <div class="ml-login-err" id="ml-login-err"></div>
          <button type="submit" class="ml-btn full" id="ml-login-btn">Sign In</button>
        </form>
        <div class="ml-login-divider">OR</div>
        <button class="ml-ms-btn" id="ml-login-ms">
          <svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
            <rect x="0" y="0" width="10.5" height="10.5" fill="#F25022"/>
            <rect x="12.5" y="0" width="10.5" height="10.5" fill="#7FBA00"/>
            <rect x="0" y="12.5" width="10.5" height="10.5" fill="#00A4EF"/>
            <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900"/>
          </svg>
          Continue with Microsoft
        </button>
      </div>
    </div>`;

  const form = $('#ml-login-form');
  const uInp = $('#ml-login-u');
  const pInp = $('#ml-login-p');
  const btn  = $('#ml-login-btn');
  const err  = $('#ml-login-err');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = uInp.value.trim();
    const p = pInp.value;
    if (!u || !p) { err.textContent = 'Enter username and password'; return; }
    err.textContent = '';
    btn.disabled = true;
    btn.innerHTML = '<span class="ml-spinner" style="width:14px;height:14px;border-width:2px"></span>';

    const loginStart = Date.now();
    try {
      const result = await doLogin(u, p);
      const remain = Math.max(0, 5000 - (Date.now() - loginStart));
      await new Promise(r => setTimeout(r, remain));
      if (result && result.success) { location.reload(); return; }
      err.textContent = (result && result.message) || 'Invalid credentials';
    } catch (e2) {
      const remain = Math.max(0, 5000 - (Date.now() - loginStart));
      await new Promise(r => setTimeout(r, remain));
      err.textContent = 'Network error';
    }
    btn.disabled = false;
    btn.textContent = 'Sign In';
  });

  $('#ml-login-ms').onclick = () => { location.href = '/api/auth/microsoft'; };
}

// ═══════════════════════════════════════════════════════════
// 19. 啟動
// ═══════════════════════════════════════════════════════════
function mountApp() {
  const root = $('#ml-root');
  root.innerHTML = `
    <div id="ml-app">
      <header id="ml-appbar"></header>
      <main id="ml-content"></main>
      <nav id="ml-tabbar"></nav>
    </div>`;
  document.body.style.overflow = 'hidden';
  bindScrollBehavior();
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

async function boot() {
  requestAnimationFrame(tickProgress);

  loadSettings();

  // 沒登入 → 登入頁
  if (!isLoggedIn()) {
    renderLogin();
    state.appReady = true;
    return;
  }

  state.user = getCurrentUser() || {};
  loadProblemsCache();
  loadStatesCache();
  loadFavCache();

  mountApp();
  state.appReady = true;

  // 背景預取
  setTimeout(() => {
    if ('requestIdleCallback' in window) requestIdleCallback(prefetchAll, { timeout: 2000 });
    else setTimeout(prefetchAll, 300);
  }, 200);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();