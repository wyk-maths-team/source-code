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

// ============ Workbench ============
const WB_HINTS = { none: { icon: 'fa-hand-pointer', text: '' }, text: { icon: 'fa-bolt', text: '' }, photo: { icon: 'fa-camera', text: '' }, steps: { icon: 'fa-pen-fancy', text: '' } };
const WB_DRAFTS_KEY = 'pd_workbench_drafts';

const workbench = {
  mode: 'none',
  imageData: '',
  _draftKey() { return `${WB_DRAFTS_KEY}:${problemId}`; },
  _readDrafts() { try { return JSON.parse(localStorage.getItem(this._draftKey()) || '{}'); } catch { return {}; } },
  saveDraft(mode, val) { if (!val && val !== 0) return; const d = this._readDrafts(); d[mode] = String(val); try { localStorage.setItem(this._draftKey(), JSON.stringify(d)); } catch {} },
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
    if (newMode === 'none') { checkBtn.disabled = true; label.textContent = 'Submit'; }
    else {
      checkBtn.disabled = false;
      if (newMode === 'text')  label.textContent = 'Submit';
      if (newMode === 'photo') label.textContent = 'Upload & Grade';
      if (newMode === 'steps') label.textContent = 'Submit to AI';
    }
    if (newMode === 'text') {
      const input = document.getElementById('answerInput');
      if(input) { input.value = this.loadDraft('text'); updateExprPreview(); }
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
async function handleStepsSubmit(stepsText, checkBtn) {
  startWaiting();
  try {
    const res = await apiCall('/api/steps-grade', 'POST', { problemId, steps: stepsText });
    stopWaiting();
    
    if (!res?.success) {
      setWorkbenchStatus(res?.message || 'Submission failed', 'err');
      S.cooldown = false;
      checkBtn.disabled = false;
      return;
    }

    // 如果是 Root，走后端轮询
    // if (res.status === 'pending') {
    //   setWorkbenchStatus('Waiting for local bridge...', 'busy');
    //   pollGradeResult({ endpoint: '/api/steps-grade', taskId: res.taskId, checkBtn, maxAttempts: 100 });
    //   return;
    // }

    // 非 Root，直接拿结果
    if (res.status === 'done') {
      renderStepsResult(res.result, res.subid);
      if (window.PD.cooldown) window.PD.cooldown.start('steps');
      
      // ⭐ 顺手更新 topbar 的 token
      if (res.tokens && window.updateTopbarTokens) {
        window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
      }
      return;
    }

    if (res.status === 'error') {
      setWorkbenchStatus('AI error: ' + (res.message || 'unknown'), 'err');
      S.cooldown = false;
      checkBtn.disabled = false;
    }
  } catch (err) {
    stopWaiting();
    setWorkbenchStatus('Network error: ' + (err.message || 'unknown'), 'err');
    S.cooldown = false;
    checkBtn.disabled = false;
  }
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
    answerInput.addEventListener('input', () => { saveAnswerDebounced(problemId, answerInput.value); updateExprPreview(); });
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

      if (result.message && result.message.includes('Image submitted')) {
        S.cooldown = true; checkBtn.disabled = true;
        let imageUrl = result.imageUrl;
        if (!imageUrl && result.subid) {
          try { const detailRes = await apiCall(`/api/submissions?action=detail&subid=${encodeURIComponent(result.subid)}`); imageUrl = detailRes?.submission?.image || ''; } catch (e) {}
        }
        if (!imageUrl) { setWorkbenchStatusHtml(statusBoxHtml(result.subid, 'Image saved (no imageUrl)', 'status-system')); S.cooldown = false; checkBtn.disabled = false; return; }

        // 图片这里你可以根据后端是否支持同步选择是否保留 Polling，我这里保留以确保安全
        startWaiting();
        try {
          const gradeRes = await apiCall('/api/image-grade', 'POST', { problemId, subid: result.subid, imageUrl });
          if (gradeRes?.success && gradeRes.taskId) {
            if (window.PD.cooldown) window.PD.cooldown.start('photo');
            setWorkbenchStatus('Waiting for grading...', 'busy');
            pollGradeResult({ endpoint: '/api/image-grade', taskId: gradeRes.taskId, checkBtn, maxAttempts: 60 });
            return;
          }
          stopWaiting();
          setWorkbenchStatus(gradeRes?.message || 'Failed to create AI task', 'err');
          S.cooldown = false; checkBtn.disabled = false;
        } catch (e) {
          stopWaiting(); setWorkbenchStatus('Network error', 'err'); S.cooldown = false; checkBtn.disabled = false;
        }
        return;
      }

      if (result.systemError) {
        setWorkbenchStatusHtml(statusBoxHtml(result.subid, 'System Error: please report.', 'status-system'));
      } else if (result.score !== undefined) {
        let txt, cls;
        if (result.score === 100) { txt = 'Accepted'; cls = 'status-accepted'; }
        else if (result.score === 0) { txt = 'Wrong Answer'; cls = 'status-wrong'; }
        else { txt = `Partial Score (${result.score}%)`; cls = 'status-partial'; }
        setWorkbenchStatusHtml(statusBoxHtml(result.subid, txt, cls));
      } else {
        const txt = result.correct ? 'Accepted' : 'Wrong Answer';
        const cls = result.correct ? 'status-accepted' : 'status-wrong';
        setWorkbenchStatusHtml(statusBoxHtml(result.subid, txt, cls));
      }

      if (result.correct || result.score === 100) {
        PD.setProblemState(problemId, 'passed');
        if (localStorage.getItem('nekoModeUnlocked') === 'true' && localStorage.getItem('showNekos') === 'true') fetchNekoAndShow();
      } else if (S.userStates[problemId] !== 'passed') PD.setProblemState(problemId, 'failed');
      updateProblemDetailIcon();

      if (window.PD.cooldown) window.PD.cooldown.start(payload.type === 'image' ? 'photo' : 'text');
      if (result.unlockedAchievements && typeof showAchievementToasts === 'function') showAchievementToasts(result.unlockedAchievements);
            // ⭐ 刷新 Topbar 的 Token
       window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
      
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

    const saved = answersStore.get(problemId);
    if (saved) { const ansEl = document.getElementById('answerInput'); if (ansEl && !ansEl.value) { ansEl.value = saved; ansEl.title = '上次提交的答案'; ansEl.style.background = 'rgba(74,144,217,.08)'; ansEl.addEventListener('input', () => { ansEl.style.background = ''; ansEl.title = ''; }, { once: true }); } }

    document.getElementById('backToListBtn')?.addEventListener('click', () => history.back());
    document.getElementById('submissionsBtn')?.addEventListener('click', () => window.location.href = `/submissions/problem/${problemId}`);

    bindAnswerInteractions();
    bindSubmitEvent();
    await setupNavigation(problem);
    updateExprPreview();
    if (window.PD.cooldown) window.PD.cooldown.refresh();
  },
};
PD.workbench = workbench;
})();