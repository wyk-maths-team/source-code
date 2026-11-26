// assets/js/pd-extras.js
(function () {
  'use strict';

const PD = window.PD;
if (!PD) { console.error('[pd-extras] window.PD missing'); return; }

const {
  S, problemId, mainContainer, PAGE_LOAD_AT,
  esc, debounce, loadScript, clampInt,
  answersStore, saveAnswerDebounced, saveAnswerNow,
  setWorkbenchStatus, setWorkbenchStatusHtml, statusBoxHtml,
  updateProblemDetailIcon,
} = PD;

// 状态保留逻辑
const _persistentStatus = { html: '', cls: '', isHtml: false };
const _origSetWorkbenchStatus     = PD.setWorkbenchStatus;
const _origSetWorkbenchStatusHtml = PD.setWorkbenchStatusHtml;

PD.setWorkbenchStatus = function (text, cls) {
  const t = text || '';
  if (t) { _persistentStatus.html = t; _persistentStatus.cls = cls || ''; _persistentStatus.isHtml = false; }
  return _origSetWorkbenchStatus.call(this, text, cls);
};
PD.setWorkbenchStatusHtml = function (html, cls) {
  const h = html || '';
  if (h) { _persistentStatus.html = h; _persistentStatus.cls = cls || ''; _persistentStatus.isHtml = true; }
  return _origSetWorkbenchStatusHtml.call(this, html, cls);
};
function restoreWorkbenchStatus() {
  if (!_persistentStatus.html) { _origSetWorkbenchStatus(''); return; }
  if (_persistentStatus.isHtml) {
    _origSetWorkbenchStatusHtml(_persistentStatus.html, _persistentStatus.cls);
    if (/\$|\\\(|\\\[/.test(_persistentStatus.html)) {
      const el = document.getElementById('wbStatus');
      if (el && PD.renderMath) PD.renderMath(el);
    }
  } else { _origSetWorkbenchStatus(_persistentStatus.html, _persistentStatus.cls); }
}

// ============ Timer ============
const TIMER_KEY = `timer_${problemId}`;
function updateTimerDisplay() {
  const el = document.getElementById('timerDisplay');
  if (!el) return;
  const { seconds } = S.timer;
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function startTimer() {
  if (S.timer.running) return;
  S.timer.running = true;
  S.timer.interval = setInterval(() => { S.timer.seconds++; updateTimerDisplay(); }, 1000);
}
function pauseTimer() {
  if (!S.timer.running) return;
  S.timer.running = false;
  clearInterval(S.timer.interval);
}
function saveTimer() { localStorage.setItem(TIMER_KEY, String(S.timer.seconds)); }
function resetTimer() {
  pauseTimer(); S.timer.seconds = 0; updateTimerDisplay(); localStorage.removeItem(TIMER_KEY);
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
  div.id = 'timerRow'; div.className = 'timer-row';
  div.innerHTML = `<span class="timer-display" id="timerDisplay">00:00:00</span><button class="timer-btn" id="timerStartBtn">Start</button><button class="timer-btn" id="timerPauseBtn">Pause</button><button class="timer-btn" id="timerResetBtn">Reset</button><button class="timer-btn" id="timerCloseBtn">✕</button>`;
  container.parentNode.insertBefore(div, container);
  updateTimerDisplay();
  document.getElementById('timerStartBtn').addEventListener('click', startTimer);
  document.getElementById('timerPauseBtn').addEventListener('click', pauseTimer);
  document.getElementById('timerResetBtn').addEventListener('click', resetTimer);
  document.getElementById('timerCloseBtn').addEventListener('click', () => { pauseTimer(); saveTimer(); div.remove(); });
}

// ============ Draw + Draw 锁 ============
// 绘图工具是一个全屏遮罩（assets/js/draw.js），打开时要锁住页面滚动，
// 否则手机上用手指画的时候会把底下的题目一起滚走。
const DRAW_LOCK_CLASS = 'draw-mode-active';
let _drawLocked = false;
let _drawpadObserver = null;
let _drawToggling = false;

function _preventScroll(e) { if (!_drawLocked) return; e.preventDefault(); }
function _preventKeyboardScroll(e) {
  if (!_drawLocked) return;
  const blocked = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
  ]);
  if (blocked.has(e.key)) e.preventDefault();
}

function setDrawLock(locked) {
  if (locked === _drawLocked) return;
  _drawLocked = locked;

  if (locked) {
    document.documentElement.classList.add(DRAW_LOCK_CLASS);
    document.body.classList.add(DRAW_LOCK_CLASS);
    document.addEventListener('wheel',     _preventScroll, { passive: false, capture: true });
    document.addEventListener('touchmove', _preventScroll, { passive: false, capture: true });
    document.addEventListener('keydown',   _preventKeyboardScroll, { capture: true });
  } else {
    document.documentElement.classList.remove(DRAW_LOCK_CLASS);
    document.body.classList.remove(DRAW_LOCK_CLASS);
    document.removeEventListener('wheel',     _preventScroll, { capture: true });
    document.removeEventListener('touchmove', _preventScroll, { capture: true });
    document.removeEventListener('keydown',   _preventKeyboardScroll, { capture: true });
  }
}

function observeDrawpadState() {
  const wrapper = document.getElementById('drawpadWrapper');
  if (!wrapper) return;

  if (_drawpadObserver) {
    try { _drawpadObserver.disconnect(); } catch {}
    _drawpadObserver = null;
  }

  const check = () => {
    const st = wrapper.style.display;
    setDrawLock(st !== 'none' && st !== '');
  };

  _drawpadObserver = new MutationObserver(check);
  _drawpadObserver.observe(wrapper, {
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  });
  check();
}

async function loadDrawTool() {
  if (window.DrawTool) return window.DrawTool;
  await loadScript('/assets/js/draw.js' + (window.__BUILD_V ? '?v=' + window.__BUILD_V : ''));
  if (!window.DrawTool) throw new Error('DrawTool not found in draw.js');
  return window.DrawTool;
}

async function toggleDrawMode() {
  if (_drawToggling) return;   // 防并发（连点会开两次）
  _drawToggling = true;

  const btn = document.getElementById('drawToggleBtn');
  const orig = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

  try {
    const DrawTool = await loadDrawTool();
    DrawTool.toggle();
  } catch (e) {
    console.error('[draw]', e);
    alert('Failed to load drawing tool: ' + e.message);
  } finally {
    if (btn && orig) btn.innerHTML = orig;
    _drawToggling = false;
  }
}

// 打开/关闭遮罩时同步滚动锁
document.addEventListener('drawtool:open',  () => setDrawLock(true));
document.addEventListener('drawtool:close', () => setDrawLock(false));

// ============ Workbench ============
const WB_HINTS = { none: { icon: 'fa-hand-pointer', text: '' }, text: { icon: 'fa-bolt', text: '' }, photo: { icon: 'fa-camera', text: '' }, steps: { icon: 'fa-pen-fancy', text: '' }, solution: { icon: 'fa-book-open', text: '' } };
const WB_DRAFTS_KEY = 'pd_workbench_drafts';

const workbench = {
  mode: 'none',
  imageData: '',
  _draftKey() { return `${WB_DRAFTS_KEY}:${problemId}`; },
  _readDrafts() { try { return JSON.parse(localStorage.getItem(this._draftKey()) || '{}'); } catch { return {}; } },
  saveDraft(mode, val) {
    const d = this._readDrafts();
    const s = String(val == null ? '' : val);
    // 空值 = 用户清空，删掉这个键，刷新后不要又冒出来
    if (!s) delete d[mode];
    else d[mode] = s;
    try { localStorage.setItem(this._draftKey(), JSON.stringify(d)); } catch {}
  },
  loadDraft(mode) { return this._readDrafts()[mode] || ''; },
  setMode(newMode) {
    if (!WB_HINTS[newMode]) return;
    if (newMode === this.mode && newMode !== 'none') newMode = 'none';
    const old = this.mode;
    if (old === 'text')  this.saveDraft('text',  document.getElementById('answerInput')?.value || '');
    if (old === 'steps') this.saveDraft('steps', document.getElementById('stepsInput')?.value || '');
    document.querySelectorAll('.wb-tab').forEach(t => t.classList.toggle('active', newMode !== 'none' && t.dataset.mode === newMode));
    document.querySelectorAll('.wb-pane').forEach(p => p.classList.toggle('active', newMode !== 'none' && p.dataset.pane === newMode));
    const h = WB_HINTS[newMode] || WB_HINTS.none;
    const hintEl = document.getElementById('wbHint');
    if (hintEl) {
      if (h.text) { hintEl.innerHTML = `<i class="fas ${h.icon}"></i><span>${h.text}</span>`; hintEl.style.display = ''; }
      else { hintEl.innerHTML = ''; hintEl.style.display = 'none'; }
    }
    const checkBtn = document.getElementById('checkAnswerBtn');
    const label = document.getElementById('wbSubmitLabel');
    if (!checkBtn || !label) return;
    if (newMode === 'none' || newMode === 'solution') {
      checkBtn.disabled = true;
      label.textContent = 'Submit';
    } else {
      checkBtn.disabled = false;
      if (newMode === 'text')  label.textContent = 'Submit';
      if (newMode === 'photo') label.textContent = 'Upload & Grade';
      if (newMode === 'steps') label.textContent = 'Submit to AI';
    }
    if (newMode === 'text') {
      const input = document.getElementById('answerInput');
      // 单一口径：answersStore 是跨会话的草稿，工作台草稿只作兜底
      if (input) {
        const saved = answersStore.get(problemId) || this.loadDraft('text');
        if (saved !== input.value) { input.value = saved; updateExprPreview(); }
      }
    } else if (newMode === 'steps') {
      const st = document.getElementById('stepsInput');
      if(st) { st.value = this.loadDraft('steps'); updateStepsCounter(); }
    } else if (newMode === 'photo') {
      const hasImg = !!this.imageData;
      const dz = document.getElementById('wbDropzone'), pv = document.getElementById('wbPhotoPreview'), img = document.getElementById('imagePreview');
      if(dz) dz.hidden = hasImg;
      if(pv) pv.hidden = !hasImg;
      if(hasImg && img) img.src = this.imageData;
    }
    this.mode = newMode;
    restoreWorkbenchStatus();
    if (window.PD.cooldown) window.PD.cooldown.refresh();

    // 題解面板：第一次切過去時才載入
    if (newMode === 'solution' && window.PDSolution) {
      try { window.PDSolution.activate(); } catch (e) { console.warn('[solution]', e); }
    }
  },
};

function updateStepsCounter() {
  const el = document.getElementById('stepsInput'), cnt = document.getElementById('stepsCount');
  if (!el || !cnt) return;
  const n = el.value.length;
  cnt.textContent = n;
  cnt.parentElement.className = 'wb-counter' + (n >= 10000 ? ' limit' : n >= 9000 ? ' warn' : '');
}

// ============ 表达式求值 ============
let _mathLoading = null;
function looksLikeExpression(s) {
  if (!s || s.length > 200 || !/\d/.test(s)) return false;
  return /[+\-*/^()]|\b(?:sqrt|sin|cos|tan|log|ln|exp|pi|abs|pow|cbrt|asin|acos|atan|round|floor|ceil|max|min)\b/i.test(s);
}
function formatNumber(num) {
  if (!Number.isFinite(num)) return String(num);
  const abs = Math.abs(num);
  if (Number.isInteger(num) && abs < 1e15) return String(num);
  if (abs >= 1e15 || (abs !== 0 && abs < 1e-4)) return num.toExponential(6).replace(/\.?0+e/, 'e');
  let s = num.toFixed(6);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
function tryEvaluateExpression(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (typeof window.math === 'undefined') {
    if (!_mathLoading) _mathLoading = loadScript('https://cdn.jsdelivr.net/npm/mathjs@12.4.1/lib/browser/math.js').then(() => { _mathLoading = null; updateExprPreview(); }).catch(() => { _mathLoading = null; });
    return null;
  }
  if (!looksLikeExpression(s)) return null;
  try {
    const node = math.parse(s);
    let unsafe = false;
    node.traverse(n => { if (n.type === 'AssignmentNode' || n.type === 'FunctionAssignmentNode' || n.type === 'BlockNode') unsafe = true; });
    if (unsafe) return null;
    const val = node.evaluate();
    let num = typeof val === 'number' ? val : (val && typeof val.toNumber === 'function' ? val.toNumber() : (typeof val === 'bigint' ? Number(val) : NaN));
    if (!Number.isFinite(num)) return null;
    const out = formatNumber(num);
    return out === s ? null : out;
  } catch { return null; }
}
function updateExprPreview() {
  const input = document.getElementById('answerInput'), box = document.getElementById('wbExprPreview'), text = document.getElementById('wbExprResult');
  if (!input || !box || !text) return;
  const raw = input.value.trim();
  if (!raw) { box.hidden = true; return; }
  const computed = tryEvaluateExpression(raw);
  if (computed != null) { text.textContent = computed; box.classList.remove('plain'); }
  else { text.textContent = raw; box.classList.add('plain'); }
  box.hidden = false;
}
function getSubmissionPayload() {
  const m = workbench.mode;
  if (m === 'none')  return { error: 'Select a submission mode first' };
  if (m === 'text') {
    const raw = document.getElementById('answerInput')?.value.trim();
    if (!raw) return { error: 'Please enter an answer' };
    const computed = tryEvaluateExpression(raw);
    return { type: 'text', answer: computed != null ? computed : raw, rawValue: raw };
  }
  if (m === 'photo') {
    if (!workbench.imageData) return { error: 'Please select an image first' };
    return { type: 'image', image: workbench.imageData, answer: '' };
  }
  if (m === 'steps') {
    const steps = document.getElementById('stepsInput')?.value.trim();
    if (!steps) return { error: 'Please enter your solution steps' };
    if (steps.length < 10) return { error: 'Solution too short (min 10 chars)' };
    if (steps.length > 10000) return { error: 'Solution too long (max 10000 chars)' };
    return { type: 'steps', answer: steps };
  }
  return { error: 'Unknown mode' };
}

// ⭐ 等待计时器
let waitInterval = null;

// ── 流式批改进度 ──────────────────────────────────────────
//
// 进度条不能按阶段「跳」——一眼就看得出是假的，而且 model 那一段占了大半
// 时间，中间会有几十秒完全不动，看着就像卡死。
//
// 改成时间驱动：以「这次大概要多久」为基准，进度随真实时间平滑推进。
// 基准来自 grading_history 的实测 p50；拿不到就用 DEFAULT_ETA_MS 兜底。
//
// 曲线用幂函数 (t/T)^0.8：
//   t/T = 0.1 → 15.6%     t/T = 0.5 → 56.8%
//   t/T = 0.25 → 32.7%    t/T = 1.0 → 99%   ← 到预期时间就封顶
// 之后不再增长，停在 99% —— 再用指数曲线「永远逼近但到不了」的话，
// 超时之后会一直缓慢爬升，反而像在骗人。到点就停更诚实。
//
// 100 秒的兜底：没有历史数据时，宁可估长不估短。估短了会在题目真正
// 开始慢下来之前就顶到 99% 卡住，那是最难看的。

const DEFAULT_ETA_MS = 100000;

// 阶段下限：只抬不降。
// 压得极低（1–4%），因为下限每高一点，曲线追上它就要多花几秒，
// 而追不上的那段时间进度条是静止的 —— 那就是「僵直」。
// 实测：model 的 floor 设 8 时，前 4.3 秒一动不动；设 3 时约 1.5 秒。
// save 例外：那一步之后马上出结果，直接抬到 95%。
const STAGE_FLOOR = {
  authorize: 1, problem: 1, quota: 2, tokens: 2,
  prepare: 3, model: 3, retry: 4, save: 95,
};
// 下限本身也走指数平滑：阶段切换时它花约 0.25 秒爬到位，而不是瞬间跳一截。
const FLOOR_TAU_MS = 250;
// 曲线在 t = T 时给出的百分比；再往上就不动了
const CURVE_CEIL = 99;
// 幂指数：0.8 比 1 略前快后慢，接近人对「已经过去多少」的直觉
const CURVE_EXP = 0.8;

let waitStartedAt = 0, waitStage = '', waitPct = 0;
let waitFloor = 0, waitFloorNow = 0, waitExpectedMs = DEFAULT_ETA_MS;
let waitRaf = null, waitTimer = null, waitActive = false, waitLastFrame = 0;

// model 那一段占了整次批改的大半时间，服务端只会在换模型时才发事件，
// 中间几十秒没有任何新信号。这里按固定节奏轮换几条如实的提示，
// 让文字一直在动 —— 注意：这几条描述的都是「正在做的事」，
// 不是编出来的假进度。最后一条停在「still grading」，不循环回开头，
// 免得看起来像倒退了。
const MODEL_TIPS = [
  'Reading your working…',
  'Checking each step against the reference…',
  'Letting the model think it through…',
  'Still grading — long answers take longer…',
];
let tipTimer = null, tipIndex = 0;

function stopModelTips() {
  if (tipTimer) { clearInterval(tipTimer); tipTimer = null; }
  tipIndex = 0;
}

function startModelTips() {
  stopModelTips();
  tipTimer = setInterval(function () {
    if (tipIndex < MODEL_TIPS.length - 1) tipIndex++;
    waitStage = MODEL_TIPS[tipIndex];
    paintStage();
  }, 7000);
}

/** 只建一次结构，之后只改内容 —— 避免每帧重建 DOM 把动画打断 */
function buildWaiting() {
  const el = document.getElementById('wbStatus');
  if (!el) return;
  el.className = 'wb-status busy wb-stream';
  el.innerHTML =
    '<span class="wb-spin" aria-hidden="true"></span>' +
    '<span class="wb-stage"></span>' +
    '<span class="wb-secs">0s</span>' +
    '<span class="wb-bar" aria-hidden="true"><i style="width:0%"></i></span>';
  paintStage();
}

function paintStage() {
  const el = document.querySelector('#wbStatus .wb-stage');
  if (el && el.textContent !== waitStage) {
    el.textContent = waitStage;
    // 换文字时重放一次浮入动画
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
  }
}

function paintSeconds() {
  const el = document.querySelector('#wbStatus .wb-secs');
  if (el) el.textContent = Math.round((Date.now() - waitStartedAt) / 1000) + 's';
}

/** 每帧算一次目标进度。幂函数曲线，到预期时间封顶 99%。 */
function tickProgress() {
  if (!waitActive) return;

  const now = Date.now();
  const dt = waitLastFrame ? Math.min(200, now - waitLastFrame) : 16;
  waitLastFrame = now;

  const elapsed = now - waitStartedAt;
  const frac = Math.min(1, elapsed / Math.max(2000, waitExpectedMs));

  // 下限平滑逼近目标值，避免阶段切换时的跳变
  waitFloorNow += (waitFloor - waitFloorNow) * (1 - Math.exp(-dt / FLOOR_TAU_MS));

  // 主曲线：t = T 时正好到 99%，之后不再增长
  const curve = CURVE_CEIL * Math.pow(frac, CURVE_EXP);

  const pct = Math.min(CURVE_CEIL, Math.max(waitFloorNow, curve));

  if (pct - waitPct >= 0.1) {
    waitPct = pct;
    const bar = document.querySelector('#wbStatus .wb-bar i');
    if (bar) bar.style.width = pct.toFixed(1) + '%';
  }

  waitRaf = requestAnimationFrame(tickProgress);
}

function startStreamWaiting(label) {
  waitStartedAt = Date.now();
  waitStage = label || 'Submitting…';
  waitPct = 0;
  waitFloor = STAGE_FLOOR.authorize;
  waitFloorNow = 0;              // 从 0 平滑爬上去，第一帧就有动作
  waitExpectedMs = DEFAULT_ETA_MS;
  waitActive = true;
  waitLastFrame = 0;

  buildWaiting();

  if (waitTimer) clearInterval(waitTimer);
  waitTimer = setInterval(paintSeconds, 500);

  if (waitRaf) cancelAnimationFrame(waitRaf);
  waitRaf = requestAnimationFrame(tickProgress);
}

function updateStreamStage(payload) {
  const id = payload && payload.id;
  const label = (payload && payload.label) || 'Grading…';

  if (id === 'model') {
    // 换模型 / 首次进入模型阶段：文字从服务端那句开始，之后由 tips 接管轮换
    startModelTips();
    waitStage = label;
  } else {
    stopModelTips();
    waitStage = label;
  }

  const floor = payload && STAGE_FLOOR[id];
  if (typeof floor === 'number' && floor > waitFloor) waitFloor = floor;

  paintStage();
}

/** 服务端按难度给的实测耗时：换掉 20 秒兜底，曲线立刻贴合真实节奏 */
function applyEta(payload) {
  const p50 = Number(payload && payload.p50Ms);
  if (isFinite(p50) && p50 > 1000) {
    // 用 p50 而不是 p90：进度条宁可在少数慢题上「慢慢逼近上限」，
    // 也不要在一半的题上早早走完然后干等。
    waitExpectedMs = p50;
  }
}

function stopStreamWaiting() {
  waitActive = false;
  stopModelTips();
  if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
  if (waitRaf) { cancelAnimationFrame(waitRaf); waitRaf = null; }
}

// 旧接口保留：image-grade 那条同步路径还在用
function startWaiting() {
  let s = 0;
  setWorkbenchStatus('Waiting (0s)', 'busy');
  if (waitInterval) clearInterval(waitInterval);
  waitInterval = setInterval(() => {
    s++;
    setWorkbenchStatus(`Waiting (${s}s)`, 'busy');
  }, 1000);
}
function stopWaiting() {
  if (waitInterval) { clearInterval(waitInterval); waitInterval = null; }
}

// ⭐ 移除 Polling，改为直接同步处理
// ⭐ 流式批改：同一个 POST，Accept 换成 text/event-stream
// 服务端每到一个阶段就推一条事件，前端用转圈 + 阶段文字 + 进度条显示。
// 老调用方（course.js / mobile）不带这个 Accept，仍然拿一次性 JSON。
async function handleStepsSubmit(stepsText, checkBtn) {
  startStreamWaiting('Submitting…');
  let settled = false;

  try {
    const token = (window.getToken && window.getToken()) || localStorage.getItem('auth_token') || '';
    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (token) headers.Authorization = 'Bearer ' + token;

    const res = await fetch('/api/steps-grade', {
      method: 'POST',
      headers,
      body: JSON.stringify({ problemId, steps: stepsText }),
    });

    const ctype = String(res.headers.get('content-type') || '');

    // 不是事件流（旧部署、代理不支持、或提前返回了 4xx）：按原方式处理
    if (!ctype.includes('text/event-stream')) {
      const data = await res.json().catch(() => ({}));
      settled = true;
      applyGradeResponse(data, checkBtn);
      return;
    }

    await readGradeStream(res, {
      onStage: (s) => updateStreamStage(s),
      onEta: (e) => applyEta(e),
      onResult: (d) => { settled = true; applyGradeResponse(d, checkBtn); },
      onError: (d) => {
        settled = true;
        setWorkbenchStatus((d && d.message) || 'AI grading failed', 'err');
        S.cooldown = false;
        checkBtn.disabled = false;
      },
    });

  } catch (err) {
    setWorkbenchStatus('Network error: ' + (err.message || 'Submission failed'), 'err');
    S.cooldown = false;
    checkBtn.disabled = false;
  } finally {
    stopStreamWaiting();
    // 流断了但没有结果：批改在服务端会继续跑完（submissions 照写），
    // 所以别让学生以为失败了 —— 告诉他去提交记录看。
    if (!settled) {
      setWorkbenchStatus('Connection lost while grading — the result will still be saved to your submissions', 'err');
      S.cooldown = false;
      checkBtn.disabled = false;
    }
  }
}

/** 把服务端返回（JSON 或 SSE 的 result/error）落到 UI 上 */
function applyGradeResponse(res, checkBtn) {
  if (!res || res.success === false) {
    setWorkbenchStatus((res && res.message) || 'Submission failed', 'err');
    S.cooldown = false;
    if (checkBtn) checkBtn.disabled = false;
    return;
  }
  if (res.status === 'done') {
    renderStepsResult(res.result, res.subid);
    if (window.PD.cooldown) window.PD.cooldown.start('steps');
    if (res.tokens && window.updateTopbarTokens) {
      window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
    }
    return;
  }
  if (res.status === 'error') {
    setWorkbenchStatus('AI error: ' + (res.message || 'unknown'), 'err');
    S.cooldown = false;
    if (checkBtn) checkBtn.disabled = false;
    return;
  }
  // 服务端不再把批改转交给本地 grader。走到这里说明返回体不是预期形状，
  // 给个中性提示，别让人误以为已经判完。
  setWorkbenchStatus((res && res.message) || 'Grading did not return a result — please try again', 'err');
  S.cooldown = false;
  if (checkBtn) checkBtn.disabled = false;
}

/** 最小的 SSE 解析：按 \n\n 分帧，只关心 stage / eta / result / error */
async function readGradeStream(res, handlers) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', evt = '', data = [];

  const flush = () => {
    if (evt || data.length) {
      const raw = data.join('\n');
      let payload = null;
      try { payload = raw ? JSON.parse(raw) : null; } catch (e) { payload = null; }
      if (payload) {
        if (evt === 'stage' && handlers.onStage) handlers.onStage(payload);
        else if (evt === 'eta' && handlers.onEta) handlers.onEta(payload);
        else if (evt === 'result' && handlers.onResult) handlers.onResult(payload);
        else if (evt === 'error' && handlers.onError) handlers.onError(payload);
        // ping / hello 忽略
      }
      evt = ''; data = [];
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) evt = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      flush();
    }
  }
  flush();
}

// Polling 保留给 Root/Bridge
function pollGradeResult({ endpoint, taskId, checkBtn, maxAttempts = 60 }) {
  const POLL_INTERVAL = 3000;
  let attempts = 0;
  const tick = async () => {
    attempts++;
    if (attempts > maxAttempts) { stopWaiting(); setWorkbenchStatus('AI grading timed out', 'err'); return; }
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const res = await apiCall(`${endpoint}${sep}taskId=${encodeURIComponent(taskId)}`);
      if (res?.status === 'done') { 
        stopWaiting(); 
        renderStepsResult(res.result, res.subid); 
        //update topbar token usage
        if (res.tokens && window.updateTopbarTokens) {
          window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
        }
        return; 
      }
      if (res?.status === 'error') { stopWaiting(); setWorkbenchStatus('AI error: ' + (res.message || 'unknown'), 'err'); return; }
      setTimeout(tick, POLL_INTERVAL);
    } catch (err) { setTimeout(tick, POLL_INTERVAL); }
  };
  setTimeout(tick, 2000);
}

function renderStepsResult(result, subid) {
  const score = Number(result?.score), comment = result?.comment || '';
  if (score === -100 || !Number.isFinite(score)) {
    setWorkbenchStatusHtml(`<span class="feedback-box status-system" style="cursor:default"><i class="fas fa-exclamation-triangle"></i>&nbsp;AI error — please retry</span>`);
    return;
  }
  const s = Math.max(0, Math.min(100, Math.round(score)));
  let label, cls;
  if (s === 100) { label = 'Accepted (100)'; cls = 'status-accepted'; }
  else if (s === 0) { label = 'Wrong Answer (0)'; cls = 'status-wrong'; }
  else { label = `Partial Score (${s})`; cls = 'status-partial'; }

  let statusHtml;
  if (!comment) {
    statusHtml = subid ? statusBoxHtml(subid, label, cls) : `<span class="feedback-box ${cls}" style="cursor:default">${esc(label)}</span>`;
  } else {
    const commentSafe = esc(comment).replace(/\n/g, '<br>');
    const inner = `${esc(label)} — <span class="comment-text">${commentSafe}</span>`;
    statusHtml = subid ? `<a href="/submissions/${encodeURIComponent(subid)}/detail" class="feedback-box ${cls}">${inner}</a>` : `<span class="feedback-box ${cls}" style="cursor:default">${inner}</span>`;
  }
  setWorkbenchStatusHtml(statusHtml);
  if (comment) { const el = document.getElementById('wbStatus'); if (el && PD.renderMath) PD.renderMath(el); }

  if (s === 100) {
    PD.setProblemState(problemId, 'passed');
    if (localStorage.getItem('nekoModeUnlocked') === 'true' && localStorage.getItem('showNekos') === 'true') fetchNekoAndShow();
  } else if (S.userStates[problemId] !== 'passed') PD.setProblemState(problemId, 'failed');
  updateProblemDetailIcon();
  // 提交完成后刷新 topbar 的 token 数据（如果你在 topbar 暴露了刷新方法）
  // if (window.loadTokens) window.loadTokens(); 
}

function fetchNekoAndShow() {
  const container = document.getElementById('nekoContainer'), img = document.getElementById('nekoImage'), status = document.getElementById('nekoStatus');
  if (!container || !img || !status) return;
  container.style.display = 'block'; status.textContent = 'Loading image...'; status.style.color = 'var(--text-secondary)'; status.style.display = 'block'; img.style.display = 'none'; img.src = '';
  const category = localStorage.getItem('nekoCategory') || 'neko';
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000);
  fetch(`https://nekos.best/api/v2/${encodeURIComponent(category)}`, { signal: ctrl.signal }).then(res => { clearTimeout(to); if (!res.ok) throw new Error(); return res.json(); })
    .then(data => { if (!data.results?.length) throw new Error(); img.src = data.results[0].url; img.style.display = 'block'; status.style.display = 'none'; container.scrollIntoView({ behavior: 'smooth', block: 'center' }); })
    .catch(err => { clearTimeout(to); status.textContent = `Load failed`; status.style.color = 'var(--danger)'; img.style.display = 'none'; });
}

function bindAnswerInteractions() {
  document.querySelectorAll('.wb-tab:not(:disabled)').forEach(tab => tab.addEventListener('click', () => workbench.setMode(tab.dataset.mode)));
  
  const answerInput = document.getElementById('answerInput');
  if(answerInput) {
    answerInput.addEventListener('input', () => {
      saveAnswerDebounced(problemId, answerInput.value);      // 跨会话草稿（防抖）
      workbench.saveDraft('text', answerInput.value);         // 切换 tab / 题目时的即时兜底
      updateExprPreview();
    });
    // ⭐ 修复了原本少括号的问题
    answerInput.addEventListener('blur', () => saveAnswerNow(problemId, answerInput.value));
  }

  const stepsInput = document.getElementById('stepsInput');
  if(stepsInput) {
    stepsInput.addEventListener('input', () => { if (stepsInput.value.length > 10000) stepsInput.value = stepsInput.value.slice(0, 10000); updateStepsCounter(); workbench.saveDraft('steps', stepsInput.value); });
    stepsInput.addEventListener('blur', () => workbench.saveDraft('steps', stepsInput.value));
  }

  const dropzone = document.getElementById('wbDropzone'), fileInput = document.getElementById('imageFileInput'), preview = document.getElementById('wbPhotoPreview'), previewImg = document.getElementById('imagePreview');
  function acceptImageFile(file) {
    if (!file || !file.type.startsWith('image/') || file.size > 5 * 1024 * 1024) { setWorkbenchStatus('Invalid image (max 5MB)', 'err'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1920; let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        workbench.imageData = canvas.toDataURL('image/jpeg', 0.9);
        if(previewImg) previewImg.src = workbench.imageData;
        if(dropzone) dropzone.hidden = true;
        if(preview) preview.hidden = false;
        setWorkbenchStatus('Image ready', 'ok');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
  if(dropzone) {
    dropzone.addEventListener('click', () => fileInput?.click());
    ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
    dropzone.addEventListener('drop', e => acceptImageFile(e.dataTransfer?.files?.[0]));
  }
  if(fileInput) fileInput.addEventListener('change', () => { acceptImageFile(fileInput.files[0]); fileInput.value = ''; });
  document.getElementById('wbRetake')?.addEventListener('click', () => fileInput?.click());
  document.getElementById('wbRemoveImage')?.addEventListener('click', () => {
    workbench.imageData = ''; if(previewImg) previewImg.src = ''; if(preview) preview.hidden = true; if(dropzone) dropzone.hidden = false; setWorkbenchStatus('');
  });
  document.getElementById('timerToggleBtn')?.addEventListener('click', toggleTimer);
  workbench.setMode('none');
}

function bindSubmitEvent() {
  const checkBtn = document.getElementById('checkAnswerBtn');
  if(!checkBtn) return;
  checkBtn.addEventListener('click', async () => {
    if (S.cooldown) return;
    const payload = getSubmissionPayload();
    if (payload.error) { setWorkbenchStatus(payload.error, 'err'); return; }

    S.cooldown = true; checkBtn.disabled = true;

    if (payload.type === 'steps') {
      workbench.saveDraft('steps', payload.answer);
      return handleStepsSubmit(payload.answer, checkBtn);
    }

    startWaiting();
    try {
      if (payload.type === 'text') {
        saveAnswerNow(problemId, payload.answer);
        if (payload.rawValue && payload.rawValue !== payload.answer) {
          const inputEl = document.getElementById('answerInput');
          if(inputEl) { inputEl.value = payload.answer; updateExprPreview(); }
        }
      }

      const body = { problemId, answer: payload.answer || '', type: payload.type, image: payload.image || '', pageDwellMs: Date.now() - PAGE_LOAD_AT };
      const result = await apiCall('/api/submit', 'POST', body);
      
      stopWaiting();
      checkBtn.disabled = false; S.cooldown = false;

      if (!result.success) { setWorkbenchStatus(result.message || 'Submission failed', 'err'); return; }

      // 小群体的彩蛋：服务端在开了 nekos 的人提交成功时带回一张图，
      // 挂在题面下方。用 DOM 构造而不是拼 HTML —— URL 来自外部 API。
      try { if (result.neko) renderNekoCard(result.neko); } catch (e) { console.warn('[neko]', e && e.message); }

      // 小群体的彩蛋：服务端在开了 nekos 的人提交成功时带回一张图。
      // 挂在题面下方，不打断提交结果的显示。
      try { if (result.neko) renderNekoCard(result.neko); } catch (e) { console.warn('[neko]', e && e.message); }

      if (result.message && result.message.includes('Image submitted')) {
        S.cooldown = true; checkBtn.disabled = true;
        let imageUrl = result.imageUrl;
        if (!imageUrl && result.subid) {
          try { const detailRes = await apiCall(`/api/submissions?action=detail&subid=${encodeURIComponent(result.subid)}`); imageUrl = detailRes?.submission?.image || ''; } catch (e) {}
        }
        if (!imageUrl) { 
          setWorkbenchStatusHtml(statusBoxHtml(result.subid, 'Image saved (no imageUrl)', 'status-system')); 
          S.cooldown = false; checkBtn.disabled = false; 
          return; 
        }

        // ⭐ 直接同步等，不需要任何 taskId 判断
        startWaiting();
        try {
          const gradeRes = await apiCall('/api/image-grade', 'POST', { problemId, subid: result.subid, imageUrl });
          
          if (gradeRes?.success && gradeRes.status === 'done') {
            stopWaiting();
            checkBtn.disabled = false; S.cooldown = false;
            
            // 统一复用 renderStepsResult 来渲染 AI 批改的结果
            renderStepsResult(gradeRes.result, result.subid);
            
            if (window.PD.cooldown) window.PD.cooldown.start('photo');
            
            // 刷新 Token
            if (gradeRes.tokens && window.updateTopbarTokens) {
              window.updateTopbarTokens(gradeRes.tokens.daily, gradeRes.tokens.global);
            }
            return;
          }
          
          // 如果后端真的返回了别的（比如被降级），给出提示
          stopWaiting();
          setWorkbenchStatus(gradeRes?.message || 'AI Grading failed', 'err');
          S.cooldown = false; checkBtn.disabled = false;
          
        } catch (e) {
          stopWaiting(); 
          setWorkbenchStatus('Network error: ' + (e.message || 'unknown'), 'err'); 
          S.cooldown = false; checkBtn.disabled = false;
        }
        return;
      }

      // 结果只有一个来源：result.status（AC / PS60 / WA / V60 / SE），
      // 以前在这里按 score 现拼一遍，和列表页的规则老是对不上。
      const st = result.status || '';
      const stLabel = window.SubStatus ? window.SubStatus.label(st) : String(st || 'Pending');
      const stCls = window.SubStatus ? window.SubStatus.cls(st) : 'status-pending';
      setWorkbenchStatusHtml(statusBoxHtml(
        result.subid,
        stLabel === 'System Error' ? 'System Error: please report.' : stLabel,
        stCls));

      if (st === 'AC') {   // 状态是唯一真相
        PD.setProblemState(problemId, 'passed');
        if (localStorage.getItem('nekoModeUnlocked') === 'true' && localStorage.getItem('showNekos') === 'true') fetchNekoAndShow();
      } else if (S.userStates[problemId] !== 'passed') PD.setProblemState(problemId, 'failed');
      updateProblemDetailIcon();

      if (window.PD.cooldown) window.PD.cooldown.start(payload.type === 'image' ? 'photo' : 'text');

      // 把批改结果广播出去：答题卡的浮窗要拿 comment 画逐题对错
      try {
        window.dispatchEvent(new CustomEvent('pd:submit-result', {
          detail: {
            problemId,
            status: st,
            subid: result.subid,
            comment: result.comment || '',
            score: result.score,
            type: payload.type,
          },
        }));
      } catch (e) {}
      if (result.unlockedAchievements && typeof showAchievementToasts === 'function') showAchievementToasts(result.unlockedAchievements);
            // ⭐ 刷新 Topbar 的 Token
      if (window.updateTopbarTokens) {
        try {
          const tokenRes = await apiCall('/api/token');
          if (tokenRes.success) window.updateTopbarTokens(tokenRes.daily, tokenRes.global);
        } catch(e) {}
      }
      
    } catch (err) {
      stopWaiting(); checkBtn.disabled = false; S.cooldown = false;
      setWorkbenchStatus('Network error: ' + (err.message || 'unknown'), 'err');
    }
  });
}

  // ═════════════════════════════════════════════════════════════
  // [H] Similar / Report
  // ═════════════════════════════════════════════════════════════
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

      // 旧的提示语在说「按 tag 比对」，但引擎早换成技能向量了 —— 会误导。
      hint.textContent = 'Matched by shared skills, then by how close the difficulty is.';

      if (!data.similar?.length) {
        list.innerHTML = '<div class="si-empty"><i class="fas fa-search" style="font-size:28px;opacity:.4;display:block;margin-bottom:10px;"></i>No similar problems found.</div>';
        return;
      }

      list.innerHTML = data.similar.map(p => {
        const diffVal = Number(p.difficulty) || 0;
        const diffText = diffVal === 0 ? '∞' : diffVal.toFixed(2);
        const shared = Array.isArray(p.shared) ? p.shared : [];
        // 共享技能才是「为什么相似」的真实解释；没有共享就老实说难度相近
        const sharedHtml = shared.length
          ? shared.map(s => `<span class="si-tag common">${esc(s)}</span>`).join('')
          : '<span class="si-tag">difficulty only</span>';

        return `
          <a href="/problems/${encodeURIComponent(p.id)}" class="si-item">
            <div class="si-title">
              <span class="si-id">${esc(p.id)}</span>
              <span class="si-name">${esc(p.name || '')}</span>
            </div>
            <div class="si-meta">
              <span>Lv.${diffText}</span>
              <span style="flex:1;"></span>
              ${sharedHtml}
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

  // ═════════════════════════════════════════════════════════════
  // [I] Discussions
  // ═════════════════════════════════════════════════════════════
  const DOMPURIFY_CONFIG = {
    ALLOWED_TAGS: ['b','i','u','strong','em','a','p','br','ul','ol','li','span','div','code','pre','svg','g','defs','clipPath','foreignObject','path','circle','line','polyline','polygon','rect','text','tspan','linearGradient','radialGradient','stop','image','use','img'],
    ALLOWED_ATTR: ['href','target','rel','class','id','style','xmlns','viewBox','width','height','d','cx','cy','r','x','y','x1','x2','y1','y2','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-opacity','stroke-opacity','opacity','font-size','text-anchor','dominant-baseline','transform','src','data-pdf','data-total'],
    ALLOW_DATA_ATTR: true,
  };

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
        renderMathInElement(listDiv, { 
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false }  
          ],
          throwOnError: false 
        });
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

  // ═════════════════════════════════════════════════════════════
  // [J] Navigation
  // ═════════════════════════════════════════════════════════════
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
      if (idx > 0)              html += `<a href="/problems/${encodeURIComponent(ids[idx - 1])}" class="back-btn" title="Previous Problem">← Prev</a>`;
      if (idx < ids.length - 1) html += `<a href="/problems/${encodeURIComponent(ids[idx + 1])}" class="back-btn" title="Next Problem">Next →</a>`;
      nav.innerHTML = html;
    } catch (e) {
      console.error('Navigation setup error:', e);
      nav.innerHTML = '';
    }
  }

function cleanup() {
  if (document.getElementById('timerRow')) { pauseTimer(); saveTimer(); }
  if (S.pollTimer) clearInterval(S.pollTimer);
}
window.addEventListener('pagehide', cleanup);

window.__PD_EXTRAS__ = {
  workbench, cleanup, fetchNekoAndShow, toggleTimer, openSimilar, loadDiscussions,
  async init() {
    const problem = S.problem; if (!problem) return;

    // 画板是按题目存的：换题时先丢掉上一题的笔迹，再载入这道题自己的
    try { window.DrawTool && window.DrawTool.reload && window.DrawTool.reload(); } catch (e) { /* 未加载画板时忽略 */ }

    const isAdmin = getCurrentUser()?.role === 'admin' || getCurrentUser()?.role === 'root';
    const state = S.userStates[problemId] || 'not_started';
    const hasAccess = isAdmin || state === 'passed';
    const isFav = S.favorites.has(problemId);

    if (isAdmin) { const el = document.getElementById('detailEditBtn'); if (el) el.innerHTML = `<a href="/admin/problems/${encodeURIComponent(problemId)}" class="back-btn" style="margin-left:0.5rem;">edit</a>`; }
    const starIcon = document.querySelector('#detailFavorite i');
    if (starIcon) { starIcon.className = isFav ? 'fas fa-star' : 'far fa-star'; starIcon.style.color = isFav ? '#f1c40f' : '#aaa'; }

    if (hasAccess) {
      const area = document.getElementById('discussionToggleArea');
      if (area) {
        area.style.display = 'block';
        document.getElementById('expandDiscussionsBtn').addEventListener('click', function () {
          const section = document.getElementById('discussionSection');
          const hidden = section.style.display === 'none' || !section.style.display;
          if (hidden) { section.style.display = 'block'; this.innerHTML = 'Hide Discussions'; if (!section.dataset.loaded) { loadDiscussions(problemId); section.dataset.loaded = 'true'; } }
          else { section.style.display = 'none'; this.innerHTML = 'Expand Discussions'; }
        });
      }
    }

    document.getElementById('similarBtn')?.addEventListener('click', openSimilar);
    document.getElementById('similarCloseBtn')?.addEventListener('click', () => document.getElementById('similarModal').style.display = 'none');
    document.getElementById('similarModal')?.addEventListener('click', function (e) { if (e.target === this) this.style.display = 'none'; });
    bindReportModal();

    document.getElementById('detailFavorite')?.addEventListener('click', async function () {
      const icon = this.querySelector('i'); if (!icon) return;
      const wasFav = icon.classList.contains('fas');
      const revert = () => { if (wasFav) { icon.className = 'fas fa-star'; icon.style.color = '#f1c40f'; } else { icon.className = 'far fa-star'; icon.style.color = '#aaa'; } };
      if (wasFav) { icon.className = 'far fa-star'; icon.style.color = '#aaa'; } else { icon.className = 'fas fa-star'; icon.style.color = '#f1c40f'; }
      try { const res = await apiCall('/api/users?action=favorite', 'POST', { problemId }); if (!res.success) revert(); } catch { revert(); }
    });

    // 恢复这道题上次未提交的草稿（answersStore 是唯一口径）
    const saved = answersStore.get(problemId) || workbench.loadDraft('text');
    if (saved) {
      const ansEl = document.getElementById('answerInput');
      if (ansEl && !ansEl.value) {
        ansEl.value = saved;
        ansEl.title = 'Saved draft';
        ansEl.style.background = 'rgba(74,144,217,.08)';
        ansEl.addEventListener('input', () => { ansEl.style.background = ''; ansEl.title = ''; }, { once: true });
        updateExprPreview();
      }
    }

    document.getElementById('backToListBtn')?.addEventListener('click', () => history.back());
    document.getElementById('submissionsBtn')?.addEventListener('click', () => window.location.href = `/submissions/problem/${problemId}`);

    // 草稿板（全屏画板，提交时把图塞进 photo 面板走同一条批改路径）
    loadScript('/assets/js/pd-scratchpad.js' + (window.__BUILD_V ? '?v=' + window.__BUILD_V : '')).catch((e) => console.warn('[scratchpad]', e));

    // 全屏绘图遮罩（画笔 / 橡皮 / 多指）
    document.getElementById('drawToggleBtn')?.addEventListener('click', toggleDrawMode);

    bindAnswerInteractions();
    bindSubmitEvent();
    await setupNavigation(problem);
    updateExprPreview();
    if (window.PD.cooldown) window.PD.cooldown.refresh();
  },
};
/**
 * 提交成功后的彩蛋卡片，挂在题面下方。
 * URL 来自外部 API —— 全程用 DOM 构造，不拼 innerHTML。
 */
function renderNekoCard(neko) {
  if (!neko || !neko.url) return;
  var host = document.getElementById('statementContent');
  if (!host) return;

  var old = document.getElementById('nekoCard');
  if (old && old.parentNode) old.parentNode.removeChild(old);

  var card = document.createElement('div');
  card.id = 'nekoCard';
  card.className = 'neko-card';

  var img = document.createElement('img');
  img.src = String(neko.url);
  img.alt = '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  card.appendChild(img);

  if (neko.artist) {
    var tag = document.createElement('span');
    tag.className = 'neko-artist';
    tag.textContent = String(neko.artist);
    card.appendChild(tag);
  }

  if (host.parentNode) host.parentNode.insertBefore(card, host.nextSibling);
  else host.appendChild(card);
}

PD.workbench = workbench;
})();