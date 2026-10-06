// pd-script.js — problem detail page
// ═══════════════════════════════════════════════════════════════════
// 分區索引：
//   [1] 常數 & 全域狀態
//   [2] 工具函式
//   [3] 本地儲存（Timer & Answers）
//   [4] 動態樣式注入
//   [5] 繪圖工具（外部 draw.js）
//   [6] PDF.js 載入 / 渲染
//   [7] 拖曳 & 縮放（MCQ 浮窗）
//   [8] PDF + MCQ 掛載
//   [9] 相似題目 / 舉報彈窗
//   [10] 討論區
//   [11] 答題互動（模式 / 提交）
//   [12] 主流程 & 生命週期
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// [1] 常數 & 全域狀態
// ───────────────────────────────────────────────────────────────────
if (!isLoggedIn()) window.location.href = '/index.html';

const __pathMatch = location.pathname.match(/^\/problems\/([^/]+)$/);
if (!__pathMatch) {
  document.getElementById('mainContent').innerHTML =
    '<div class="error-msg">Invalid problem URL.</div>';
  throw new Error('No problem ID');
}
const problemId   = decodeURIComponent(__pathMatch[1]);
const PAGE_LOAD_AT = Date.now();

const mainContainer = document.getElementById('mainContent');

// 集中式狀態
const S = {
  userStates: {},         // { [pid]: 'passed' | 'failed' }
  imageData: '',          // 待提交圖片
  cooldown: false,
  pollTimer: null,        // 圖片提交後輪詢
  currentMode: 'numeric',
  problemName: '',
  favorites: new Set(),
  timer: { seconds: 0, interval: null, running: false },
};

// ───────────────────────────────────────────────────────────────────
// [2] 工具函式
// ───────────────────────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// 讓 innerHTML 注入的 <script> 真的會執行
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

// 動態載入外部腳本（同一 src 只載一次）
const _scriptCache = new Map();
function loadScript(src) {
  if (_scriptCache.has(src)) return _scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
  _scriptCache.set(src, p);
  return p;
}

// ───────────────────────────────────────────────────────────────────
// [3] 本地儲存：Timer & Answers
// ───────────────────────────────────────────────────────────────────
const TIMER_KEY   = `timer_${problemId}`;
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

// ───────────────────────────────────────────────────────────────────
// [4] 動態樣式注入
// ───────────────────────────────────────────────────────────────────
function injectStyle(id, css) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}

injectStyle('pd-feedback-style', `
.feedback-box{display:inline-block;padding:.3rem .9rem;border-radius:4px;border:1px solid;font-weight:600;text-decoration:none;cursor:pointer;font-size:.9rem;transition:filter .15s,transform .1s}
.feedback-box:hover{filter:brightness(.94);transform:translateY(-1px)}
.feedback-box:active{transform:translateY(0)}
.feedback-box.status-accepted{background:#d4edda;color:#155724;border-color:#c3e6cb}
.feedback-box.status-wrong{background:#f8d7da;color:#721c24;border-color:#f5c6cb}
.feedback-box.status-partial{background:#fff3cd;color:#856404;border-color:#ffeeba}
.feedback-box.status-system{background:#e2e3e5;color:#383d41;border-color:#d6d8db}
.feedback-box.status-pending{background:#eee;color:#666;border-color:#d6d8db}
[data-theme="dark"] .feedback-box.status-accepted{background:#1b4d2e;color:#8fdf8f;border-color:#2e6b3e}
[data-theme="dark"] .feedback-box.status-wrong{background:#4d1b1b;color:#df8f8f;border-color:#6b2e2e}
[data-theme="dark"] .feedback-box.status-partial{background:#4d3e1b;color:#dfc88f;border-color:#6b562e}
[data-theme="dark"] .feedback-box.status-system{background:#2d2d2d;color:#bbb;border-color:#444}
[data-theme="dark"] .feedback-box.status-pending{background:#2d2d2d;color:#999;border-color:#444}
`);

injectStyle('pd-misc-style', `
.si-item{display:block;padding:10px 14px;background:var(--card-bg);border:1px solid var(--border-color);border-radius:6px;margin-bottom:8px;text-decoration:none;color:var(--text-primary);transition:border-color .15s,transform .12s,box-shadow .15s}
.si-item:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:0 2px 8px rgba(0,0,0,.08)}
.si-title{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:5px;font-size:.95rem}
.si-id{font-family:'Consolas',monospace;color:var(--accent);flex-shrink:0}
.si-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.si-meta{display:flex;gap:10px;font-size:.8rem;color:var(--text-secondary);flex-wrap:wrap;align-items:center}
.si-tag{background:rgba(74,144,217,.12);color:var(--accent);padding:1px 8px;border-radius:10px;font-size:.72rem;font-weight:600}
.si-tag.common{background:rgba(46,204,113,.15);color:#2e7d32}
.si-badge{font-size:.72rem;font-weight:700;color:#e67e22;flex-shrink:0}
.si-empty,.si-loading{text-align:center;padding:30px 20px;color:var(--text-secondary);font-size:.9rem}
[data-theme="dark"] .si-tag{background:rgba(74,144,217,.25)}
[data-theme="dark"] .si-tag.common{background:rgba(46,204,113,.25);color:#8fce9f}


/* ═══ Workbench ═══ */
.answer-workbench {
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  margin: 1rem 0 1.4rem;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}

/* ═══ Tabs ═══ */
.wb-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-color);
  background: rgba(0,0,0,.02);
}
[data-theme="dark"] .wb-tabs { background: rgba(255,255,255,.02); }

.wb-tab {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 2px;
  padding: 10px 8px;
  border: none; background: none;
  color: var(--text-secondary);
  cursor: pointer; font-family: inherit;
  font-size: .9rem; font-weight: 600;
  border-bottom: 2px solid transparent;
  transition: all .15s;
  min-width: 0;
}
.wb-tab i { font-size: 1rem; line-height: 1; }
.wb-tab span { font-size: .88rem; line-height: 1.2; }
.wb-tab small {
  font-size: .68rem; opacity: .65;
  font-weight: 400; line-height: 1.1;
  white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
}
.wb-tab:hover:not(:disabled) { color: var(--text-primary); background: rgba(74,144,217,.04); }
.wb-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  background: rgba(74,144,217,.06);
}
.wb-tab.active small { color: var(--accent); opacity: .9; }
.wb-tab:disabled {
  opacity: .4;
  cursor: not-allowed;
  filter: grayscale(.6);
}

/* ═══ Hint ═══ */
.wb-hint {
  padding: 8px 16px;
  font-size: .82rem;
  color: var(--text-secondary);
  background: rgba(74,144,217,.05);
  border-bottom: 1px solid var(--border-color);
  display: flex; align-items: center; gap: 8px;
  min-height: 36px;
}
.wb-hint i { color: var(--accent); opacity: .8; }

/* ═══ Panes ═══ */
.wb-panes { padding: 14px 16px; }
.wb-pane { display: none; }
.wb-pane.active { display: block; }

.wb-input {
  width: 100%; padding: 12px 14px;
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  background: var(--card-bg); color: var(--text-primary);
  font-family: inherit; font-size: 1rem;
  box-sizing: border-box;
  transition: border-color .15s;
}
.wb-input:focus { outline: none; border-color: var(--accent); }
.wb-input.saved-hint { background: rgba(74,144,217,.08); }

.wb-textarea {
  width: 100%; padding: 12px 14px;
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
  background: var(--card-bg); color: var(--text-primary);
  font-family: inherit; font-size: .95rem; line-height: 1.6;
  resize: vertical; min-height: 200px;
  box-sizing: border-box;
  transition: border-color .15s;
}
.wb-textarea:focus { outline: none; border-color: var(--accent); }
.wb-textarea:disabled { opacity: .5; cursor: not-allowed; }

.wb-counter {
  margin-top: 6px;
  font-size: .78rem; color: var(--text-secondary);
  font-family: 'Consolas', monospace;
  text-align: right;
}
.wb-counter.warn  { color: #f0ad4e; }
.wb-counter.limit { color: var(--danger); }

/* ═══ Photo dropzone ═══ */
.wb-dropzone {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 6px; padding: 36px 20px;
  border: 2px dashed var(--border-color);
  border-radius: 10px;
  background: rgba(74,144,217,.02);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all .15s;
  text-align: center;
}
.wb-dropzone:hover,
.wb-dropzone.dragover {
  border-color: var(--accent);
  background: rgba(74,144,217,.06);
  color: var(--accent);
}
.wb-dropzone i { font-size: 2rem; opacity: .65; margin-bottom: 4px; }
.wb-dropzone .dz-title { font-size: .95rem; font-weight: 600; }
.wb-dropzone small { font-size: .74rem; opacity: .7; }

.wb-photo-preview {
  display: flex; flex-direction: column;
  align-items: center; gap: 12px;
  padding: 4px 0;
}
.wb-photo-preview img {
  max-width: 100%; max-height: 320px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  box-shadow: 0 4px 12px rgba(0,0,0,.08);
}
.wb-photo-actions { display: flex; gap: 10px; }
.wb-photo-actions button {
  padding: 6px 14px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: none; color: var(--text-primary);
  cursor: pointer; font-family: inherit; font-size: .85rem;
  font-weight: 600;
  transition: all .15s;
}
.wb-photo-actions button:hover { border-color: var(--accent); color: var(--accent); }
#wbRemoveImage:hover { border-color: var(--danger); color: var(--danger); }

/* ═══ Footer ═══ */
.wb-footer {
  display: flex; justify-content: space-between; align-items: center;
  gap: 12px; padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  background: rgba(0,0,0,.015);
  flex-wrap: wrap;
}
[data-theme="dark"] .wb-footer { background: rgba(255,255,255,.02); }

.wb-status {
  font-size: .85rem;
  color: var(--text-secondary);
  min-height: 1.2em; flex: 1;
  min-width: 0;
}
.wb-status.ok   { color: #2e7d32; font-weight: 600; }
.wb-status.err  { color: var(--danger); font-weight: 600; }
.wb-status.busy { color: var(--accent); font-weight: 600; }

.wb-footer-actions {
  display: flex; gap: 8px; align-items: center;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.wb-btn-secondary {
  padding: 8px 14px;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: none; color: var(--text-secondary);
  cursor: pointer; font-family: inherit;
  font-size: .84rem; font-weight: 600;
  transition: all .15s;
}
.wb-btn-secondary:hover { border-color: var(--accent); color: var(--accent); }

.wb-submit {
  padding: 9px 26px;
  border: none; border-radius: 7px;
  background: var(--accent); color: #fff;
  cursor: pointer; font-family: inherit;
  font-size: .9rem; font-weight: 700;
  display: inline-flex; align-items: center; gap: 8px;
  transition: filter .15s, opacity .15s;
}
.wb-submit:hover:not(:disabled) { filter: brightness(1.1); }
.wb-submit:disabled { opacity: .5; cursor: not-allowed; }
.wb-submit {
  padding: 9px 26px;
  border: none; border-radius: 7px;
  background: #28a745; color: #fff;
  cursor: pointer; font-family: inherit;
  font-size: .9rem; font-weight: 700;
  display: inline-flex; align-items: center; gap: 8px;
  transition: filter .15s, background .15s, opacity .15s;
}
.wb-submit:hover:not(:disabled) { filter: brightness(1.08); }
.wb-submit:disabled {
  background: #8a8f96;
  opacity: .75;
  cursor: not-allowed;
}

/* Submissions 按鈕：藍色 */
#submissionsBtn {
  background: #4a90d9;
  border-color: #4a90d9;
  color: #fff;
}
#submissionsBtn:hover {
  background: #3a7bc8;
  border-color: #3a7bc8;
  color: #fff;
  filter: brightness(1.05);
}
/* ═══ Mobile ═══ */
@media (max-width: 600px) {
  .wb-tab small { display: none; }
  .wb-tab { padding: 10px 4px; }
  .wb-tab span { font-size: .82rem; }
  .wb-footer { flex-direction: column; align-items: stretch; }
  .wb-footer-actions { justify-content: space-between; }
  .wb-submit { flex: 1; justify-content: center; }
}
/* ═══ Expression preview ═══ */
.wb-expr-preview {
  display: flex; align-items: center; gap: 10px;
  margin-top: 8px; padding: 8px 14px;
  background: rgba(46,204,113,.08);
  border: 1px solid rgba(46,204,113,.35);
  border-radius: 8px;
  font-size: .88rem;
  animation: exprFadeIn .16s ease;
  transition: background .15s, border-color .15s;
}
/* 未计算（原文）→ 灰色 */
.wb-expr-preview.plain {
  background: rgba(128,128,128,.06);
  border-color: var(--border-color);
}
.wb-expr-preview.plain i { color: var(--text-secondary); }
.wb-expr-preview.plain .expr-value { color: var(--text-primary); font-weight: 500; }
@keyframes exprFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.wb-expr-preview i {
  color: #2ecc71; font-size: 1rem; flex-shrink: 0;
}
.wb-expr-preview .expr-label {
  color: var(--text-secondary); font-size: .82rem;
  flex-shrink: 0;
}
.wb-expr-preview .expr-value {
  font-family: 'Consolas', 'Monaco', monospace;
  font-weight: 700; font-size: .95rem;
  color: #2e7d32;
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;
}
[data-theme="dark"] .wb-expr-preview {
  background: rgba(46,204,113,.12);
  border-color: rgba(46,204,113,.4);
}
[data-theme="dark"] .wb-expr-preview .expr-value { color: #8fdf8f; }
[data-theme="dark"] .wb-expr-preview.plain {
  background: rgba(255,255,255,.03);
  border-color: var(--border-color);
}
[data-theme="dark"] .wb-expr-preview.plain .expr-value { color: var(--text-primary); }
`);

function statusBoxHtml(subid, text, cls) {
  if (!subid) return esc(text);
  return `<a href="/submissions/${encodeURIComponent(subid)}/detail" class="feedback-box ${cls}">${esc(text)}</a>`;
}

// ───────────────────────────────────────────────────────────────────
// [5] 繪圖工具（外部 draw.js）
// ───────────────────────────────────────────────────────────────────
async function loadDrawTool() {
  if (window.DrawTool) return window.DrawTool;
  await loadScript('/script/draw.js');
  if (!window.DrawTool) throw new Error('DrawTool not found in draw.js');
  return window.DrawTool;
}

async function toggleDrawMode() {
  try {
    const DrawTool = await loadDrawTool();
    DrawTool.toggle(mainContainer);
  } catch (e) {
    console.error('[draw]', e);
    alert('Failed to load drawing tool: ' + e.message);
  }
}

// ───────────────────────────────────────────────────────────────────
// [6] PDF.js：懶載入 + 渲染
// ───────────────────────────────────────────────────────────────────
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  if (!window.pdfjsLib) throw new Error('pdfjsLib not found');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
}

let _pdfRenderToken = 0;
let _pdfCurrentDoc  = null;

async function renderPdfWithPdfJs(container, pdfUrl) {
  const token = ++_pdfRenderToken;
  if (_pdfCurrentDoc) { try { _pdfCurrentDoc.destroy(); } catch {} _pdfCurrentDoc = null; }

  const oldScrollTop = container.scrollTop || 0;
  container.innerHTML = '<div class="pdf-loading"><span class="spinner"></span> Loading PDF...</div>';

  let pdfjsLib;
  try {
    pdfjsLib = await loadPdfJs();
  } catch {
    if (token !== _pdfRenderToken) return;
    container.innerHTML = `<div class="pdf-error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load PDF viewer</p><a href="${esc(pdfUrl)}" target="_blank" rel="noopener">Open in new tab</a></div>`;
    return;
  }
  if (token !== _pdfRenderToken) return;

  try {
    const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
    if (token !== _pdfRenderToken) { try { pdf.destroy(); } catch {} return; }
    _pdfCurrentDoc = pdf;
    container.innerHTML = '';

    const dpr = window.devicePixelRatio || 1;
    const containerWidth = (container.clientWidth || container.offsetWidth || 800) - 8;

    for (let n = 1; n <= pdf.numPages; n++) {
      if (token !== _pdfRenderToken) return;
      const page = await pdf.getPage(n);
      if (token !== _pdfRenderToken) return;
      const unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (containerWidth / unscaled.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width  = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width  = Math.floor(viewport.width  / dpr) + 'px';
      canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
      canvas.className = 'pdf-page-canvas';
      container.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    if (token === _pdfRenderToken && oldScrollTop > 0) {
      requestAnimationFrame(() => { container.scrollTop = oldScrollTop; });
    }
  } catch {
    if (token !== _pdfRenderToken) return;
    container.innerHTML = `<div class="pdf-error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load PDF</p><a href="${esc(pdfUrl)}" target="_blank" rel="noopener">Open in new tab</a></div>`;
  }
}

function toGooglePreviewUrl(url) {
  if (!url || !/^https:\/\/(docs|drive)\.google\.com\//.test(url)) return null;
  const drive = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  const docs = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/?#]+)/);
  if (docs) return `https://docs.google.com/${docs[1]}/d/${docs[2]}/preview`;
  return null;
}

// ───────────────────────────────────────────────────────────────────
// [7] 拖曳 & 縮放
// ───────────────────────────────────────────────────────────────────
function makeDraggable(el, handle) {
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    dragging = true;
    const r = el.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY;
    ox = r.left;    oy = r.top;
    el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
    el.style.right = 'auto';       el.style.bottom = 'auto';
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const minTop = getTopbarHeight();
    el.style.left = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  ox + e.clientX - sx)) + 'px';
    el.style.top  = Math.max(minTop, Math.min(window.innerHeight - el.offsetHeight, oy + e.clientY - sy)) + 'px';
  });
  const end = e => { if (dragging) { dragging = false; try { handle.releasePointerCapture(e.pointerId); } catch {} } };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function makeResizable(el, handle, minW = 260, minH = 200) {
  let resizing = false, sx = 0, sy = 0, sw = 0, sh = 0;
  handle.addEventListener('pointerdown', e => {
    resizing = true;
    sx = e.clientX; sy = e.clientY;
    sw = el.offsetWidth; sh = el.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault(); e.stopPropagation();
  });
  handle.addEventListener('pointermove', e => {
    if (!resizing) return;
    el.style.width     = Math.max(minW, sw + e.clientX - sx) + 'px';
    el.style.height    = Math.max(minH, sh + e.clientY - sy) + 'px';
    el.style.maxHeight = 'none';
  });
  const end = e => { if (resizing) { resizing = false; try { handle.releasePointerCapture(e.pointerId); } catch {} } };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function applyFloatingInitialLayout(el) {
  const topbarH = getTopbarHeight();
  const isMobile = window.innerWidth <= 768;
  el.style.left = 'auto';
  el.style.right = 'auto';
  if (isMobile) {
    el.style.width    = Math.min(window.innerWidth - 16, 320) + 'px';
    el.style.right    = '8px';
    el.style.top      = (topbarH + 8) + 'px';
    el.style.maxHeight = '55vh';
  } else {
    el.style.width    = '400px';
    el.style.right    = '40px';
    el.style.top      = Math.max(topbarH + 20, 100) + 'px';
    el.style.maxHeight = '75vh';
  }
}

// ───────────────────────────────────────────────────────────────────
// [8] PDF + MCQ 掛載
// ───────────────────────────────────────────────────────────────────
function mountPdfQuizSplit() {
  const pdfMount = document.getElementById('pdf-quiz-split');
  if (!pdfMount) return;
  const pdfUrl = pdfMount.dataset.pdf;
  if (!pdfUrl) return;

  let absolutePdfUrl;
  try { absolutePdfUrl = new URL(pdfUrl, location.href).href; }
  catch { absolutePdfUrl = pdfUrl; }
  const googlePreviewUrl = toGooglePreviewUrl(absolutePdfUrl);

  injectStyle('pdf-quiz-split-style', `
.pdf-quiz-stage{position:relative;width:100%}
.pdf-quiz-left{width:100%;height:88vh;display:flex;flex-direction:column;border:1px solid var(--border-color);border-radius:6px;overflow:hidden;background:var(--card-bg)}
.pdf-viewer-header{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:#f0f2f5;border-bottom:1px solid var(--border-color);font-size:.85rem;flex-shrink:0;gap:8px}
[data-theme="dark"] .pdf-viewer-header{background:#21262d}
.pdf-viewer-title{font-weight:700;color:var(--text-primary)}
.pdf-viewer-actions{display:flex;gap:8px;align-items:center}
.pdf-open-btn{color:var(--accent);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:5px;font-size:.8rem}
.pdf-open-btn:hover{text-decoration:underline}
.mcq-toggle-btn{background:var(--accent);color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:.8rem;font-weight:600;cursor:pointer;font-family:inherit}
.mcq-toggle-btn:hover{background:var(--accent-hover)}
.pdf-pages-scroll{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;background:#525659;padding:6px 0;-webkit-overflow-scrolling:touch;min-height:0}
.pdf-page-canvas{display:block;margin:0 auto 8px;box-shadow:0 1px 4px rgba(0,0,0,.3);background:#fff}
.pdf-google-frame{flex:1 1 auto;width:100%;border:none;background:#fff;min-height:0}
.pdf-loading,.pdf-error{display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-secondary);padding:2rem 1rem;text-align:center;gap:.5rem}
.pdf-loading .spinner{width:24px;height:24px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:pdfSpin .8s linear infinite}
@keyframes pdfSpin{to{transform:rotate(360deg)}}
.pdf-error i{font-size:2rem;color:var(--danger)}
.pdf-error a{color:var(--accent);font-weight:600}
.mcq-floating-window{position:fixed;top:100px;right:40px;width:400px;max-height:75vh;background:rgba(214,232,252,.42);backdrop-filter:blur(14px) saturate(1.8) brightness(1.06);-webkit-backdrop-filter:blur(14px) saturate(1.8) brightness(1.06);border:1px solid rgba(255,255,255,.65);border-radius:12px;box-shadow:0 12px 40px rgba(0,40,100,.22),0 2px 8px rgba(0,40,100,.10),inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.35),inset 1px 0 0 rgba(255,255,255,.55),inset -1px 0 0 rgba(255,255,255,.55),inset 0 24px 44px -22px rgba(255,255,255,.55);z-index:9000;display:flex;flex-direction:column;overflow:hidden;font-size:.9rem;color:#0a2a4a;text-shadow:0 1px 0 rgba(255,255,255,.75)}
.mcq-float-header{cursor:move;padding:8px 12px;background:linear-gradient(180deg,rgba(255,255,255,.55) 0%,rgba(200,225,255,.28) 55%,rgba(180,210,245,.14) 100%);border-bottom:1px solid rgba(255,255,255,.55);display:flex;justify-content:space-between;align-items:center;user-select:none;font-weight:600;font-size:.8rem;flex-shrink:0;touch-action:none;color:#0a2a4a;text-shadow:0 1px 0 rgba(255,255,255,.9)}
.mcq-float-header .mcq-drag-icon{margin-right:6px;opacity:.5}
.mcq-close-btn{background:rgba(255,255,255,.45);border:1px solid rgba(255,255,255,.7);border-radius:6px;font-size:.75rem;cursor:pointer;color:#0a2a4a;padding:1px 8px;font-family:inherit;line-height:1.4}
.mcq-close-btn:hover{background:rgba(220,60,60,.8);color:#fff}
.mcq-float-body{flex:1 1 auto;overflow-y:auto;padding:.4rem;min-height:0;background:transparent}
.mcq-floating-window .mc-table{background:rgba(255,255,255,.65);border-collapse:collapse;width:100%;margin:0 auto .6rem;font-size:.85rem;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08),0 0 0 1px rgba(255,255,255,.5)}
.mcq-floating-window .mc-table th,.mcq-floating-window .mc-table td{border:1px solid rgba(100,140,190,.55);padding:.25rem .35rem;text-align:center;vertical-align:middle;background:rgba(255,255,255,.55)}
.mcq-floating-window .mc-table th{background:rgba(220,235,252,.9);color:#0a2a4a;font-weight:700;font-size:.78rem}
.mcq-floating-window .mc-table td:first-child{background:rgba(230,240,250,.92);color:#2a4a6a;font-weight:600;width:2.6em}
.mcq-floating-window .mc-table td:hover{background:rgba(200,225,250,.9)}
.mcq-floating-window .mc-table tr.mc-sep td{border-bottom:2px solid rgba(80,130,200,.8)}
.mcq-floating-window .mc-table input[type="radio"]{cursor:pointer;margin:0;width:15px;height:15px;accent-color:#4a90d9}
.mcq-floating-window .mc-submit-btn{background:linear-gradient(180deg,rgba(80,200,120,.95) 0%,rgba(40,167,69,.95) 100%);color:#fff;border:1px solid rgba(255,255,255,.6);padding:.5rem 2.5rem;border-radius:6px;font-size:.9rem;font-weight:700;cursor:pointer;display:block;margin:.4rem auto;letter-spacing:1px}
.mcq-floating-window .mc-submit-btn:hover{background:linear-gradient(180deg,rgba(90,215,135,1) 0%,rgba(50,185,80,1) 100%)}
.mcq-resize-handle{position:absolute;right:0;bottom:0;width:22px;height:22px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 45%,rgba(100,150,210,.4) 45%,rgba(100,150,210,.6) 100%);border-bottom-right-radius:8px;z-index:2}
.mcq-resize-handle:hover{background:linear-gradient(135deg,transparent 45%,rgba(100,150,210,.75) 45%,rgba(100,150,210,1) 100%)}
[data-theme="dark"] .mcq-floating-window{background:rgba(30,50,80,.45);border-color:rgba(150,190,240,.55);color:#d8e6f5;text-shadow:0 1px 0 rgba(0,0,0,.4);box-shadow:0 12px 40px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35),inset 0 1px 0 rgba(180,210,255,.4)}
[data-theme="dark"] .mcq-float-header{background:linear-gradient(180deg,rgba(140,180,240,.28) 0%,rgba(60,90,140,.14) 55%,rgba(40,60,100,.08) 100%);border-bottom-color:rgba(150,190,240,.4);color:#d8e6f5;text-shadow:0 1px 0 rgba(0,0,0,.5)}
[data-theme="dark"] .mcq-close-btn{background:rgba(80,120,180,.35);color:#d8e6f5;border-color:rgba(150,190,240,.45)}
[data-theme="dark"] .mcq-close-btn:hover{background:rgba(200,60,60,.85);color:#fff}
[data-theme="dark"] .mcq-floating-window .mc-table{background:rgba(20,30,45,.75);box-shadow:0 1px 3px rgba(0,0,0,.5),0 0 0 1px rgba(120,170,230,.2)}
[data-theme="dark"] .mcq-floating-window .mc-table th,[data-theme="dark"] .mcq-floating-window .mc-table td{border-color:rgba(120,160,220,.5);background:rgba(30,42,60,.7)}
[data-theme="dark"] .mcq-floating-window .mc-table th{background:rgba(45,60,85,.9);color:#c9dcff}
[data-theme="dark"] .mcq-floating-window .mc-table td:first-child{background:rgba(40,52,72,.92);color:#a8c0e0}
[data-theme="dark"] .mcq-floating-window .mc-table td:hover{background:rgba(70,100,145,.75)}
[data-theme="dark"] .mcq-floating-window .mc-table tr.mc-sep td{border-bottom:2px solid rgba(100,160,230,.9)}
@media (max-width:768px){.mcq-floating-window{width:calc(100vw - 16px)!important;max-width:320px;right:8px!important;left:auto!important;max-height:55vh}}
`);

  const quizMount = document.getElementById('mc-quiz-mount');
  const hasQuiz   = !!quizMount;

  // 建立外層 stage
  const stage = document.createElement('div');
  stage.className = 'pdf-quiz-stage';
  pdfMount.parentNode.insertBefore(stage, pdfMount);
  stage.appendChild(pdfMount);
  pdfMount.classList.add('pdf-quiz-left');

  pdfMount.innerHTML = `
    <div class="pdf-viewer-header">
      <span class="pdf-viewer-title">📄 ${googlePreviewUrl ? 'Google Drive' : 'PDF'}</span>
      <div class="pdf-viewer-actions">
        ${hasQuiz ? '<button class="mcq-toggle-btn" id="toggleMcqBtn"><i class="fas fa-clipboard-list"></i> Answer Sheet</button>' : ''}
        <a href="${esc(absolutePdfUrl)}" target="_blank" rel="noopener" class="pdf-open-btn">
          <i class="fas fa-external-link-alt"></i> Open
        </a>
      </div>
    </div>
    ${googlePreviewUrl
      ? `<iframe class="pdf-google-frame" src="${esc(googlePreviewUrl)}" allow="autoplay" referrerpolicy="no-referrer"></iframe>`
      : `<div class="pdf-pages-scroll" id="pdf-pages-scroll"></div>`}`;

  // PDF 渲染（僅非 Google 分支）
  if (!googlePreviewUrl) {
    const scroll = pdfMount.querySelector('.pdf-pages-scroll');
    renderPdfWithPdfJs(scroll, absolutePdfUrl);
    scroll.dataset.pdfUrl = absolutePdfUrl;

    if (window.ResizeObserver) {
      if (window.__pdfResizeObserver) { try { window.__pdfResizeObserver.disconnect(); } catch {} }
      let lastWidth = Math.floor(scroll.clientWidth);
      let rt = null;
      window.__pdfResizeObserver = new ResizeObserver(entries => {
        for (const e of entries) {
          const w = Math.floor(e.contentRect.width);
          if (Math.abs(w - lastWidth) < 100) continue;
          lastWidth = w;
          clearTimeout(rt);
          rt = setTimeout(() => {
            const sc = document.getElementById('pdf-pages-scroll');
            if (sc?.dataset.pdfUrl) renderPdfWithPdfJs(sc, sc.dataset.pdfUrl);
          }, 500);
        }
      });
      window.__pdfResizeObserver.observe(scroll);
    }
  }

  // MCQ 浮窗
  if (hasQuiz) {
    const floating = document.createElement('div');
    floating.className = 'mcq-floating-window';
    floating.id = 'mcqFloatingWindow';
    floating.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'mcq-float-header';
    header.id = 'mcqDragHandle';
    header.innerHTML = `
      <span><i class="fas fa-grip-vertical mcq-drag-icon"></i><i class="fas fa-clipboard-list"></i> Answer Sheet</span>
      <button class="mcq-close-btn" id="closeMcqBtn" title="Close">✕</button>`;

    const body = document.createElement('div');
    body.className = 'mcq-float-body';
    quizMount.parentNode.removeChild(quizMount);
    body.appendChild(quizMount);

    floating.appendChild(header);
    floating.appendChild(body);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'mcq-resize-handle';
    resizeHandle.title = 'Drag to resize';
    floating.appendChild(resizeHandle);
    document.body.appendChild(floating);

    applyFloatingInitialLayout(floating);
    makeDraggable(floating, header);
    makeResizable(floating, resizeHandle, 260, 200);

    let _lastW = window.innerWidth;
    window.addEventListener('resize', () => {
      if (Math.abs(window.innerWidth - _lastW) < 100) return;
      _lastW = window.innerWidth;
      if (!floating.style.left || floating.style.left === 'auto') applyFloatingInitialLayout(floating);
    });

    const toggleBtn = document.getElementById('toggleMcqBtn');
    const closeBtn  = document.getElementById('closeMcqBtn');
    const showBtnLabel = () => { if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-clipboard-list"></i> Answer Sheet'; };
    const hideBtnLabel = () => { if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-times"></i> Hide Answer'; };

    toggleBtn?.addEventListener('click', () => {
      const hidden = floating.style.display === 'none';
      floating.style.display = hidden ? 'flex' : 'none';
      hidden ? hideBtnLabel() : showBtnLabel();
    });
    closeBtn?.addEventListener('click', () => {
      floating.style.display = 'none';
      showBtnLabel();
    });
  }

  // paper-mount 內部：隱藏舊的分割/畫板
  const stmtContent = document.getElementById('statementContent');
  if (stmtContent) { stmtContent.style.flex = '1 1 100%'; stmtContent.style.maxWidth = '100%'; }
  const splitDivider = document.getElementById('splitDivider');
  if (splitDivider) splitDivider.style.display = 'none';
  const drawpadWrapper = document.getElementById('drawpadWrapper');
  if (drawpadWrapper) drawpadWrapper.style.display = 'none';
}

// MCQ 答案表
function mountMcQuiz() {
  const mount = document.getElementById('mc-quiz-mount');
  if (!mount) return;

  injectStyle('mc-quiz-style', `
.mc-table{width:100%;border-collapse:collapse;margin:0 auto 1rem;font-size:.9rem;background:#eef1f5;border-radius:4px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.mc-table th,.mc-table td{border:1px solid #c8ced7;padding:.3rem .4rem;text-align:center;vertical-align:middle}
.mc-table th{background:#dde2e9;font-weight:700;font-size:.8rem;color:#2c3e50}
.mc-table td{background:#eef1f5}
.mc-table td:first-child{font-weight:600;color:var(--text-secondary);background:#e3e7ee;width:3em}
.mc-table input[type="radio"]{cursor:pointer;margin:0;width:16px;height:16px;accent-color:var(--accent)}
.mc-table tr.mc-sep td{border-bottom:2px solid var(--accent)}
.mc-table.mc-many-options th,.mc-table.mc-many-options td{padding:.2rem .25rem;font-size:.8rem}
.mc-table.mc-many-options input[type="radio"]{width:14px;height:14px}
[data-theme="dark"] .mc-table{background:#1a1e25}
[data-theme="dark"] .mc-table th,[data-theme="dark"] .mc-table td{border-color:#3a424e}
[data-theme="dark"] .mc-table th{background:#2b313a;color:#e0e6ed}
[data-theme="dark"] .mc-table td{background:#1a1e25}
[data-theme="dark"] .mc-table td:first-child{background:#232830;color:#a8b4c0}
.mc-submit-btn{display:block;margin:.8rem auto 1.5rem;padding:.65rem 3rem;background:#28a745;color:#fff;border:none;border-radius:6px;font-size:1rem;font-weight:700;cursor:pointer;letter-spacing:1px}
.mc-submit-btn:hover{background:#218838}
`);

  const TOTAL   = clampInt(mount.dataset.total,   1, 200, 45);
  const OPTIONS = clampInt(mount.dataset.options, 2, 26,  4);
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, OPTIONS);
  const LETTER_SET = new Set(LETTERS.split(''));
  const SEP_EVERY = 5;

  const headerCells = ['<th>#</th>', ...LETTERS.split('').map(ch => `<th>${ch}</th>`)];
  let html = `
    <p style="color:var(--text-secondary);font-size:.85rem;margin:.3rem 0 .6rem 0;">
      Select one option (${LETTERS.split('').join('/')}) for each question. Unanswered → <code>X</code>.
    </p>
    <table class="mc-table${OPTIONS > 4 ? ' mc-many-options' : ''}">
      <thead><tr>${headerCells.join('')}</tr></thead><tbody>`;

  for (let i = 1; i <= TOTAL; i++) {
    const sep = (i % SEP_EVERY === 0 && i < TOTAL) ? ' class="mc-sep"' : '';
    let row = `<tr${sep}><td>${i}</td>`;
    for (const ch of LETTERS) row += `<td><input type="radio" name="mcq-${i}" value="${ch}"></td>`;
    html += row + '</tr>';
  }
  html += `</tbody></table><button id="mc-submit-btn" class="mc-submit-btn">submit</button>`;
  mount.innerHTML = html;

  const answerInputEl = document.getElementById('answerInput');

  function syncRadiosFromInput() {
    const str = (answerInputEl?.value || '').trim().toUpperCase();
    for (let i = 1; i <= TOTAL; i++) {
      const ch = str[i - 1];
      mount.querySelectorAll(`input[name="mcq-${i}"]`).forEach(r => { r.checked = false; });
      if (ch && LETTER_SET.has(ch)) {
        const radio = mount.querySelector(`input[name="mcq-${i}"][value="${ch}"]`);
        if (radio) radio.checked = true;
      }
    }
  }
  function syncInputFromRadios() {
    let ans = '';
    for (let i = 1; i <= TOTAL; i++) {
      const sel = mount.querySelector(`input[name="mcq-${i}"]:checked`);
      ans += sel ? sel.value : 'X';
    }
    ans = ans.replace(/X+$/, '');
    if (answerInputEl) answerInputEl.value = ans;
  }

  answerInputEl?.addEventListener('input', syncRadiosFromInput);

  mount.querySelectorAll('input[type="radio"]').forEach(r => {
    r.addEventListener('mousedown', function () { this.dataset.wasChecked = this.checked ? '1' : '0'; });
    r.addEventListener('click', function () {
      if (this.dataset.wasChecked === '1') { this.checked = false; this.dataset.wasChecked = '0'; }
      syncInputFromRadios();
    });
    r.addEventListener('change', syncInputFromRadios);
  });

  mount.querySelectorAll('.mc-table td').forEach(td => {
    const radio = td.querySelector('input[type="radio"]');
    if (!radio) return;
    td.style.cursor = 'pointer';
    td.addEventListener('click', e => {
      if (e.target === radio) return;
      if (radio.checked) { radio.checked = false; }
      else {
        mount.querySelectorAll(`input[name="${radio.name}"]`).forEach(r => { r.checked = false; });
        radio.checked = true;
      }
      syncInputFromRadios();
    });
  });

  syncRadiosFromInput();

  mount.querySelector('#mc-submit-btn')?.addEventListener('click', () => {
    let answer = '';
    for (let i = 1; i <= TOTAL; i++) {
      const sel = mount.querySelector(`input[name="mcq-${i}"]:checked`);
      answer += sel ? sel.value : 'X';
    }
    workbench.setMode('text');                             // ⭐ 强制切到文字模式
    document.getElementById('answerInput').value = answer;
    document.getElementById('checkAnswerBtn')?.click();
  });
}

// 整數夾限工具
function clampInt(raw, min, max, fallback) {
  const n = parseInt(raw, 10);
  return (Number.isFinite(n) && n >= min && n <= max) ? n : fallback;
}

// ───────────────────────────────────────────────────────────────────
// [9] 相似題目 / 舉報彈窗
// ───────────────────────────────────────────────────────────────────
async function openSimilar() {
  const modal = document.getElementById('similarModal');
  const list  = document.getElementById('similarList');
  const hint  = document.getElementById('similarHint');
  if (!modal || !list) return;

  modal.style.display = 'flex';
  list.innerHTML = '<div class="si-loading"><span class="spinner"></span> Searching similar problems...</div>';

  try {
    const data = await apiCall(`/api/problem?action=similar&id=${encodeURIComponent(problemId)}`);
    if (!data.success) throw new Error(data.message || 'Failed to load');

    const curTags = data.current?.tags || [];
    hint.textContent = curTags.length
      ? `Comparing against tags: ${curTags.join(', ')} · difficulty ${(data.current.difficulty || 0).toFixed(2)}`
      : `No tags on this problem — showing closest difficulty`;

    if (!data.similar?.length) {
      list.innerHTML = '<div class="si-empty"><i class="fas fa-search" style="font-size:28px;opacity:.4;display:block;margin-bottom:10px;"></i>No similar problems found.</div>';
      return;
    }

    const curTagSet = new Set(curTags.map(t => String(t).toLowerCase()));

    list.innerHTML = data.similar.map(p => {
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const tagsHtml = tags.slice(0, 6).map(t => {
        const common = curTagSet.has(String(t).toLowerCase());
        return `<span class="si-tag${common ? ' common' : ''}">${esc(t)}</span>`;
      }).join('');

      const diffVal = Number(p.difficulty) || 0;
      const diffText = diffVal === 0 ? '∞' : diffVal.toFixed(2);
      const delta = Number(p.diffDelta) || 0;
      const deltaText = delta < 0.01 ? 'exact' : `Δ${delta.toFixed(2)}`;

      return `
        <a href="/problems/${encodeURIComponent(p.id)}" class="si-item">
          <div class="si-title">
            <span class="si-id">${esc(p.id)}</span>
            <span class="si-name">${esc(p.name || '')}</span>
          </div>
          <div class="si-meta">
            <span>Lv.${diffText}</span>
            <span class="si-badge">${deltaText}</span>
            ${p.commonTags ? `<span style="color:#2ecc71;font-weight:600;">+${p.commonTags} tag${p.commonTags > 1 ? 's' : ''}</span>` : ''}
            <span style="flex:1;"></span>
            ${tagsHtml}
          </div>
        </a>`;
    }).join('');
  } catch (err) {
    console.error(err);
    list.innerHTML = `<div class="si-empty" style="color:var(--danger);">Error: ${esc(err.message)}</div>`;
  }
}

function bindReportModal() {
  const modal = document.getElementById('reportModal');
  const openBtn = document.getElementById('reportBtn');

  openBtn.addEventListener('click', () => {
    document.getElementById('reportReason').value = '';
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('reportReason').focus(), 50);
  });
  document.getElementById('reportCancelBtn').addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });

  document.getElementById('reportSubmitBtn').addEventListener('click', async function () {
    const reason = document.getElementById('reportReason').value.trim();
    if (!reason) return alert('Please describe the issue before submitting.');
    this.disabled = true;
    this.textContent = 'Submitting...';
    try {
      const res = await apiCall('/api/problem?action=report', 'POST', { problemId, reason });
      if (res.success) {
        modal.style.display = 'none';
        alert('Report submitted. Thank you!');
      } else {
        alert('Failed to submit report: ' + (res.message || 'Unknown error'));
      }
    } catch {
      alert('Network error. Please try again.');
    } finally {
      this.disabled = false;
      this.textContent = 'Submit Report';
    }
  });
}

// ───────────────────────────────────────────────────────────────────
// [10] 討論區
// ───────────────────────────────────────────────────────────────────
async function loadDiscussions(pid) {
  const listDiv = document.getElementById('discussionList');
  try {
    const data = await apiCall(`/api/problem?action=discussions&problemId=${encodeURIComponent(pid)}`);
    if (!data.success) { listDiv.innerHTML = '<p>Failed to load discussions.</p>'; return; }

    const me = getCurrentUser()?.username;
    listDiv.innerHTML = data.discussions.map(d => {
      const liked = Array.isArray(d.likedBy) && d.likedBy.includes(me);
      return `
        <div class="discussion-post" data-id="${d._id}">
          <div class="post-header">
            <span class="post-user">${esc(d.username)}</span>
            <span class="post-time">${new Date(d.createdAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}</span>
          </div>
          <div class="post-content">${DOMPurify.sanitize(d.content, DOMPURIFY_CONFIG)}</div>
          <div class="post-actions">
            <button class="like-btn ${liked ? 'liked' : ''}" data-id="${d._id}">
              ${liked ? '❤️' : '🤍'} <span class="likes-count">${d.likes || 0}</span>
            </button>
          </div>
        </div>`;
    }).join('') || '<p>No discussions yet.</p>';

    if (typeof renderMathInElement === 'function') {
      renderMathInElement(listDiv, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
    }

    listDiv.querySelectorAll('.like-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const discussionId = btn.dataset.id;
        const res = await apiCall('/api/problem?action=discussions', 'PUT', { action: 'like', discussionId });
        if (res.success) {
          const isLiked = res.discussion.likedBy?.includes(me);
          btn.className = `like-btn ${isLiked ? 'liked' : ''}`;
          btn.innerHTML = `${isLiked ? '❤️' : '🤍'} <span class="likes-count">${res.discussion.likes}</span>`;
        }
      });
    });

    document.getElementById('postDiscussionBtn').addEventListener('click', async () => {
      const content = document.getElementById('discussionContent').value.trim();
      if (!content) return alert('Content is empty');
      const res = await apiCall('/api/problem?action=discussions', 'POST', { problemId: pid, content });
      if (res.success) {
        document.getElementById('discussionContent').value = '';
        loadDiscussions(pid);
      } else {
        alert(res.message || 'Error');
      }
    });
  } catch {
    listDiv.innerHTML = '<p>Error loading discussions.</p>';
  }
}

// DOMPurify 白名單
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: ['b','i','u','strong','em','a','p','br','ul','ol','li','span','div','code','pre','svg','g','defs','clipPath','foreignObject','path','circle','line','polyline','polygon','rect','text','tspan','linearGradient','radialGradient','stop','image','use','img'],
  ALLOWED_ATTR: ['href','target','rel','class','id','style','xmlns','viewBox','width','height','d','cx','cy','r','x','y','x1','x2','y1','y2','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-opacity','stroke-opacity','opacity','font-size','text-anchor','dominant-baseline','transform','src','data-pdf','data-total'],
  ALLOW_DATA_ATTR: true
};

// ───────────────────────────────────────────────────────────────────
// [11] 答題互動（模式 / 圖片 / 提交 / Timer / 圖片狀態輪詢）
// ───────────────────────────────────────────────────────────────────
function updateProblemDetailIcon() {
  const state = S.userStates[problemId] || 'not_started';
  const el = document.getElementById('detailStatusIcon');
  if (el) {
    el.innerHTML = state === 'passed' ? '<i class="fa fa-check-circle fa-green"></i>'
                 : state === 'failed' ? '<i class="fa fa-times-circle fa-red"></i>'
                 : '';
  }
  if (S.problemName) document.title = S.problemName + ' - WYK Maths Team';
}

function startImageStatusPoll() {
  clearInterval(S.pollTimer);
  let attempts = 0;
  S.pollTimer = setInterval(async () => {
    if (++attempts > 120) {
      clearInterval(S.pollTimer);
      document.getElementById('detailSpinner').style.display = 'none';
      document.getElementById('detailStatusIcon').style.display = '';
      document.getElementById('detailStatusText').textContent = 'Timed out';
      return;
    }
    try {
      const data = await apiCall(`/api/submissions?problem_id=${encodeURIComponent(problemId)}`);
      if (!data.success) return;
      const sub = data.submissions[0];
      if (!(sub && sub.type === 'image' && sub.marked)) return;

      clearInterval(S.pollTimer);
      document.getElementById('detailSpinner').style.display = 'none';
      const iconEl = document.getElementById('detailStatusIcon');
      iconEl.style.display = 'inline';
      const status = sub.status;
      if (status === 'Accepted') {
        iconEl.innerHTML = '<i class="fa fa-check-circle fa-green"></i>';
        S.userStates[problemId] = 'passed';
      } else if (status === 'Wrong Answer') {
        iconEl.innerHTML = '<i class="fa fa-times-circle fa-red"></i>';
        if (S.userStates[problemId] !== 'passed') S.userStates[problemId] = 'failed';
      } else if (status.startsWith('Partial Score')) {
        iconEl.innerHTML = '<i class="fa fa-exclamation-triangle fa-yellow"></i>';
        if (S.userStates[problemId] !== 'passed') S.userStates[problemId] = 'failed';
      } else {
        iconEl.innerHTML = '<span style="color:#888;">-</span>';
      }
      document.getElementById('detailStatusText').textContent = status;
      updateProblemDetailIcon();
    } catch {}
  }, 5000);
}

// ---- Timer ----
function updateTimerDisplay() {
  const el = document.getElementById('timerDisplay');
  if (!el) return;
  const { seconds } = S.timer;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function startTimer() {
  if (S.timer.running) return;
  S.timer.running = true;
  S.timer.interval = setInterval(() => {
    S.timer.seconds++;
    updateTimerDisplay();
  }, 1000);
}
function pauseTimer() {
  if (!S.timer.running) return;
  S.timer.running = false;
  clearInterval(S.timer.interval);
}
function saveTimer() { localStorage.setItem(TIMER_KEY, String(S.timer.seconds)); }
function resetTimer() {
  pauseTimer();
  S.timer.seconds = 0;
  updateTimerDisplay();
  localStorage.removeItem(TIMER_KEY);
}
function toggleTimer() {
  const existing = document.getElementById('timerRow');
  if (existing) { pauseTimer(); saveTimer(); existing.remove(); return; }

  const container = document.getElementById('splitContainer');
  if (!container) return;

  const saved = parseInt(localStorage.getItem(TIMER_KEY) ?? '0', 10);
  S.timer.seconds = (!isNaN(saved) && saved >= 0) ? saved : 0;
  S.timer.running = false;

  const div = document.createElement('div');
  div.id = 'timerRow';
  div.className = 'timer-row';
  div.innerHTML = `
    <span class="timer-display" id="timerDisplay">00:00:00</span>
    <button class="timer-btn" id="timerStartBtn">Start</button>
    <button class="timer-btn" id="timerPauseBtn">Pause</button>
    <button class="timer-btn" id="timerResetBtn">Reset</button>
    <button class="timer-btn" id="timerCloseBtn">✕</button>`;
  container.parentNode.insertBefore(div, container);
  updateTimerDisplay();

  document.getElementById('timerStartBtn').addEventListener('click', startTimer);
  document.getElementById('timerPauseBtn').addEventListener('click', pauseTimer);
  document.getElementById('timerResetBtn').addEventListener('click', resetTimer);
  document.getElementById('timerCloseBtn').addEventListener('click', () => { pauseTimer(); saveTimer(); div.remove(); });
}

// ---- 上一題 / 下一題 ----
async function setupNavigation(currentProblem) {
  const nav = document.getElementById('navButtons');
  if (!nav) return;
  let ids = [];
  try {
    const cached = localStorage.getItem('problemListCache_full');
    if (cached) {
      const data = JSON.parse(cached);
      if (data.timestamp && (Date.now() - data.timestamp < 864e5) && data.problems?.length) {
        ids = data.problems.map(p => p.id);
      }
    }
    if (!ids.length) {
      const res = await apiCall('/api/problem?ids=1');
      if (res.success && res.ids) ids = res.ids;
      else { nav.innerHTML = ''; return; }
    }
    ids.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const idx = ids.indexOf(currentProblem.id);
    if (idx === -1) { nav.innerHTML = ''; return; }
    let html = '';
    if (idx > 0)                  html += `<a href="/problems/${encodeURIComponent(ids[idx - 1])}" class="back-btn" title="Previous Problem">← Prev</a>`;
    if (idx < ids.length - 1)     html += `<a href="/problems/${encodeURIComponent(ids[idx + 1])}" class="back-btn" title="Next Problem">Next →</a>`;
    nav.innerHTML = html;
  } catch (e) {
    console.error('Navigation setup error:', e);
    nav.innerHTML = '';
  }
}

// ───────────────────────────────────────────────────────────────────
// [11] Workbench（三模式）
// ───────────────────────────────────────────────────────────────────
const WB_HINTS = {
  none:  { icon: 'fa-hand-pointer', text: 'Select a submission mode above to begin' },
  text:  { icon: 'fa-bolt',         text: 'Numbers or short text — instant grading' },
  photo: { icon: 'fa-camera',       text: 'Photo or upload — will be marked manually' },
  steps: { icon: 'fa-pen-fancy',    text: 'Write full solution — AI grades by step' },
};

const WB_DRAFTS_KEY = 'pd_workbench_drafts';

const workbench = {
  mode: 'none',
  imageData: '',

  _draftKey() { return `${WB_DRAFTS_KEY}:${problemId}`; },
  _readDrafts() {
    try { return JSON.parse(localStorage.getItem(this._draftKey()) || '{}'); }
    catch { return {}; }
  },
  saveDraft(mode, val) {
    if (!val && val !== 0) return;
    const d = this._readDrafts();
    d[mode] = String(val);
    try { localStorage.setItem(this._draftKey(), JSON.stringify(d)); } catch {}
  },
  loadDraft(mode) { return this._readDrafts()[mode] || ''; },

  setMode(newMode) {
    if (!WB_HINTS[newMode]) return;

    // ⭐ 点击当前已激活的 tab → 收起
    if (newMode === this.mode && newMode !== 'none') {
      newMode = 'none';
    }

    const old = this.mode;

    // 保存旧草稿
    if (old === 'text')  this.saveDraft('text',  document.getElementById('answerInput').value);
    if (old === 'steps') this.saveDraft('steps', document.getElementById('stepsInput').value);

    // Tab 高亮（none 时全部取消）
    document.querySelectorAll('.wb-tab').forEach(t => {
      t.classList.toggle('active', newMode !== 'none' && t.dataset.mode === newMode);
    });

    // Pane 切换（none 时全部隐藏）
    document.querySelectorAll('.wb-pane').forEach(p => {
      p.classList.toggle('active', newMode !== 'none' && p.dataset.pane === newMode);
    });

    // Hint
    const h = WB_HINTS[newMode] || WB_HINTS.none;
    document.getElementById('wbHint').innerHTML =
      `<i class="fas ${h.icon}"></i><span>${h.text}</span>`;

    // 提交按钮
    const checkBtn = document.getElementById('checkAnswerBtn');
    const label = document.getElementById('wbSubmitLabel');
    if (newMode === 'none') {
      checkBtn.disabled = true;
      label.textContent = 'Submit';
    } else {
      checkBtn.disabled = false;
      if (newMode === 'text')  label.textContent = 'Submit';
      if (newMode === 'photo') label.textContent = 'Upload & Grade';
      if (newMode === 'steps') label.textContent = 'Submit to AI';
    }

    // 恢复草稿（保持之前输入的内容）
    if (newMode === 'text') {
      const input = document.getElementById('answerInput');
      input.value = this.loadDraft('text');
      updateExprPreview();                    // ⭐ 恢复草稿后刷新表达式预览
    } else if (newMode === 'steps') {
      const st = document.getElementById('stepsInput');
      st.value = this.loadDraft('steps');
      updateStepsCounter();
    } else if (newMode === 'photo') {
      const hasImg = !!this.imageData;
      document.getElementById('wbDropzone').hidden = hasImg;
      document.getElementById('wbPhotoPreview').hidden = !hasImg;
      if (hasImg) document.getElementById('imagePreview').src = this.imageData;
    }

    this.mode = newMode;
    setWorkbenchStatus('');                   // 清空状态
  },
};

function updateStepsCounter() {
  const el  = document.getElementById('stepsInput');
  const cnt = document.getElementById('stepsCount');
  if (!el || !cnt) return;
  const wrap = cnt.parentElement;
  const n = el.value.length;
  cnt.textContent = n;
  wrap.className = 'wb-counter' + (n >= 1000 ? ' limit' : n >= 900 ? ' warn' : '');
}

function setWorkbenchStatus(text, cls = '') {
  const el = document.getElementById('wbStatus');
  el.textContent = text;
  el.className = 'wb-status' + (cls ? ' ' + cls : '');
}
function setWorkbenchStatusHtml(html, cls = '') {
  const el = document.getElementById('wbStatus');
  el.innerHTML = html;
  el.className = 'wb-status' + (cls ? ' ' + cls : '');
}
// ───────────────────────────────────────────────────────────────────
// [11.0] 表達式求值（Text 模式用）
// ───────────────────────────────────────────────────────────────────
let _mathLoading = null;

function looksLikeExpression(s) {
  if (!s || s.length > 200) return false;
  if (!/\d/.test(s)) return false;   // 必須含數字
  return /[+\-*/^()]|\b(?:sqrt|sin|cos|tan|log|ln|exp|pi|abs|pow|cbrt|asin|acos|atan|round|floor|ceil|max|min)\b/i.test(s);
}

function formatNumber(num) {
  if (!Number.isFinite(num)) return String(num);

  const abs = Math.abs(num);

  // 整数 → 直接字符串（避免 "4.000000"）
  if (Number.isInteger(num) && abs < 1e15) return String(num);

  // 极大或极小 → 科学计数法（6 位有效数字，去尾 0）
  if (abs >= 1e15 || (abs !== 0 && abs < 1e-4)) {
    return num.toExponential(6).replace(/\.?0+e/, 'e');
  }

  // 一般情况 → 6 位小数，去尾 0
  let s = num.toFixed(6);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
function tryEvaluateExpression(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // 懶加載 math.js（若 arch-render.js 沒預載）
  if (typeof window.math === 'undefined') {
    if (!_mathLoading) {
      _mathLoading = loadScript('https://cdn.jsdelivr.net/npm/mathjs@12.4.1/lib/browser/math.js')
        .then(() => { _mathLoading = null; updateExprPreview(); })
        .catch(() => { _mathLoading = null; });
    }
    return null;
  }

  if (!looksLikeExpression(s)) return null;

  try {
    const node = math.parse(s);

    // 拒絕賦值 / 塊語句
    let unsafe = false;
    node.traverse(n => {
      if (n.type === 'AssignmentNode' ||
          n.type === 'FunctionAssignmentNode' ||
          n.type === 'BlockNode') {
        unsafe = true;
      }
    });
    if (unsafe) return null;

    const val = node.evaluate();
    let num;
    if (typeof val === 'number')                          num = val;
    else if (val && typeof val.toNumber === 'function')   num = val.toNumber();
    else if (typeof val === 'bigint')                     num = Number(val);
    else                                                  return null;

    if (!Number.isFinite(num)) return null;

    const out = formatNumber(num);
    if (out === s) return null;   // 結果和原文一樣（如輸入 "42"）→ 不顯示
    return out;
  } catch {
    return null;
  }
}

function updateExprPreview() {
  const input = document.getElementById('answerInput');
  const box   = document.getElementById('wbExprPreview');
  const text  = document.getElementById('wbExprResult');
  if (!input || !box || !text) return;

  const raw = input.value.trim();
  if (!raw) {
    box.hidden = true;
    return;
  }

  const computed = tryEvaluateExpression(raw);
  if (computed != null) {
    text.textContent = computed;
    box.classList.remove('plain');
  } else {
    text.textContent = raw;
    box.classList.add('plain');
  }
  box.hidden = false;
}
function getSubmissionPayload() {
  const m = workbench.mode;
  if (m === 'none')  return { error: 'Select a submission mode first' };
  if (m === 'text') {
    const raw = document.getElementById('answerInput').value.trim();
    if (!raw) return { error: 'Please enter an answer' };

    // ⭐ 表達式 → 自動替換為計算值
    const computed = tryEvaluateExpression(raw);
    const answer = computed != null ? computed : raw;

    return { type: 'text', answer, rawValue: raw };
  }
  if (m === 'photo') {
    if (!workbench.imageData) return { error: 'Please select an image first' };
    return { type: 'image', image: workbench.imageData, answer: '' };
  }
if (m === 'steps') {
  const steps = document.getElementById('stepsInput').value.trim();
  if (!steps)                return { error: 'Please enter your solution steps' };
  if (steps.length < 10)     return { error: 'Solution too short (min 10 chars)' };
  if (steps.length > 1000)   return { error: 'Solution too long (max 1000 chars)' };
  return { type: 'steps', answer: steps };
}
  return { error: 'Unknown mode' };
}

// ───────────────────────────────────────────────────────────────────
// [11.1] Bind workbench events
// ───────────────────────────────────────────────────────────────────
function bindAnswerInteractions() {
  // Tabs
  document.querySelectorAll('.wb-tab:not(:disabled)').forEach(tab => {
    tab.addEventListener('click', () => workbench.setMode(tab.dataset.mode));
  });

  // Text input
  const answerInput = document.getElementById('answerInput');
  answerInput.addEventListener('input', () => {
    saveAnswerDebounced(problemId, answerInput.value);
    updateExprPreview();                      // ⭐ 新增
  });
  answerInput.addEventListener('blur',  () => saveAnswerNow(problemId, answerInput.value));

  // Steps input (disabled, but wire-up harmless)
// Steps input
const stepsInput = document.getElementById('stepsInput');
stepsInput.addEventListener('input', () => {
  if (stepsInput.value.length > 1000) {
    stepsInput.value = stepsInput.value.slice(0, 1000);
  }
  updateStepsCounter();
  workbench.saveDraft('steps', stepsInput.value);
});
stepsInput.addEventListener('blur', () => workbench.saveDraft('steps', stepsInput.value));

  // Photo
  const dropzone  = document.getElementById('wbDropzone');
  const fileInput = document.getElementById('imageFileInput');
  const preview   = document.getElementById('wbPhotoPreview');
  const previewImg = document.getElementById('imagePreview');

  function acceptImageFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setWorkbenchStatus('Please select an image file', 'err'); return; }
    if (file.size > 5 * 1024 * 1024)     { setWorkbenchStatus('Image too large (max 5 MB)', 'err'); return; }

    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1920;
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        workbench.imageData = canvas.toDataURL('image/jpeg', 0.9);

        previewImg.src = workbench.imageData;
        dropzone.hidden = true;
        preview.hidden = false;
        setWorkbenchStatus('Image ready', 'ok');
      };
      img.onerror = () => setWorkbenchStatus('Cannot decode image', 'err');
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    acceptImageFile(fileInput.files[0]);
    fileInput.value = '';
  });
  ['dragenter','dragover'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', e => {
    const file = e.dataTransfer?.files?.[0];
    acceptImageFile(file);
  });

  document.getElementById('wbRetake').addEventListener('click', () => fileInput.click());
  document.getElementById('wbRemoveImage').addEventListener('click', () => {
    workbench.imageData = '';
    previewImg.src = '';
    preview.hidden = true;
    dropzone.hidden = false;
    setWorkbenchStatus('');
  });

  // Other buttons
  document.getElementById('drawToggleBtn')?.addEventListener('click', toggleDrawMode);
  document.getElementById('timerToggleBtn')?.addEventListener('click', toggleTimer);

  // Initial state
  workbench.setMode('none');
}

// ───────────────────────────────────────────────────────────────────
// [11.2] Submit
// ───────────────────────────────────────────────────────────────────
function bindSubmitEvent() {
  const checkBtn = document.getElementById('checkAnswerBtn');

  checkBtn.addEventListener('click', async () => {
    if (S.cooldown) return;

    const payload = getSubmissionPayload();
    if (payload.error) {
      setWorkbenchStatus(payload.error, 'err');
      return;
    }

    S.cooldown = true;
    checkBtn.disabled = true;
    if (payload.type === 'steps') {
      workbench.saveDraft('steps', payload.answer);
      return handleStepsSubmit(payload.answer, checkBtn);
    }
    setWorkbenchStatus(
      payload.type === 'image' ? 'Uploading…'
      : payload.type === 'steps' ? 'AI grading…'
      : 'Submitting…',
      'busy'
    );

    try {
      if (payload.type === 'text') {
        saveAnswerNow(problemId, payload.answer);
        // ⭐ 若用戶輸入了表達式，提交後把輸入框替換為計算值
        if (payload.rawValue && payload.rawValue !== payload.answer) {
          const inputEl = document.getElementById('answerInput');
          inputEl.value = payload.answer;
          updateExprPreview();
        }
      }
      if (payload.type === 'steps') workbench.saveDraft('steps', payload.answer);

      const body = {
        problemId,
        answer: payload.answer || '',
        type: payload.type,
        image: payload.image || '',
        pageDwellMs: Date.now() - PAGE_LOAD_AT,
      };
      const result = await apiCall('/api/submit', 'POST', body);

      checkBtn.disabled = false;
      S.cooldown = false;

      if (!result.success) {
        setWorkbenchStatus(result.message || 'Submission failed', 'err');
        return;
      }

      // ⭐ 結果用可點擊的 feedback-box 呈現
      if (result.message && result.message.includes('Image submitted')) {
        setWorkbenchStatusHtml(
          statusBoxHtml(result.subid, 'Image submitted for marking', 'status-pending')
        );
        document.getElementById('detailStatusIcon').style.display = 'none';
        document.getElementById('detailSpinner').style.display = 'inline-block';
        document.getElementById('detailStatusText').textContent = 'Pending';
        startImageStatusPoll();
      } else if (result.systemError) {
        setWorkbenchStatusHtml(
          statusBoxHtml(result.subid, 'System Error', 'status-system')
        );
      } else if (result.score !== undefined) {
        let txt, cls;
        if (result.score === 100)      { txt = 'Accepted';                    cls = 'status-accepted'; }
        else if (result.score === 0)   { txt = 'Wrong Answer';                cls = 'status-wrong';    }
        else                           { txt = `Partial Score (${result.score}%)`; cls = 'status-partial'; }
        setWorkbenchStatusHtml(statusBoxHtml(result.subid, txt, cls));
      } else {
        const txt = result.correct ? 'Accepted' : 'Wrong Answer';
        const cls = result.correct ? 'status-accepted' : 'status-wrong';
        setWorkbenchStatusHtml(statusBoxHtml(result.subid, txt, cls));
      }

      // Update state icon
      if (result.correct || result.score === 100) {
        S.userStates[problemId] = 'passed';
        if (localStorage.getItem('nekoModeUnlocked') === 'true' &&
            localStorage.getItem('showNekos') === 'true') {
          fetchNekoAndShow();
        }
      } else if (S.userStates[problemId] !== 'passed') {
        S.userStates[problemId] = 'failed';
      }
      updateProblemDetailIcon();

      if (result.unlockedAchievements && typeof showAchievementToasts === 'function') {
        showAchievementToasts(result.unlockedAchievements);
      }
    } catch (err) {
      checkBtn.disabled = false;
      S.cooldown = false;
      console.error('[submit] failed:', err);
      setWorkbenchStatus('Network error: ' + (err.message || 'unknown'), 'err');
    }
  });
}
// ---- Neko ----
function fetchNekoAndShow() {
  const container = document.getElementById('nekoContainer');
  const img = document.getElementById('nekoImage');
  const status = document.getElementById('nekoStatus');
  if (!container || !img || !status) return;

  container.style.display = 'block';
  status.textContent = 'Loading neko...';
  status.style.color = 'var(--text-secondary)';
  status.style.display = 'block';
  img.style.display = 'none';
  img.src = '';

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);

  fetch('https://nekos.best/api/v2/neko', { signal: ctrl.signal })
    .then(res => { clearTimeout(to); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(data => {
      if (!data.results?.length) throw new Error('No neko results');
      img.src = data.results[0].url;
      img.style.display = 'block';
      status.style.display = 'none';
      container.scrollIntoView({ behavior: 'smooth', block: 'center' });
    })
    .catch(err => {
      clearTimeout(to);
      status.textContent = `Load failed: ${err.name === 'AbortError' ? 'timeout' : err.message}`;
      status.style.color = 'var(--danger)';
      img.style.display = 'none';
    });
}
// ─────────────────────────────────────────────────────────────
// [11.3] Steps 模式：同步呼叫本地 server.js
// ─────────────────────────────────────────────────────────────
const GRADER_BASE = 'https://appeared-bernard-held-connector.trycloudflare.com ';

async function handleStepsSubmit(stepsText, checkBtn) {
  setWorkbenchStatus('AI 批改中…（約 10-40 秒，請稍等）', 'busy');

  try {
    const r = await fetch(`${GRADER_BASE}/grade-steps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        problem_id: problemId,
        student_steps: stepsText,
      }),
    });

    const data = await r.json();

    if (!r.ok || !data.success) {
      setWorkbenchStatus(data.message || 'Grading failed', 'err');
      return;
    }

    renderStepsResult({ score: data.score, comment: data.comment });
  } catch (err) {
    console.error('[steps submit]', err);
    setWorkbenchStatus('無法連線批改服務：' + err.message, 'err');
  } finally {
    S.cooldown = false;
    checkBtn.disabled = false;
  }
}

function renderStepsResult(result) {
  const score   = Number(result?.score) || 0;
  const comment = result?.comment || '';

  let label, cls;
  if (score === 100)     { label = 'Accepted (100)';          cls = 'status-accepted'; }
  else if (score === 0)  { label = 'Wrong Answer (0)';        cls = 'status-wrong';    }
  else                   { label = `Partial Score (${score})`; cls = 'status-partial'; }

  const display = comment ? `${label} — ${comment}` : label;
  setWorkbenchStatusHtml(
    `<span class="feedback-box ${cls}" style="cursor:default">${esc(display)}</span>`
  );

  if (score === 100) {
    S.userStates[problemId] = 'passed';
    if (localStorage.getItem('nekoModeUnlocked') === 'true' &&
        localStorage.getItem('showNekos') === 'true' &&
        typeof fetchNekoAndShow === 'function') {
      fetchNekoAndShow();
    }
  } else if (S.userStates[problemId] !== 'passed') {
    S.userStates[problemId] = 'failed';
  }
  updateProblemDetailIcon();
}
// ───────────────────────────────────────────────────────────────────
// [11.5] 頁面資料載入
// ───────────────────────────────────────────────────────────────────
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
// ───────────────────────────────────────────────────────────────────
// [12] 主流程
// ───────────────────────────────────────────────────────────────────
async function initPage() {
  try {
    mainContainer.innerHTML = '';

    const pageData = await loadPageData();
    if (!pageData?.problem) {
      mainContainer.innerHTML = '<div class="error-msg">Problem not found. Please try again later.</div>';
      return;
    }

    const problem = pageData.problem;
    S.problemName = problem.name || problemId;

    // 只記錄當前題的狀態
    S.userStates = {};
    if (pageData.state && pageData.state !== 'not_started') S.userStates[problemId] = pageData.state;
    S.favorites = new Set(pageData.favorited ? [problemId] : []);

    const diff    = problem.difficulty ?? 0;
    const isAdmin = getCurrentUser()?.role === 'admin' || getCurrentUser()?.role === 'root';
    const isFav   = S.favorites.has(problemId);
    const state   = S.userStates[problemId] || 'not_started';
    const hasAccess = isAdmin || state === 'passed';

    mainContainer.innerHTML = `
      <div class="problem-detail" id="problemDetailShell">
        <div class="detail-header">
          <button class="back-btn" id="backToListBtn">← Back</button>
          <span class="problem-name-detail">
            <span id="detailProblemName">${esc(problemId)} - ${esc(S.problemName)}</span>
            <span id="detailStatusIcon"></span>
            <span id="detailSpinner" class="spinner" style="display:none"></span>
            <span id="detailStatusText" style="margin-left:.5rem;font-size:.9rem"></span>
            <span id="detailFavorite" style="margin-left:8px;cursor:pointer">
              <i class="far fa-star" style="font-size:1.2rem;color:#aaa"></i>
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
            <button type="button" class="wb-tab" data-mode="text" role="tab">
              <i class="fas fa-keyboard"></i>
              <span>Text</span>
              <small>Instant grading</small>
            </button>
            <button type="button" class="wb-tab" data-mode="photo" role="tab">
              <i class="fas fa-camera"></i>
              <span>Photo</span>
              <small>Manually marked</small>
            </button>
            <button type="button" class="wb-tab" data-mode="steps" role="tab">
              <i class="fas fa-pen-fancy"></i>
              <span>Steps</span>
              <small>AI grading</small>
            </button>
          </div>

          <div class="wb-hint" id="wbHint">
            <i class="fas fa-hand-pointer"></i>
            <span>Select a submission mode above to begin</span>
          </div>

          <div class="wb-panes">

            <div class="wb-pane" data-pane="text">
              <input type="text" id="answerInput" class="wb-input"
                    placeholder="Enter your answer…" autocomplete="off" spellcheck="false">
              <div class="wb-expr-preview" id="wbExprPreview" hidden>
                <i class="fas fa-calculator"></i>
                <span class="expr-label">Will submit:</span>
                <span class="expr-value" id="wbExprResult"></span>
              </div>
            </div>
            <div class="wb-pane" data-pane="photo">
              <label class="wb-dropzone" id="wbDropzone">
                <input type="file" id="imageFileInput" accept="image/*" hidden>
                <i class="fas fa-cloud-upload-alt"></i>
                <span class="dz-title">Drop an image here, or click to select</span>
                <small>JPG · PNG · HEIC · up to 5 MB</small>
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
              <textarea id="stepsInput" class="wb-textarea" rows="10"
                maxlength="1000"
                placeholder="Write your full solution here (max 1000 chars)…"></textarea>
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

    // 題幹（管理員可信注入）
    const stmt = document.getElementById('statementContent');
    stmt.innerHTML = problem.statement || '';
    executeScriptsIn(stmt);
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(stmt, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
    }
    mountPdfQuizSplit();
    mountMcQuiz();

    // 頭部細節
    if (isAdmin) {
      document.getElementById('detailEditBtn').innerHTML =
        `<a href="/admin/problems/${encodeURIComponent(problemId)}" class="back-btn" style="margin-left:0.5rem;" title="Edit problem">edit</a>`;
    }
    updateProblemDetailIcon();

    const starIcon = document.querySelector('#detailFavorite i');
    if (starIcon) {
      starIcon.className = isFav ? 'fas fa-star' : 'far fa-star';
      starIcon.style.color = isFav ? '#f1c40f' : '#aaa';
    }

    // 討論區（僅通過者 / 管理員）
    if (hasAccess) {
      const area = document.getElementById('discussionToggleArea');
      area.style.display = 'block';
      document.getElementById('expandDiscussionsBtn').addEventListener('click', function () {
        const section = document.getElementById('discussionSection');
        const hidden = section.style.display === 'none' || !section.style.display;
        if (hidden) {
          section.style.display = 'block';
          this.innerHTML = 'Hide Discussions';
          if (!section.dataset.loaded) {
            loadDiscussions(problemId);
            section.dataset.loaded = 'true';
          }
        } else {
          section.style.display = 'none';
          this.innerHTML = 'Expand Discussions';
        }
      });
    }

    // 相似題目
    document.getElementById('similarBtn').addEventListener('click', openSimilar);
    document.getElementById('similarCloseBtn').addEventListener('click', () => {
      document.getElementById('similarModal').style.display = 'none';
    });
    document.getElementById('similarModal').addEventListener('click', function (e) {
      if (e.target === this) this.style.display = 'none';
    });

    // 舉報
    bindReportModal();

    // 收藏
    document.getElementById('detailFavorite').addEventListener('click', async function () {
      const icon = this.querySelector('i');
      if (!icon) return;
      const wasFav = icon.classList.contains('fas');
      const revert = () => {
        if (wasFav) { icon.className = 'fas fa-star'; icon.style.color = '#f1c40f'; }
        else        { icon.className = 'far fa-star'; icon.style.color = '#aaa'; }
      };
      if (wasFav) { icon.className = 'far fa-star'; icon.style.color = '#aaa'; }
      else        { icon.className = 'fas fa-star'; icon.style.color = '#f1c40f'; }
      try {
        const res = await apiCall('/api/users?action=favorite', 'POST', { problemId });
        if (!res.success) revert();
      } catch { revert(); }
    });

    // 恢復上次答案
    const saved = answersStore.get(problemId);
    if (saved) {
      const ansEl  = document.getElementById('answerInput');
      const exprEl = document.getElementById('exprInput');
      if (ansEl && !ansEl.value) {
        ansEl.value = saved;
        ansEl.title = '上次提交的答案';
        ansEl.style.background = 'rgba(74,144,217,.08)';
        ansEl.addEventListener('input', () => {
          ansEl.style.background = '';
          ansEl.title = '';
        }, { once: true });
      }
      if (exprEl && !exprEl.value) exprEl.value = saved;
    }

    // 事件
    document.getElementById('backToListBtn').addEventListener('click', () => history.back());
    document.getElementById('submissionsBtn').addEventListener('click', () => {
      window.location.href = `/submissions/problem/${problemId}`;
    });

    bindAnswerInteractions();
    bindSubmitEvent();
    await setupNavigation(problem);
    updateExprPreview(); 
  } catch (err) {
    console.error('initPage error:', err);
    mainContainer.innerHTML = `<div class="error-msg">Failed to load problem: ${err.message}</div>`;
  }
}

// ───────────────────────────────────────────────────────────────────
// 生命週期
// ───────────────────────────────────────────────────────────────────
window.addEventListener('pagehide', () => {
  if (document.getElementById('timerRow')) { pauseTimer(); saveTimer(); }
  if (S.pollTimer) clearInterval(S.pollTimer);
  if (window.__pdfResizeObserver) {
    try { window.__pdfResizeObserver.disconnect(); } catch {}
    window.__pdfResizeObserver = null;
  }
  const ansEl = document.getElementById('answerInput');
  const expEl = document.getElementById('exprInput');
  if (ansEl?.value) saveAnswerNow(problemId, ansEl.value);
  if (expEl?.value) saveAnswerNow(problemId, expEl.value);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') return;
  const ansEl = document.getElementById('answerInput');
  const expEl = document.getElementById('exprInput');
  if (ansEl?.value) saveAnswerNow(problemId, ansEl.value);
  if (expEl?.value) saveAnswerNow(problemId, expEl.value);
});

// 啟動
initPage();