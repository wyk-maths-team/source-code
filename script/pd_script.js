// pd_script.js — problem detail page
if (!isLoggedIn()) window.location.href = '/index.html';

const pathMatch = window.location.pathname.match(/^\/problems\/([^/]+)$/);
if (!pathMatch) {
  document.getElementById('mainContent').innerHTML = '<div class="error-msg">Invalid problem URL.</div>';
  throw new Error('No problem ID');
}
const problemId = decodeURIComponent(pathMatch[1]);
document.title = `Problem ${problemId} - WYK Maths Team`;

const mainContainer = document.getElementById('mainContent');
let userStates = {};
let imageData = '';
let cooldown = false;
let pollTimer = null;
let currentMode = 'numeric';
let timerInterval = null;
let timerSeconds = 0;
let timerRunning = false;
let currentProblemName = '';

// ============ Timer ============
const TIMER_KEY = `timer_${problemId}`;
const saveTimer  = () => localStorage.setItem(TIMER_KEY, String(timerSeconds));
const clearTimer = () => localStorage.removeItem(TIMER_KEY);
function loadTimer() {
  const v = parseInt(localStorage.getItem(TIMER_KEY) ?? '0', 10);
  timerSeconds = (!isNaN(v) && v >= 0) ? v : 0;
}

// ============ 工具 ============
const escapeHtml = s => (s ?? '').toString().replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
const getTopbarHeight = () => {
  const n = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-height'), 10);
  return Number.isFinite(n) ? n : 60;
};
// ============ Similar 卡片 CSS（只注入一次）============
(function injectSimilarCSS() {
  if (document.getElementById('similar-modal-style')) return;
  const s = document.createElement('style');
  s.id = 'similar-modal-style';
  s.textContent = `
.si-item {
  display: block;
  padding: 10px 14px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 8px;
  text-decoration: none;
  color: var(--text-primary);
  transition: border-color .15s, transform .12s, box-shadow .15s;
}
.si-item:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0,0,0,.08);
}
.si-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  margin-bottom: 5px;
  font-size: .95rem;
}
.si-id {
  font-family: 'Consolas', monospace;
  color: var(--accent);
  flex-shrink: 0;
}
.si-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.si-meta {
  display: flex;
  gap: 10px;
  font-size: .8rem;
  color: var(--text-secondary);
  flex-wrap: wrap;
  align-items: center;
}
.si-tag {
  background: rgba(74,144,217,.12);
  color: var(--accent);
  padding: 1px 8px;
  border-radius: 10px;
  font-size: .72rem;
  font-weight: 600;
}
.si-tag.common {
  background: rgba(46,204,113,.15);
  color: #2e7d32;
}
[data-theme="dark"] .si-tag {
  background: rgba(74,144,217,.25);
}
[data-theme="dark"] .si-tag.common {
  background: rgba(46,204,113,.25);
  color: #8fce9f;
}
.si-badge {
  font-size: .72rem;
  font-weight: 700;
  color: #e67e22;
  flex-shrink: 0;
}
.si-empty {
  text-align: center;
  padding: 30px 20px;
  color: var(--text-secondary);
  font-size: .9rem;
}
.si-loading {
  text-align: center;
  padding: 30px 20px;
  color: var(--text-secondary);
  font-size: .9rem;
}
`;
  document.head.appendChild(s);
})();
// ============ 狀態徽章 CSS（只注入一次）============
(function injectFeedbackBoxCSS() {
  if (document.getElementById('feedback-box-style')) return;
  const s = document.createElement('style');
  s.id = 'feedback-box-style';
  s.textContent = `
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
[data-theme="dark"] .feedback-box.status-pending{background:#2d2d2d;color:#999;border-color:#444}`;
  document.head.appendChild(s);
})();

function statusBoxHtml(subid, text, cls) {
  if (!subid) return text;
  return `<a href="/submissions/${encodeURIComponent(subid)}/detail" class="feedback-box ${cls}">${escapeHtml(text)}</a>`;
}

// ============ 題目 + 用戶資料載入（並行 race：API 為準，CDN 為 fallback）============
// ============ 題目 + 用戶資料載入（全部走 API）============
async function loadPageData() {
  const apiData = await apiCall(`/api/problem?action=page&id=${encodeURIComponent(problemId)}`)
    .catch(() => null);

  if (!apiData || !apiData.success || !apiData.problem) return null;

  return {
    problem: apiData.problem,
    state: apiData.state || 'not_started',
    favorited: !!apiData.favorited
  };
}

const domPurifyConfig = {
  ALLOWED_TAGS: ['b','i','u','strong','em','a','p','br','ul','ol','li','span','div','code','pre','svg','g','defs','clipPath','foreignObject','path','circle','line','polyline','polygon','rect','text','tspan','linearGradient','radialGradient','stop','image','use','img'],
  ALLOWED_ATTR: ['href','target','rel','class','id','style','xmlns','viewBox','width','height','d','cx','cy','r','x','y','x1','x2','y1','y2','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-opacity','stroke-opacity','opacity','font-size','text-anchor','dominant-baseline','transform','src'],
  ALLOW_DATA_ATTR: true
};

// ============ 狀態圖標 ============
function updateProblemDetailIcon(pid, pname) {
  const state = userStates[pid] || 'not_started';
  const el = document.getElementById('detailStatusIcon');
  if (el) {
    el.innerHTML = state === 'passed' ? '<i class="fa fa-check-circle fa-green"></i>'
                 : state === 'failed' ? '<i class="fa fa-times-circle fa-red"></i>'
                 : '';
  }
  if (pname) document.title = pname + ' - WYK Maths Team';
}

// ============ 圖片提交狀態輪詢 ============
function startImageStatusPoll() {
  clearInterval(pollTimer);
  let attempts = 0;
  pollTimer = setInterval(async () => {
    if (++attempts > 120) {
      clearInterval(pollTimer);
      document.getElementById('detailSpinner').style.display = 'none';
      document.getElementById('detailStatusIcon').style.display = '';
      document.getElementById('detailStatusText').textContent = 'Timed out';
      return;
    }
    try {
      const data = await apiCall(`/api/submissions?problem_id=${encodeURIComponent(problemId)}`);
      if (!data.success) return;
      const sub = data.submissions[0];
      if (sub && sub.type === 'image' && sub.marked) {
        clearInterval(pollTimer);
        const status = sub.status;
        document.getElementById('detailSpinner').style.display = 'none';
        const iconEl = document.getElementById('detailStatusIcon');
        iconEl.style.display = 'inline';
        if (status === 'Accepted') {
          iconEl.innerHTML = '<i class="fa fa-check-circle fa-green"></i>';
          userStates[problemId] = 'passed';
        } else if (status === 'Wrong Answer') {
          iconEl.innerHTML = '<i class="fa fa-times-circle fa-red"></i>';
          if (userStates[problemId] !== 'passed') userStates[problemId] = 'failed';
        } else if (status.startsWith('Partial Score')) {
          iconEl.innerHTML = '<i class="fa fa-exclamation-triangle fa-yellow"></i>';
          if (userStates[problemId] !== 'passed') userStates[problemId] = 'failed';
        } else {
          iconEl.innerHTML = '<span style="color:#888;">-</span>';
        }
        document.getElementById('detailStatusText').textContent = status;
        updateProblemDetailIcon(problemId, currentProblemName);
      }
    } catch (e) { /* ignore */ }
  }, 5000);
}

// ============ Timer 控制 ============
function updateTimerDisplay() {
  const el = document.getElementById('timerDisplay');
  if (!el) return;
  const h = Math.floor(timerSeconds / 3600);
  const m = Math.floor((timerSeconds % 3600) / 60);
  const s = timerSeconds % 60;
  el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  timerInterval = setInterval(() => { timerSeconds++; updateTimerDisplay(); }, 1000);
}
function pauseTimer() {
  if (!timerRunning) return;
  timerRunning = false;
  clearInterval(timerInterval);
}
function resetTimer() {
  pauseTimer();
  timerSeconds = 0;
  updateTimerDisplay();
  clearTimer();
}
function toggleTimer() {
  const existing = document.getElementById('timerRow');
  if (existing) { pauseTimer(); saveTimer(); existing.remove(); return; }

  const container = document.getElementById('splitContainer');
  if (!container) return;
  loadTimer();
  timerRunning = false;

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

// ============ 導航 ============
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
    if (idx > 0) html += `<a href="/problems/${encodeURIComponent(ids[idx - 1])}" class="back-btn" title="Previous Problem">← Prev</a>`;
    if (idx < ids.length - 1) html += `<a href="/problems/${encodeURIComponent(ids[idx + 1])}" class="back-btn" title="Next Problem">Next →</a>`;
    nav.innerHTML = html;
  } catch (e) {
    console.error('Navigation setup error:', e);
    nav.innerHTML = '';
  }
}

// ============ PDF.js 動態載入 ============
let _pdfjsLoadingPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsLoadingPromise) return _pdfjsLoadingPromise;
  _pdfjsLoadingPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      if (!window.pdfjsLib) return reject(new Error('pdfjsLib not defined'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(s);
  });
  return _pdfjsLoadingPromise;
}

// ============ PDF 渲染（含並發保護 + 滾動位置保留）============
let _pdfRenderToken = 0;
let _pdfCurrentDoc = null;

async function renderPdfWithPdfJs(container, pdfUrl) {
  const token = ++_pdfRenderToken;
  if (_pdfCurrentDoc) { try { _pdfCurrentDoc.destroy(); } catch (e) {} _pdfCurrentDoc = null; }

  const oldScrollTop = container.scrollTop || 0;
  container.innerHTML = '<div class="pdf-loading"><span class="spinner"></span> Loading PDF...</div>';

  let pdfjsLib;
  try {
    pdfjsLib = await loadPdfJs();
  } catch (err) {
    if (token !== _pdfRenderToken) return;
    console.error(err);
    container.innerHTML = `<div class="pdf-error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load PDF viewer</p><a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener">Open in new tab</a></div>`;
    return;
  }
  if (token !== _pdfRenderToken) return;

  try {
    const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
    if (token !== _pdfRenderToken) { try { pdf.destroy(); } catch (e) {} return; }
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
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = Math.floor(viewport.width / dpr) + 'px';
      canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
      canvas.className = 'pdf-page-canvas';
      container.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    }
    if (token === _pdfRenderToken && oldScrollTop > 0) {
      requestAnimationFrame(() => { container.scrollTop = oldScrollTop; });
    }
  } catch (err) {
    if (token !== _pdfRenderToken) return;
    console.error('PDF render error:', err);
    container.innerHTML = `<div class="pdf-error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load PDF</p><a href="${escapeHtml(pdfUrl)}" target="_blank" rel="noopener">Open in new tab</a></div>`;
  }
}

// ============ Google Drive / Docs URL 轉換 ============
function toGooglePreviewUrl(url) {
  if (!url || !/^https:\/\/(docs|drive)\.google\.com\//.test(url)) return null;
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
  const docsMatch = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/?#]+)/);
  if (docsMatch) return `https://docs.google.com/${docsMatch[1]}/d/${docsMatch[2]}/preview`;
  return null;
}

// ============ 可拖動 / 可縮放（pointer 事件，兼容滑鼠與觸控）============
function makeDraggable(el, handle) {
  let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    const rect = el.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    origX = rect.left; origY = rect.top;
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const minTop = getTopbarHeight();
    const maxLeft = window.innerWidth - el.offsetWidth;
    const maxTop = window.innerHeight - el.offsetHeight;
    el.style.left = Math.max(0, Math.min(maxLeft, origX + dx)) + 'px';
    el.style.top  = Math.max(minTop, Math.min(maxTop, origY + dy)) + 'px';
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

function makeResizable(el, handle, minW = 260, minH = 200) {
  let startX = 0, startY = 0, startW = 0, startH = 0, resizing = false;

  handle.addEventListener('pointerdown', (e) => {
    resizing = true;
    startX = e.clientX; startY = e.clientY;
    startW = el.offsetWidth; startH = el.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });

  handle.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.width = Math.max(minW, startW + dx) + 'px';
    el.style.height = Math.max(minH, startH + dy) + 'px';
    el.style.maxHeight = 'none';
  });

  function endResize(e) {
    if (!resizing) return;
    resizing = false;
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  handle.addEventListener('pointerup', endResize);
  handle.addEventListener('pointercancel', endResize);
}

function applyFloatingInitialLayout(el) {
  const topbarH = getTopbarHeight();
  const isMobile = window.innerWidth <= 768;
  el.style.left = 'auto';
  el.style.right = 'auto';
  if (isMobile) {
    el.style.width = Math.min(window.innerWidth - 16, 320) + 'px';
    el.style.right = '8px';
    el.style.top = (topbarH + 8) + 'px';
    el.style.maxHeight = '55vh';
  } else {
    el.style.width = '400px';
    el.style.right = '40px';
    el.style.top = Math.max(topbarH + 20, 100) + 'px';
    el.style.maxHeight = '75vh';
  }
}

// ============ PDF + Quiz 掛載（全屏 PDF + 浮動答題卡）============
function mountPdfQuizSplit() {
  const pdfMount = document.getElementById('pdf-quiz-split');
  if (!pdfMount) return;
  const pdfUrl = pdfMount.dataset.pdf;
  if (!pdfUrl) return;

  let absolutePdfUrl;
  try { absolutePdfUrl = new URL(pdfUrl, location.href).href; }
  catch (e) { absolutePdfUrl = pdfUrl; }
  const googlePreviewUrl = toGooglePreviewUrl(absolutePdfUrl);

  if (!document.getElementById('pdf-quiz-split-style')) {
    const s = document.createElement('style');
    s.id = 'pdf-quiz-split-style';
    s.textContent = `
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
.mcq-floating-window{position:fixed;top:100px;right:40px;width:400px;max-height:75vh;background:rgba(214,232,252,.42);backdrop-filter:blur(14px) saturate(1.8) brightness(1.06);-webkit-backdrop-filter:blur(14px) saturate(1.8) brightness(1.06);border:1px solid rgba(255,255,255,.65);border-radius:12px;box-shadow:0 12px 40px rgba(0,40,100,.22),0 2px 8px rgba(0,40,100,.10),inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.35),inset 1px 0 0 rgba(255,255,255,.55),inset -1px 0 0 rgba(255,255,255,.55),inset 0 24px 44px -22px rgba(255,255,255,.55);z-index:9000;display:flex;flex-direction:column;overflow:hidden;font-size:.9rem;color:#0a2a4a;text-shadow:0 1px 0 rgba(255,255,255,.75);transition:box-shadow .25s ease,border-color .25s ease}
.mcq-floating-window:hover{border-color:rgba(255,255,255,.85);box-shadow:0 16px 50px rgba(0,40,100,.28),0 2px 8px rgba(0,40,100,.12),inset 0 1px 0 rgba(255,255,255,1),inset 0 -1px 0 rgba(255,255,255,.45),inset 1px 0 0 rgba(255,255,255,.7),inset -1px 0 0 rgba(255,255,255,.7),inset 0 28px 52px -22px rgba(255,255,255,.75)}
.mcq-float-header{cursor:move;padding:8px 12px;background:linear-gradient(180deg,rgba(255,255,255,.55) 0%,rgba(200,225,255,.28) 55%,rgba(180,210,245,.14) 100%);border-bottom:1px solid rgba(255,255,255,.55);display:flex;justify-content:space-between;align-items:center;user-select:none;font-weight:600;font-size:.8rem;flex-shrink:0;touch-action:none;color:#0a2a4a;text-shadow:0 1px 0 rgba(255,255,255,.9);position:relative}
.mcq-float-header::before{content:"";position:absolute;top:0;left:8%;right:8%;height:1px;background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,.9) 30%,rgba(255,255,255,1) 50%,rgba(255,255,255,.9) 70%,transparent 100%);pointer-events:none}
.mcq-float-header .mcq-drag-icon{margin-right:6px;opacity:.5}
.mcq-close-btn{background:rgba(255,255,255,.45);border:1px solid rgba(255,255,255,.7);border-radius:6px;font-size:.75rem;cursor:pointer;color:#0a2a4a;padding:1px 8px;font-family:inherit;line-height:1.4;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);box-shadow:inset 0 1px 0 rgba(255,255,255,.85);transition:all .15s}
.mcq-close-btn:hover{background:rgba(220,60,60,.8);color:#fff;border-color:rgba(255,255,255,.85);text-shadow:none}
.mcq-float-body{flex:1 1 auto;overflow-y:auto;padding:.4rem;min-height:0;background:transparent}
.mcq-floating-window .mc-table{background:rgba(255,255,255,.65);border-collapse:collapse;width:100%;margin:0 auto .6rem;font-size:.85rem;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08),0 0 0 1px rgba(255,255,255,.5);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
.mcq-floating-window .mc-table th,.mcq-floating-window .mc-table td{border:1px solid rgba(100,140,190,.55);padding:.25rem .35rem;text-align:center;vertical-align:middle;background:rgba(255,255,255,.55)}
.mcq-floating-window .mc-table th{background:rgba(220,235,252,.9);color:#0a2a4a;font-weight:700;font-size:.78rem}
.mcq-floating-window .mc-table td:first-child{background:rgba(230,240,250,.92);color:#2a4a6a;font-weight:600;width:2.6em}
.mcq-floating-window .mc-table td:hover{background:rgba(200,225,250,.9)}
.mcq-floating-window .mc-table tr.mc-sep td{border-bottom:2px solid rgba(80,130,200,.8)}
.mcq-floating-window .mc-table input[type="radio"]{cursor:pointer;margin:0;width:15px;height:15px;accent-color:#4a90d9;filter:drop-shadow(0 0 2px rgba(255,255,255,.9))}
.mcq-floating-window .mc-submit-btn{background:linear-gradient(180deg,rgba(80,200,120,.95) 0%,rgba(40,167,69,.95) 100%);color:#fff;border:1px solid rgba(255,255,255,.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 2px 6px rgba(0,40,20,.3);padding:.5rem 2.5rem;border-radius:6px;font-size:.9rem;font-weight:700;cursor:pointer;display:block;margin:.4rem auto;letter-spacing:1px;text-shadow:0 1px 1px rgba(0,0,0,.15)}
.mcq-floating-window .mc-submit-btn:hover{background:linear-gradient(180deg,rgba(90,215,135,1) 0%,rgba(50,185,80,1) 100%)}
.mcq-resize-handle{position:absolute;right:0;bottom:0;width:22px;height:22px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 45%,rgba(100,150,210,.4) 45%,rgba(100,150,210,.6) 100%);border-bottom-right-radius:8px;z-index:2}
.mcq-resize-handle:hover{background:linear-gradient(135deg,transparent 45%,rgba(100,150,210,.75) 45%,rgba(100,150,210,1) 100%)}
[data-theme="dark"] .mcq-floating-window{background:rgba(30,50,80,.45);border-color:rgba(150,190,240,.55);color:#d8e6f5;text-shadow:0 1px 0 rgba(0,0,0,.4);box-shadow:0 12px 40px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.35),inset 0 1px 0 rgba(180,210,255,.4),inset 0 -1px 0 rgba(120,170,230,.2),inset 1px 0 0 rgba(180,210,255,.2),inset -1px 0 0 rgba(180,210,255,.2)}
[data-theme="dark"] .mcq-floating-window:hover{border-color:rgba(180,215,255,.75);box-shadow:0 16px 50px rgba(0,0,0,.65),0 2px 8px rgba(0,0,0,.4),inset 0 1px 0 rgba(200,225,255,.55),inset 0 -1px 0 rgba(120,170,230,.3),inset 1px 0 0 rgba(180,210,255,.3),inset -1px 0 0 rgba(180,210,255,.3)}
[data-theme="dark"] .mcq-float-header{background:linear-gradient(180deg,rgba(140,180,240,.28) 0%,rgba(60,90,140,.14) 55%,rgba(40,60,100,.08) 100%);border-bottom-color:rgba(150,190,240,.4);color:#d8e6f5;text-shadow:0 1px 0 rgba(0,0,0,.5)}
[data-theme="dark"] .mcq-float-header::before{background:linear-gradient(90deg,transparent 0%,rgba(180,210,255,.7) 50%,transparent 100%)}
[data-theme="dark"] .mcq-close-btn{background:rgba(80,120,180,.35);color:#d8e6f5;border-color:rgba(150,190,240,.45)}
[data-theme="dark"] .mcq-close-btn:hover{background:rgba(200,60,60,.85);color:#fff}
[data-theme="dark"] .mcq-floating-window .mc-table{background:rgba(20,30,45,.75);box-shadow:0 1px 3px rgba(0,0,0,.5),0 0 0 1px rgba(120,170,230,.2)}
[data-theme="dark"] .mcq-floating-window .mc-table th,[data-theme="dark"] .mcq-floating-window .mc-table td{border-color:rgba(120,160,220,.5);background:rgba(30,42,60,.7)}
[data-theme="dark"] .mcq-floating-window .mc-table th{background:rgba(45,60,85,.9);color:#c9dcff}
[data-theme="dark"] .mcq-floating-window .mc-table td:first-child{background:rgba(40,52,72,.92);color:#a8c0e0}
[data-theme="dark"] .mcq-floating-window .mc-table td:hover{background:rgba(70,100,145,.75)}
[data-theme="dark"] .mcq-floating-window .mc-table tr.mc-sep td{border-bottom:2px solid rgba(100,160,230,.9)}
@media (max-width:768px){.mcq-floating-window{width:calc(100vw - 16px)!important;max-width:320px;right:8px!important;left:auto!important;max-height:55vh}}
`;
    document.head.appendChild(s);
  }

  const quizMount = document.getElementById('mc-quiz-mount');
  const hasQuiz = !!quizMount;

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
        <a href="${escapeHtml(absolutePdfUrl)}" target="_blank" rel="noopener" class="pdf-open-btn">
          <i class="fas fa-external-link-alt"></i> Open
        </a>
      </div>
    </div>
    ${googlePreviewUrl
      ? `<iframe class="pdf-google-frame" src="${escapeHtml(googlePreviewUrl)}" allow="autoplay" referrerpolicy="no-referrer"></iframe>`
      : `<div class="pdf-pages-scroll" id="pdf-pages-scroll"></div>`}`;

  if (googlePreviewUrl) {
    // Google Drive 分支：iframe，不需 ResizeObserver
  } else {
    const scrollContainer = pdfMount.querySelector('.pdf-pages-scroll');
    renderPdfWithPdfJs(scrollContainer, absolutePdfUrl);
    scrollContainer.dataset.pdfUrl = absolutePdfUrl;

    if (window.ResizeObserver && scrollContainer) {
      if (window.__pdfResizeObserver) { try { window.__pdfResizeObserver.disconnect(); } catch (e) {} }
      let lastWidth = Math.floor(scrollContainer.clientWidth);
      let resizeTimer = null;
      window.__pdfResizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const newWidth = Math.floor(entry.contentRect.width);
          if (Math.abs(newWidth - lastWidth) < 100) continue;
          lastWidth = newWidth;
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => {
            const sc = document.getElementById('pdf-pages-scroll');
            if (sc && sc.dataset.pdfUrl) renderPdfWithPdfJs(sc, sc.dataset.pdfUrl);
          }, 500);
        }
      });
      window.__pdfResizeObserver.observe(scrollContainer);
    }
  }

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
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const isHidden = floating.style.display === 'none';
        floating.style.display = isHidden ? 'flex' : 'none';
        toggleBtn.innerHTML = isHidden
          ? '<i class="fas fa-times"></i> Hide Answer'
          : '<i class="fas fa-clipboard-list"></i> Answer Sheet';
      });
    }
    const closeBtn = document.getElementById('closeMcqBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        floating.style.display = 'none';
        if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-clipboard-list"></i> Answer Sheet';
      });
    }
  }

  const stmtContent = document.getElementById('statementContent');
  if (stmtContent) { stmtContent.style.flex = '1 1 100%'; stmtContent.style.maxWidth = '100%'; }
  const splitDivider = document.getElementById('splitDivider');
  if (splitDivider) splitDivider.style.display = 'none';
  const drawpadWrapper = document.getElementById('drawpadWrapper');
  if (drawpadWrapper) drawpadWrapper.style.display = 'none';
}
function mountMcQuiz() {
  const mount = document.getElementById('mc-quiz-mount');
  if (!mount) return;

   if (!document.getElementById('mc-quiz-style')) {
    const s = document.createElement('style');
    s.id = 'mc-quiz-style';
    s.textContent = `
.mc-table{width:100%;border-collapse:collapse;margin:0 auto 1rem;font-size:.9rem;table-layout:auto;background:#eef1f5;border-radius:4px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.mc-table th,.mc-table td{border:1px solid #c8ced7;padding:.3rem .4rem;text-align:center;vertical-align:middle}
.mc-table th{background:#dde2e9;font-weight:700;font-size:.8rem;color:#2c3e50}
.mc-table td{background:#eef1f5}
.mc-table td:first-child{font-weight:600;color:var(--text-secondary);background:#e3e7ee;width:3em}
.mc-table input[type="radio"]{cursor:pointer;margin:0;width:16px;height:16px;accent-color:var(--accent)}
.mc-table tr.mc-sep td{border-bottom:2px solid var(--accent)}
.mc-table.mc-many-options th,.mc-table.mc-many-options td{padding:.2rem .25rem;font-size:.8rem}
.mc-table.mc-many-options input[type="radio"]{width:14px;height:14px}
[data-theme="dark"] .mc-table{background:#1a1e25;box-shadow:0 1px 3px rgba(0,0,0,.4)}
[data-theme="dark"] .mc-table th,
[data-theme="dark"] .mc-table td{border-color:#3a424e}
[data-theme="dark"] .mc-table th{background:#2b313a;color:#e0e6ed}
[data-theme="dark"] .mc-table td{background:#1a1e25}
[data-theme="dark"] .mc-table td:first-child{background:#232830;color:#a8b4c0}
.mc-submit-btn{display:block;margin:.8rem auto 1.5rem;padding:.65rem 3rem;background:#28a745;color:#fff;border:none;border-radius:6px;font-size:1rem;font-weight:700;cursor:pointer;letter-spacing:1px;transition:background .15s}
.mc-submit-btn:hover{background:#218838}
.mc-submit-btn:disabled{background:#6c757d;cursor:not-allowed}
`;
    document.head.appendChild(s);
  }

  const rawTotal = parseInt(mount.dataset.total, 10);
  const TOTAL = (Number.isFinite(rawTotal) && rawTotal >= 1 && rawTotal <= 200) ? rawTotal : 45;

  const rawOptions = parseInt(mount.dataset.options, 10);
  const OPTIONS = (Number.isFinite(rawOptions) && rawOptions >= 2 && rawOptions <= 26) ? rawOptions : 4;
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, OPTIONS);
  const LETTER_SET = new Set(LETTERS.split(''));

  const SEP_EVERY = 5;

  const headerCells = ['<th>#</th>'];
  for (const ch of LETTERS) headerCells.push(`<th>${ch}</th>`);

  let html = `
    <p style="color:var(--text-secondary);font-size:.85rem;margin:.3rem 0 .6rem 0;">
      Select one option (${LETTERS.split('').join('/')}) for each question. Unanswered questions will be submitted as <code>X</code>.
    </p>
    <table class="mc-table${OPTIONS > 4 ? ' mc-many-options' : ''}">
      <thead><tr>${headerCells.join('')}</tr></thead>
      <tbody>`;

  for (let i = 1; i <= TOTAL; i++) {
    const sep = (i % SEP_EVERY === 0 && i < TOTAL) ? ' class="mc-sep"' : '';
    let row = `<tr${sep}><td>${i}</td>`;
    for (const ch of LETTERS) {
      row += `<td><input type="radio" name="mcq-${i}" value="${ch}"></td>`;
    }
    row += '</tr>';
    html += row;
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

  if (answerInputEl) answerInputEl.addEventListener('input', syncRadiosFromInput);

  mount.querySelectorAll('input[type="radio"]').forEach(r => {
    r.addEventListener('mousedown', function () {
      this.dataset.wasChecked = this.checked ? '1' : '0';
    });
    r.addEventListener('click', function () {
      if (this.dataset.wasChecked === '1') {
        this.checked = false;
        this.dataset.wasChecked = '0';
      }
      syncInputFromRadios();
    });
    r.addEventListener('change', syncInputFromRadios);
  });

  mount.querySelectorAll('.mc-table td').forEach(td => {
    const radio = td.querySelector('input[type="radio"]');
    if (!radio) return;
    td.style.cursor = 'pointer';
    td.addEventListener('click', function (e) {
      if (e.target === radio) return;
      if (radio.checked) {
        radio.checked = false;
      } else {
        mount.querySelectorAll(`input[name="${radio.name}"]`).forEach(r => { r.checked = false; });
        radio.checked = true;
      }
      syncInputFromRadios();
    });
  });

  syncRadiosFromInput();

  const submitMcBtn = mount.querySelector('#mc-submit-btn');
  if (submitMcBtn) {
    submitMcBtn.addEventListener('click', () => {
      let answer = '';
      for (let i = 1; i <= TOTAL; i++) {
        const sel = mount.querySelector(`input[name="mcq-${i}"]:checked`);
        answer += sel ? sel.value : 'X';
      }
      currentMode = 'numeric';
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('modeNumeric')?.classList.add('active');
      document.getElementById('textAnswerGroup').style.display = 'block';
      document.getElementById('imageAnswerGroup').style.display = 'none';
      document.getElementById('expressionAnswerGroup').style.display = 'none';

      const input = document.getElementById('answerInput');
      if (input) input.value = answer;

      const submitBtn = document.getElementById('checkAnswerBtn');
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      }
    });
  }
}

// ============ 主流程 ============
async function initPage() {
  try {
    mainContainer.innerHTML = '';

    // ⭐ 一次拿 problem + states + favorites（CDN 並行 fallback）
    const pageData = await loadPageData();
    if (!pageData || !pageData.problem) {
      mainContainer.innerHTML = '<div class="error-msg">Problem not found. Please try again later.</div>';
      return;
    }

        const problem = pageData.problem;
    // 只記錄當前題的狀態
    userStates = {};
    if (pageData.state && pageData.state !== 'not_started') {
      userStates[problemId] = pageData.state;
    }
    // 只記錄當前題是否收藏
    window.favorites = new Set();
    if (pageData.favorited) window.favorites.add(problemId);

    const diff = problem.difficulty ?? 0;
    currentProblemName = problem.name || problemId;
    const isAdmin = (getCurrentUser()?.role === 'admin' || getCurrentUser()?.role === 'root');

    mainContainer.innerHTML = `
      <div class="problem-detail" id="problemDetailShell">
        <div class="detail-header">
          <button class="back-btn" id="backToListBtn">← Back</button>
          <span class="problem-name-detail">
            <span id="detailProblemName">${escapeHtml(problemId)} - ${escapeHtml(currentProblemName)}</span>
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
        <div class="answer-area">
          <div class="mode-switch">
            <button id="modeNumeric" class="mode-btn active" data-mode="numeric">Numeric</button>
            <button id="modePhoto" class="mode-btn" data-mode="photo">Photo</button>
            <button id="modeExpression" class="mode-btn" data-mode="expression">Expression</button>
          </div>
          <div id="textAnswerGroup">
            <label>Your Answer:</label>
            <input type="text" id="answerInput" class="answer-input" placeholder="Enter answer">
          </div>
          <div id="imageAnswerGroup" style="display:none">
            <label>Upload Image (max 1):</label>
            <input type="file" id="imageFileInput" accept="image/*" style="display:none">
            <button id="pickImageBtn" class="check-btn">Choose / Take Photo</button>
            <img id="imagePreview" style="max-width:150px;display:none;margin-left:10px">
            <button id="removeImageBtn" style="display:none">✕</button>
          </div>
          <div id="expressionAnswerGroup" style="display:none">
            <label>Expression:</label>
            <input type="text" id="exprInput" placeholder="e.g. (1+2*sqrt(3))/4">
            <span id="exprPreview"></span>
          </div>
          <button id="checkAnswerBtn" class="check-btn">Submit</button>
          <button id="submissionsBtn" class="submissions-btn">Submissions</button>
          <button id="timerToggleBtn" class="submissions-btn">Timer</button>
          <span id="feedbackMsg" class="feedback"></span>
          <span id="loadingSpinner" class="spinner" style="display:none"></span>
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

    const statementContent = document.getElementById('statementContent');
    if (statementContent) {
      statementContent.innerHTML = problem.statement
        ? DOMPurify.sanitize(problem.statement, domPurifyConfig)
        : '';
      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(statementContent, {
          delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }]
        });
      }
      mountPdfQuizSplit();
      mountMcQuiz();
    }

    const isFav = window.favorites.has(problemId);
    const currentState = userStates[problemId] || 'not_started';

    if (isAdmin) {
      document.getElementById('detailEditBtn').innerHTML =
        `<a href="/admin/problems/${encodeURIComponent(problemId)}" class="back-btn" style="margin-left:0.5rem;" title="Edit problem">edit</a>`;
    }
    updateProblemDetailIcon(problemId, currentProblemName);

    const starIcon = document.querySelector('#detailFavorite i');
    if (starIcon) {
      starIcon.className = isFav ? 'fas fa-star' : 'far fa-star';
      starIcon.style.color = isFav ? '#f1c40f' : '#aaa';
    }

    const hasAccess = isAdmin || currentState === 'passed';
    const toggleArea = document.getElementById('discussionToggleArea');
    if (hasAccess && toggleArea) {
      toggleArea.style.display = 'block';
      document.getElementById('expandDiscussionsBtn').addEventListener('click', function () {
        const section = document.getElementById('discussionSection');
        if (section.style.display === 'none' || !section.style.display) {
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

    // ---- Report modal ----
    document.getElementById('reportBtn').addEventListener('click', () => {
      document.getElementById('reportReason').value = '';
      document.getElementById('reportModal').style.display = 'flex';
      setTimeout(() => document.getElementById('reportReason').focus(), 50);
    });
    document.getElementById('reportCancelBtn').addEventListener('click', () => {
      document.getElementById('reportModal').style.display = 'none';
    });
    document.getElementById('reportModal').addEventListener('click', function (e) {
      if (e.target === this) this.style.display = 'none';
    });
    document.getElementById('reportSubmitBtn').addEventListener('click', async function () {
      const reason = document.getElementById('reportReason').value.trim();
      if (!reason) return alert('Please describe the issue before submitting.');
      this.disabled = true;
      this.textContent = 'Submitting...';
      try {
        const res = await apiCall('/api/problem?action=report', 'POST', { problemId, reason });
        if (res.success) {
          document.getElementById('reportModal').style.display = 'none';
          alert('Report submitted. Thank you!');
        } else {
          alert('Failed to submit report: ' + (res.message || 'Unknown error'));
        }
      } catch (err) {
        alert('Network error. Please try again.');
      } finally {
        this.disabled = false;
        this.textContent = 'Submit Report';
      }
    });
        // ---- Similar modal ----
    document.getElementById('similarBtn').addEventListener('click', openSimilar);
    document.getElementById('similarCloseBtn').addEventListener('click', () => {
      document.getElementById('similarModal').style.display = 'none';
    });
    document.getElementById('similarModal').addEventListener('click', function (e) {
      if (e.target === this) this.style.display = 'none';
    });

    // ---- 收藏 ----
    document.getElementById('detailFavorite').addEventListener('click', async function () {
      const icon = this.querySelector('i');
      if (!icon) return;
      const wasFav = icon.classList.contains('fas');
      const revert = () => {
        if (wasFav) { icon.className = 'fas fa-star'; icon.style.color = '#f1c40f'; }
        else { icon.className = 'far fa-star'; icon.style.color = '#aaa'; }
      };
      if (wasFav) { icon.className = 'far fa-star'; icon.style.color = '#aaa'; }
      else { icon.className = 'fas fa-star'; icon.style.color = '#f1c40f'; }
      try {
        const res = await apiCall('/api/users?action=favorite', 'POST', { problemId });
        if (!res.success) revert();
      } catch (e) { revert(); }
    });

    bindSubmitEvent();
    bindStaticEvents();
    await setupNavigation(problem);
  } catch (err) {
    console.error('initPage error:', err);
    mainContainer.innerHTML = `<div class="error-msg">Failed to load problem: ${err.message}</div>`;
  }
}
// ============ 相似題目 ============
async function openSimilar() {
  const modal = document.getElementById('similarModal');
  const list = document.getElementById('similarList');
  const hint = document.getElementById('similarHint');
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

    if (!data.similar || data.similar.length === 0) {
      list.innerHTML = '<div class="si-empty"><i class="fas fa-search" style="font-size:28px;opacity:.4;display:block;margin-bottom:10px;"></i>No similar problems found.</div>';
      return;
    }

    const curTagSet = new Set(curTags.map(t => String(t).toLowerCase()));

    list.innerHTML = data.similar.map(p => {
      const tags = Array.isArray(p.tags) ? p.tags : [];
      const tagsHtml = tags.slice(0, 6).map(t => {
        const isCommon = curTagSet.has(String(t).toLowerCase());
        return `<span class="si-tag${isCommon ? ' common' : ''}">${escapeHtml(t)}</span>`;
      }).join('');

      const diffVal = Number(p.difficulty) || 0;
      const diffText = diffVal === 0 ? '∞' : diffVal.toFixed(2);
      const delta = Number(p.diffDelta) || 0;
      const deltaText = delta < 0.01 ? 'exact' : `Δ${delta.toFixed(2)}`;

      return `
        <a href="/problems/${encodeURIComponent(p.id)}" class="si-item">
          <div class="si-title">
            <span class="si-id">${escapeHtml(p.id)}</span>
            <span class="si-name">${escapeHtml(p.name || '')}</span>
          </div>
          <div class="si-meta">
            <span>Lv.${diffText}</span>
            <span class="si-badge">${deltaText}</span>
            ${p.commonTags ? `<span style="color:#2ecc71;font-weight:600;">+${p.commonTags} tag${p.commonTags > 1 ? 's' : ''}</span>` : ''}
            <span style="flex:1;"></span>
            ${tagsHtml}
          </div>
        </a>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
    list.innerHTML = `<div class="si-empty" style="color:var(--danger);">Error: ${escapeHtml(err.message)}</div>`;
  }
}
// ============ 靜態事件 ============
function bindStaticEvents() {
  document.getElementById('backToListBtn').addEventListener('click', () => history.back());
  document.getElementById('submissionsBtn').addEventListener('click', () => {
    window.location.href = `/submissions/problem/${problemId}`;
  });

  // ---- 模式切換 ----
  const modeButtons = document.querySelectorAll('.mode-btn');
  const textGroup = document.getElementById('textAnswerGroup');
  const imageGroup = document.getElementById('imageAnswerGroup');
  const exprGroup = document.getElementById('expressionAnswerGroup');
  const answerInput = document.getElementById('answerInput');
  const exprInput = document.getElementById('exprInput');

  modeButtons.forEach(btn => btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    currentMode = mode;
    modeButtons.forEach(b => b.classList.toggle('active', b === btn));
    textGroup.style.display = mode === 'numeric' ? 'block' : 'none';
    imageGroup.style.display = mode === 'photo' ? 'block' : 'none';
    exprGroup.style.display = mode === 'expression' ? 'block' : 'none';

    if (mode === 'numeric') {
      answerInput.setAttribute('inputmode', 'decimal');
      answerInput.setAttribute('type', 'text');
      answerInput.placeholder = 'Enter a number';
      setTimeout(() => answerInput.focus(), 100);
    } else if (mode === 'expression') {
      exprInput.setAttribute('inputmode', 'text');
      setTimeout(() => exprInput.focus(), 100);
      updateExprPreview();
    }
    if (mode !== 'photo') {
      imageData = '';
      document.getElementById('imagePreview').style.display = 'none';
      document.getElementById('removeImageBtn').style.display = 'none';
      document.getElementById('imageFileInput').value = '';
    }
  }));

  // ---- 圖片選擇 ----
  const pickBtn = document.getElementById('pickImageBtn');
  const imageInput = document.getElementById('imageFileInput');
  pickBtn.addEventListener('click', () => {
    imageInput.removeAttribute('capture');
    imageInput.setAttribute('accept', 'image/*');
    imageInput.removeAttribute('multiple');
    imageInput.click();
  });
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxWidth = 1500;
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        imageData = canvas.toDataURL('image/jpeg', 0.95);
        const preview = document.getElementById('imagePreview');
        preview.src = imageData;
        preview.style.display = 'inline-block';
        document.getElementById('removeImageBtn').style.display = 'inline-block';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('removeImageBtn').addEventListener('click', () => {
    imageData = '';
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('removeImageBtn').style.display = 'none';
    imageInput.value = '';
  });

  // ---- Expression 預覽 ----
  const exprPreview = document.getElementById('exprPreview');
  function updateExprPreview() {
    const rawExpr = exprInput.value.trim();
    if (!rawExpr) { exprPreview.innerHTML = ''; return; }
    try {
      const node = math.parse(rawExpr);
      const result = node.evaluate();
      const numResult = (typeof result === 'object' && result.isBigNumber) ? result.toNumber() : result;
      katex.render(node.toTex(), exprPreview, { throwOnError: false });
      exprPreview.innerHTML = `Result: ${numResult.toFixed(9)}&nbsp;` + exprPreview.innerHTML;
    } catch (e) {
      exprPreview.innerHTML = '<span style="color:red;">Invalid expression</span>';
    }
  }
  exprInput.addEventListener('input', updateExprPreview);

  document.getElementById('timerToggleBtn').addEventListener('click', toggleTimer);
}

// ============ 提交 ============
function bindSubmitEvent() {
  const checkBtn = document.getElementById('checkAnswerBtn');
  const fb = document.getElementById('feedbackMsg');

  checkBtn.addEventListener('mousedown', async (e) => {
    e.preventDefault();
    if (cooldown) return;
    const spinner = document.getElementById('loadingSpinner');
    let answer = '';
    let type = 'text';
    let image = '';

    if (currentMode === 'photo') {
      type = 'image';
      image = imageData;
      if (!image) { fb.textContent = 'Please select an image'; fb.className = 'feedback wrong'; return; }
    } else if (currentMode === 'expression') {
      const rawExpr = document.getElementById('exprInput').value.trim();
      if (!rawExpr) { fb.textContent = 'Enter an expression'; fb.className = 'feedback wrong'; return; }
      try {
        const node = math.parse(rawExpr);
        const result = node.evaluate();
        const numResult = (typeof result === 'object' && result.isBigNumber) ? result.toNumber() : result;
        answer = String(numResult.toFixed(9));
      } catch (err) {
        fb.textContent = 'Invalid expression'; fb.className = 'feedback wrong'; return;
      }
    } else {
      const val = document.getElementById('answerInput').value.trim();
      if (!val) { fb.textContent = 'Enter answer'; fb.className = 'feedback wrong'; return; }
      answer = val;
    }

    cooldown = true;
    checkBtn.disabled = true;
    spinner.style.display = 'inline-block';
    fb.innerHTML = '';
    fb.className = '';

    let remaining = 5;
    checkBtn.textContent = `Wait ${remaining.toFixed(1)}s`;
    const countdown = setInterval(() => {
      remaining -= 0.1;
      if (remaining <= 0) {
        clearInterval(countdown);
        checkBtn.disabled = false;
        checkBtn.textContent = 'Submit';
        cooldown = false;
      } else {
        checkBtn.textContent = `Wait ${remaining.toFixed(1)}s`;
      }
    }, 100);

    try {
      const result = await apiCall('/api/submit', 'POST', { problemId, answer, type, image: image || '' });
      spinner.style.display = 'none';
      if (!result.success) return;

      if (result.message && result.message.includes('Image submitted')) {
        fb.innerHTML = statusBoxHtml(result.subid, 'Image submitted for marking', 'status-pending');
        document.getElementById('detailStatusIcon').style.display = 'none';
        document.getElementById('detailSpinner').style.display = 'inline-block';
        document.getElementById('detailStatusText').textContent = 'Pending';
        startImageStatusPoll();
      } else if (result.systemError) {
        fb.innerHTML = statusBoxHtml(result.subid, 'System Error', 'status-system');
      } else if (result.score !== undefined) {
        let txt, cls;
        if (result.score === 100) { txt = 'Accepted'; cls = 'status-accepted'; }
        else if (result.score === 0) { txt = 'Wrong Answer'; cls = 'status-wrong'; }
        else { txt = `Partial Score (${result.score}%)`; cls = 'status-partial'; }
        fb.innerHTML = statusBoxHtml(result.subid, txt, cls);
      } else {
        const txt = result.correct ? 'Accepted' : 'Wrong Answer';
        const cls = result.correct ? 'status-accepted' : 'status-wrong';
        fb.innerHTML = statusBoxHtml(result.subid, txt, cls);
        if (result.correct) {
          userStates[problemId] = 'passed';
          if (localStorage.getItem('nekoModeUnlocked') === 'true' && localStorage.getItem('showNekos') === 'true') {
            fetchNekoAndShow();
          }
        } else if (userStates[problemId] !== 'passed') {
          userStates[problemId] = 'failed';
        }
        updateProblemDetailIcon(problemId, currentProblemName);
      }
    } catch (err) {
      spinner.style.display = 'none';
      fb.textContent = 'Network error';
      fb.className = 'feedback wrong';
    }
  });

  checkBtn.addEventListener('click', (e) => e.preventDefault());
}

// ============ Neko（裝飾）============
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  fetch('https://nekos.best/api/v2/neko', { signal: controller.signal })
    .then(res => {
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json();
    })
    .then(data => {
      if (data.results && data.results.length > 0) {
        img.src = data.results[0].url;
        img.style.display = 'block';
        status.style.display = 'none';
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        throw new Error('No neko results returned');
      }
    })
    .catch(err => {
      clearTimeout(timeoutId);
      const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
      status.textContent = `Load failed: ${msg}`;
      status.style.color = 'var(--danger)';
      img.style.display = 'none';
    });
}

// ============ 討論區 ============
async function loadDiscussions(problemId) {
  const listDiv = document.getElementById('discussionList');
  try {
    const data = await apiCall(`/api/problem?action=discussions&problemId=${encodeURIComponent(problemId)}`);
    if (!data.success) { listDiv.innerHTML = '<p>Failed to load discussions.</p>'; return; }

    const currentUsername = getCurrentUser()?.username;
    listDiv.innerHTML = data.discussions.map(d => {
      const liked = d.likedBy && d.likedBy.includes(currentUsername);
      return `
        <div class="discussion-post" data-id="${d._id}">
          <div class="post-header">
            <span class="post-user">${escapeHtml(d.username)}</span>
            <span class="post-time">${new Date(d.createdAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}</span>
          </div>
          <div class="post-content">${DOMPurify.sanitize(d.content, domPurifyConfig)}</div>
          <div class="post-actions">
            <button class="like-btn ${liked ? 'liked' : ''}" data-id="${d._id}">
              ${liked ? '❤️' : '🤍'} <span class="likes-count">${d.likes || 0}</span>
            </button>
          </div>
        </div>`;
    }).join('') || '<p>No discussions yet.</p>';

    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(listDiv, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }]
      });
    }

    listDiv.querySelectorAll('.like-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const discussionId = btn.dataset.id;
        const res = await apiCall('/api/problem?action=discussions', 'PUT', { action: 'like', discussionId });
        if (res.success) {
          const newLikes = res.discussion.likes;
          const isLiked = res.discussion.likedBy && res.discussion.likedBy.includes(currentUsername);
          btn.className = `like-btn ${isLiked ? 'liked' : ''}`;
          btn.innerHTML = `${isLiked ? '❤️' : '🤍'} <span class="likes-count">${newLikes}</span>`;
        }
      });
    });

    document.getElementById('postDiscussionBtn').addEventListener('click', async () => {
      const content = document.getElementById('discussionContent').value.trim();
      if (!content) return alert('Content is empty');
      const res = await apiCall('/api/problem?action=discussions', 'POST', { problemId, content });
      if (res.success) {
        document.getElementById('discussionContent').value = '';
        loadDiscussions(problemId);
      } else {
        alert(res.message || 'Error');
      }
    });
  } catch (err) {
    listDiv.innerHTML = '<p>Error loading discussions.</p>';
  }
}

// ============ 啟動 ============
initPage();

// ============ 頁面卸載清理 ============
window.addEventListener('pagehide', () => {
  if (document.getElementById('timerRow')) { pauseTimer(); saveTimer(); }
  if (pollTimer) clearInterval(pollTimer);
  if (window.__pdfResizeObserver) {
    try { window.__pdfResizeObserver.disconnect(); } catch (e) {}
    window.__pdfResizeObserver = null;
  }
  cooldown = false;
});
