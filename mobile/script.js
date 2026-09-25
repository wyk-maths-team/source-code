/* ═══════════════════════════════════════════════════════════
 * WYK Maths Team — Mobile App
 * ═══════════════════════════════════════════════════════════ */
(function () {
'use strict';

// ═══════════════════════════════════════════════════════════
// 0. Auth
// ═══════════════════════════════════════════════════════════
const TOKEN_KEY = 'auth_token';

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
function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
function parseJwt(t) { try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; } }
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
  if (res.status === 401) { setToken(null); throw new Error('Session expired'); }
  if (!res.ok) {
    const d = await res.json().catch(() => ({ message: 'HTTP ' + res.status }));
    throw new Error(d.message || ('HTTP ' + res.status));
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════
// 1. IndexedDB 封裝
// ═══════════════════════════════════════════════════════════
const DB_NAME = 'wyk-mobile-db';
const DB_VERSION = 1;
let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('No IndexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('problems')) {
        db.createObjectStore('problems', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('drafts')) {
        const s = db.createObjectStore('drafts', { keyPath: 'id', autoIncrement: true });
        s.createIndex('byProblem', 'problemId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function dbGet(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function dbPut(store, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}
function dbGetAll(store) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}
function dbDelete(store, key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

// ═══════════════════════════════════════════════════════════
// 2. 常量 & 狀態
// ═══════════════════════════════════════════════════════════
const LS = {
  problems: 'mobile_problems_v1',
  states:   'mobile_states_v1',
  fav:      'mobile_fav_v1',
  settings: 'mobile_settings_v1',
  welcome:  'mobile_welcome_done_v1',
  acAnswers: 'mobile_ac_answers_v1',
};

const CACHE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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
  _updates: null,
  _firstRender: true,
  _scrollMemory: {},
  _cacheInProgress: false,
};

// ═══════════════════════════════════════════════════════════
// 3. 工具
// ═══════════════════════════════════════════════════════════
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function escAttr(s) { return esc(s); }

function toast(msg, icon) {
  let t = $('#ml-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ml-toast'; document.body.appendChild(t); }
  t.innerHTML = (icon ? `<i class="fas ${icon}" style="margin-right:6px;opacity:.85"></i>` : '') + esc(msg);
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 1800);
}

function haptic(ms = 8) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch {}
}

function fmtDateTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return { date: '—', time: '—', short: '—' };
  const pad = n => String(n).padStart(2, '0');
  const local = new Date(d.getTime() + 8 * 3600000);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`,
    short: `${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}
function faviconOf(name) {
  return String(name || '?').trim()[0]?.toUpperCase() || '?';
}

// 通用分頁
function computePageItems(current, total, maxVisible) {
  if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1);
  const inner = maxVisible - 2;
  const half = Math.floor(inner / 2);
  let start = Math.max(2, current - half);
  let end = Math.min(total - 1, start + inner - 1);
  start = Math.max(2, end - inner + 1);
  const items = [1];
  if (start > 2) items.push('…');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < total - 1) items.push('…');
  items.push(total);
  return items;
}

function renderPagination(current, total, onNav) {
  if (total <= 1) return '';
  const items = computePageItems(current, total, 5);
  let html = '<div class="ml-pagination">';
  html += `<button class="ml-page-btn" data-p="${current - 1}" ${current <= 1 ? 'disabled' : ''} aria-label="Prev"><i class="fas fa-chevron-left"></i></button>`;
  for (const it of items) {
    if (it === '…') html += `<span class="ml-page-ellipsis">…</span>`;
    else html += `<button class="ml-page-btn ${it === current ? 'active' : ''}" data-p="${it}">${it}</button>`;
  }
  html += `<button class="ml-page-btn" data-p="${current + 1}" ${current >= total ? 'disabled' : ''} aria-label="Next"><i class="fas fa-chevron-right"></i></button>`;
  html += '</div>';
  return html;
}
function bindPagination(root, onNav) {
  $$('.ml-page-btn[data-p]', root).forEach(btn => {
    btn.onclick = () => {
      const p = parseInt(btn.dataset.p, 10);
      if (p && p >= 1) { haptic(6); onNav(p); }
    };
  });
}

function animateNumber(el, to, duration = 650) {
  if (!el) return;
  if (!state.settings.animations) { el.textContent = to; return; }
  const from = 0;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function withMinSkeleton(fn, minMs = 250) {
  const start = Date.now();
  const result = await fn();
  const remain = Math.max(0, minMs - (Date.now() - start));
  if (remain) await new Promise(r => setTimeout(r, remain));
  return result;
}

// ── KaTeX 就緒 ──
async function ensureKatex() {
  if (typeof window.renderMathInElement === 'function') return true;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (typeof window.renderMathInElement === 'function') return true;
  }
  return false;
}

// ── math.js 就緒（表達式計算用） ──
let _mathLoading = null;
function ensureMath() {
  if (window.math && typeof window.math.evaluate === 'function') return Promise.resolve(true);
  if (_mathLoading) return _mathLoading;
  _mathLoading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mathjs@11.8.0/lib/browser/math.js';
    s.async = true;
    s.onload = () => resolve(!!(window.math && typeof window.math.evaluate === 'function'));
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return _mathLoading;
}

// 格式化計算結果（去尾零，最大 12 位小數）
function formatMathNumber(n) {
  if (!Number.isFinite(n)) return null;
  if (Number.isInteger(n)) return String(n);
  let s = n.toFixed(12);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

// 計算表達式，成功回傳字串，失敗回傳 null
async function evaluateExpression(expr) {
  const raw = String(expr || '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  const ready = await ensureMath();
  if (!ready) return { ok: false, reason: 'unavailable' };

  try {
    const result = window.math.evaluate(raw);
    let num = null;
    if (typeof result === 'number') num = result;
    else if (result && typeof result.toNumber === 'function') num = result.toNumber();
    else if (result && typeof result.valueOf === 'function') {
      const v = result.valueOf();
      if (typeof v === 'number') num = v;
    }
    if (typeof num !== 'number' || !Number.isFinite(num)) {
      return { ok: false, reason: 'not-number' };
    }
    const formatted = formatMathNumber(num);
    if (formatted == null) return { ok: false, reason: 'not-number' };
    return { ok: true, value: formatted, num };
  } catch (e) {
    return { ok: false, reason: 'syntax' };
  }
}

// ═══════════════════════════════════════════════════════════
// 4. AC 答案緩存
// ═══════════════════════════════════════════════════════════
function loadAcAnswers() {
  try {
    const raw = localStorage.getItem(LS.acAnswers);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}
function saveAcAnswer(pid, ans) {
  if (!pid) return;
  const s = String(ans == null ? '' : ans).trim();
  if (!s) return;
  try {
    const all = loadAcAnswers();
    all[pid] = s;
    localStorage.setItem(LS.acAnswers, JSON.stringify(all));
  } catch {}
}
function getAcAnswer(pid) {
  const all = loadAcAnswers();
  return all[pid] || '';
}

// ═══════════════════════════════════════════════════════════
// 5. 頁面過渡動畫
// ═══════════════════════════════════════════════════════════
const TAB_ORDER = ['/', '/problems', '/submissions', '/contests', '/rank', '/me'];

function getTabIdx(path) {
  for (let i = 0; i < TAB_ORDER.length; i++) {
    const t = TAB_ORDER[i];
    if (path === t || path.startsWith(t + '/')) return i;
  }
  return -1;
}

function detectDirection(prevPath, nextPath) {
  if (!prevPath || !nextPath || prevPath === nextPath) return 'fade';
  const pParts = prevPath.split('/').filter(Boolean);
  const nParts = nextPath.split('/').filter(Boolean);
  if (pParts[0] === nParts[0] && pParts.length !== nParts.length) {
    return nParts.length > pParts.length ? 'forward' : 'back';
  }
  const pi = getTabIdx(prevPath);
  const ni = getTabIdx(nextPath);
  if (pi >= 0 && ni >= 0 && pi !== ni) {
    return ni > pi ? 'forward' : 'back';
  }
  return 'fade';
}

function animatePageEnter(el, direction) {
  if (!state.settings.animations || !el || typeof el.animate !== 'function') return;
  let from;
  if (direction === 'forward')      from = { opacity: 0, transform: 'translateX(28px)' };
  else if (direction === 'back')    from = { opacity: 0, transform: 'translateX(-28px)' };
  else                              from = { opacity: 0, transform: 'translateY(6px)' };
  try {
    el.animate([from, { opacity: 1, transform: 'none' }],
      { duration: 300, easing: 'cubic-bezier(.32,.72,0,1)' });
  } catch (e) {}
}

const STAGGER_SELECTORS = '.ml-prob, .ml-sub, .ml-update, .ml-quick, .ml-me-stat, .ml-rank-item, .ml-pd-sub, .ml-result-row, .ml-list-item';

function staggerIn(root) {
  if (!state.settings.animations || !root || typeof Element.prototype.animate !== 'function') return;
  const items = Array.from(root.querySelectorAll(STAGGER_SELECTORS));
  const max = 15;
  items.slice(0, max).forEach((el, i) => {
    try {
      el.animate(
        [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 240, delay: Math.min(i * 22, 320), easing: 'cubic-bezier(.32,.72,0,1)', fill: 'backwards' }
      );
    } catch (e) {}
  });
}

function animateTitle(el, text) {
  if (!el) return;
  el.textContent = text;
  if (!state.settings.animations || typeof el.animate !== 'function') return;
  try {
    el.animate(
      [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }],
      { duration: 220, easing: 'cubic-bezier(.32,.72,0,1)' }
    );
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════
// 6. 進度條
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
      setTimeout(() => { wrap.classList.add('ml-hide'); setTimeout(() => wrap.remove(), 400); }, 160);
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
// 7. LocalStorage
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
  applyCompact();
  applyAnimations();
}
function saveSettings() {
  lsWrite(LS.settings, state.settings);
  applyTheme();
  applyCompact();
  applyAnimations();
}
function applyTheme() {
  const t = state.settings.theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : state.settings.theme;
  document.documentElement.setAttribute('data-theme', t);
}
function applyCompact() {
  document.body.classList.toggle('ml-compact', !!state.settings.compact);
}
function applyAnimations() {
  document.body.classList.toggle('ml-no-anim', !state.settings.animations);
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
// 8. Cache All Problems
// ═══════════════════════════════════════════════════════════
async function getCacheStatus() {
  try {
    const last = await dbGet('meta', 'cacheAllAt');
    const problems = await dbGetAll('problems');
    const lastAt = last ? last.value : 0;
    const remaining = Math.max(0, CACHE_COOLDOWN_MS - (Date.now() - lastAt));
    return { lastAt, remaining, count: problems.length };
  } catch {
    return { lastAt: 0, remaining: 0, count: 0 };
  }
}

async function cacheAllProblems(onProgress) {
  const d = await apiCall('/api/problem?all=1&withStatement=1');
  if (!d || !d.success || !Array.isArray(d.problems)) {
    throw new Error('Failed to load problems');
  }
  const problems = d.problems;

  const db = await openDB();
  const tx = db.transaction('problems', 'readwrite');
  const store = tx.objectStore('problems');
  store.clear();
  const now = Date.now();
  for (let i = 0; i < problems.length; i++) {
    store.put({ ...problems[i], cachedAt: now });
    if (onProgress && i % 10 === 0) onProgress(i + 1, problems.length);
  }
  await new Promise((res, rej) => {
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
  await dbPut('meta', { key: 'cacheAllAt', value: Date.now() });

  const light = problems.map(p => ({
    id: p.id, name: p.name, difficulty: p.difficulty,
    tags: p.tags, public: p.public, solves: p.solves,
  }));
  state.problems = light;
  state.problemsLoaded = true;
  saveProblemsCache(light);

  return problems.length;
}

async function getCachedProblem(id) {
  try { return await dbGet('problems', id); }
  catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// 9. 草稿箱
// ═══════════════════════════════════════════════════════════
async function saveDraft(problemId, answer, type = 'text', image = '') {
  const draft = {
    problemId,
    answer,
    type,
    image,
    createdAt: Date.now(),
    tries: 0,
  };
  await dbPut('drafts', draft);
  return draft;
}
async function getAllDrafts() {
  try { return await dbGetAll('drafts'); }
  catch { return []; }
}
async function deleteDraft(id) { await dbDelete('drafts', id); }
async function updateDraft(draft) { await dbPut('drafts', draft); }

let _syncingDrafts = false;
async function syncDrafts() {
  if (!navigator.onLine || _syncingDrafts) return;
  _syncingDrafts = true;
  try {
    const drafts = await getAllDrafts();
    if (!drafts.length) return;

    let synced = 0, failed = 0;
    for (const draft of drafts) {
      try {
        const r = await apiCall('/api/submit', 'POST', {
          problemId: draft.problemId,
          answer: draft.answer,
          type: draft.type || 'text',
          image: draft.image || '',
          clientTimestamp: new Date(draft.createdAt).toISOString(),
        });
        if (r && r.success) {
          await deleteDraft(draft.id);
          synced++;
          if (r.correct || r.score === 100) {
            state.states = state.states || {};
            state.states[draft.problemId] = 'passed';
            // ⭐ 保存 AC 答案
            saveAcAnswer(draft.problemId, draft.answer);
          } else if (state.states && state.states[draft.problemId] !== 'passed') {
            state.states[draft.problemId] = 'failed';
          }
          saveStatesCache(state.states || {});
        } else {
          await deleteDraft(draft.id);
          failed++;
        }
      } catch (e) {
        draft.tries = (draft.tries || 0) + 1;
        if (draft.tries >= 5) {
          await deleteDraft(draft.id);
          failed++;
        } else {
          await updateDraft(draft);
        }
      }
    }
    if (synced || failed) {
      const total = synced + failed;
      toast(`Synced ${synced}/${total} draft${total > 1 ? 's' : ''}`, 'fa-cloud-arrow-up');
    }
  } finally {
    _syncingDrafts = false;
  }
}

// 統一提交入口
async function submitAnswer(problemId, answer, type = 'text', image = '') {
  if (!navigator.onLine) {
    const d = await saveDraft(problemId, answer, type, image);
    return { success: true, drafted: true, draftId: d.id };
  }
  return await apiCall('/api/submit', 'POST', { problemId, answer, type, image });
}

// ═══════════════════════════════════════════════════════════
// 10. 路由
// ═══════════════════════════════════════════════════════════
function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: '/' + parts.join('/'), parts };
}
function navigate(path) {
  const content = $('#ml-content');
  if (content) state._scrollMemory[state.route.path] = content.scrollTop;
  haptic(6);
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
// 11. AppBar / TabBar
// ═══════════════════════════════════════════════════════════
function renderAppBar(opts) {
  opts = opts || {};
  const bar = $('#ml-appbar');
  if (!bar) return;
  const title = routeTitle();
  const leftIcon = opts.leftIcon || 'fa-chevron-left';
  const rightIcon = opts.rightIcon || 'fa-chevron-right';

  let backBtn = $('#ml-ab-back');
  let titleEl = $('.ml-ab-title', bar);
  let fwdBtn  = $('#ml-ab-fwd');

  if (!backBtn || !titleEl || !fwdBtn) {
    bar.innerHTML = `
      <button class="ml-ab-btn" id="ml-ab-back" aria-label="Back"><i class="fas ${leftIcon}"></i></button>
      <div class="ml-ab-title"></div>
      <button class="ml-ab-btn" id="ml-ab-fwd" aria-label="Forward"><i class="fas ${rightIcon}"></i></button>`;
    backBtn = $('#ml-ab-back');
    titleEl = $('.ml-ab-title', bar);
    fwdBtn  = $('#ml-ab-fwd');
  } else {
    const bi = backBtn.querySelector('i');
    const fi = fwdBtn.querySelector('i');
    if (bi) bi.className = 'fas ' + leftIcon;
    if (fi) fi.className = 'fas ' + rightIcon;
  }

  backBtn.disabled = !!opts.leftDisabled;
  fwdBtn.disabled  = !!opts.rightDisabled;

  if (titleEl.textContent !== title) {
    titleEl.classList.toggle('hidden', !title);
    animateTitle(titleEl, title);
  }

  backBtn.onclick = () => { haptic(6); if (opts.onLeft) opts.onLeft(); else history.back(); };
  fwdBtn.onclick  = () => { haptic(6); if (opts.onRight) opts.onRight(); else history.forward(); };
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
// 12. 預取
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
      if (state._updates) return;   // ⭐ 這行才是對的位置
      try {
        const d = await fetch('/api/updates').then(r => r.json());
        if (d && d.success && Array.isArray(d.updates)) state._updates = d.updates;
      } catch (e) {}
    })(),
  ]);
}

// ═══════════════════════════════════════════════════════════
// 13. Home
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

  const showWelcome = localStorage.getItem(LS.welcome) !== '1';

  content.innerHTML = `
    <div class="ml-page">
      ${showWelcome ? `
        <div class="ml-welcome" id="ml-welcome">
          <div class="ml-welcome-icon"><i class="fas fa-rocket"></i></div>
          <div class="ml-welcome-text">
            <b>Welcome to WYK Maths</b>
            <span>Add to Home Screen for full experience</span>
          </div>
          <button class="ml-welcome-close" id="ml-welcome-close" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>
      ` : ''}

      <div class="ml-greet">
        <h1 class="ml-greet-h1">${esc(greet)},<br><em>${esc(u.displayName || u.username || 'Guest')}</em></h1>
        <p class="ml-greet-sub"><i class="fas fa-bolt" style="margin-right:4px;opacity:.7"></i>What are we solving today?</p>
      </div>

      <div class="ml-stats-grid">
        <div class="ml-stat">
          <i class="fas fa-circle-check ml-stat-icon"></i>
          <div class="ml-stat-val" id="stat-solved">0</div>
          <div class="ml-stat-lbl">Solved</div>
        </div>
        <div class="ml-stat">
          <i class="fas fa-book ml-stat-icon"></i>
          <div class="ml-stat-val" id="stat-total">0</div>
          <div class="ml-stat-lbl">Total</div>
        </div>
      </div>

      <div class="ml-section-title"><i class="fas fa-bolt" style="margin-right:5px;opacity:.7"></i>Quick Access</div>
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

      <div class="ml-section-title"><i class="fas fa-bullhorn" style="margin-right:5px;opacity:.7"></i>Recent Updates</div>
      <div id="ml-updates">${renderUpdatesSkeleton()}</div>
    </div>`;

  animateNumber($('#stat-solved'), solvedCount);
  animateNumber($('#stat-total'), totalProblems);

  const welcomeClose = $('#ml-welcome-close');
  if (welcomeClose) {
    welcomeClose.onclick = () => {
      haptic(6);
      localStorage.setItem(LS.welcome, '1');
      const el = $('#ml-welcome');
      if (el) {
        if (state.settings.animations && typeof el.animate === 'function') {
          el.animate(
            [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }],
            { duration: 200, easing: 'ease' }
          ).finished.then(() => el.remove()).catch(() => el.remove());
        } else el.remove();
      }
    };
  }

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
        haptic(6);
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
// 14. Problems 列表
// ═══════════════════════════════════════════════════════════
const probState = { filter: 'all', sort: 'default', page: 1, idPattern: '' };

async function renderProblems() {
  const content = $('#ml-content');
  const savedFilter = sessionStorage.getItem('ml_prob_filter') || 'all';
  sessionStorage.removeItem('ml_prob_filter');
  probState.filter = savedFilter;
  probState.page = 1;

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-prob-filters" id="ml-prob-filters">
        <button class="ml-chip" data-f="all"><i class="fas fa-layer-group"></i> All</button>
        <button class="ml-chip" data-f="unsolved"><i class="fas fa-fire"></i> Unsolved</button>
        <button class="ml-chip" data-f="solved"><i class="fas fa-circle-check"></i> Solved</button>
        <button class="ml-chip" data-f="fav"><i class="fas fa-star"></i> Bookmarks</button>
      </div>
      <div class="ml-sort-label"><i class="fas fa-arrow-down-wide-short" style="margin-right:5px;opacity:.7"></i>Sort by</div>
      <div class="ml-prob-filters" id="ml-prob-sorts">
        <button class="ml-chip small" data-s="default"><i class="fas fa-list-ol"></i> Default</button>
        <button class="ml-chip small" data-s="difficulty"><i class="fas fa-gauge-high"></i> Difficulty</button>
        <button class="ml-chip small" data-s="solves"><i class="fas fa-user-check"></i> Solves</button>
      </div>
      <div class="ml-id-filter">
        <i class="fas fa-filter"></i>
        <input type="text" id="ml-id-input" class="ml-input"
               placeholder="Filter ID · regex (e.g. ^HA25, \\d{4}$)"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
        <button class="ml-id-clear" id="ml-id-clear" aria-label="Clear" style="display:none">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="ml-id-hint" id="ml-id-hint"></div>
      <div id="ml-prob-list">${renderProblemsSkeleton()}</div>
    </div>`;

  const apply = () => {
    $$('#ml-prob-filters .ml-chip').forEach(b => b.classList.toggle('active', b.dataset.f === probState.filter));
    $$('#ml-prob-sorts .ml-chip').forEach(b => b.classList.toggle('active', b.dataset.s === probState.sort));
    renderProbList();
  };

  $$('#ml-prob-filters .ml-chip').forEach(b => b.onclick = () => {
    haptic(6);
    probState.filter = b.dataset.f;
    probState.page = 1;
    apply();
  });
  $$('#ml-prob-sorts .ml-chip').forEach(b => b.onclick = () => {
    haptic(6);
    probState.sort = b.dataset.s;
    probState.page = 1;
    apply();
  });
  // ── ID Regex 篩選 ──
  const idInput = $('#ml-id-input');
  const idClear = $('#ml-id-clear');
  const idHint  = $('#ml-id-hint');

  if (idInput) {
    // 還原先前輸入
    idInput.value = probState.idPattern || '';
    idClear.style.display = idInput.value ? '' : 'none';

    let _idDebounce = null;
    const applyIdFilter = () => {
      probState.idPattern = idInput.value.trim();
      probState.page = 1;

      // 語法檢查
      if (probState.idPattern) {
        try {
          new RegExp(probState.idPattern);
          idHint.textContent = '';
          idHint.className = 'ml-id-hint';
          idInput.classList.remove('error');
        } catch (err) {
          idHint.textContent = 'Invalid regex: ' + (err.message || 'syntax error');
          idHint.className = 'ml-id-hint error';
          idInput.classList.add('error');
          // 語法錯誤時不過濾（保留上一狀態），直接返回
          return;
        }
      } else {
        idHint.textContent = '';
        idHint.className = 'ml-id-hint';
        idInput.classList.remove('error');
      }

      idClear.style.display = probState.idPattern ? '' : 'none';
      renderProbList();
    };

    idInput.addEventListener('input', () => {
      clearTimeout(_idDebounce);
      _idDebounce = setTimeout(applyIdFilter, 250);
    });
    idInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(_idDebounce);
        applyIdFilter();
        idInput.blur();
      }
    });

    idClear.onclick = () => {
      idInput.value = '';
      idClear.style.display = 'none';
      haptic(6);
      applyIdFilter();
      idInput.focus();
    };

    // 進入頁面先顯示提示
    if (probState.idPattern) applyIdFilter();
  }

    if (!state.problemsLoaded) {
    const wait = setInterval(() => {
      if (state.problemsLoaded) { clearInterval(wait); apply(); }
    }, 100);
    // ⭐ 4 秒內沒被 prefetch 填上 → 自己拉一次
    setTimeout(async () => {
      clearInterval(wait);
      if (!state.problemsLoaded) {
        try {
          const d = await apiCall('/api/problem?all=1');
          if (d && d.success && Array.isArray(d.problems)) {
            state.problems = d.problems;
            state.problemsLoaded = true;
            saveProblemsCache(d.problems);
          }
        } catch (e) { console.warn('problems fallback failed', e); }
      }
      apply();
    }, 4000);
  } else {
    apply();
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

function renderProbList() {
  const wrap = $('#ml-prob-list');
  if (!wrap) return;
  const all = state.problems || [];
  const s = state.settings;
  const states = state.states || {};
  const favs = state.favorites || new Set();
  const filter = probState.filter;
  const sort = probState.sort;

  let items = all.slice();

  // ── Regex 篩選 ID ──
  if (probState.idPattern) {
    let re = null;
    try { re = new RegExp(probState.idPattern); } catch { re = null; }
    if (re) items = items.filter(p => re.test(String(p.id)));
  }

  // ── 狀態篩選 ──
  if (filter === 'unsolved') items = items.filter(p => states[p.id] !== 'passed');
  else if (filter === 'solved') items = items.filter(p => states[p.id] === 'passed');
  else if (filter === 'fav') items = items.filter(p => favs.has(p.id));

  if (sort === 'difficulty') items.sort((a, b) => (a.difficulty || 0) - (b.difficulty || 0));
  else if (sort === 'solves') items.sort((a, b) => (b.solves || 0) - (a.solves || 0));

  if (!items.length) {
    wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No problems</div>`;
    return;
  }

  const limit = s.pageSize || 30;
  const total = Math.ceil(items.length / limit);
  if (probState.page > total) probState.page = total;
  if (probState.page < 1) probState.page = 1;
  const start = (probState.page - 1) * limit;
  const shown = items.slice(start, start + limit);

  wrap.innerHTML = shown.map(p => probCardHtml(p, s, states, favs)).join('')
    + renderPagination(probState.page, total);

  bindProbCards(wrap);
  bindPagination(wrap, (p) => {
    probState.page = p;
    renderProbList();
    const c = $('#ml-content');
    if (c) c.scrollTop = 0;
  });
  staggerIn(wrap);
}

function probCardHtml(p, s, states, favs) {
  const st = states[p.id] || 'not_started';
  const cls = st === 'passed' ? 'passed' : st === 'failed' ? 'failed' : '';
  const isFav = favs.has(p.id);
  const diff = p.difficulty;
  const diffText = !diff ? '∞' : diff.toFixed(2);

  // ⭐ AC 時在名稱後面加綠色 tick
  const tick = st === 'passed'
    ? `<i class="fas fa-circle-check ml-prob-tick" aria-label="Solved"></i>`
    : '';

  let statusHtml = '';
  if (st === 'failed') statusHtml = `<span class="ml-prob-status failed"><i class="fas fa-times"></i> WA</span>`;

  return `
    <div class="ml-prob ${cls}" data-id="${escAttr(p.id)}">
      <div class="ml-prob-main">
        <div class="ml-prob-top">
          <span class="ml-prob-id">${esc(p.id)}</span>
          <span class="ml-prob-name">
            <span class="ml-prob-name-text">${esc(p.name || '')}</span>
            ${tick}
          </span>
          ${statusHtml}
        </div>
        <div class="ml-prob-meta">
          ${s.showDifficulty ? `<span class="ml-prob-diff"><i class="fas fa-gauge-high" style="margin-right:3px;opacity:.7"></i>Lv.${diffText}</span>` : ''}
          ${s.showSolves ? `<span><i class="fas fa-user-check"></i> ${p.solves || 0}</span>` : ''}
          ${s.showTags && p.tags && p.tags.length
            ? `<div class="ml-prob-tags">${p.tags.slice(0, 3).map(t => `<span class="ml-tag">${esc(t)}</span>`).join('')}${p.tags.length > 3 ? `<span class="ml-tag">+${p.tags.length - 3}</span>` : ''}</div>`
            : ''}
        </div>
      </div>
      ${s.showFavorite ? `<button class="ml-prob-fav${isFav ? ' on' : ''}" data-fav="${escAttr(p.id)}" aria-label="Favorite"><i class="fas fa-star"></i></button>` : ''}
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
      haptic(6);
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
// 15. Problem Detail
// ═══════════════════════════════════════════════════════════
async function renderProblemDetail(id) {
  const content = $('#ml-content');

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
    let p = null;
    let offlineFallback = false;

    // 1) 在線 → 打 API
    if (navigator.onLine) {
      try {
        const d = await apiCall('/api/problem?action=page&id=' + encodeURIComponent(id));
        if (d && d.success && d.problem) {
          p = d.problem;
          if (p.statement) {
            dbPut('problems', { ...p, cachedAt: Date.now() }).catch(() => {});
          }
        }
      } catch (e) {
        // 網路失敗 → 走 fallback
      }
    }

    // 2) 離線或 API 失敗 → IndexedDB fallback
    if (!p) {
      const cached = await getCachedProblem(id);
      if (cached) {
        p = cached;
        offlineFallback = true;
      }
    }

    if (!p) throw new Error('Not found');

    const s = state.settings;
    const diffText = !p.difficulty ? '∞' : Number(p.difficulty).toFixed(2);

    content.innerHTML = `
      <div class="ml-page">
        ${offlineFallback ? `
          <div class="ml-feedback show pending" style="margin-bottom:14px">
            <i class="fas fa-plane"></i> Offline — showing cached version
          </div>
        ` : ''}
        <div class="ml-pd-title">${esc(p.name || p.id)}</div>
        <div class="ml-pd-meta">
          <span class="ml-prob-id">${esc(p.id)}</span>
          ${s.showDifficulty ? `<span><i class="fas fa-gauge-high" style="margin-right:3px;opacity:.7"></i>Lv.${diffText}</span>` : ''}
          ${s.showTags && p.tags && p.tags.length
            ? `<div class="ml-prob-tags">${p.tags.map(t => `<span class="ml-tag">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="ml-pd-statement" id="ml-pd-statement"></div>

        <div id="ml-pd-answer-zone">
          <div class="ml-expr-row">
            <input type="text" class="ml-input ml-expr-input" id="ml-pd-expr"
                   placeholder="Expression · e.g. sqrt(3)+2/5 (Enter to compute)"
                   autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            <div class="ml-expr-hint" id="ml-pd-expr-hint"></div>
          </div>
          <div class="ml-answer-row">
            <input type="text" class="ml-input" id="ml-pd-answer" placeholder="Your answer"
                   autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            <button class="ml-btn" id="ml-pd-submit">
              <i class="fas fa-paper-plane"></i> Submit
            </button>
          </div>
          <div class="ml-feedback" id="ml-pd-feedback"></div>
        </div>

        <div class="ml-pd-subs" id="ml-pd-subs">
          <div class="ml-section-title"><i class="fas fa-history" style="margin-right:5px;opacity:.7"></i>My Submissions</div>
          <div id="ml-pd-subs-list"><div class="ml-loading-center" style="padding:20px 0"><span class="ml-spinner"></span></div></div>
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
      ensureKatex().then(ready => {
        if (ready && typeof window.renderMathInElement === 'function') {
          try {
            window.renderMathInElement(stmt, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '\\[', right: '\\]', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
              ],
              throwOnError: false,
            });
          } catch (e) {}
        }
      });
    }

    const exprInp = $('#ml-pd-expr');
    const exprHint = $('#ml-pd-expr-hint');
    const answerInp = $('#ml-pd-answer');
    const submitBtn = $('#ml-pd-submit');
    const fb = $('#ml-pd-feedback');

    // ── 初始答案填入（優先：AC 答案 → 上次輸入） ──
    let initialAnswer = '';
    const acAns = getAcAnswer(id);
    if (acAns) {
      initialAnswer = acAns;
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem('pd_user_answers') || '{}');
        if (saved[id]) initialAnswer = saved[id];
      } catch {}
    }
    if (initialAnswer && answerInp) answerInp.value = initialAnswer;

    // ── 表達式 Enter 計算 ──
    if (exprInp) {
      exprInp.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        if (e.isComposing) return;
        e.preventDefault();
        const raw = (exprInp.value || '').trim();
        if (!raw) return;

        // 顯示「計算中」
        if (exprHint) {
          exprHint.className = 'ml-expr-hint show';
          exprHint.textContent = 'Computing…';
        }

        const r = await evaluateExpression(raw);
        if (r.ok) {
          if (answerInp) answerInp.value = r.value;
          if (exprHint) {
            exprHint.className = 'ml-expr-hint show ok';
            exprHint.textContent = '= ' + r.value;
          }
          haptic(8);
          // 聚焦 answer input，方便用戶確認/提交
          if (answerInp) answerInp.focus();
        } else {
          let msg = 'Invalid expression';
          if (r.reason === 'unavailable') msg = 'Calculator not available offline';
          else if (r.reason === 'syntax') msg = 'Syntax error';
          else if (r.reason === 'not-number') msg = 'Result is not a number';
          if (exprHint) {
            exprHint.className = 'ml-expr-hint show error';
            exprHint.textContent = msg;
          }
          if (state.settings.animations && exprInp && typeof exprInp.animate === 'function') {
            try {
              exprInp.animate(
                [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' },
                 { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' },
                 { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
                { duration: 320, easing: 'ease' }
              );
            } catch {}
          }
          haptic(20);
        }
      });

      // 輸入變化時清除舊提示
      exprInp.addEventListener('input', () => {
        if (exprHint && exprHint.classList.contains('error')) {
          exprHint.className = 'ml-expr-hint';
          exprHint.textContent = '';
        }
      });
    }

    const doSubmit = async () => {
      const ans = (answerInp.value || '').trim();
      if (!ans) { toast('Enter an answer', 'fa-circle-exclamation'); return; }
      haptic(10);
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="ml-spinner" style="width:14px;height:14px;border-width:2px"></span>';
      try {
        const r = await submitAnswer(id, ans, 'text', '');

        if (r && r.drafted) {
          fb.className = 'ml-feedback show partial';
          fb.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Saved as draft — will auto-submit when online';
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';

          // ⭐ 離線草稿也顯示在列表頂部（灰色 pending）
          prependLocalSubmission({
            subid: '',   // 沒有 subid → 不可點
            problemId: id,
            type: 'text',
            timestamp: Date.now(),
            answer: ans,
            answerHidden: false,
            username: state.user?.username || '',
            displayName: state.user?.displayName || '',
            status: 'Pending',
          });
          return;
        }

        if (r && r.success) {
          const correct = r.correct || r.score === 100;
          const score = typeof r.score === 'number' ? r.score : (correct ? 100 : 0);
          if (correct) {
            fb.className = 'ml-feedback show ac';
            fb.innerHTML = '<i class="fas fa-circle-check"></i> Accepted';
            state.states = state.states || {};
            state.states[id] = 'passed';
            saveStatesCache(state.states);

            // ⭐ 保存 AC 答案，以便下次自動填入
            saveAcAnswer(id, ans);

            // ⭐ 首次 AC → 掛載討論區（若還沒掛載）
            if (!document.getElementById('ml-pd-discussions')) {
              setTimeout(() => { mountDiscussion(id); }, 120);
            }

            // 短暫顯示 Solved（2 秒）後恢復可提交
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-circle-check"></i> Solved';
            submitBtn.style.background = 'var(--ok)';
            setTimeout(() => {
              if (document.body.contains(submitBtn)) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
                submitBtn.style.background = '';
              }
            }, 2000);
          } else if (score > 0) {
            fb.className = 'ml-feedback show partial';
            fb.innerHTML = `<i class="fas fa-circle-half-stroke"></i> Partial ${score}%`;
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
            submitBtn.style.background = '';
          } else {
            fb.className = 'ml-feedback show wa';
            fb.innerHTML = '<i class="fas fa-circle-xmark"></i> Wrong Answer';
            state.states = state.states || {};
            if (state.states[id] !== 'passed') state.states[id] = 'failed';
            saveStatesCache(state.states);
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
            submitBtn.style.background = '';
            if (state.settings.animations && typeof fb.animate === 'function') {
              try {
                fb.animate(
                  [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' },
                   { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' },
                   { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }],
                  { duration: 320, easing: 'ease' }
                );
              } catch {}
            }
          }
          // ⭐ 樂觀更新：不重新拉 API
          if (r.subid) {
            prependLocalSubmission({
              subid: r.subid,
              problemId: id,
              type: 'text',
              timestamp: Date.now(),
              answer: ans,
              answerHidden: false,
              username: state.user?.username || '',
              displayName: state.user?.displayName || '',
              status: correct
                ? 'Accepted'
                : (score > 0 ? `Partial Score (${score})` : 'Wrong Answer'),
            });
          } else {
            // 後端沒回 subid（極少數）→ 保守重拉
            loadProblemSubmissions(id);
          }
        } else {
          fb.className = 'ml-feedback show wa';
          fb.innerHTML = `<i class="fas fa-circle-exclamation"></i> ${esc(r && r.message || 'Error')}`;
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
        }
      } catch (e) {
        try {
          await saveDraft(id, ans, 'text', '');
          fb.className = 'ml-feedback show partial';
          fb.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Saved as draft';
        } catch {
          fb.className = 'ml-feedback show wa';
          fb.innerHTML = '<i class="fas fa-wifi"></i> Network error';
        }
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
      }
    };

    submitBtn.onclick = doSubmit;
    answerInp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); doSubmit(); }
    });

    loadProblemSubmissions(id);

    // ⭐ 若已 AC → 掛載討論區
    if (state.states && state.states[id] === 'passed') {
      mountDiscussion(id);
    }

  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Problem not found</div></div>`;
  }
}
// ── 題目詳情提交項：HTML 生成 ──
function pdSubItemHtml(sub) {
  const dt = fmtDateTime(sub.timestamp);
  const cls = statusCls(sub.status);
  const ansText = sub.type === 'image'
    ? '[Image]'
    : (sub.answerHidden ? 'Hidden' : (sub.answer || ''));
  return `<div class="ml-pd-sub" data-subid="${escAttr(sub.subid || '')}">
    <span class="ml-pd-sub-time">${esc(dt.short)}</span>
    <span class="ml-pd-sub-ans">${esc(ansText)}</span>
    <span class="ml-pd-sub-status ${cls}">${esc(sub.status || 'Pending')}</span>
  </div>`;
}

function bindPdSubItems(root) {
  $$('.ml-pd-sub[data-subid]', root).forEach(el => {
    el.onclick = () => {
      if (el.dataset.subid) navigate('/submissions/' + encodeURIComponent(el.dataset.subid));
    };
  });
}

// ── 樂觀更新：把剛提交的項目插入列表頂部（不重新拉 API） ──
function prependLocalSubmission(sub) {
  const wrap = $('#ml-pd-subs-list');
  if (!wrap) return false;

  // 若當前是空狀態 / spinner → 先清掉
  if (wrap.querySelector('.ml-empty') || wrap.querySelector('.ml-loading-center')) {
    wrap.innerHTML = '';
  }

  wrap.insertAdjacentHTML('afterbegin', pdSubItemHtml(sub));

  const first = wrap.querySelector('.ml-pd-sub');
  if (first) {
    first.onclick = () => {
      if (first.dataset.subid) navigate('/submissions/' + encodeURIComponent(first.dataset.subid));
    };
    // 入場動畫（可選）
    if (state.settings.animations && typeof first.animate === 'function') {
      try {
        first.animate(
          [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
          { duration: 260, easing: 'cubic-bezier(.32,.72,0,1)' }
        );
      } catch {}
    }
  }
  return true;
}
// ═══════════════════════════════════════════════════════════
// 討論區
// ═══════════════════════════════════════════════════════════
const discState = { page: 1, total: 0, totalPages: 1, loading: false };

function renderDiscussionsSection(problemId) {
  return `
    <div class="ml-pd-discussions" id="ml-pd-discussions">
      <div class="ml-section-title">
        <i class="fas fa-comments" style="margin-right:5px;opacity:.7"></i>Discussion
        <span class="ml-disc-count" id="ml-disc-count"></span>
      </div>

      <div class="ml-disc-compose">
        <textarea class="ml-input ml-disc-input" id="ml-disc-input"
                  placeholder="Share your thoughts… (LaTeX supported)"
                  rows="2" maxlength="5000" autocorrect="off" autocapitalize="sentences" spellcheck="true"></textarea>
        <button class="ml-btn ml-disc-post" id="ml-disc-post" disabled aria-label="Post">
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>

      <div id="ml-disc-list">
        <div class="ml-loading-center" style="padding:20px 0"><span class="ml-spinner"></span></div>
      </div>

      <button class="ml-btn ghost full" id="ml-disc-more" style="display:none;margin-top:8px">
        <i class="fas fa-arrow-down"></i> Load more
      </button>
    </div>`;
}

function discItemHtml(d) {
  const dt = fmtDateTime(d.createdAt);
  const liked = d.liked === true
    || (Array.isArray(d.likedBy) && state.user && d.likedBy.includes(state.user.username));
  return `<div class="ml-disc-item" data-id="${escAttr(d._id || '')}">
    <div class="ml-disc-header">
      <div class="ml-disc-user">
        <i class="fas fa-user-circle"></i>
        <span>${esc(d.username || '')}</span>
      </div>
      <div class="ml-disc-time">${esc(dt.short)}</div>
    </div>
    <div class="ml-disc-body">${window.DOMPurify ? DOMPurify.sanitize(d.content || '') : esc(d.content || '')}</div>
    <div class="ml-disc-actions">
      <button class="ml-disc-like${liked ? ' liked' : ''}" data-id="${escAttr(d._id || '')}">
        <i class="fas fa-heart"></i>
        <span>${d.likes || 0}</span>
      </button>
    </div>
  </div>`;
}

function mountDiscussion(problemId) {
  if (document.getElementById('ml-pd-discussions')) return;
  const subs = document.getElementById('ml-pd-subs');
  if (!subs) return;
  subs.insertAdjacentHTML('afterend', renderDiscussionsSection(problemId));
  bindDiscussionEvents(problemId);
  loadDiscussions(problemId, 1);
}

async function loadDiscussions(problemId, page = 1, append = false) {
  const wrap = $('#ml-disc-list');
  if (!wrap) return;
  if (discState.loading) return;
  discState.loading = true;

  if (!append) {
    wrap.innerHTML = `<div class="ml-loading-center" style="padding:20px 0"><span class="ml-spinner"></span></div>`;
  }

  try {
    const d = await apiCall(
      '/api/problem?action=discussions&problemId=' + encodeURIComponent(problemId)
      + '&page=' + page + '&limit=20'
    );
    if (!d || !d.success) throw new Error(d && d.message || 'Failed');

    const list = d.discussions || [];
    const pg = d.pagination || {};
    discState.page = page;
    discState.total = pg.total || list.length;
    discState.totalPages = pg.totalPages || 1;

    const countEl = $('#ml-disc-count');
    if (countEl) countEl.textContent = discState.total ? `(${discState.total})` : '';

    if (page === 1) {
      if (!list.length) {
        wrap.innerHTML = `<div class="ml-empty" style="padding:24px 16px"><i class="fas fa-comments"></i>No discussions yet. Be the first!</div>`;
        const moreBtn = $('#ml-disc-more');
        if (moreBtn) moreBtn.style.display = 'none';
        return;
      }
      wrap.innerHTML = list.map(discItemHtml).join('');
    } else {
      wrap.insertAdjacentHTML('beforeend', list.map(discItemHtml).join(''));
    }

    // KaTeX 渲染（非阻塞）
    ensureKatex().then(ready => {
      if (ready && typeof window.renderMathInElement === 'function' && document.body.contains(wrap)) {
        try {
          window.renderMathInElement(wrap, {
            delimiters: [
              { left: '$$', right: '$$', display: true },
              { left: '\\[', right: '\\]', display: true },
              { left: '$', right: '$', display: false },
              { left: '\\(', right: '\\)', display: false },
            ],
            throwOnError: false,
          });
        } catch {}
      }
    });

    const moreBtn = $('#ml-disc-more');
    if (moreBtn) {
      moreBtn.style.display = discState.page < discState.totalPages ? '' : 'none';
    }
  } catch (e) {
    if (page === 1) {
      wrap.innerHTML = `<div class="ml-empty" style="padding:20px 16px"><i class="fas fa-triangle-exclamation"></i>Failed to load discussions</div>`;
    }
  } finally {
    discState.loading = false;
  }
}

function bindDiscussionEvents(problemId) {
  const input = $('#ml-disc-input');
  const postBtn = $('#ml-disc-post');
  const moreBtn = $('#ml-disc-more');
  const listEl = $('#ml-disc-list');

  // 輸入 → 啟用/禁用發送按鈕
  if (input) {
    input.addEventListener('input', () => {
      postBtn.disabled = !input.value.trim();
    });
    // 自動增高
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 180) + 'px';
    });
  }

  // 發送
  if (postBtn) {
    postBtn.onclick = async () => {
      const content = (input.value || '').trim();
      if (!content) return;
      haptic(10);
      postBtn.disabled = true;
      postBtn.innerHTML = '<span class="ml-spinner" style="width:14px;height:14px;border-width:2px"></span>';
      try {
        const r = await apiCall('/api/problem?action=discussions', 'POST', { problemId, content });
        if (r && r.success) {
          input.value = '';
          input.style.height = '';
          postBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
          postBtn.disabled = true;
          toast('Posted', 'fa-circle-check');
          loadDiscussions(problemId, 1);
        } else {
          toast((r && r.message) || 'Failed', 'fa-circle-exclamation');
          postBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
          postBtn.disabled = false;
        }
      } catch (e) {
        toast('Network error', 'fa-wifi');
        postBtn.innerHTML = '<i class="fas fa-paper-plane"></i>';
        postBtn.disabled = false;
      }
    };
  }

  // Load more
  if (moreBtn) {
    moreBtn.onclick = () => {
      if (discState.page < discState.totalPages) {
        loadDiscussions(problemId, discState.page + 1, true);
      }
    };
  }

  // 點讚（事件委託）
  if (listEl) {
    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('.ml-disc-like');
      if (!btn) return;
      e.stopPropagation();
      const did = btn.dataset.id;
      if (!did) return;
      haptic(6);

      const wasLiked = btn.classList.contains('liked');
      const countEl = btn.querySelector('span');
      const curCount = parseInt(countEl.textContent, 10) || 0;

      // 樂觀更新
      btn.classList.toggle('liked', !wasLiked);
      countEl.textContent = wasLiked ? Math.max(0, curCount - 1) : curCount + 1;

      try {
        const r = await apiCall('/api/problem?action=discussions', 'PUT', { discussionId: did });
        if (r && r.success && r.discussion) {
          const d = r.discussion;
          const serverLiked = Array.isArray(d.likedBy) && state.user && d.likedBy.includes(state.user.username);
          btn.classList.toggle('liked', serverLiked);
          countEl.textContent = d.likes || 0;
        } else {
          btn.classList.toggle('liked', wasLiked);
          countEl.textContent = curCount;
        }
      } catch {
        btn.classList.toggle('liked', wasLiked);
        countEl.textContent = curCount;
      }
    });
  }
}
async function loadProblemSubmissions(id) {
  const wrap = $('#ml-pd-subs-list');
  if (!wrap) return;
  if (!navigator.onLine) {
    wrap.innerHTML = `<div class="ml-empty" style="padding:20px"><i class="fas fa-plane"></i>Offline</div>`;
    return;
  }
  try {
    const d = await apiCall('/api/submissions?problem_id=' + encodeURIComponent(id) + '&limit=20');
    if (!d || !d.success) throw new Error();
    const subs = d.submissions || [];
    if (!subs.length) {
      wrap.innerHTML = `<div class="ml-empty" style="padding:20px"><i class="fas fa-inbox"></i>No submissions yet</div>`;
      return;
    }
    wrap.innerHTML = subs.map(pdSubItemHtml).join('');
    bindPdSubItems(wrap);
  } catch {
    wrap.innerHTML = `<div class="ml-empty" style="padding:20px"><i class="fas fa-triangle-exclamation"></i>Failed to load</div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// 16. Submissions
// ═══════════════════════════════════════════════════════════
const subsState = { filter: 'all', user: '', problem: '', page: 1 };

async function renderSubmissions() {
  const content = $('#ml-content');
  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-sub-filters">
        <div class="ml-filter-chips" id="ml-subs-chips">
          <button class="ml-chip" data-f="all"><i class="fas fa-layer-group"></i> All</button>
          <button class="ml-chip" data-f="accepted"><i class="fas fa-circle-check"></i> Accepted</button>
          <button class="ml-chip" data-f="wrong"><i class="fas fa-circle-xmark"></i> Wrong</button>
          <button class="ml-chip" data-f="partial"><i class="fas fa-circle-half-stroke"></i> Partial</button>
          <button class="ml-chip" data-f="pending"><i class="fas fa-clock"></i> Pending</button>
          <button class="ml-chip" data-f="system"><i class="fas fa-triangle-exclamation"></i> System</button>
        </div>
        <div class="ml-filter-inputs">
          <input type="text" class="ml-input" id="ml-subs-user" placeholder="Username" autocomplete="off" autocapitalize="none" spellcheck="false">
          <input type="text" class="ml-input" id="ml-subs-prob" placeholder="Problem ID" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div id="ml-subs-list"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>
    </div>`;

  $$('#ml-subs-chips .ml-chip').forEach(b => {
    b.classList.toggle('active', b.dataset.f === subsState.filter);
    b.onclick = () => {
      haptic(6);
      subsState.filter = b.dataset.f;
      subsState.page = 1;
      $$('#ml-subs-chips .ml-chip').forEach(x => x.classList.toggle('active', x === b));
      loadSubmissions();
    };
  });

  const userInp = $('#ml-subs-user');
  const probInp = $('#ml-subs-prob');
  userInp.value = subsState.user || '';
  probInp.value = subsState.problem || '';

  const applyInputs = () => {
    subsState.user = userInp.value.trim();
    subsState.problem = probInp.value.trim();
    subsState.page = 1;
    loadSubmissions();
  };
  userInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyInputs(); userInp.blur(); } });
  probInp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applyInputs(); probInp.blur(); } });

  loadSubmissions();
}

async function loadSubmissions() {
  const wrap = $('#ml-subs-list');
  if (!wrap) return;
  wrap.innerHTML = `<div class="ml-loading-center"><span class="ml-spinner"></span></div>`;

  await withMinSkeleton(async () => {
    const limit = state.settings.pageSize || 30;
    const params = new URLSearchParams({ all: '1', page: subsState.page, limit });
    if (subsState.user) params.set('user', subsState.user);
    if (subsState.problem) params.set('problem', subsState.problem);
    if (subsState.filter && subsState.filter !== 'all') params.set('result', subsState.filter);

    try {
      const d = await apiCall('/api/submissions?' + params.toString());
      if (!d || !d.success) throw new Error();
      const subs = d.submissions || [];
      if (!subs.length) {
        wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-inbox"></i>No submissions</div>`;
        return;
      }
      const total = d.totalPages || 1;
      wrap.innerHTML = subs.map(subCardHtml).join('')
        + renderPagination(subsState.page, total);
      $$('.ml-sub[data-subid]', wrap).forEach(el => {
        el.onclick = () => {
          if (el.dataset.subid) navigate('/submissions/' + encodeURIComponent(el.dataset.subid));
        };
      });
      bindPagination(wrap, (p) => {
        subsState.page = p;
        loadSubmissions();
        const c = $('#ml-content');
        if (c) c.scrollTop = 0;
      });
      staggerIn(wrap);
    } catch (e) {
      if (!navigator.onLine) {
        wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-plane"></i>Offline — submissions unavailable</div>`;
      } else {
        wrap.innerHTML = `<div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load</div>`;
      }
    }
  }, 250);
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
        <div class="ml-sub-user"><i class="fas fa-user" style="margin-right:3px;opacity:.6"></i>${esc(s.displayName || s.username || '')}</div>
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
            <i class="fas fa-clock" style="margin-right:4px;opacity:.6"></i>${esc(dt.date)} ${esc(dt.time)}
            <i class="fas fa-user" style="margin:0 4px 0 8px;opacity:.6"></i>${esc(s.username)}
          </div>
          <div class="ml-sub-status ${cls}" style="display:inline-block">${esc(d.status || 'Pending')}</div>
        </div>
        ${s.answer !== undefined ? `
          <div class="ml-section-title" style="margin-top:18px"><i class="fas fa-pen" style="margin-right:5px;opacity:.7"></i>Answer</div>
          <div class="ml-card" style="font-family:Consolas,monospace;font-size:14px;word-break:break-all">${esc(s.answer || '(empty)')}</div>
        ` : s.answerHidden ? `
          <div class="ml-section-title" style="margin-top:18px"><i class="fas fa-pen" style="margin-right:5px;opacity:.7"></i>Answer</div>
          <div class="ml-card" style="color:var(--fg-muted);font-style:italic"><i class="fas fa-eye-slash" style="margin-right:6px"></i>Hidden</div>
        ` : ''}
        ${s.comment ? `
          <div class="ml-section-title" style="margin-top:18px"><i class="fas fa-comment" style="margin-right:5px;opacity:.7"></i>Comment</div>
          <div class="ml-card">${esc(s.comment)}</div>
        ` : ''}
      </div>`;
  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Not found</div></div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// 17. Contests
// ═══════════════════════════════════════════════════════════
async function renderContests() {
  const content = $('#ml-content');
  await withMinSkeleton(async () => {
    try {
      const d = await apiCall('/api/contests?action=list&page=1&limit=30');
      if (!d || !d.success) throw new Error();
      const cs = d.contests || [];

      content.innerHTML = `<div class="ml-page"><div id="ml-contests-list"></div></div>`;

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
      content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Failed to load</div></div>`;
    }
  }, 250);
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
        <div class="ml-sub-user"><i class="fas fa-users" style="margin-right:4px;opacity:.6"></i>${c.contestantCount || 0} · <i class="fas fa-clock" style="margin-right:3px;opacity:.6"></i>${Number(c.duration) || 0}m</div>
      </div>
      <span class="ml-sub-status ${cls[status]}">${statusMap[status]}</span>
    </div>`;
}

async function renderContestDetail(id) {
  const content = $('#ml-content');
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
          <i class="fas fa-clock" style="margin-right:4px;opacity:.6"></i>${esc(dateStr)}
          <i class="fas fa-users" style="margin:0 4px 0 10px;opacity:.6"></i>${c.participantCount}
        </div>

        ${canSee ? `
          <div class="ml-section-title"><i class="fas fa-list-check" style="margin-right:5px;opacity:.7"></i>Problems</div>
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
        ` : c.status === 'ended' ? '' : `
          <div class="ml-empty"><i class="fas fa-lock"></i>${c.status === 'upcoming' ? 'Contest not started' : 'Problems not available'}</div>
        `}

        <div class="ml-results" id="ml-results">
          <div class="ml-section-title"><i class="fas fa-ranking-star" style="margin-right:5px;opacity:.7"></i>Results</div>
          <div id="ml-results-list"><div class="ml-loading-center" style="padding:20px 0"><span class="ml-spinner"></span></div></div>
        </div>
      </div>`;

    $$('.ml-prob[data-pid]', content).forEach(el => {
      el.onclick = () => navigate('/problems/' + encodeURIComponent(el.dataset.pid));
    });

    if (c.status === 'ended' || c.status === 'ongoing') {
      loadContestResults(id, c.status);
    } else {
      const r = $('#ml-results');
      if (r) r.style.display = 'none';
    }

  } catch (e) {
    content.innerHTML = `<div class="ml-page"><div class="ml-empty"><i class="fas fa-triangle-exclamation"></i>Not found</div></div>`;
  }
}

async function loadContestResults(id, status) {
  const wrap = $('#ml-results-list');
  if (!wrap) return;
  try {
    const d = await apiCall('/api/contests?action=results&id=' + encodeURIComponent(id));
    if (!d || !d.success) throw new Error();
    const parts = (d.stats && d.stats.participants) || [];

    if (!parts.length) {
      wrap.innerHTML = `<div class="ml-empty" style="padding:20px"><i class="fas fa-inbox"></i>No results yet</div>`;
      return;
    }
    const isEnded = status === 'ended';
    wrap.innerHTML = parts.map((p, i) => {
      const rank = i + 1;
      let rankCls = '';
      if (isEnded) {
        if (rank === 1) rankCls = 'gold';
        else if (rank === 2) rankCls = 'silver';
        else if (rank === 3) rankCls = 'bronze';
      }
      const name = p.displayName || (p.isTeam ? `Team #${p.username}` : p.username);
      const score = isEnded ? (p.total || 0).toFixed(2) : '—';
      return `<div class="ml-result-row">
        <span class="ml-result-rank ${rankCls}">${rank}</span>
        <span class="ml-result-name">${esc(name)}</span>
        <span class="ml-result-score">${score}</span>
      </div>`;
    }).join('');
    staggerIn(wrap);
  } catch (e) {
    wrap.innerHTML = `<div class="ml-empty" style="padding:20px"><i class="fas fa-triangle-exclamation"></i>Failed to load</div>`;
  }
}

// ═══════════════════════════════════════════════════════════
// 18. Rank
// ═══════════════════════════════════════════════════════════
async function renderRank() {
  const content = $('#ml-content');
  await withMinSkeleton(async () => {
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
  }, 250);
}

function rankPodiumHtml(u, r) {
  const name = u.displayName || u.username;
  const avatar = u.pfp ? `<img src="${escAttr(u.pfp)}" alt="">` : faviconOf(name);
  const medal = r === 1 ? 'fa-crown' : r === 2 ? 'fa-medal' : 'fa-award';
  return `<div class="ml-rank-podium r${r}">
    <div class="ml-rank-avatar">${avatar}</div>
    <div class="ml-rank-name">${esc(name)}</div>
    <div class="ml-rank-solves"><i class="fas ${medal}" style="opacity:.6;margin-right:3px"></i>${u.solves || 0}</div>
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
// 19. Me
// ═══════════════════════════════════════════════════════════
async function renderMe() {
  const content = $('#ml-content');
  const u = state.user || {};
  const states = state.states || {};
  const solved = Object.values(states).filter(v => v === 'passed').length;
  const total = state.problems ? state.problems.length : 0;
  const pct = total ? Math.round(solved / total * 100) : 0;
  const avatar = u.pfp ? `<img src="${escAttr(u.pfp)}" alt="">` : '<i class="fas fa-user"></i>';

  const R = 32;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - pct / 100);

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-me-head">
        <div class="ml-me-avatar">${avatar}</div>
        <div class="ml-me-name">${esc(u.displayName || u.username || 'Guest')}</div>
        <div class="ml-me-sub">@${esc(u.username || '')}</div>
      </div>

      <div class="ml-me-progress">
        <svg width="96" height="96" viewBox="0 0 96 96" class="ml-me-ring">
          <circle cx="48" cy="48" r="${R}" stroke="var(--surface-2)" stroke-width="6" fill="none"/>
          <circle id="ml-me-ring-fill" cx="48" cy="48" r="${R}"
                  stroke="var(--accent)" stroke-width="6" fill="none"
                  stroke-linecap="round"
                  stroke-dasharray="${C.toFixed(2)} ${C.toFixed(2)}"
                  stroke-dashoffset="${C.toFixed(2)}"
                  transform="rotate(-90 48 48)"
                  style="transition: stroke-dashoffset .9s cubic-bezier(.32,.72,0,1)"/>
          <text x="48" y="53" text-anchor="middle"
                font-family="'SF Mono',Consolas,monospace" font-size="20" font-weight="800"
                fill="var(--fg)">${pct}%</text>
        </svg>
        <div class="ml-me-progress-text">
          <div><b>${solved}</b> solved</div>
          <div style="color:var(--fg-muted);font-size:12px">${total - solved} to go</div>
        </div>
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

  requestAnimationFrame(() => {
    const ring = $('#ml-me-ring-fill');
    if (ring) ring.setAttribute('stroke-dashoffset', offset.toFixed(2));
  });

  $$('[data-nav]', content).forEach(el => el.onclick = () => navigate(el.dataset.nav));
  const favNav = $('[data-filter="fav"]', content);
  if (favNav) favNav.onclick = () => {
    sessionStorage.setItem('ml_prob_filter', 'fav');
    navigate('/problems');
  };
  $('#ml-me-logout').onclick = () => {
    haptic(10);
    if (!confirm('Sign out?')) return;
    setToken(null);
    setTimeout(() => location.reload(), 60);
  };
}

// ═══════════════════════════════════════════════════════════
// 20. Settings
// ═══════════════════════════════════════════════════════════
async function updateCacheButtonUI() {
  const btn = $('#ml-cache-btn');
  const hint = $('#ml-cache-status');
  if (!btn || !hint) return;
  if (state._cacheInProgress) return;

  const { remaining, count, lastAt } = await getCacheStatus();

  if (remaining > 0) {
    const hours = Math.ceil(remaining / 3600000);
    btn.disabled = true;
    btn.classList.remove('caching');
    btn.innerHTML = `<i class="fas fa-lock"></i> ${hours}h`;
    hint.textContent = `Cached ${count} problems · last ${fmtDateTime(lastAt).short}`;
  } else if (count > 0) {
    btn.disabled = false;
    btn.classList.remove('caching');
    btn.innerHTML = '<i class="fas fa-rotate"></i> Update';
    hint.textContent = `Cached ${count} problems`;
  } else {
    btn.disabled = false;
    btn.classList.remove('caching');
    btn.innerHTML = '<i class="fas fa-download"></i> Cache';
    hint.textContent = 'Download all statements for offline';
  }
}

async function updateDraftsUI() {
  const btn = $('#ml-drafts-btn');
  const hint = $('#ml-drafts-status');
  if (!btn || !hint) return;
  try {
    const drafts = await getAllDrafts();
    if (!drafts.length) {
      btn.disabled = true;
      btn.classList.add('ghost');
      btn.textContent = 'Empty';
      hint.textContent = 'No pending drafts';
    } else {
      btn.disabled = !navigator.onLine;
      btn.classList.remove('ghost');
      btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Sync';
      hint.textContent = `${drafts.length} pending`;
    }
  } catch {
    btn.disabled = true;
    btn.textContent = 'N/A';
    hint.textContent = 'Not supported';
  }
}

async function renderSettings() {
  const content = $('#ml-content');
  const s = state.settings;
  const u = state.user || {};
  const avatar = u.pfp ? `<img src="${escAttr(u.pfp)}" alt="">` : '<i class="fas fa-user"></i>';

  content.innerHTML = `
    <div class="ml-page">
      <div class="ml-section-title"><i class="fas fa-user-circle" style="margin-right:5px;opacity:.7"></i>Profile</div>
      <div class="ml-set-group">
        <div class="ml-pfp-row">
          <div class="ml-pfp-avatar" id="ml-pfp-avatar">${avatar}</div>
          <div class="ml-pfp-info">
            <div class="ml-pfp-name">${esc(u.displayName || u.username || '')}</div>
            <button class="ml-pfp-btn" id="ml-pfp-pick"><i class="fas fa-camera"></i> Change</button>
            <input type="file" id="ml-pfp-input" accept="image/*" style="display:none">
          </div>
        </div>
      </div>

      <div class="ml-section-title"><i class="fas fa-palette" style="margin-right:5px;opacity:.7"></i>Appearance</div>
      <div class="ml-set-group">
        <div class="ml-set-item">
          <span class="lbl"><i class="fas fa-circle-half-stroke" style="margin-right:8px;opacity:.6;width:16px"></i>Theme</span>
          <div class="ml-seg" data-seg="theme">
            <button class="ml-seg-btn${s.theme === 'dark' ? ' active' : ''}" data-v="dark">Dark</button>
            <button class="ml-seg-btn${s.theme === 'light' ? ' active' : ''}" data-v="light">Light</button>
            <button class="ml-seg-btn${s.theme === 'auto' ? ' active' : ''}" data-v="auto">Auto</button>
          </div>
        </div>
        <div class="ml-set-item">
          <span class="lbl"><i class="fas fa-compress" style="margin-right:8px;opacity:.6;width:16px"></i>Compact Mode</span>
          <div class="ml-switch${s.compact ? ' on' : ''}" data-sw="compact"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl"><i class="fas fa-wand-magic-sparkles" style="margin-right:8px;opacity:.6;width:16px"></i>Animations</span>
          <div class="ml-switch${s.animations ? ' on' : ''}" data-sw="animations"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl"><i class="fas fa-table-cells" style="margin-right:8px;opacity:.6;width:16px"></i>Cards per Page</span>
          <div class="ml-seg" data-seg="pageSize">
            <button class="ml-seg-btn${s.pageSize === 20 ? ' active' : ''}" data-v="20">20</button>
            <button class="ml-seg-btn${s.pageSize === 30 ? ' active' : ''}" data-v="30">30</button>
            <button class="ml-seg-btn${s.pageSize === 50 ? ' active' : ''}" data-v="50">50</button>
          </div>
        </div>
      </div>

      <div class="ml-section-title"><i class="fas fa-list-check" style="margin-right:5px;opacity:.7"></i>Problem List</div>
      <div class="ml-set-group">
        <div class="ml-set-item">
          <span class="lbl"><i class="fas fa-gauge-high" style="margin-right:8px;opacity:.6;width:16px"></i>Show Difficulty</span>
          <div class="ml-switch${s.showDifficulty ? ' on' : ''}" data-sw="showDifficulty"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl"><i class="fas fa-tags" style="margin-right:8px;opacity:.6;width:16px"></i>Show Tags</span>
          <div class="ml-switch${s.showTags ? ' on' : ''}" data-sw="showTags"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl"><i class="fas fa-user-check" style="margin-right:8px;opacity:.6;width:16px"></i>Show Solve Count</span>
          <div class="ml-switch${s.showSolves ? ' on' : ''}" data-sw="showSolves"></div>
        </div>
        <div class="ml-set-item">
          <span class="lbl"><i class="fas fa-star" style="margin-right:8px;opacity:.6;width:16px"></i>Show Favorite Star</span>
          <div class="ml-switch${s.showFavorite ? ' on' : ''}" data-sw="showFavorite"></div>
        </div>
      </div>

      <div class="ml-section-title"><i class="fas fa-cloud-arrow-down" style="margin-right:5px;opacity:.7"></i>Offline</div>
      <div class="ml-set-group">
        <div class="ml-set-item">
          <span class="lbl">
            <i class="fas fa-download" style="margin-right:8px;opacity:.6;width:16px"></i>Cache All Problems
            <span class="hint" id="ml-cache-status">Loading…</span>
          </span>
          <button class="ml-pfp-btn" id="ml-cache-btn" disabled>
            <i class="fas fa-download"></i> Cache
          </button>
        </div>
        <div class="ml-set-item">
          <span class="lbl">
            <i class="fas fa-inbox" style="margin-right:8px;opacity:.6;width:16px"></i>Draft Queue
            <span class="hint" id="ml-drafts-status">Loading…</span>
          </span>
          <button class="ml-pfp-btn ghost" id="ml-drafts-btn" disabled>...</button>
        </div>
      </div>
      <div class="ml-section-title"><i class="fas fa-triangle-exclamation" style="margin-right:5px;opacity:.7"></i>Danger Zone</div>
      <div class="ml-set-group">
        <div class="ml-set-item">
          <span class="lbl">
            <i class="fas fa-bomb" style="margin-right:8px;opacity:.6;width:16px"></i>Force Reset
            <span class="hint">Clear all caches and stop the app</span>
          </span>
          <button class="ml-pfp-btn" id="ml-reset-btn">
            <i class="fas fa-bomb"></i> Reset
          </button>
        </div>
      </div>

      <div class="ml-section-title"><i class="fas fa-user-shield" style="margin-right:5px;opacity:.7"></i>Account</div>
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

  // 開關
  $$('[data-sw]', content).forEach(el => {
    el.onclick = () => {
      haptic(6);
      const k = el.dataset.sw;
      const next = !state.settings[k];
      state.settings[k] = next;
      el.classList.toggle('on', next);
      saveSettings();
    };
  });
  // 分段
  $$('[data-seg]', content).forEach(seg => {
    const k = seg.dataset.seg;
    $$('.ml-seg-btn', seg).forEach(btn => {
      btn.onclick = () => {
        haptic(6);
        let v = btn.dataset.v;
        if (k === 'pageSize') v = parseInt(v, 10);
        state.settings[k] = v;
        $$('.ml-seg-btn', seg).forEach(b => b.classList.toggle('active', b === btn));
        saveSettings();
      };
    });
  });

  // PFP 上傳
  const pfpBtn = $('#ml-pfp-pick');
  const pfpInput = $('#ml-pfp-input');
  pfpBtn.onclick = () => pfpInput.click();
  pfpInput.addEventListener('change', async () => {
    const file = pfpInput.files && pfpInput.files[0];
    pfpInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Not an image', 'fa-circle-exclamation'); return; }
    if (file.size > 2 * 1024 * 1024) { toast('Max 2MB', 'fa-circle-exclamation'); return; }

    pfpBtn.disabled = true;
    pfpBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';
    try {
      const dataUrl = await compressImage(file, 512, 0.85);
      const r = await apiCall('/api/users?action=pfp', 'POST', { image: dataUrl });
      if (r && r.success && r.pfp) {
        state.user.pfp = r.pfp;
        const el = $('#ml-pfp-avatar');
        if (el) el.innerHTML = `<img src="${escAttr(r.pfp)}" alt="">`;
        toast('Updated', 'fa-circle-check');
        haptic(10);
      } else {
        toast(r && r.message || 'Upload failed', 'fa-circle-exclamation');
      }
    } catch (e) {
      toast('Network error', 'fa-wifi');
    } finally {
      pfpBtn.disabled = false;
      pfpBtn.innerHTML = '<i class="fas fa-camera"></i> Change';
    }
  });

  // Cache All Problems
  const cacheBtn = $('#ml-cache-btn');
  cacheBtn.onclick = async () => {
    if (cacheBtn.disabled || state._cacheInProgress) return;
    haptic(10);

    if (!navigator.onLine) {
      toast('Offline — cannot cache', 'fa-plane');
      return;
    }

    state._cacheInProgress = true;
    cacheBtn.disabled = true;
    cacheBtn.classList.add('caching');

    const hint = $('#ml-cache-status');
    const origHint = hint ? hint.textContent : '';

    try {
      const count = await cacheAllProblems((done, total) => {
        const pct = Math.floor(done / total * 100);
        cacheBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${pct}%`;
        if (hint) hint.textContent = `Downloading… ${done}/${total}`;
      });
      toast(`Cached ${count} problems`, 'fa-circle-check');
      haptic(15);
    } catch (e) {
      toast('Cache failed: ' + (e.message || 'unknown'), 'fa-circle-exclamation');
      if (hint) hint.textContent = origHint;
    } finally {
      state._cacheInProgress = false;
      cacheBtn.classList.remove('caching');
      await updateCacheButtonUI();
    }
  };

  // Drafts sync
  const draftsBtn = $('#ml-drafts-btn');
  draftsBtn.onclick = async () => {
    if (draftsBtn.disabled) return;
    haptic(10);
    draftsBtn.disabled = true;
    draftsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    await syncDrafts();
    await updateDraftsUI();
  };
    // Force Reset
  const resetBtn = $('#ml-reset-btn');
  if (resetBtn) {
    resetBtn.onclick = async () => {
      if (resetBtn.disabled) return;
      const ok = confirm(
        'Force Reset\n\n' +
        '• Clear all caches (Cache Storage)\n' +
        '• Unregister Service Worker\n' +
        '• Stop the app\n\n' +
        'You will need to close and reopen the app.'
      );
      if (!ok) return;

      haptic(30);
      resetBtn.disabled = true;
      resetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting…';

      // 1) 清 Cache Storage
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
      } catch (e) { console.warn('clear caches failed', e); }

      // 2) 註銷所有 Service Worker
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
      } catch (e) { console.warn('unregister SW failed', e); }

      // 3) 清 sessionStorage（保留 auth_token）
      try { sessionStorage.clear(); } catch {}

      // 4) 崩潰
      crashOut();
    };
  }

  // 帳號操作
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
          toast(r.success ? 'Password updated' : (r.message || 'Failed'), r.success ? 'fa-circle-check' : 'fa-circle-exclamation');
        } catch { toast('Network error', 'fa-wifi'); }
      } else if (a === 'name') {
        const cur = state.user ? (state.user.displayName || state.user.username) : '';
        const nn = prompt('New display name', cur);
        if (!nn || !nn.trim()) return;
        try {
          const r = await apiCall('/api/users?action=changename', 'POST', { newname: nn.trim() });
          if (r.success) { state.user.displayName = nn.trim(); toast('Updated', 'fa-circle-check'); }
          else toast(r.message || 'Failed', 'fa-circle-exclamation');
        } catch { toast('Network error', 'fa-wifi'); }
      } else if (a === 'logout') {
        haptic(10);
        if (!confirm('Sign out?')) return;
        setToken(null);
        setTimeout(() => location.reload(), 60);
      }
    };
  });

  await updateCacheButtonUI();
  await updateDraftsUI();
}

// 圖片壓縮
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
          else { w = Math.round(w * maxDim / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Load failed'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════
// 21. 路由分派
// ═══════════════════════════════════════════════════════════
const SCROLL_KEEP_PATHS = /^\/(problems|submissions|contests|rank|me|settings)?$/;

async function renderRoute() {
  const prevPath = state.route.path;
  state.route = parseRoute();
  const p = state.route.parts;
  const nextPath = state.route.path;
  const isFirst = state._firstRender;
  const direction = isFirst ? 'fade' : detectDirection(prevPath, nextPath);

  renderTabBar();

  const content = $('#ml-content');
  const keep = SCROLL_KEEP_PATHS.test(nextPath);
  if (content) {
    if (keep) {
      const saved = state._scrollMemory[nextPath];
      content.scrollTop = typeof saved === 'number' ? saved : 0;
    } else {
      content.scrollTop = 0;
    }
  }

  renderAppBar({ leftDisabled: p.length <= 1, rightDisabled: true });

  const doTransition = !isFirst && content && state.settings.animations;
  if (doTransition) {
    content.innerHTML = `<div class="ml-page"><div class="ml-loading-center"><span class="ml-spinner"></span></div></div>`;
    animatePageEnter(content, direction);
  }

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

  if (doTransition) {
    setTimeout(() => { staggerIn(content); }, 30);
  }

  state._firstRender = false;
}

// ═══════════════════════════════════════════════════════════
// 22. 滾動隱藏 AppBar
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
// 23. Login
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
          <div class="ml-input-wrap">
            <i class="fas fa-user"></i>
            <input type="text" class="ml-input" id="ml-login-u" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">
          </div>
          <div class="ml-input-wrap">
            <i class="fas fa-lock"></i>
            <input type="password" class="ml-input" id="ml-login-p" placeholder="Password" autocomplete="current-password">
          </div>
          <div class="ml-login-err" id="ml-login-err"></div>
          <button type="submit" class="ml-btn full" id="ml-login-btn">
            <i class="fas fa-right-to-bracket"></i> Sign In
          </button>
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

  const shake = () => {
    if (!state.settings.animations) return;
    [uInp, pInp].forEach(el => {
      if (!el || typeof el.animate !== 'function') return;
      try {
        el.animate(
          [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' },
           { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' },
           { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
          { duration: 360, easing: 'ease' }
        );
      } catch {}
    });
    haptic(20);
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = uInp.value.trim();
    const p = pInp.value;
    if (!u || !p) {
      err.textContent = 'Enter username and password';
      shake();
      return;
    }
    err.textContent = '';
    btn.disabled = true;
    btn.innerHTML = '<span class="ml-spinner" style="width:14px;height:14px;border-width:2px"></span>';

    const loginStart = Date.now();
    try {
      const result = await doLogin(u, p);
      const elapsed = Date.now() - loginStart;
      if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed));
      if (result && result.success) {
        haptic(15);
        location.reload();
        return;
      }
      err.textContent = (result && result.message) || 'Invalid credentials';
      shake();
    } catch (e2) {
      const elapsed = Date.now() - loginStart;
      if (elapsed < 500) await new Promise(r => setTimeout(r, 500 - elapsed));
      err.textContent = 'Network error';
      shake();
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Sign In';
  });

  $('#ml-login-ms').onclick = () => { location.href = '/api/auth/microsoft'; };
}

// ═══════════════════════════════════════════════════════════
// 24. Service Worker / 離線
// ═══════════════════════════════════════════════════════════
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  let isFirstLoad = !navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isFirstLoad) { isFirstLoad = false; return; }
    if (!sessionStorage.getItem('sw_reloaded')) {
      sessionStorage.setItem('sw_reloaded', '1');
      location.reload();
    }
  });

  navigator.serviceWorker
    .register('/mobile/sw.js', { scope: '/mobile/' })
    .then(reg => reg.update().catch(() => {}))
    .catch(err => console.warn('[sw] register failed:', err));
}

function setupOfflineIndicator() {
  const update = () => {
    document.body.classList.toggle('ml-offline', navigator.onLine === false);
  };
  update();
  window.addEventListener('online', () => {
    update();
    toast('Online', 'fa-wifi');
    setTimeout(() => { syncDrafts(); }, 800);
  });
  window.addEventListener('offline', () => {
    update();
    toast('Offline mode', 'fa-plane');
  });
}

// ═══════════════════════════════════════════════════════════
// 25. 啟動
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
// ═══════════════════════════════════════════════════════════
// 崩潰退出
// ═══════════════════════════════════════════════════════════
function crashOut() {
  // 1) 停止網路活動
  try { window.stop && window.stop(); } catch {}

  // 2) 停止所有定時器（瀏覽器 timer ID 是遞增整數）
  try {
    for (let i = 1; i < 100000; i++) {
      clearTimeout(i);
      clearInterval(i);
    }
  } catch {}

  // 3) 清空 DOM 並換上崩潰畫面
  try {
    document.documentElement.innerHTML = `
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
        <title>App Stopped</title>
        <style>
          html,body{margin:0;padding:0;height:100%;width:100%;
            background:#0a0a0a;color:#f85149;
            font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;
            display:flex;align-items:center;justify-content:center;text-align:center;
            overscroll-behavior:none;user-select:none;-webkit-user-select:none;
            -webkit-tap-highlight-color:transparent}
          .crash-inner{padding:32px 24px;max-width:360px}
          .crash-icon{font-size:56px;margin-bottom:18px;opacity:.85;color:#f85149}
          .crash-title{font-size:18px;font-weight:800;color:#e6edf3;margin-bottom:8px;letter-spacing:-.2px}
          .crash-text{font-size:13px;color:#8b949e;line-height:1.6;margin-bottom:24px}
          .crash-hint{font-size:11px;color:#484f58;line-height:1.6}
        </style>
      </head>
      <body>
        <div class="crash-inner">
          <div class="crash-icon">⚠</div>
          <div class="crash-title">App Stopped</div>
          <div class="crash-text">
            All caches have been cleared.<br>
            The app has been halted intentionally.
          </div>
          <div class="crash-hint">
            Close this window and reopen the app to continue.
          </div>
        </div>
      </body>
    `;
  } catch (e) {
    try { document.body.innerHTML = '<div style="padding:40px;color:#f85149;background:#0a0a0a;height:100vh">App stopped.</div>'; } catch {}
  }

  // 4) 阻止所有指標交互
  try {
    document.body.style.pointerEvents = 'none';
    document.body.style.userSelect = 'none';
    document.documentElement.style.pointerEvents = 'none';
  } catch {}

  // 5) 移除所有事件監聽：把 window / document 上的 handler 換掉（部分能生效）
  try {
    // 阻止所有鍵盤輸入
    window.addEventListener('keydown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, true);
    // 阻止所有滾動
    window.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  } catch {}

  // 6) 嘗試關閉視窗（PWA 通常無效，普通 tab 有時有效）
  try { window.close(); } catch {}
  try {
    window.open('', '_self', '');
    window.close();
  } catch {}

  // 7) 讓 JS 引擎進入死循環狀態（在微任務隊列的最後丟出一個 uncaught error）
  setTimeout(() => {
    throw new Error('__APP_FORCE_RESET__');
  }, 60);
}

async function boot() {
  requestAnimationFrame(tickProgress);
  loadSettings();
  setupOfflineIndicator();
  registerServiceWorker();

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

  // 有網路時自動同步草稿
  if (navigator.onLine) {
    setTimeout(() => { syncDrafts(); }, 3000);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();