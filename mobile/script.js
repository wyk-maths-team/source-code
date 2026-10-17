/* ═══════════════════════════════════════════════════════════════════
 * WYK Maths Team — Mobile PWA (single-file app)
 *
 * 6 bottom tabs (icon-only): Home / Problems / Submissions /
 * Leaderboard / Contests / Me. Detail views (problem, submission,
 * user, contest, settings) are hash-routed sub-views layered on top
 * of the tab bar.
 *
 * Offline-first:
 *   - problems list cached in localStorage
 *   - statements + images cached in IndexedDB (bulk cache in Settings)
 *   - submissions made while offline go to a draft box (IndexedDB),
 *     then are flushed to the server automatically when back online.
 *
 * Navigation lock:
 *   - while a view is loading, tab / back / in-view navigation is
 *     blocked to prevent stale async results from clobbering the view.
 *   - the heartbeat (online-status report) is intentionally NOT part of
 *     this lock — it keeps running in the background at all times.
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ────────────────────────────────────────────────
   * 0. Utils
   * ──────────────────────────────────────────────── */
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function toast(msg, type) {
    const root = $('#toastRoot');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  function formatTime(iso, withDate) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const p = n => String(n).padStart(2, '0');
    const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    if (withDate) return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
    return hm;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function timeAgo(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  // difficulty → color pill (mirrors web)
  function diffColor(d) {
    if (!d) return { label: '∞', cls: 'diff', style: 'background:#777' };
    if (d < 2)  return { label: d.toFixed(2), cls: 'diff', style: 'background:#888' };
    if (d < 3)  return { label: d.toFixed(2), cls: 'diff', style: 'background:#2e9e5b' };
    if (d < 4)  return { label: d.toFixed(2), cls: 'diff', style: 'background:#337ab7' };
    if (d < 5)  return { label: d.toFixed(2), cls: 'diff', style: 'background:#7a3fbf' };
    if (d < 6)  return { label: d.toFixed(2), cls: 'diff', style: 'background:#c98a00' };
    if (d < 7)  return { label: d.toFixed(2), cls: 'diff', style: 'background:#c0392b' };
    return { label: d.toFixed(2), cls: 'diff', style: 'background:#1a1a2e' };
  }

  function statusOf(s) {
    // List endpoint (/api/submissions) returns a `status` string, e.g.
    // "Accepted", "Wrong Answer", "Partial Score (75)", "Pending", "System Error".
    if (typeof s.status === 'string' && s.status) {
      const st = s.status;
      if (st === 'Accepted') return { text: 'Accepted', cls: 'status-accepted' };
      if (st === 'Wrong Answer') return { text: 'Wrong Answer', cls: 'status-wrong' };
      if (st === 'System Error') return { text: 'System Error', cls: 'status-system' };
      if (st === 'Pending') return { text: 'Pending', cls: 'status-pending' };
      if (st.indexOf('Partial') === 0) return { text: st.replace('Partial Score', 'Partial'), cls: 'status-partial' };
      return { text: st, cls: 'status-pending' };
    }
    // Detail endpoint returns the raw marked / score / correct / systemError fields.
    if (s.marked && s.score !== undefined) {
      if (s.score === 100) return { text: 'Accepted', cls: 'status-accepted' };
      if (s.score === 0) return { text: 'Wrong Answer', cls: 'status-wrong' };
      return { text: `Partial (${s.score})`, cls: 'status-partial' };
    }
    if (s.type === 'image' && !s.marked) return { text: 'Pending', cls: 'status-pending' };
    if (s.systemError) return { text: 'System Error', cls: 'status-system' };
    if (typeof s.correct === 'boolean') return s.correct
      ? { text: 'Accepted', cls: 'status-accepted' }
      : { text: 'Wrong Answer', cls: 'status-wrong' };
    return { text: 'Pending', cls: 'status-pending' };
  }

  /* ────────────────────────────────────────────────
   * 1. Settings (theme / font size) — shared keys with web
   * ──────────────────────────────────────────────── */
  const Settings = {
    get theme() { return localStorage.getItem('theme') || 'light'; },
    setTheme(t) {
      localStorage.setItem('theme', t);
      if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
    },
    get fontSize() { return parseInt(localStorage.getItem('fontSize')) || 16; },
    setFontSize(n) {
      n = Math.min(24, Math.max(12, n));
      localStorage.setItem('fontSize', String(n));
      document.documentElement.style.fontSize = n + 'px';
    },
  };

  /* ────────────────────────────────────────────────
   * 2. Auth
   * ──────────────────────────────────────────────── */
  const TOKEN_KEY = 'auth_token';
  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function isLoggedIn() { return !!getToken(); }
  function getCurrentUser() {
    const token = getToken();
    if (!token) return null;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 < Date.now()) { localStorage.removeItem(TOKEN_KEY); return null; }
      return { username: payload.username, role: payload.role || 'student', displayName: payload.displayName || payload.username };
    } catch { return null; }
  }

  async function login(username, password) {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) localStorage.setItem(TOKEN_KEY, data.token);
      return data;
    } catch (e) {
      return { success: false, message: 'Network error' };
    }
  }

  function logout() {
    const token = getToken();
    if (token) {
      try { fetch('/api/heartbeat?action=offline', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, keepalive: true }).catch(() => {}); } catch (e) {}
    }
    localStorage.clear();
    location.hash = '#/login';
    render();
  }

  // apiCall throws Error with .offline=true on network failure
  async function apiCall(endpoint, method, body) {
    const url = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(url, {
        method: method || 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new Error('offline');
      err.offline = true;
      throw err;
    }

    if (res.status === 401) {
      const data = await res.json().catch(() => ({}));
      if (data.message && /unauthorized|expired|invalid token/i.test(data.message)) {
        localStorage.removeItem(TOKEN_KEY);
        location.hash = '#/login';
        render();
        const err = new Error(data.message || 'Unauthorized');
        err.auth = true;
        throw err;
      }
    }
    if (res.status === 403) {
      const data = await res.json().catch(() => ({ message: 'Forbidden' }));
      throw new Error(data.message || 'Forbidden');
    }
    if (res.status === 429) {
      const data = await res.json().catch(() => ({ message: 'Too many requests' }));
      throw new Error(data.message || 'Too many requests');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({ message: 'HTTP ' + res.status }));
      throw new Error(data.message || 'HTTP ' + res.status);
    }
    return res.json();
  }

  /* ────────────────────────────────────────────────
   * 3. IndexedDB (statements / images / drafts / meta)
   * ──────────────────────────────────────────────── */
  const DB = (() => {
    const NAME = 'moj-mobile';
    const VER = 1;
    let dbPromise = null;

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, VER);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('statements')) db.createObjectStore('statements', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'url' });
          if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbPromise;
    }

    async function tx(store, mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const req = fn(s);
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    }

    return {
      // statements
      async getStatement(id) { try { return await tx('statements', 'readonly', s => s.get(String(id))); } catch { return null; } },
      async putStatement(obj) { return tx('statements', 'readwrite', s => s.put(obj)); },
      async getAllStatements() { try { return await tx('statements', 'readonly', s => s.getAll()); } catch { return []; } },
      async clearStatements() { return tx('statements', 'readwrite', s => s.clear()); },
      // images
      async getImage(url) { try { const r = await tx('images', 'readonly', s => s.get(url)); return r ? r.blob : null; } catch { return null; } },
      async putImage(url, blob) { return tx('images', 'readwrite', s => s.put({ url, blob, updatedAt: Date.now() })); },
      async countImages() { try { return await tx('images', 'readonly', s => s.count()); } catch { return 0; } },
      async clearImages() { return tx('images', 'readwrite', s => s.clear()); },
      // drafts
      async getDrafts() { try { return await tx('drafts', 'readonly', s => s.getAll()); } catch { return []; } },
      async addDraft(d) { return tx('drafts', 'readwrite', s => s.add(d)); },
      async deleteDraft(id) { return tx('drafts', 'readwrite', s => s.delete(id)); },
      async clearDrafts() { return tx('drafts', 'readwrite', s => s.clear()); },
      // meta
      async getMeta(key) { try { const r = await tx('meta', 'readonly', s => s.get(key)); return r ? r.value : null; } catch { return null; } },
      async setMeta(key, value) { return tx('meta', 'readwrite', s => s.put({ key, value })); },
    };
  })();

  /* ────────────────────────────────────────────────
   * 4. localStorage data caches (lightweight list / states / favorites)
   * ──────────────────────────────────────────────── */
  const LCache = {
    getProblems() { try { return JSON.parse(localStorage.getItem('moj_problemList')); } catch { return null; } },
    setProblems(d) { localStorage.setItem('moj_problemList', JSON.stringify(d)); },
    getStates() { try { return JSON.parse(localStorage.getItem('moj_states')); } catch { return null; } },
    setStates(d) { localStorage.setItem('moj_states', JSON.stringify(d)); },
    getFavorites() { try { return JSON.parse(localStorage.getItem('moj_favorites')); } catch { return null; } },
    setFavorites(d) { localStorage.setItem('moj_favorites', JSON.stringify(d)); },
  };

  // in-memory working set
  const Store = {
    problems: [],      // light list
    allTags: [],
    states: {},
    favorites: new Set(),
    version: null,
  };

  function loadFromLocal() {
    const p = LCache.getProblems();
    if (p && Array.isArray(p.problems)) {
      Store.problems = p.problems;
      Store.allTags = p.allTags || [];
      Store.version = p.version;
    }
    const s = LCache.getStates();
    if (s && s.states) Store.states = s.states;
    const f = LCache.getFavorites();
    if (f && Array.isArray(f.favorites)) Store.favorites = new Set(f.favorites);
  }

  /* ────────────────────────────────────────────────
   * 5. Online / offline
   * ──────────────────────────────────────────────── */
  function isOnline() { return navigator.onLine !== false; }

  function refreshTopbar() {
    $('#offlineBadge').hidden = isOnline();
    updateDraftBadge();
  }

  /* ────────────────────────────────────────────────
   * 6. Data fetch (network-first, cache fallback)
   * ──────────────────────────────────────────────── */
  async function fetchProblemsAll(withStatement) {
    const url = withStatement ? '/api/problem?all=1&withStatement=1' : '/api/problem?all=1';
    return apiCall(url);
  }

  async function fetchPreload() {
    return apiCall('/api/users?action=preload');
  }

  // Refresh problem list + states + favorites
  async function refreshProblemData() {
    const [probs, preload] = await Promise.allSettled([
      fetchProblemsAll(false),
      fetchPreload(),
    ]);
    if (probs.status === 'fulfilled' && probs.value && probs.value.success) {
      const d = probs.value;
      Store.problems = d.problems || [];
      Store.allTags = d.allTags || [];
      Store.version = d.version;
      LCache.setProblems({ problems: Store.problems, allTags: Store.allTags, version: Store.version, updatedAt: Date.now() });
    }
    if (preload.status === 'fulfilled' && preload.value && preload.value.success) {
      Store.states = preload.value.states || {};
      Store.favorites = new Set(preload.value.favorites || []);
      LCache.setStates({ states: Store.states, updatedAt: Date.now() });
      LCache.setFavorites({ favorites: Array.from(Store.favorites), updatedAt: Date.now() });
    }
  }

  // guarantee data is present (fetch if missing), returns bool success
  async function ensureProblemData() {
    if (Store.problems.length === 0) await refreshProblemData();
    return Store.problems.length > 0;
  }

  /* ────────────────────────────────────────────────
   * 7. Bulk cache (statements + images) — Settings feature
   * ──────────────────────────────────────────────── */
  function extractImageUrls(html) {
    if (!html) return [];
    const div = document.createElement('div');
    div.innerHTML = html;
    const urls = [];
    $$('img', div).forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:') && !src.startsWith('blob:')) urls.push(src);
    });
    return Array.from(new Set(urls));
  }

  async function cacheAllProblems(onProgress) {
    if (!isOnline()) { toast('Offline — cannot cache', 'err'); return { ok: false }; }
    const report = p => { if (onProgress) onProgress(p); };

    const data = await fetchProblemsAll(true);
    if (!data || !data.success || !Array.isArray(data.problems)) {
      toast('Failed to fetch problems', 'err');
      return { ok: false };
    }
    const problems = data.problems;
    report({ phase: 'statement', done: 0, total: problems.length });

    let images = new Set();
    for (let i = 0; i < problems.length; i++) {
      const p = problems[i];
      if (p.statement) {
        await DB.putStatement({ id: String(p.id), name: p.name, statement: p.statement, updatedAt: Date.now() });
        extractImageUrls(p.statement).forEach(u => images.add(u));
      }
      report({ phase: 'statement', done: i + 1, total: problems.length });
      if (i % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const urls = Array.from(images);
    report({ phase: 'image', done: 0, total: urls.length });
    let okCount = 0;
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (res.ok) {
          const blob = await res.blob();
          await DB.putImage(url, blob);
          okCount++;
        }
      } catch (e) { /* skip */ }
      report({ phase: 'image', done: i + 1, total: urls.length, ok: okCount });
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }

    await DB.setMeta('lastCacheAt', Date.now());
    return { ok: true, problems: problems.length, images: urls.length, imageOk: okCount };
  }

  /* ────────────────────────────────────────────────
   * 8. Statement rendering (+ cached image rewrite + KaTeX)
   * ──────────────────────────────────────────────── */
  async function renderMath(el) {
    if (!el) return;
    if (typeof renderMathInElement === 'function') {
      try {
        renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '$', right: '$', display: false },
          ],
          throwOnError: false,
          errorColor: '#cc0000',
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
        });
      } catch (e) {}
    }
  }

  async function rewriteImages(container) {
    const imgs = $$('img', container);
    for (const img of imgs) {
      const src = img.getAttribute('src');
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
      const blob = await DB.getImage(src);
      if (blob) img.src = URL.createObjectURL(blob);
    }
  }

  async function renderStatementInto(el, statement) {
    el.innerHTML = statement || '';
    await rewriteImages(el);
    await renderMath(el);
  }

  /* ────────────────────────────────────────────────
   * 9. Router + navigation lock
   * ──────────────────────────────────────────────── */
  const TAB_ROUTES = ['home', 'problems', 'submissions', 'leaderboard', 'contests', 'me'];
  const TAB_LABELS = { home: 'Home', problems: 'Problems', submissions: 'Submissions', leaderboard: 'Leaderboard', contests: 'Contests', me: 'Me' };
  const historyStack = [];

  // ⭐ Navigation lock: block page/tab switching while a view is loading.
  let isLoading = false;

  function parseHash() {
    const h = (location.hash || '#/home').replace(/^#\/?/, '').replace(/\/+$/, '');
    const parts = h.split('/').filter(Boolean);
    if (parts.length === 0) return { name: 'home', params: [] };
    return { name: parts[0], params: parts.slice(1).map(decodeURIComponent) };
  }

  function currentRoute() { return parseHash(); }

  function navigate(hash) {
    if (isLoading) { toast('Loading…'); return; }
    if (!hash.startsWith('#')) hash = '#' + hash;
    if (location.hash === hash) { render(); return; }
    historyStack.length = 0;   // tab switch resets the detail stack
    location.hash = hash;
  }

  function goSubView(hash) {
    if (isLoading) { toast('Loading…'); return; }
    const cur = parseHash();
    const curStr = cur.name + (cur.params.length ? '/' + cur.params.join('/') : '');
    historyStack.push(curStr);
    location.hash = '#' + hash.replace(/^#/, '');
  }

  function parentTabOf(route) {
    switch (route.name) {
      case 'problem': case 'submission': return route.name === 'problem' ? 'problems' : 'submissions';
      case 'user': return 'leaderboard';
      case 'contest': return 'contests';
      case 'settings': return 'me';
      default: return route.name;
    }
  }

  function highlightNav(route) {
    const tab = parentTabOf(route);
    $$('#bottomNav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.route === tab));
    $('#topbarTitle').textContent = routeLabel(route);
  }

  function routeLabel(route) {
    switch (route.name) {
      case 'home': return 'WYK Maths';
      case 'problems': return 'Problems';
      case 'problem': return 'Problem #' + (route.params[0] || '');
      case 'submissions': return 'Submissions';
      case 'submission': return 'Submission';
      case 'leaderboard': return 'Leaderboard';
      case 'user': return (route.params[0] || 'User');
      case 'contests': return 'Contests';
      case 'contest': return 'Contest';
      case 'me': return 'Me';
      case 'settings': return 'Settings';
      case 'login': return 'Sign in';
      default: return 'WYK Maths';
    }
  }

  function isSubView(route) {
    return ['problem', 'submission', 'user', 'contest', 'settings'].includes(route.name);
  }

  function updateBackButton(route) {
    const btn = $('#backBtn');
    btn.hidden = !isSubView(route);
    btn.onclick = () => {
      if (isLoading) { toast('Loading…'); return; }
      if (historyStack.length > 0) {
        const prev = historyStack.pop();
        location.hash = '#' + prev;
      } else {
        location.hash = '#' + parentTabOf(route);
      }
    };
  }

  async function render() {
    const view = $('#view');
    const route = currentRoute();

    // auth gate
    if (!isLoggedIn() && route.name !== 'login') {
      location.hash = '#/login';
      return renderLogin(view);
    }

    highlightNav(route);
    updateBackButton(route);
    refreshTopbar();

    view.innerHTML = '<div class="loading-wrap"><span class="spinner"></span><span>Loading…</span></div>';
    view.scrollTop = 0;

    // ⭐ begin navigation lock — cleared in finally below
    isLoading = true;
    try {
      switch (route.name) {
        case 'home':        await renderHome(view); break;
        case 'problems':    await renderProblems(view); break;
        case 'problem':     await renderProblemDetail(view, route.params[0]); break;
        case 'submissions': await renderSubmissions(view); break;
        case 'submission':  await renderSubmissionDetail(view, route.params[0]); break;
        case 'leaderboard': await renderLeaderboard(view); break;
        case 'user':        await renderUser(view, route.params[0]); break;
        case 'contests':    await renderContests(view); break;
        case 'contest':     await renderContestDetail(view, route.params[0]); break;
        case 'me':          await renderMe(view); break;
        case 'settings':    await renderSettings(view); break;
        case 'login':       await renderLogin(view); break;
        default:            view.innerHTML = '<div class="empty"><i class="fas fa-ghost"></i>Page not found</div>';
      }
    } catch (e) {
      if (e && e.auth) return;
      view.innerHTML = '<div class="empty"><i class="fas fa-triangle-exclamation"></i>' + esc(e.message || 'Failed to load') + '</div>';
    } finally {
      isLoading = false;
    }
  }

  /* ────────────────────────────────────────────────
   * 10. Views
   * ──────────────────────────────────────────────── */

  // ── Login ──
  function renderLogin(view) {
    $('#backBtn').hidden = true;
    $('#topbarTitle').textContent = 'Sign in';
    $$('#bottomNav .nav-item').forEach(b => b.classList.remove('active'));
    view.innerHTML = `
      <div class="login-wrap">
        <div class="login-logo"><i class="fas fa-calculator"></i></div>
        <div class="login-title">WYK Maths Team</div>
        <div class="card">
          <div class="field">
            <label>Username</label>
            <input class="input" id="loginUser" autocomplete="username" placeholder="Username">
          </div>
          <div class="field">
            <label>Password</label>
            <input class="input" id="loginPass" type="password" autocomplete="current-password" placeholder="Password">
          </div>
          <div id="loginErr" class="small" style="color:var(--danger);margin-bottom:10px;display:none"></div>
          <button class="btn btn-block" id="loginBtn">Sign in</button>
        </div>
      </div>`;
    $('#loginBtn').onclick = async () => {
      const u = $('#loginUser').value.trim();
      const p = $('#loginPass').value;
      if (!u || !p) { $('#loginErr').textContent = 'Please enter username and password'; $('#loginErr').style.display = 'block'; return; }
      $('#loginBtn').disabled = true; $('#loginBtn').textContent = 'Signing in…';
      const r = await login(u, p);
      if (r.success) {
        location.hash = '#/home';
        render();
        toast('Welcome back!', 'ok');
      } else {
        $('#loginErr').textContent = r.message || 'Sign in failed';
        $('#loginErr').style.display = 'block';
        $('#loginBtn').disabled = false; $('#loginBtn').textContent = 'Sign in';
      }
    };
  }

  // ── Home ──
  async function renderHome(view) {
    view.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    const user = getCurrentUser();

    // welcome (once)
    let welcome = '';
    if (!localStorage.getItem('moj_welcomed')) {
      localStorage.setItem('moj_welcomed', '1');
      welcome = `<div class="welcome card">
        <div class="hello">Hi, ${esc(user.displayName || user.username)} 👋</div>
        <div class="sub">Welcome to WYK Maths Team Mobile</div>
      </div>`;
    } else {
      welcome = `<div class="welcome card">
        <div class="hello">${esc(user.displayName || user.username)}</div>
        <div class="sub">${esc(user.username)}</div>
      </div>`;
    }

    view.innerHTML = welcome + `<div class="stat-grid">
      <div class="stat-card"><div class="num" id="stSolved">…</div><div class="lbl">Solved</div></div>
      <div class="stat-card"><div class="num" id="stRank">…</div><div class="lbl">Rank</div></div>
      <div class="stat-card"><div class="num" id="stRating">…</div><div class="lbl">Rating</div></div>
      <div class="stat-card"><div class="num" id="stTotal">…</div><div class="lbl">Problems</div></div>
    </div>
    <div class="card mt8">
      <div class="card-title">Progress</div>
      <div class="progress"><div id="stProgress" style="width:0%"></div></div>
      <div class="small muted mt8" id="stProgressText">Loading…</div>
    </div>
    <div class="card mt8" id="draftSummaryCard" style="display:none">
      <div class="card-title"><i class="fas fa-inbox"></i> Drafts</div>
      <div class="small muted" id="draftSummaryText"></div>
      <button class="btn btn-secondary btn-sm mt8" id="syncNowBtn"><i class="fas fa-cloud-arrow-up"></i> Sync now</button>
    </div>`;

    const me = user.username;
    try {
      const [prof, lb] = await Promise.allSettled([
        apiCall('/api/users?action=profile&username=' + encodeURIComponent(me)),
        apiCall('/api/users?action=leaderboard'),
      ]);
      if (prof.status === 'fulfilled' && prof.value && prof.value.success) {
        const d = prof.value;
        $('#stSolved').textContent = d.totalPassed;
        $('#stTotal').textContent = d.totalProblems;
        $('#stRating').textContent = (d.rating ?? '—');
        const pct = d.totalProblems ? Math.round(d.totalPassed / d.totalProblems * 100) : 0;
        $('#stProgress').style.width = pct + '%';
        $('#stProgressText').textContent = `${d.totalPassed} / ${d.totalProblems} (${pct}%)`;
      }
      if (lb.status === 'fulfilled' && lb.value && lb.value.success) {
        const entry = (lb.value.leaderboard || []).find(e => e.username === me);
        if (entry) $('#stRank').textContent = '#' + entry.rank;
        else $('#stRank').textContent = '—';
      }
    } catch (e) { /* offline: leave placeholders */ }

    updateDraftSummary();
  }

  async function updateDraftSummary() {
    const drafts = await DB.getDrafts();
    const card = $('#draftSummaryCard');
    const text = $('#draftSummaryText');
    if (card) {
      card.style.display = drafts.length ? 'block' : 'none';
      if (text && drafts.length) text.textContent = `${drafts.length} submission(s) pending (auto-submit when online)`;
    }
    const btn = $('#syncNowBtn');
    if (btn) btn.onclick = () => syncDrafts(true);
  }

  // ── Problems list ──
  async function renderProblems(view) {
    await ensureProblemData();
    const problems = Store.problems;

    // client filter state (persisted)
    let activeTags = new Set();
    try { activeTags = new Set(JSON.parse(localStorage.getItem('moj_activeTags') || '[]')); } catch {}

    const tagCounts = {};
    problems.forEach(p => (p.tags || []).forEach(t => tagCounts[t] = (tagCounts[t] || 0) + 1));
    const sortedTags = Object.keys(tagCounts).sort();

    let page = 1;
    const pageSize = 30;

    function filtered() {
      let list = problems.slice();
      if (activeTags.size) {
        const arr = Array.from(activeTags);
        list = list.filter(p => arr.every(t => (p.tags || []).includes(t)));
      }
      return list;
    }

    view.innerHTML = `
      <div class="row" style="margin-bottom:10px">
        <button class="btn btn-secondary btn-sm" id="tagsBtn"><i class="fas fa-tag"></i> Tags${activeTags.size ? ' (' + activeTags.size + ')' : ''}</button>
        <div class="grow"></div>
        <button class="btn btn-sm" id="refreshBtn"><i class="fas fa-sync-alt"></i></button>
      </div>
      <div id="activeTagsRow" style="margin-bottom:10px">${renderActiveTags(activeTags)}</div>
      <div id="problemList"></div>
      <div id="problemPager" class="row" style="justify-content:center;gap:8px;margin-top:10px"></div>`;

    function renderActiveTags(tags) {
      if (!tags.size) return '';
      return Array.from(tags).map(t => `<span class="tag active">${esc(t)} <i class="fas fa-xmark" data-rm="${esc(t)}" style="cursor:pointer"></i></span>`).join(' ');
    }

    function renderList() {
      const list = filtered();
      const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
      if (page > totalPages) page = totalPages;
      const pageList = list.slice((page - 1) * pageSize, page * pageSize);

      const el = $('#problemList');
      if (!pageList.length) {
        el.innerHTML = '<div class="empty"><i class="fas fa-inbox"></i>No problems</div>';
        $('#problemPager').innerHTML = '';
        return;
      }
      el.innerHTML = pageList.map(p => {
        const state = Store.states[p.id] || 'not_started';
        const isFav = Store.favorites.has(p.id);
        const d = diffColor(p.difficulty);
        const stateIcon = state === 'passed' ? '<i class="fas fa-check-circle" style="color:var(--success)"></i>'
          : state === 'failed' ? '<i class="fas fa-times-circle" style="color:var(--danger)"></i>' : '';
        return `<div class="problem-card" data-id="${esc(p.id)}">
          <span class="problem-id">${esc(p.id)}</span>
          <div class="grow" style="min-width:0">
            <div class="problem-name">${esc(p.name)} ${stateIcon}</div>
            <div>${(p.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
          </div>
          <div class="problem-meta">
            <span class="${d.cls}" style="${d.style}">${d.label}</span>
            <span class="small muted">${p.solves || 0} solves</span>
            <span class="fav ${isFav ? 'on' : ''}" data-fav="${esc(p.id)}"><i class="${isFav ? 'fas' : 'far'} fa-star"></i></span>
          </div>
        </div>`;
      }).join('');

      $$('#problemList .problem-card').forEach(card => {
        card.addEventListener('click', e => {
          if (e.target.closest('[data-fav]')) return;
          goSubView('problem/' + encodeURIComponent(card.dataset.id));
        });
      });
      $$('#problemList [data-fav]').forEach(f => {
        f.addEventListener('click', async e => {
          e.stopPropagation();
          await toggleFavorite(f.dataset.fav, f);
        });
      });

      // pagination
      const pager = $('#problemPager');
      if (totalPages > 1) {
        pager.innerHTML = `
          <button class="btn btn-secondary btn-sm" id="pgPrev" ${page <= 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
          <span class="small muted">${page} / ${totalPages}</span>
          <button class="btn btn-secondary btn-sm" id="pgNext" ${page >= totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>`;
        $('#pgPrev').onclick = () => { if (page > 1) { page--; renderList(); view.scrollTop = 0; } };
        $('#pgNext').onclick = () => { if (page < totalPages) { page++; renderList(); view.scrollTop = 0; } };
      } else {
        pager.innerHTML = '';
      }
    }

    function bindTagRemoval() {
      $$('#activeTagsRow [data-rm]').forEach(rm => {
        rm.addEventListener('click', () => {
          activeTags.delete(rm.dataset.rm);
          localStorage.setItem('moj_activeTags', JSON.stringify(Array.from(activeTags)));
          page = 1;
          renderProblems(view);
        });
      });
    }

    renderList();
    bindTagRemoval();

    $('#refreshBtn').onclick = async () => {
      $('#refreshBtn').disabled = true;
      await refreshProblemData();
      renderProblems(view);
    };
    $('#tagsBtn').onclick = () => openTagModal(activeTags, sortedTags, tagCounts, () => renderProblems(view));
  }

  function openTagModal(activeTags, sortedTags, tagCounts, onDone) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">
      <h3><i class="fas fa-tag"></i> Select tags</h3>
      <div id="tagList" style="max-height:50vh;overflow-y:auto"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" id="tagClear">Clear</button>
        <button class="btn btn-sm" id="tagDone">Done</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const list = $('#tagList', overlay);
    list.innerHTML = sortedTags.map(t => {
      const on = activeTags.has(t);
      return `<div class="setting-row" data-tag="${esc(t)}">
        <div class="tt"><span class="lbl">${esc(t)}</span><span class="dsc">${tagCounts[t] || 0} problems</span></div>
        <i class="fas ${on ? 'fa-check-circle' : 'fa-circle'}" style="color:${on ? 'var(--accent)' : 'var(--text-3)'}"></i>
      </div>`;
    }).join('') || '<div class="empty">No tags</div>';
    $$('#tagList [data-tag]', overlay).forEach(row => {
      row.addEventListener('click', () => {
        const t = row.dataset.tag;
        if (activeTags.has(t)) activeTags.delete(t); else activeTags.add(t);
        localStorage.setItem('moj_activeTags', JSON.stringify(Array.from(activeTags)));
        overlay.remove();
        onDone();
      });
    });
    $('#tagClear', overlay).onclick = () => { activeTags.clear(); localStorage.setItem('moj_activeTags', '[]'); overlay.remove(); onDone(); };
    $('#tagDone', overlay).onclick = () => { overlay.remove(); onDone(); };
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  async function toggleFavorite(pid, el) {
    const wasFav = Store.favorites.has(pid);
    if (wasFav) Store.favorites.delete(pid); else Store.favorites.add(pid);
    LCache.setFavorites({ favorites: Array.from(Store.favorites), updatedAt: Date.now() });
    if (el) {
      el.classList.toggle('on', !wasFav);
      el.innerHTML = `<i class="${!wasFav ? 'fas' : 'far'} fa-star"></i>`;
    }
    if (!isOnline()) { toast('Offline: favorite will sync when online', 'warn'); return; }
    try {
      const res = await apiCall('/api/users?action=favorite', 'POST', { problemId: pid });
      if (res.success) {
        Store.favorites = new Set(res.favorites);
        LCache.setFavorites({ favorites: Array.from(Store.favorites), updatedAt: Date.now() });
      }
    } catch (e) { /* keep optimistic state */ }
  }

  // ── Problem detail ──
  async function renderProblemDetail(view, pid) {
    if (!pid) { view.innerHTML = '<div class="empty">Invalid problem</div>'; return; }

    let problem = null, state = 'not_started', favorited = false;
    const cached = await DB.getStatement(pid);
    if (cached) {
      problem = { id: pid, name: cached.name, statement: cached.statement, difficulty: 0, tags: [], FS: false };
    }

    view.innerHTML = `
      <div class="detail-header">
        <div class="nm" id="pdName">${esc(pid)}</div>
        <span id="pdStateIcon"></span>
        <span id="pdDiff" class="small muted"></span>
        <span id="pdFav" style="font-size:1.2rem;color:#aaa;padding:4px"><i class="far fa-star"></i></span>
      </div>
      <div class="wb" id="pdWorkbench"></div>
      <div class="card statement-content" id="pdStatement"><div class="loading-wrap"><span class="spinner"></span></div></div>
      <div class="card" id="pdActions"></div>`;

    const stmtEl = $('#pdStatement');
    if (problem && cached) {
      $('#pdName').textContent = pid + ' - ' + (cached.name || '');
      await renderStatementInto(stmtEl, cached.statement);
    }

    // fetch authoritative data
    try {
      const data = await apiCall('/api/problem?action=page&id=' + encodeURIComponent(pid));
      if (!data || !data.success || !data.problem) {
        if (!problem) { view.innerHTML = '<div class="empty"><i class="fas fa-lock"></i>Problem not found or access denied</div>'; return; }
      } else {
        problem = data.problem;
        state = data.state || 'not_started';
        favorited = !!data.favorited;
        $('#pdName').textContent = pid + ' - ' + (problem.name || '');
        $('#pdDiff').textContent = 'Lv.' + (problem.difficulty === 0 ? '∞' : (problem.difficulty || 0).toFixed(2));
        if ((problem.tags || []).length) {
          const tagsEl = document.createElement('span');
          tagsEl.className = 'small muted';
          tagsEl.textContent = (problem.tags || []).join(', ');
          $('#pdDiff').after(tagsEl);
        }
        await renderStatementInto(stmtEl, problem.statement);
        await DB.putStatement({ id: String(pid), name: problem.name, statement: problem.statement, updatedAt: Date.now() });
      }
    } catch (e) {
      if (problem) { /* offline: use cache */ }
      else { view.innerHTML = '<div class="empty"><i class="fas fa-cloud-slash"></i>Offline and not cached</div>'; return; }
    }

    // state / fav icons
    $('#pdStateIcon').innerHTML = state === 'passed' ? '<i class="fas fa-check-circle" style="color:var(--success)"></i>'
      : state === 'failed' ? '<i class="fas fa-times-circle" style="color:var(--danger)"></i>' : '';
    const favEl = $('#pdFav');
    favEl.innerHTML = `<i class="${favorited ? 'fas' : 'far'} fa-star"></i>`;
    favEl.style.color = favorited ? '#f1c40f' : '#aaa';
    favEl.onclick = async () => {
      favorited = !favorited;
      favEl.innerHTML = `<i class="${favorited ? 'fas' : 'far'} fa-star"></i>`;
      favEl.style.color = favorited ? '#f1c40f' : '#aaa';
      await toggleFavorite(pid, null);
    };

    renderWorkbench(problem);
    renderProblemActions(problem);
  }

  function renderWorkbench(problem) {
    const el = $('#pdWorkbench');
    const fsForced = problem.FS === true;
    el.innerHTML = `
      <div class="wb-tabs">
        <button class="wb-tab" data-mode="text" ${fsForced ? 'disabled' : ''}><i class="fas fa-keyboard"></i>Text</button>
        <button class="wb-tab" data-mode="photo"><i class="fas fa-camera"></i>Image</button>
        <button class="wb-tab" data-mode="steps"><i class="fas fa-wand-magic-sparkles"></i>AI Steps</button>
      </div>
      <div id="wbPane" style="margin-bottom:8px"></div>
      <div class="wb-status" id="wbStatus"></div>
      <div class="wb-footer">
        <button class="btn" id="wbSubmit"><i class="fas fa-paper-plane"></i> Submit</button>
      </div>`;

    let mode = fsForced ? 'steps' : 'text';
    let imageData = '';

    const savedAnswer = (() => { try { return JSON.parse(localStorage.getItem('pd_user_answers') || '{}')[problem.id] || ''; } catch { return ''; } })();

    function setMode(m) {
      mode = m;
      $$('#pdWorkbench .wb-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === m));
      const pane = $('#wbPane');
      if (m === 'text') {
        pane.innerHTML = `<input class="input" id="answerInput" inputmode="decimal" autocomplete="off" placeholder="Enter answer" value="${esc(savedAnswer)}">`;
        const inp = $('#answerInput');
        inp.addEventListener('input', () => {
          const o = (() => { try { return JSON.parse(localStorage.getItem('pd_user_answers') || '{}'); } catch { return {}; } })();
          o[problem.id] = inp.value; localStorage.setItem('pd_user_answers', JSON.stringify(o));
        });
      } else if (m === 'photo') {
        pane.innerHTML = `<div class="dropzone" id="wbDropzone"><input type="file" id="imageFileInput" accept="image/*" hidden><i class="fas fa-cloud-arrow-up"></i><div class="small">Tap to upload image</div></div>
          <div class="photo-preview" id="wbPhotoPreview" hidden><img id="imagePreview"><div class="row mt8">
            <button class="btn btn-secondary btn-sm" id="wbRetake"><i class="fas fa-rotate"></i> Replace</button>
            <button class="btn btn-secondary btn-sm" id="wbRemoveImage"><i class="fas fa-trash"></i> Remove</button>
          </div></div>`;
        bindImageInput();
      } else {
        pane.innerHTML = `<textarea class="input" id="stepsInput" rows="8" maxlength="10000" placeholder="Write your solution steps (AI-graded)"></textarea>
          <div class="counter"><span id="stepsCount">0</span> / 10000</div>`;
        $('#stepsInput').addEventListener('input', () => $('#stepsCount').textContent = $('#stepsInput').value.length);
      }
    }

    function bindImageInput() {
      const dz = $('#wbDropzone'); const fi = $('#imageFileInput');
      const preview = $('#wbPhotoPreview'); const img = $('#imagePreview');
      function accept(file) {
        if (!file) return;
        if (!file.type.startsWith('image/')) { toast('Please select an image', 'err'); return; }
        if (file.size > 5 * 1024 * 1024) { toast('Image too large (max 5MB)', 'err'); return; }
        const reader = new FileReader();
        reader.onload = e => {
          const im = new Image();
          im.onload = () => {
            const maxW = 1600; let w = im.width, h = im.height;
            if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            c.getContext('2d').drawImage(im, 0, 0, w, h);
            imageData = c.toDataURL('image/jpeg', 0.88);
            img.src = imageData; dz.hidden = true; preview.hidden = false;
          };
          im.src = e.target.result;
        };
        reader.readAsDataURL(file);
      }
      dz.onclick = () => fi.click();
      fi.onchange = () => { accept(fi.files[0]); fi.value = ''; };
      $('#wbRetake').onclick = () => fi.click();
      $('#wbRemoveImage').onclick = () => { imageData = ''; img.src = ''; preview.hidden = true; dz.hidden = false; };
    }

    setMode(mode);
    $$('#pdWorkbench .wb-tab').forEach(t => t.addEventListener('click', () => { if (!t.disabled) setMode(t.dataset.mode); }));

    const statusEl = $('#wbStatus');
    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = 'wb-status' + (cls ? ' ' + cls : ''); }

    $('#wbSubmit').onclick = async () => {
      const btn = $('#wbSubmit');
      btn.disabled = true;
      if (mode === 'text') {
        const answer = $('#answerInput').value.trim();
        if (!answer) { setStatus('Please enter an answer', 'err'); btn.disabled = false; return; }
        setStatus(isOnline() ? 'Submitting…' : 'Offline — saving to drafts…', 'busy');
        const r = await submitOne({ problemId: problem.id, answer, type: 'text', image: '' });
        handleSubmitResult(r, setStatus);
      } else if (mode === 'photo') {
        if (!imageData) { setStatus('Please upload an image first', 'err'); btn.disabled = false; return; }
        setStatus(isOnline() ? 'Uploading…' : 'Offline — saving to drafts…', 'busy');
        const r = await submitOne({ problemId: problem.id, answer: '', type: 'image', image: imageData });
        handleSubmitResult(r, setStatus);
      } else {
        const steps = $('#stepsInput').value.trim();
        if (!steps) { setStatus('Please enter steps', 'err'); btn.disabled = false; return; }
        setStatus(isOnline() ? 'Submitting to AI…' : 'Offline — saving to drafts…', 'busy');
        const r = await submitSteps(problem.id, steps);
        handleSubmitResult(r, setStatus);
      }
      btn.disabled = false;
    };
  }

  function handleSubmitResult(r, setStatus) {
    if (r.drafted) {
      setStatus('Saved to drafts — will submit when online', 'ok');
      toast('Saved to drafts', 'ok');
      updateDraftBadge();
      return;
    }
    if (!r.success) { setStatus(r.message || 'Submission failed', 'err'); return; }
    if (r.correct || r.score === 100) {
      setStatus('Accepted ✅', 'ok');
    } else if (r.score === 0 || r.correct === false) {
      setStatus('Wrong Answer ❌', 'err');
    } else if (r.score !== undefined) {
      setStatus('Partial (' + r.score + ')', 'ok');
    } else if (r.systemError) {
      setStatus('System Error', 'err');
    } else {
      setStatus('Submitted', 'ok');
    }
    toast('Submitted', 'ok');
  }

  async function submitOne(payload) {
    // offline → draft
    if (!isOnline()) {
      await DB.addDraft({ problemId: payload.problemId, answer: payload.answer, type: payload.type, image: payload.image, createdAt: Date.now() });
      updateDraftBadge();
      return { drafted: true };
    }
    try {
      const res = await apiCall('/api/submit', 'POST', { ...payload, pageDwellMs: 0 });
      return res;
    } catch (e) {
      if (e.offline) {
        await DB.addDraft({ problemId: payload.problemId, answer: payload.answer, type: payload.type, image: payload.image, createdAt: Date.now() });
        updateDraftBadge();
        return { drafted: true };
      }
      return { success: false, message: e.message };
    }
  }

  async function submitSteps(pid, steps) {
    if (!isOnline()) {
      await DB.addDraft({ problemId: pid, answer: steps, type: 'steps', image: '', createdAt: Date.now() });
      updateDraftBadge();
      return { drafted: true };
    }
    try {
      const res = await apiCall('/api/steps-grade', 'POST', { problemId: pid, steps });
      if (res && res.taskId) return { success: true, message: 'AI grading…', pending: true };
      return { success: false, message: res.message || 'Submission failed' };
    } catch (e) {
      if (e.offline) {
        await DB.addDraft({ problemId: pid, answer: steps, type: 'steps', image: '', createdAt: Date.now() });
        updateDraftBadge();
        return { drafted: true };
      }
      return { success: false, message: e.message };
    }
  }

  function renderProblemActions(problem) {
    const el = $('#pdActions');
    el.innerHTML = `
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <button class="btn btn-secondary btn-sm" id="similarBtn"><i class="fas fa-layer-group"></i> Similar</button>
        <button class="btn btn-secondary btn-sm" id="discussBtn"><i class="fas fa-comments"></i> Discussion</button>
        <button class="btn btn-secondary btn-sm" id="reportBtn" style="color:var(--danger)"><i class="fas fa-flag"></i> Report</button>
      </div>
      <div id="similarWrap" style="display:none;margin-top:10px"></div>
      <div id="discussWrap" style="display:none;margin-top:10px"></div>`;

    $('#similarBtn').onclick = async () => {
      const wrap = $('#similarWrap');
      if (wrap.style.display !== 'none') { wrap.style.display = 'none'; return; }
      wrap.style.display = 'block';
      wrap.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
      try {
        const d = await apiCall('/api/problem?action=similar&id=' + encodeURIComponent(problem.id));
        const sim = (d.similar || []);
        wrap.innerHTML = sim.length
          ? sim.map(s => `<div class="problem-card" data-id="${esc(s.id)}"><span class="problem-id">${esc(s.id)}</span><div class="grow"><div class="problem-name">${esc(s.name)}</div></div><span class="diff" style="${diffColor(s.difficulty).style}">${diffColor(s.difficulty).label}</span></div>`).join('')
          : '<div class="empty">No similar problems</div>';
        $$('#similarWrap .problem-card').forEach(c => c.onclick = () => goSubView('problem/' + encodeURIComponent(c.dataset.id)));
      } catch (e) { wrap.innerHTML = '<div class="empty">Failed to load</div>'; }
    };

    $('#discussBtn').onclick = async () => {
      const wrap = $('#discussWrap');
      if (wrap.style.display !== 'none') { wrap.style.display = 'none'; return; }
      wrap.style.display = 'block';
      wrap.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
      await loadDiscussions(wrap, problem.id);
    };

    $('#reportBtn').onclick = () => openReportModal(problem.id);
  }

  async function loadDiscussions(wrap, pid) {
    try {
      const d = await apiCall('/api/problem?action=discussions&problemId=' + encodeURIComponent(pid));
      const discs = d.discussions || [];
      wrap.innerHTML = `
        <div class="card-title">Discussion</div>
        <div id="discList"></div>
        <div class="field mt8">
          <textarea class="input" id="discContent" rows="3" placeholder="Write a comment… (LaTeX supported)"></textarea>
        </div>
        <button class="btn btn-sm" id="discPost">Post</button>`;
      const list = $('#discList');
      list.innerHTML = discs.length ? discs.map(x => `
        <div class="disc">
          <div class="head">${esc(x.username)} · ${timeAgo(x.createdAt)}</div>
          <div class="body" data-latex>${esc(x.content)}</div>
          <div class="like ${x.liked ? 'on' : ''}" data-id="${esc(x._id)}"><i class="${x.liked ? 'fas' : 'far'} fa-heart"></i> ${x.likes || 0}</div>
        </div>`).join('') : '<div class="empty">No discussion yet</div>';
      $$('#discList .body').forEach(b => renderMath(b));
      $$('#discList .like').forEach(l => l.onclick = async () => {
        try {
          await apiCall('/api/problem?action=discussions', 'PUT', { discussionId: l.dataset.id });
          loadDiscussions(wrap, pid);
        } catch (e) { toast('Action failed', 'err'); }
      });
      $('#discPost').onclick = async () => {
        const c = $('#discContent').value.trim();
        if (!c) return;
        try {
          await apiCall('/api/problem?action=discussions', 'POST', { problemId: pid, content: c });
          $('#discContent').value = '';
          loadDiscussions(wrap, pid);
          toast('Posted', 'ok');
        } catch (e) { toast(e.message || 'Failed to post', 'err'); }
      };
    } catch (e) {
      wrap.innerHTML = '<div class="empty">Failed to load discussion (you may need to solve this first)</div>';
    }
  }

  function openReportModal(pid) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal">
      <h3>Report problem</h3>
      <p class="small muted">Describe the issue. Your username will be recorded.</p>
      <textarea class="input" id="reportReason" rows="4" maxlength="1000" placeholder="e.g. wrong statement, wrong answer, broken image…"></textarea>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" id="reportCancel">Cancel</button>
        <button class="btn btn-sm" id="reportSubmit">Submit</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    $('#reportCancel', overlay).onclick = () => overlay.remove();
    $('#reportSubmit', overlay).onclick = async () => {
      const reason = $('#reportReason', overlay).value.trim();
      if (!reason) { toast('Please enter a reason', 'err'); return; }
      try {
        await apiCall('/api/problem?action=report', 'POST', { problemId: pid, reason });
        overlay.remove(); toast('Report submitted', 'ok');
      } catch (e) { toast(e.message || 'Failed to report', 'err'); }
    };
  }

  // ── Submissions list ──
  async function renderSubmissions(view) {
    const state = {
      user: '', problem: '', result: '', page: 1, limit: 30,
    };
    const me = getCurrentUser().username;

    view.innerHTML = `
      <div class="card">
        <div class="field"><label>By user</label>
          <div class="row"><input class="input grow" id="fUser" placeholder="Username"><button class="btn btn-secondary btn-sm" id="fUserSelf">Me</button></div>
        </div>
        <div class="field"><label>By problem</label><input class="input" id="fProblem" placeholder="Problem ID"></div>
        <div class="field"><label>Result</label>
          <select class="input" id="fResult">
            <option value="">All</option>
            <option value="accepted">Accepted</option>
            <option value="wrong">Wrong Answer</option>
            <option value="partial">Partial</option>
            <option value="pending">Pending</option>
            <option value="system">System Error</option>
          </select>
        </div>
        <button class="btn btn-block" id="fApply">Apply filters</button>
      </div>
      <div id="subList"></div>
      <div id="subMore" class="center mt8"></div>`;

    async function load(reset) {
      if (reset) { state.page = 1; $('#subList').innerHTML = ''; }
      const params = new URLSearchParams({ all: '1', page: state.page, limit: state.limit, includeHeader: '1' });
      if (state.user) params.set('user', state.user);
      if (state.problem) params.set('problem', state.problem);
      if (state.result) params.set('result', state.result);
      try {
        const d = await apiCall('/api/submissions?' + params.toString());
        const subs = d.submissions || [];
        if (reset) $('#subList').innerHTML = '';
        if (!subs.length && state.page === 1) { $('#subList').innerHTML = '<div class="empty"><i class="fas fa-inbox"></i>No submissions</div>'; $('#subMore').innerHTML = ''; return; }
        $('#subList').insertAdjacentHTML('beforeend', subs.map(s => {
          const st = statusOf(s);
          return `<div class="sub-card" data-subid="${esc(s.subid)}">
            <div class="sub-main">
              <div class="sub-id">#${esc(s.subid)} <span class="badge ${st.cls}">${esc(st.text)}</span></div>
              <div class="sub-info"><span data-user="${esc(s.username)}">${esc(s.displayName || s.username)}</span> · <span data-prob="${esc(s.problemId)}">${esc(s.problemId)} ${esc(s.problemName || '')}</span></div>
              <div class="sub-info">${formatTime(s.timestamp, true)}</div>
            </div>
            <i class="fas fa-chevron-right" style="color:var(--text-3)"></i>
          </div>`;
        }).join(''));
        $('#subMore').innerHTML = d.hasMore ? '<button class="btn btn-secondary btn-sm" id="loadMoreBtn">Load more</button>' : (subs.length ? '<span class="small muted">End of list</span>' : '');
        if ($('#loadMoreBtn')) $('#loadMoreBtn').onclick = () => { state.page++; load(false); };

        $$('#subList [data-user]').forEach(e => e.addEventListener('click', ev => { ev.stopPropagation(); goSubView('user/' + encodeURIComponent(e.dataset.user)); }));
        $$('#subList [data-prob]').forEach(e => e.addEventListener('click', ev => { ev.stopPropagation(); goSubView('problem/' + encodeURIComponent(e.dataset.prob)); }));
        $$('#subList .sub-card').forEach(c => c.addEventListener('click', () => goSubView('submission/' + encodeURIComponent(c.dataset.subid))));
      } catch (e) {
        $('#subList').innerHTML = '<div class="empty"><i class="fas fa-cloud-slash"></i>' + (e.offline ? 'Offline — cannot load submissions' : esc(e.message)) + '</div>';
      }
    }

    $('#fApply').onclick = () => {
      state.user = $('#fUser').value.trim();
      state.problem = $('#fProblem').value.trim();
      state.result = $('#fResult').value;
      load(true);
    };
    $('#fUserSelf').onclick = () => { $('#fUser').value = me; };
    await load(true);
  }

  // ── Submission detail ──
  async function renderSubmissionDetail(view, subid) {
    if (!subid) { view.innerHTML = '<div class="empty">Invalid submission</div>'; return; }
    view.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    try {
      const d = await apiCall('/api/submissions?action=detail&subid=' + encodeURIComponent(subid));
      const s = d.submission;
      const st = statusOf(s);
      let answerHtml = '';
      if (s.type === 'image' && s.image) answerHtml = `<img src="${esc(s.image)}" style="max-width:100%;border-radius:8px">`;
      else if (s.answerHidden) answerHtml = '<div class="answer-text muted"><i class="fas fa-lock"></i> Answer hidden</div>';
      else answerHtml = `<div class="answer-text"><b>Answer:</b> ${esc(String(s.answer ?? 'none'))}</div>`;

      let commentHtml = s.commentHidden ? '<span class="muted"><i class="fas fa-lock"></i> Comment hidden</span>'
        : (s.comment ? esc(s.comment).replace(/\n/g, '<br>') : '<span class="muted">No comment yet</span>');

      view.innerHTML = `
        <div class="card">
          <div class="row" style="margin-bottom:8px">
            <div class="grow sub-id">Submission #${esc(s.subid)}</div>
            <span class="badge ${st.cls}">${esc(st.text)}</span>
          </div>
          <div class="meta-item"><span class="k">User</span><span class="v" data-user="${esc(s.username)}">${esc(s.username)}</span></div>
          <div class="meta-item"><span class="k">Problem</span><span class="v" data-prob="${esc(s.problemId)}">${esc(s.problemId)} - ${esc(d.problemName)}</span></div>
          <div class="meta-item"><span class="k">Submitted</span><span class="v">${formatDate(s.timestamp)}</span></div>
          <div class="meta-item"><span class="k">Total attempts</span><span class="v">${d.attempts}</span></div>
        </div>
        <div class="card" id="subAnswer">${answerHtml}</div>
        <div class="card"><div class="card-title">Teacher's comment</div><div id="subComment">${commentHtml}</div></div>`;

      renderMath($('#subComment'));
      const uEl = $('#view [data-user]'); const pEl = $('#view [data-prob]');
      if (uEl) uEl.onclick = () => goSubView('user/' + encodeURIComponent(s.username));
      if (pEl) pEl.onclick = () => goSubView('problem/' + encodeURIComponent(s.problemId));
    } catch (e) {
      view.innerHTML = '<div class="empty"><i class="fas fa-triangle-exclamation"></i>' + (e.offline ? 'Offline — cannot load details' : 'Submission not found or access denied') + '</div>';
    }
  }

  // ── Leaderboard ──
  async function renderLeaderboard(view) {
    view.innerHTML = `
      <div class="seg" style="margin-bottom:10px">
        <button data-period="overall" class="active">Overall</button>
        <button data-period="monthly">Monthly</button>
        <button data-period="weekly">Weekly</button>
        <button data-period="daily">Daily</button>
      </div>
      <div id="lbList"></div>`;

    let period = 'overall';
    async function load() {
      $('#lbList').innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
      const url = '/api/users?action=leaderboard' + (period !== 'overall' ? '&period=' + period : '');
      try {
        const d = await apiCall(url);
        const list = (d.leaderboard || []).filter(e => e.solves > 0);
        const me = getCurrentUser().username;
        $('#lbList').innerHTML = list.length ? list.map(e => {
          const isMe = e.username === me;
          const hasRating = typeof e.rating === 'number';
          return `<div class="lb-row ${isMe ? 'mine' : ''}" data-user="${esc(e.username)}">
            <span class="lb-rank ${e.rank <= 3 ? 'top' + e.rank : ''}">${e.rank}</span>
            ${avatarHtml(e, 34)}
            <div class="lb-main">
              <div class="lb-name">${esc(e.username)} - ${esc(e.displayName || e.username)}</div>
              <div class="lb-sub">${period === 'overall' && hasRating ? ratingBadge(e.rating, e.tierColor) + ' · ' : ''}${e.online ? '<span style="color:var(--success)">Online</span>' : ''}</div>
            </div>
            <span class="lb-metric">${e.solves}</span>
          </div>`;
        }).join('') : '<div class="empty"><i class="fas fa-ranking-star"></i>No data</div>';
        $$('#lbList .lb-row').forEach(r => r.onclick = () => goSubView('user/' + encodeURIComponent(r.dataset.user)));
      } catch (e) {
        $('#lbList').innerHTML = '<div class="empty"><i class="fas fa-cloud-slash"></i>' + (e.offline ? 'Offline — cannot load' : esc(e.message)) + '</div>';
      }
    }
    $$('#view .seg button').forEach(b => b.onclick = () => {
      if (b.dataset.period === period) return;
      period = b.dataset.period;
      $$('#view .seg button').forEach(x => x.classList.toggle('active', x === b));
      load();
    });
    await load();
  }

  function avatarHtml(entry, size) {
    const url = entry.pfp || '';
    if (url) return `<span class="avatar" style="width:${size}px;height:${size}px"><img src="${esc(url)}" loading="lazy"></span>`;
    const initial = (entry.displayName || entry.username || '?').charAt(0).toUpperCase();
    return `<span class="avatar" style="width:${size}px;height:${size}px">${esc(initial)}</span>`;
  }
  function ratingBadge(rating, color) {
    const c = color || '#337ab7';
    return `<span class="badge" style="background:${esc(c)};color:#fff;border-color:transparent">${Math.round(rating)}</span>`;
  }

  // ── User profile ──
  async function renderUser(view, username) {
    if (!username) { view.innerHTML = '<div class="empty">Invalid user</div>'; return; }
    view.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    try {
      const d = await apiCall('/api/users?action=profile&username=' + encodeURIComponent(username));
      const pct = d.totalProblems ? Math.round(d.totalPassed / d.totalProblems * 100) : 0;
      const attempted = d.attempted || [];
      const passed = attempted.filter(a => a.state === 'passed').map(a => a.id);
      const failed = attempted.filter(a => a.state === 'failed').map(a => a.id);

      view.innerHTML = `
        <div class="card center">
          ${avatarHtml(d, 72)}
          <div class="hello" style="font-size:1.2rem;margin-top:8px">${esc(d.displayName || username)}</div>
          <div class="sub muted">@${esc(username)}${d.realName ? ' · ' + esc(d.realName) : ''}</div>
          <div class="row" style="justify-content:center;gap:6px;margin-top:8px">
            ${ratingBadge(d.rating, d.tierColor)}
            ${d.online ? '<span class="badge status-accepted">Online</span>' : '<span class="badge status-pending">Offline</span>'}
          </div>
        </div>
        <div class="stat-grid">
          <div class="stat-card"><div class="num">${d.totalPassed}</div><div class="lbl">Solved</div></div>
          <div class="stat-card"><div class="num">${d.totalProblems}</div><div class="lbl">Total</div></div>
          <div class="stat-card"><div class="num">${Math.round(d.rating || 0)}</div><div class="lbl">Rating</div></div>
          <div class="stat-card"><div class="num">${d.maxDifficulty || 0}</div><div class="lbl">Max difficulty</div></div>
        </div>
        <div class="card mt8">
          <div class="card-title">Progress</div>
          <div class="progress"><div style="width:${pct}%;background:var(--accent)"></div></div>
          <div class="small muted mt8">${d.totalPassed} / ${d.totalProblems} (${pct}%)</div>
        </div>
        <div class="card mt8">
          <div class="card-title">Solved (${passed.length})</div>
          <div>${passed.length ? passed.slice(0, 200).map(id => `<span class="tag" style="cursor:pointer" data-prob="${esc(id)}">${esc(id)}</span>`).join('') : '<span class="muted small">None</span>'}</div>
        </div>
        <div class="card mt8">
          <div class="card-title">Attempted / unsolved (${failed.length})</div>
          <div>${failed.length ? failed.slice(0, 200).map(id => `<span class="tag" style="cursor:pointer" data-prob="${esc(id)}">${esc(id)}</span>`).join('') : '<span class="muted small">None</span>'}</div>
        </div>`;
      $$('#view [data-prob]').forEach(e => e.onclick = () => goSubView('problem/' + encodeURIComponent(e.dataset.prob)));
    } catch (e) {
      view.innerHTML = '<div class="empty"><i class="fas fa-user-slash"></i>' + (e.offline ? 'Offline — cannot load' : 'User not found') + '</div>';
    }
  }

  // ── Contests list ──
  async function renderContests(view) {
    view.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    try {
      const d = await apiCall('/api/contests?action=list&page=1&limit=50');
      const list = d.contests || [];
      const now = Date.now();
      function cstatus(c) {
        const start = new Date(c.startTime).getTime();
        const end = start + (c.duration || 0) * 60000;
        if (now < start) return { text: 'Upcoming', cls: 'status-pending' };
        if (now > end) return { text: 'Ended', cls: 'status-system' };
        return { text: 'Ongoing', cls: 'status-accepted' };
      }
      view.innerHTML = list.length ? list.map(c => {
        const st = cstatus(c);
        return `<div class="contest-card" data-id="${esc(c.id)}">
          <div class="nm">${esc(c.name || ('Contest #' + c.id))}</div>
          <div class="meta"><span class="badge ${st.cls}">${st.text}</span> · ${c.contestantCount} participants · ${formatDate(c.startTime)}</div>
        </div>`;
      }).join('') : '<div class="empty"><i class="fas fa-trophy"></i>No contests</div>';
      $$('#view .contest-card').forEach(c => c.onclick = () => goSubView('contest/' + encodeURIComponent(c.dataset.id)));
    } catch (e) {
      view.innerHTML = '<div class="empty"><i class="fas fa-cloud-slash"></i>' + (e.offline ? 'Offline — cannot load' : esc(e.message)) + '</div>';
    }
  }

  // ── Contest detail ──
  async function renderContestDetail(view, cid) {
    view.innerHTML = '<div class="loading-wrap"><span class="spinner"></span></div>';
    try {
      const d = await apiCall('/api/contests?action=page&id=' + encodeURIComponent(cid));
      const c = d.contest;
      const stText = { ongoing: 'Ongoing', upcoming: 'Upcoming', ended: 'Ended' }[c.status] || c.status;
      const stCls = { ongoing: 'status-accepted', upcoming: 'status-pending', ended: 'status-system' }[c.status] || 'status-pending';

      const problems = (c.problems || []).map(p => {
        const state = c.userContestStates[p.id] || (c.globalStates[p.id] === 'passed' ? 'passed' : 'not_started');
        const score = c.userScores[p.id];
        return `<div class="problem-card" data-id="${esc(p.id)}">
          <span class="problem-id">${esc(p.id)}</span>
          <div class="grow"><div class="problem-name">${esc(p.name || '')}</div></div>
          <div class="problem-meta">
            ${state === 'passed' ? '<i class="fas fa-check-circle" style="color:var(--success)"></i>'
              : state === 'partial' ? `<span class="badge status-partial">${score ?? ''}</span>`
              : state === 'failed' ? '<i class="fas fa-times-circle" style="color:var(--danger)"></i>' : ''}
          </div>
        </div>`;
      }).join('');

      view.innerHTML = `
        <div class="card">
          <div class="row"><div class="grow"><div class="nm" style="font-weight:800;font-size:1.1rem">${esc(c.name || '')}</div></div>
          <span class="badge ${stCls}">${stText}</span></div>
          <div class="meta-item"><span class="k">Starts</span><span class="v">${formatDate(c.startTime)}</span></div>
          <div class="meta-item"><span class="k">Duration</span><span class="v">${c.duration} min</span></div>
          <div class="meta-item"><span class="k">Participants</span><span class="v">${c.participantCount}</span></div>
          <div class="meta-item"><span class="k">My status</span><span class="v">${c.isParticipant ? 'Joined' : 'Not joined'}</span></div>
          ${c.status !== 'ended' && !c.isParticipant ? '<button class="btn btn-block mt8" id="joinBtn">Join contest</button>' : ''}
        </div>
        ${problems ? `<div class="card"><div class="card-title">Problems (${c.problems.length})</div>${problems || '<span class="muted small">Problems shown when contest starts</span>'}</div>` : ''}
        ${c.status === 'ended' ? '<button class="btn btn-block" id="resultsBtn"><i class="fas fa-list-ol"></i> View results</button>' : ''}`;

      $('#joinBtn') && ($('#joinBtn').onclick = async () => {
        try { await apiCall('/api/contests?action=join', 'POST', { contestId: c.id }); toast('Joined', 'ok'); renderContestDetail(view, cid); }
        catch (e) { toast(e.message || 'Failed to join', 'err'); }
      });
      $('#resultsBtn') && ($('#resultsBtn').onclick = () => openContestResults(c.id));
      $$('#view .problem-card').forEach(x => x.onclick = () => goSubView('problem/' + encodeURIComponent(x.dataset.id)));
    } catch (e) {
      view.innerHTML = '<div class="empty"><i class="fas fa-cloud-slash"></i>' + (e.offline ? 'Offline — cannot load' : 'Contest not found') + '</div>';
    }
  }

  function openContestResults(cid) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal"><h3>Contest results</h3><div id="crBody"><div class="loading-wrap"><span class="spinner"></span></div></div>
      <div class="modal-actions"><button class="btn btn-sm" id="crClose">Close</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    $('#crClose', overlay).onclick = () => overlay.remove();
    apiCall('/api/contests?action=results&id=' + encodeURIComponent(cid)).then(d => {
      const parts = (d.stats && d.stats.participants) || [];
      $('#crBody', overlay).innerHTML = parts.length ? parts.map((p, i) => `
        <div class="lb-row" data-user="${esc(p.username)}">
          <span class="lb-rank ${i < 3 ? 'top' + (i + 1) : ''}">${i + 1}</span>
          ${avatarHtml(p, 30)}
          <div class="lb-main"><div class="lb-name">${esc(p.displayName || p.username)}</div></div>
          <span class="lb-metric">${p.total}</span>
        </div>`).join('') : '<div class="empty">No results yet</div>';
      $$('#crBody .lb-row', overlay).forEach(r => r.onclick = () => { overlay.remove(); goSubView('user/' + encodeURIComponent(r.dataset.user)); });
    }).catch(() => { $('#crBody', overlay).innerHTML = '<div class="empty">Failed to load</div>'; });
  }

  // ── Me ──
  async function renderMe(view) {
    const user = getCurrentUser();
    view.innerHTML = `
      <div class="card center">
        <div class="avatar lg" style="margin:0 auto">${esc((user.displayName || user.username).charAt(0).toUpperCase())}</div>
        <div class="hello" style="font-size:1.3rem;margin-top:10px">${esc(user.displayName || user.username)}</div>
        <div class="sub muted">@${esc(user.username)} · ${esc(user.role)}</div>
      </div>
      <div class="card">
        <div class="setting-row" id="meSettings"><span class="ic"><i class="fas fa-gear"></i></span><div class="tt"><span class="lbl">Settings</span><span class="dsc">Font, theme, cache</span></div><i class="fas fa-chevron-right" style="color:var(--text-3)"></i></div>
        <div class="setting-row" id="meProfile"><span class="ic"><i class="fas fa-id-card"></i></span><div class="tt"><span class="lbl">My profile</span><span class="dsc">View progress</span></div><i class="fas fa-chevron-right" style="color:var(--text-3)"></i></div>
        <div class="setting-row" id="meDraft"><span class="ic"><i class="fas fa-inbox"></i></span><div class="tt"><span class="lbl">Drafts</span><span class="dsc" id="meDraftDesc">0 pending</span></div><i class="fas fa-chevron-right" style="color:var(--text-3)"></i></div>
      </div>
      <button class="btn btn-block" id="logoutBtn" style="background:var(--danger)"><i class="fas fa-right-from-bracket"></i> Sign out</button>`;

    $('#meSettings').onclick = () => goSubView('settings');
    $('#meProfile').onclick = () => goSubView('user/' + encodeURIComponent(user.username));
    $('#meDraft').onclick = () => openDraftBox();
    $('#logoutBtn').onclick = () => logout();
    const drafts = await DB.getDrafts();
    $('#meDraftDesc').textContent = drafts.length + ' pending';
  }

  async function openDraftBox() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal"><h3><i class="fas fa-inbox"></i> Drafts</h3><div id="draftBody"></div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" id="draftClose">Close</button>
        <button class="btn btn-sm" id="draftSync"><i class="fas fa-cloud-arrow-up"></i> Submit all</button>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    $('#draftClose', overlay).onclick = () => overlay.remove();
    $('#draftSync', overlay).onclick = async () => { await syncDrafts(true); renderDrafts(); };

    async function renderDrafts() {
      const drafts = await DB.getDrafts();
      $('#draftBody', overlay).innerHTML = drafts.length ? drafts.map(d => `
        <div class="disc">
          <div class="head">${esc(d.problemId)} · ${esc({ text: 'Text', image: 'Image', steps: 'AI Steps' }[d.type] || d.type)} · ${timeAgo(d.createdAt)}</div>
          <div class="body small">${d.type === 'image' ? '[Image]' : esc(String(d.answer).slice(0, 80))}</div>
        </div>`).join('') : '<div class="empty">Drafts empty</div>';
    }
    renderDrafts();
  }

  // ── Settings ──
  async function renderSettings(view) {
    view.innerHTML = `
      <div class="card">
        <div class="setting-row">
          <span class="ic"><i class="fas fa-moon"></i></span>
          <div class="tt"><span class="lbl">Dark theme</span><span class="dsc">Toggle dark / light mode</span></div>
          <label class="switch"><input type="checkbox" id="swTheme"><span class="slider"></span></label>
        </div>
        <div class="setting-row">
          <span class="ic"><i class="fas fa-text-height"></i></span>
          <div class="tt"><span class="lbl">Font size</span><span class="dsc" id="fontVal">${Settings.fontSize}px</span></div>
          <div class="row" style="gap:4px">
            <button class="btn btn-secondary btn-sm" id="fontMinus"><i class="fas fa-minus"></i></button>
            <button class="btn btn-secondary btn-sm" id="fontPlus"><i class="fas fa-plus"></i></button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><i class="fas fa-database"></i> Offline cache</div>
        <p class="small muted">Cache all problem statements & images for offline viewing.</p>
        <div class="meta-item"><span class="k">Cached problems</span><span class="v" id="cacheStmtCount">…</span></div>
        <div class="meta-item"><span class="k">Cached images</span><span class="v" id="cacheImgCount">…</span></div>
        <div class="meta-item"><span class="k">Last cached</span><span class="v" id="cacheLastAt">—</span></div>
        <div id="cacheProgress" style="display:none" class="mt8">
          <div class="progress"><div id="cacheProgressBar" style="width:0%;background:var(--accent)"></div></div>
          <div class="small muted mt8" id="cacheProgressText"></div>
        </div>
        <button class="btn btn-block mt8" id="cacheBtn"><i class="fas fa-download"></i> Cache all problems</button>
        <button class="btn btn-secondary btn-block mt8" id="clearCacheBtn"><i class="fas fa-trash"></i> Clear cache</button>
      </div>

      <div class="card">
        <div class="card-title"><i class="fas fa-circle-info"></i> About</div>
        <div class="small muted">WYK Maths Team Online Judge · Mobile PWA</div>
        <div class="small muted mt8">Offline submissions go to drafts and auto-submit when online.</div>
      </div>`;

    $('#swTheme').checked = Settings.theme === 'dark';
    $('#swTheme').onchange = e => Settings.setTheme(e.target.checked ? 'dark' : 'light');
    $('#fontMinus').onclick = () => { Settings.setFontSize(Settings.fontSize - 1); $('#fontVal').textContent = Settings.fontSize + 'px'; };
    $('#fontPlus').onclick = () => { Settings.setFontSize(Settings.fontSize + 1); $('#fontVal').textContent = Settings.fontSize + 'px'; };

    const [stmts, imgCount, lastAt] = await Promise.all([
      DB.getAllStatements(), DB.countImages(), DB.getMeta('lastCacheAt'),
    ]);
    $('#cacheStmtCount').textContent = stmts.length;
    $('#cacheImgCount').textContent = imgCount;
    $('#cacheLastAt').textContent = lastAt ? formatDate(lastAt) : '—';

    $('#cacheBtn').onclick = async () => {
      if (!isOnline()) { toast('Offline — cannot cache', 'err'); return; }
      const btn = $('#cacheBtn');
      btn.disabled = true;
      $('#cacheProgress').style.display = 'block';
      await cacheAllProblems(p => {
        if (p.phase === 'statement') {
          $('#cacheProgressText').textContent = `Caching statements… ${p.done}/${p.total}`;
          $('#cacheProgressBar').style.width = Math.round(p.done / p.total * 70) + '%';
        } else {
          $('#cacheProgressText').textContent = `Caching images… ${p.done}/${p.total} (${p.ok || 0} ok)`;
          $('#cacheProgressBar').style.width = (70 + Math.round(p.done / Math.max(1, p.total) * 30)) + '%';
        }
      });
      $('#cacheProgressText').textContent = 'Done';
      $('#cacheProgressBar').style.width = '100%';
      btn.disabled = false;
      renderSettings(view);
      toast('Cache complete', 'ok');
    };

    $('#clearCacheBtn').onclick = async () => {
      await DB.clearStatements();
      await DB.clearImages();
      toast('Cache cleared', 'ok');
      renderSettings(view);
    };
  }

  /* ────────────────────────────────────────────────
   * 11. Draft box sync
   * ──────────────────────────────────────────────── */
  async function updateDraftBadge() {
    const drafts = await DB.getDrafts();
    const badge = $('#draftBadge');
    const count = $('#draftCount');
    if (drafts.length) {
      badge.hidden = false;
      count.textContent = drafts.length;
    } else {
      badge.hidden = true;
    }
  }

  async function syncDrafts(manual) {
    if (!isOnline()) { if (manual) toast('Offline — cannot sync', 'err'); return; }
    const drafts = await DB.getDrafts();
    if (!drafts.length) { if (manual) toast('Drafts empty', 'ok'); return; }

    let ok = 0, fail = 0;
    for (const d of drafts) {
      try {
        if (d.type === 'steps') {
          const res = await apiCall('/api/steps-grade', 'POST', { problemId: d.problemId, steps: d.answer });
          if (!res || !res.taskId) throw new Error(res && res.message || 'steps failed');
        } else {
          const res = await apiCall('/api/submit', 'POST', { problemId: d.problemId, answer: d.answer, type: d.type, image: d.image || '' });
          if (!res.success) throw new Error(res.message || 'submit failed');
        }
        await DB.deleteDraft(d.id);
        ok++;
      } catch (e) {
        if (e.offline) break;   // went offline mid-sync
        fail++;
      }
    }
    await updateDraftBadge();
    if (manual) {
      if (fail) toast(`Submitted ${ok}, ${fail} failed`, 'err');
      else toast(`Submitted ${ok}`, 'ok');
    } else if (ok) {
      toast(`Drafts: auto-submitted ${ok}`, 'ok');
    }
    const route = currentRoute();
    if (route.name === 'home') updateDraftSummary();
  }

  /* ────────────────────────────────────────────────
   * 12. Heartbeat (online status) — NOT part of the nav lock
   * ═══════════════════════════════════════════════════════
   * Reports the user as online by POSTing /api/heartbeat, which
   * bumps `lastSeenAt` (and unsets `explicitlyOffline`). This runs
   * entirely in the background and is intentionally independent of
   * the `isLoading` navigation lock, so it keeps firing while views
   * are loading.
   */
  function startHeartbeat() {
    let lastActivity = Date.now();
    const markActivity = () => { lastActivity = Date.now(); };

    ['mousemove', 'keydown', 'click', 'touchstart', 'scroll', 'wheel'].forEach(ev =>
      document.addEventListener(ev, markActivity, { passive: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') markActivity();
    });

    async function beat() {
      if (!isLoggedIn() || !isOnline()) return;
      if (Date.now() - lastActivity > 180000) return;   // idle → skip
      const token = getToken();
      try {
        await fetch('/api/heartbeat', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        });
      } catch (e) { /* silent */ }
    }

    // initial beat shortly after load, then periodically
    setTimeout(beat, 4000);
    setInterval(beat, 180000);
  }

  /* ────────────────────────────────────────────────
   * 13. Events + init
   * ──────────────────────────────────────────────── */
  function bindEvents() {
    // bottom nav
    $$('#bottomNav .nav-item').forEach(b => {
      b.addEventListener('click', () => {
        const route = b.dataset.route;
        if (route === currentRoute().name) return;
        navigate(route);
      });
    });

    // hash change
    window.addEventListener('hashchange', render);

    // online / offline
    window.addEventListener('online', () => {
      refreshTopbar();
      toast('Back online', 'ok');
      syncDrafts(false);
    });
    window.addEventListener('offline', () => {
      refreshTopbar();
      toast('Offline', 'warn');
    });
  }

  function init() {
    loadFromLocal();
    bindEvents();
    startHeartbeat();

    // SW registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/mobile/sw.js').catch(() => {});
    }

    // auth restore via root cookie (optional, best-effort)
    if (!isLoggedIn()) {
      fetch('/api/root-session', { method: 'GET', credentials: 'include', cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (d && d.success && d.token) {
            localStorage.setItem(TOKEN_KEY, d.token);
            render();
          }
        })
        .catch(() => {});
    }

    // initial draft badge + auto sync
    updateDraftBadge();
    if (isOnline()) syncDrafts(false);

    render();
  }

  // expose a couple helpers for debugging
  window.MOJ = { navigate, goSubView, syncDrafts, cacheAllProblems, DB };

  init();
})();
