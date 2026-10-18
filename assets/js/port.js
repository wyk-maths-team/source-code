// script/port.js
(function () {
  'use strict';

  if (!isLoggedIn()) { window.location.href = '/index.html'; return; }
  const user = getCurrentUser();
  if (!user || user.role !== 'root') {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:#999">Root only.</div>';
    return;
  }

  // ═══ Theme ═══
  const themeBtn = document.getElementById('themeToggle');
  function syncThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeBtn.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
  }
  themeBtn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }
    syncThemeIcon();
  });
  syncThemeIcon();

  // ═══ Views ═══
  const views = {
    tasks: document.getElementById('view-tasks'),
    submissions: document.getElementById('view-submissions'),
    settings: document.getElementById('view-settings'),
  };
  document.querySelectorAll('.ptb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const v = tab.dataset.view;
      if (!v) return;
      document.querySelectorAll('.ptb-tab').forEach(t => t.classList.toggle('active', t === tab));
      Object.entries(views).forEach(([k, el]) => el.hidden = (k !== v));
      if (v === 'submissions') loadSubmissions(1);
      if (v === 'settings') loadSettings();
    });
  });

  // ═══ State ═══
  const state = {
    subject: 'chin',
    chapter: '',
    search: '',
    problems: [],
    filtered: [],
    problemStats: {},   // ⭐ { problemId: { status, score, maxScore, submittedAt } }
    current: null,
    steps: '',
    images: [],
    submitting: false,
    subsPage: 1,
  };

  // ═══ LocalStorage 草稿 ═══
  const DRAFT_PREFIX = 'port_draft_';
  function draftKey(problemId) { return `${DRAFT_PREFIX}${problemId}`; }
  function saveDraft(problemId, text) {
    if (!problemId) return;
    try {
      if (text && text.trim()) localStorage.setItem(draftKey(problemId), text);
      else localStorage.removeItem(draftKey(problemId));
    } catch {}
  }
  function loadDraft(problemId) {
    if (!problemId) return '';
    try { return localStorage.getItem(draftKey(problemId)) || ''; } catch { return ''; }
  }
  function clearDraft(problemId) {
    try { localStorage.removeItem(draftKey(problemId)); } catch {}
  }

  // ═══ HTTP ═══
  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body || null;
    return apiCall(path, method, body);
  }

  // ═══ KaTeX ═══
  function renderMathIn(el) {
    if (!el || typeof renderMathInElement !== 'function') return;
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
    } catch (e) { console.warn('[katex]', e); }
  }

  // ═══ Escape ═══
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  // ═══ Subject / Chapter / Search ═══
  const subjectSelect = document.getElementById('subjectSelect');
  const chapterSelect = document.getElementById('chapterSelect');
  const searchInput = document.getElementById('searchInput');
  const problemList = document.getElementById('problemList');
  const problemCount = document.getElementById('problemCount');

  subjectSelect.addEventListener('change', () => {
    state.subject = subjectSelect.value;
    state.chapter = '';
    state.current = null;
    loadProblems();
  });
  chapterSelect.addEventListener('change', () => {
    state.chapter = chapterSelect.value;
    applyFilter();
  });
  searchInput.addEventListener('input', () => {
    state.search = searchInput.value.trim().toLowerCase();
    applyFilter();
  });

  async function loadProblems() {
    problemList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2)">Loading…</div>';

    // ⭐ 並行拉題目 + 提交狀態
    const [problemsData, statsData] = await Promise.all([
      api(`/api/port/problems?subject=${state.subject}&limit=500`),
      api(`/api/port/problem-stats?subject=${state.subject}`),
    ]);

    if (!problemsData.success) {
      problemList.innerHTML = '<div style="padding:20px;color:var(--danger)">Failed.</div>';
      return;
    }

    state.problemStats = (statsData.success && statsData.stats) ? statsData.stats : {};

    const curVal = chapterSelect.value;
    chapterSelect.innerHTML = '<option value="">All chapters</option>' +
      problemsData.chapters.map(c => `<option value="${c}">Chapter ${c}</option>`).join('');
    chapterSelect.value = curVal;

    state.problems = problemsData.items;
    applyFilter();
  }

  // ⭐ 只刷新狀態（提交完成後呼叫）
  async function refreshProblemStats() {
    try {
      const r = await api(`/api/port/problem-stats?subject=${state.subject}`);
      if (r.success && r.stats) {
        state.problemStats = r.stats;
        renderProblemList();
      }
    } catch {}
  }

  function applyFilter() {
    let list = state.problems;
    if (state.chapter) {
      const c = Number(state.chapter);
      list = list.filter(p => p.chapter === c);
    }
    if (state.search) {
      const q = state.search;
      list = list.filter(p =>
        (p.id || '').toLowerCase().includes(q) ||
        (p.statement || '').toLowerCase().includes(q)
      );
    }
    state.filtered = list;
    renderProblemList();
  }

  // ⭐ 根據題目統計生成狀態圖標
  function getStatusIcon(problemId) {
    const st = state.problemStats[problemId];
    if (!st) return '';

    // pending / processing
    if (st.status === 'pending' || st.status === 'processing') {
      return '<span class="pi-status pending" title="Grading…"><i class="fas fa-circle-notch fa-spin"></i></span>';
    }
    if (st.status === 'error') {
      return '<span class="pi-status error" title="Error"><i class="fas fa-exclamation-triangle"></i></span>';
    }
    if (st.status !== 'done') return '';

    // done
    const s = Number(st.score);
    const m = Number(st.maxScore);

    // M2 診斷模式
    if (s === -1) {
      return '<span class="pi-status diag" title="Diagnostic"><i class="fas fa-stethoscope"></i></span>';
    }
    // 滿分
    if (Number.isFinite(s) && Number.isFinite(m) && s >= m) {
      return '<span class="pi-status perfect" title="Perfect"><i class="fas fa-check-circle"></i></span>';
    }
    // 過半
    if (Number.isFinite(s) && Number.isFinite(m) && s >= m * 0.5) {
      return `<span class="pi-status partial" title="${s}/${m}"><i class="fas fa-circle-half-stroke"></i></span>`;
    }
    // 有提交但低分
    if (Number.isFinite(s) && s > 0) {
      return `<span class="pi-status low" title="${s}${Number.isFinite(m) ? '/' + m : ''}"><i class="fas fa-circle-minus"></i></span>`;
    }
    // 0 分
    if (s === 0) {
      return '<span class="pi-status fail" title="0"><i class="fas fa-times-circle"></i></span>';
    }
    // fallback: done 但無分數
    return '<span class="pi-status perfect" title="Done"><i class="fas fa-check-circle"></i></span>';
  }

  function renderProblemList() {
    if (state.filtered.length === 0) {
      problemList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2)">No problems.</div>';
      problemCount.textContent = '0 problems';
      return;
    }
    const doneCount = Object.keys(state.problemStats).length;
    problemCount.textContent = `${state.filtered.length} problems · ${doneCount} done`;

    problemList.innerHTML = state.filtered.map(p => `
      <div class="problem-item" data-id="${escapeHtml(p.id)}">
        <span class="pi-id">${escapeHtml(p.id)}</span>
        <span class="pi-right">
          ${getStatusIcon(p.id)}
          <span class="pi-chapter">Ch.${p.chapter ?? '?'}</span>
        </span>
      </div>
    `).join('');
    problemList.querySelectorAll('.problem-item').forEach(el => {
      el.addEventListener('click', () => selectProblem(el.dataset.id));
    });
  }

  // ═══ Select Problem ═══
  function selectProblem(id) {
    const p = state.problems.find(x => x.id === id);
    if (!p) return;

    if (state.current && state.current.id !== id) {
      saveDraft(state.current.id, state.steps);
    }

    state.current = p;

    problemList.querySelectorAll('.problem-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });

    const empty = document.getElementById('problemEmpty');
    const panel = document.getElementById('problemPanel');
    if (empty) { empty.hidden = true; empty.style.display = 'none'; }
    panel.hidden = false;

    document.getElementById('ppId').textContent = p.id;
    document.getElementById('ppChapter').textContent = `Ch.${p.chapter ?? '?'}`;
    document.getElementById('ppSource').textContent = p.source || '';
    document.getElementById('ppMaxScore').textContent =
      (p.maxScore != null) ? `Max: ${p.maxScore}` : '';

    const stmtEl = document.getElementById('ppStatement');
    stmtEl.textContent = p.statement || '(no statement)';
    setTimeout(() => renderMathIn(stmtEl), 0);

    const ansEl = document.getElementById('ppAnswer');
    ansEl.textContent = p.answer || '(no reference answer)';
    setTimeout(() => renderMathIn(ansEl), 0);

    const draft = loadDraft(p.id);
    stepsInput.value = draft;
    state.steps = draft;
    stepsCount.textContent = draft.length;

    state.images = [];
    renderImageGrid();
    hideResult();

    updateSubmitBtn();
  }

  // ═══ Submit tabs ═══
  document.querySelectorAll('.sp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.mode;
      document.querySelectorAll('.sp-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.sp-pane').forEach(p => p.hidden = p.dataset.pane !== mode);
    });
  });

  // ═══ Steps ═══
  const stepsInput = document.getElementById('stepsInput');
  const stepsCount = document.getElementById('stepsCount');
  const draftIndicator = document.getElementById('draftIndicator');
  let draftSaveTimer = null;

  stepsInput.addEventListener('input', () => {
    state.steps = stepsInput.value;
    stepsCount.textContent = state.steps.length;
    updateSubmitBtn();

    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      if (state.current) {
        saveDraft(state.current.id, state.steps);
        draftIndicator.textContent = '✓ draft saved';
        draftIndicator.classList.add('saved');
        setTimeout(() => {
          draftIndicator.classList.remove('saved');
          draftIndicator.textContent = '';
        }, 1500);
      }
    }, 600);
  });

  document.getElementById('clearSteps').addEventListener('click', () => {
    if (!state.steps.trim()) return;
    if (!confirm('Clear the current draft?')) return;
    stepsInput.value = '';
    state.steps = '';
    stepsCount.textContent = '0';
    if (state.current) clearDraft(state.current.id);
    updateSubmitBtn();
  });

  // ═══ Images ═══
  const imgDropzone = document.getElementById('imgDropzone');
  const imgInput = document.getElementById('imgInput');
  const imgGrid = document.getElementById('imgGrid');

  imgDropzone.addEventListener('click', () => imgInput.click());
  ['dragenter', 'dragover'].forEach(ev => imgDropzone.addEventListener(ev, e => {
    e.preventDefault(); imgDropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => imgDropzone.addEventListener(ev, e => {
    e.preventDefault(); imgDropzone.classList.remove('dragover');
  }));
  imgDropzone.addEventListener('drop', e => {
    handleFiles(Array.from(e.dataTransfer.files || []));
  });
  imgInput.addEventListener('change', () => {
    handleFiles(Array.from(imgInput.files || []));
    imgInput.value = '';
  });

  async function handleFiles(files) {
    for (const f of files) {
      if (state.images.length >= 10) { alert('Max 10 images'); break; }
      if (!f.type.startsWith('image/')) continue;
      if (f.size > 10 * 1024 * 1024) { alert(`Too large: ${f.name}`); continue; }
      const dataUrl = await fileToCompressedDataUrl(f);
      state.images.push(dataUrl);
    }
    renderImageGrid();
    updateSubmitBtn();
  }

  function fileToCompressedDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const maxW = 1920;
          let w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.9));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function renderImageGrid() {
    imgGrid.innerHTML = state.images.map((d, i) => `
      <div class="ig-item">
        <img src="${d}">
        <button class="ig-remove" data-i="${i}">✕</button>
      </div>
    `).join('');
    imgGrid.querySelectorAll('.ig-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        state.images.splice(Number(btn.dataset.i), 1);
        renderImageGrid();
        updateSubmitBtn();
      });
    });
  }

  // ═══ Result Panel ═══
  const resultPanel = document.getElementById('resultPanel');
  const resultScore = document.getElementById('resultScore');
  const resultComment = document.getElementById('resultComment');
  const resultDetails = document.getElementById('resultDetails');

  function hideResult() {
    resultPanel.hidden = true;
    resultScore.textContent = '';
    resultScore.className = 'result-score';
    resultComment.textContent = '';
    resultDetails.innerHTML = '';
  }

  function showResult(result) {
    if (!result) return;
    const score = Number(result.score);
    const maxScore = state.current?.maxScore;

    if (score === -1) {
      resultScore.textContent = 'Diagnostic · no score';
      resultScore.className = 'result-score diag';
    } else if (Number.isFinite(score)) {
      const isPass = maxScore ? (score >= maxScore * 0.5) : (score >= 50);
      resultScore.textContent = maxScore ? `${score} / ${maxScore}` : `${score}`;
      resultScore.className = 'result-score ' + (isPass ? 'pass' : 'fail');
    } else {
      resultScore.textContent = '—';
      resultScore.className = 'result-score';
    }

    resultComment.textContent = result.comment || '(no feedback)';
    setTimeout(() => renderMathIn(resultComment), 0);

    resultDetails.innerHTML = '';
    if (result.details && typeof result.details === 'object') {
      const entries = Object.entries(result.details).filter(([, v]) => v != null);
      if (entries.length) {
        resultDetails.innerHTML = entries.map(([k, v]) => `
          <div class="result-detail-item">
            <div class="result-detail-key">${escapeHtml(k)}</div>
            <div class="result-detail-val">${escapeHtml(String(v))}</div>
          </div>
        `).join('');
      }
    }

    resultPanel.hidden = false;
    setTimeout(() => resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
  }

  document.getElementById('resultClose').addEventListener('click', hideResult);

  // ═══ Submit ═══
  const submitBtn = document.getElementById('submitBtn');
  const submitStatus = document.getElementById('submitStatus');

  function updateSubmitBtn() {
    const has = !!state.current && (state.steps.trim() || state.images.length > 0);
    submitBtn.disabled = !has || state.submitting;
  }

  submitBtn.addEventListener('click', async () => {
    if (state.submitting) return;
    if (!state.current) return;
    state.submitting = true;
    submitBtn.disabled = true;

    hideResult();

    try {
      submitStatus.className = 'sp-status';
      submitStatus.textContent = 'Uploading images…';

      let imageUrls = [];
      if (state.images.length > 0) {
        const up = await api('/api/port/upload', {
          method: 'POST',
          body: { images: state.images },
        });
        if (!up.success) throw new Error(up.message || 'Upload failed');
        imageUrls = up.urls;
      }

      submitStatus.textContent = 'Creating task…';
      const sub = await api('/api/port/submit', {
        method: 'POST',
        body: {
          problemId: state.current.id,
          subject: state.subject,
          steps: state.steps,
          images: imageUrls,
        },
      });
      if (!sub.success) throw new Error(sub.message || 'Submit failed');

      // ⭐ 立刻在列表上顯示「批改中」
      state.problemStats[state.current.id] = {
        status: 'processing',
        score: null,
        maxScore: state.current.maxScore,
        submittedAt: new Date().toISOString(),
      };
      renderProblemList();

      submitStatus.className = 'sp-status';
      submitStatus.textContent = 'Grading…';
      pollResult(sub.taskId);

    } catch (e) {
      submitStatus.className = 'sp-status err';
      submitStatus.textContent = 'Error: ' + e.message;
      state.submitting = false;
      updateSubmitBtn();
    }
  });

  async function pollResult(taskId) {
    const MAX = 60;
    for (let i = 0; i < MAX; i++) {
      await sleep(3000);
      try {
        const r = await api(`/api/port/poll?taskId=${encodeURIComponent(taskId)}`);
        if (r.status === 'done') {
          submitStatus.className = 'sp-status ok';
          submitStatus.textContent = '✔ Graded';
          showResult(r.result);
          if (state.current) clearDraft(state.current.id);

          // ⭐ 更新該題狀態
          if (state.current) {
            state.problemStats[state.current.id] = {
              status: 'done',
              score: r.result?.score ?? null,
              maxScore: state.current.maxScore,
              submittedAt: new Date().toISOString(),
            };
            renderProblemList();
          }
          state.submitting = false;
          updateSubmitBtn();
          return;
        }
        if (r.status === 'error') {
          submitStatus.className = 'sp-status err';
          submitStatus.textContent = 'Error: ' + (r.message || 'Grading failed');
          if (state.current) {
            state.problemStats[state.current.id] = {
              status: 'error',
              score: null,
              maxScore: state.current.maxScore,
              submittedAt: new Date().toISOString(),
            };
            renderProblemList();
          }
          state.submitting = false;
          updateSubmitBtn();
          return;
        }
      } catch (e) { /* retry */ }
    }
    submitStatus.className = 'sp-status err';
    submitStatus.textContent = 'Timed out';
    state.submitting = false;
    updateSubmitBtn();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ═══ Submissions ═══
  const subsList = document.getElementById('subsList');
  const subsSubject = document.getElementById('subsSubject');
  const subsPagination = document.getElementById('subsPagination');
  const pgPrev = document.getElementById('pgPrev');
  const pgNext = document.getElementById('pgNext');
  const pgPages = document.getElementById('pgPages');

  let subsTotalPages = 1;
  const SUBS_PER_PAGE = 20;

  document.getElementById('subsRefresh').addEventListener('click', () => loadSubmissions(state.subsPage));
  subsSubject.addEventListener('change', () => loadSubmissions(1));
  pgPrev.addEventListener('click', () => {
    if (state.subsPage > 1) loadSubmissions(state.subsPage - 1);
  });
  pgNext.addEventListener('click', () => {
    if (state.subsPage < subsTotalPages) loadSubmissions(state.subsPage + 1);
  });

  async function loadSubmissions(page = 1) {
    state.subsPage = page;
    subsList.innerHTML = '<div class="sub-empty"><i class="fas fa-spinner fa-spin"></i><div>Loading…</div></div>';
    subsPagination.hidden = true;

    const q = new URLSearchParams({
      limit: String(SUBS_PER_PAGE),
      page: String(page),
    });
    if (subsSubject.value) q.set('subject', subsSubject.value);

    const data = await api(`/api/port/submissions?${q}`);
    if (!data.success || !data.items?.length) {
      subsList.innerHTML = '<div class="sub-empty"><i class="fas fa-inbox"></i><div>No submissions yet.</div></div>';
      return;
    }

    subsTotalPages = data.totalPages || 1;
    subsList.innerHTML = data.items.map(s => renderSubCard(s)).join('');

    subsList.querySelectorAll('.sub-card-header').forEach(h => {
      h.addEventListener('click', async () => {
        const card = h.closest('.sub-card');
        const wasOpen = card.classList.contains('open');
        card.classList.toggle('open');
        if (!wasOpen && !card.dataset.detailLoaded) {
          card.dataset.detailLoaded = '1';
          const detail = await api(`/api/port/submissions?id=${encodeURIComponent(card.dataset.id)}`);
          if (detail.success) {
            renderSubDetail(card, detail.submission);
          }
        }
      });
    });

    subsList.querySelectorAll('.sub-images img').forEach(img => {
      img.addEventListener('click', e => {
        e.stopPropagation();
        openLightbox(img.src);
      });
    });

    renderPagination();
  }

  function renderPagination() {
    if (subsTotalPages <= 1) {
      subsPagination.hidden = true;
      return;
    }
    subsPagination.hidden = false;
    pgPrev.disabled = state.subsPage <= 1;
    pgNext.disabled = state.subsPage >= subsTotalPages;

    const cur = state.subsPage;
    const total = subsTotalPages;
    const nums = new Set([1, total]);
    for (let i = Math.max(1, cur - 2); i <= Math.min(total, cur + 2); i++) nums.add(i);

    const sorted = [...nums].sort((a, b) => a - b);
    let html = '';
    let prev = 0;
    for (const n of sorted) {
      if (n - prev > 1) html += '<span class="pg-ellipsis">…</span>';
      html += `<button class="pg-num ${n === cur ? 'active' : ''}" data-page="${n}">${n}</button>`;
      prev = n;
    }
    pgPages.innerHTML = html;
    pgPages.querySelectorAll('.pg-num').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (p !== cur) loadSubmissions(p);
      });
    });
  }

  function renderSubCard(s) {
    const scoreHtml = (s.score === -1)
      ? '<span class="sub-score diag">diagnostic</span>'
      : (s.score != null
          ? `<span class="sub-score">${s.score}${s.maxScore ? ' / ' + s.maxScore : ''}</span>`
          : '');
    const time = new Date(s.createdAt).toLocaleString('zh-HK', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
    return `
      <div class="sub-card" data-id="${escapeHtml(s.submissionId)}">
        <div class="sub-card-header">
          <div class="sub-meta-left">
            <span class="sub-id">${escapeHtml(s.problemId)}</span>
            <span class="sub-subject">${escapeHtml(s.subject)}</span>
            <span class="sub-time">${escapeHtml(time)}</span>
          </div>
          <div class="sub-meta-right">
            <span class="sub-status ${escapeHtml(s.status)}">${escapeHtml(s.status)}</span>
            ${scoreHtml}
            <i class="fas fa-chevron-down sub-expand-icon"></i>
          </div>
        </div>
        <div class="sub-card-body"><div class="sub-card-body-inner"></div></div>
      </div>
    `;
  }

  function renderSubDetail(card, sub) {
    const inner = card.querySelector('.sub-card-body-inner');
    let html = '';

    if (sub.comment) {
      html += `
        <div class="sub-section">
          <div class="sub-label">Feedback</div>
          <div class="sub-comment">${escapeHtml(sub.comment)}</div>
        </div>`;
    }

    if (sub.details && typeof sub.details === 'object') {
      const entries = Object.entries(sub.details).filter(([, v]) => v != null);
      if (entries.length) {
        html += `
          <div class="sub-section">
            <div class="sub-label">Details</div>
            <div class="sub-details">
              ${entries.map(([k, v]) => `
                <div class="sub-detail-item">
                  <div class="sub-detail-key">${escapeHtml(k)}</div>
                  <div class="sub-detail-val">${escapeHtml(String(v))}</div>
                </div>`).join('')}
            </div>
          </div>`;
      }
    }

    if (sub.steps) {
      html += `
        <div class="sub-section">
          <div class="sub-label">Your steps</div>
          <div class="sub-steps">${escapeHtml(sub.steps)}</div>
        </div>`;
    }

    if (sub.images && sub.images.length) {
      html += `
        <div class="sub-section">
          <div class="sub-label">Images (${sub.images.length})</div>
          <div class="sub-images">
            ${sub.images.map(url => `<img src="${escapeHtml(url)}" loading="lazy">`).join('')}
          </div>
        </div>`;
    }

    if (!html) html = '<div style="color:var(--text-2);font-size:13px;">No details available.</div>';
    inner.innerHTML = html;

    const feedbackEl = inner.querySelector('.sub-comment');
    if (feedbackEl) setTimeout(() => renderMathIn(feedbackEl), 0);

    inner.querySelectorAll('.sub-images img').forEach(img => {
      img.addEventListener('click', e => {
        e.stopPropagation();
        openLightbox(img.src);
      });
    });
  }

  // ═══ Lightbox ═══
  let lightbox = null;
  function openLightbox(src) {
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'img-lightbox';
      lightbox.innerHTML = '<img>';
      lightbox.addEventListener('click', () => lightbox.classList.remove('open'));
      document.body.appendChild(lightbox);
    }
    lightbox.querySelector('img').src = src;
    lightbox.classList.add('open');
  }

  // ═══ Settings ═══
  const chatUrlInput = document.getElementById('chatUrlInput');
  const chatUrlStatus = document.getElementById('chatUrlStatus');

  async function loadSettings() {
    const data = await api('/api/port/settings');
    if (data.success) chatUrlInput.value = data.currentChatUrl || '';
  }
  document.getElementById('chatUrlSave').addEventListener('click', async () => {
    chatUrlStatus.textContent = '';
    const r = await api('/api/port/settings', {
      method: 'PUT',
      body: { currentChatUrl: chatUrlInput.value.trim() },
    });
    if (r.success) {
      chatUrlStatus.textContent = '✔ Saved';
      setTimeout(() => chatUrlStatus.textContent = '', 2000);
    } else {
      chatUrlStatus.style.color = 'var(--danger)';
      chatUrlStatus.textContent = r.message || 'Failed';
    }
  });

  // ═══ Init ═══
  loadProblems();
})();