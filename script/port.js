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
      if (v === 'submissions') loadSubmissions();
      if (v === 'settings') loadSettings();
    });
  });

  // ═══ State ═══
  const state = {
    subject: 'chin',
    chapter: '',
    problems: [],
    current: null,
    steps: '',
    images: [],
    submitting: false,
  };

  // ═══ HTTP ═══
  // ⭐ 走全域 apiCall，它會自動加 Authorization header
  // 簽名：apiCall(url, method='GET', body=null)
  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body || null;
    return apiCall(path, method, body);
  }

  // ═══ Subject / Chapter ═══
  const subjectSelect = document.getElementById('subjectSelect');
  const chapterSelect = document.getElementById('chapterSelect');
  const problemList = document.getElementById('problemList');

  subjectSelect.addEventListener('change', () => {
    state.subject = subjectSelect.value;
    state.chapter = '';
    state.current = null;
    loadProblems();
  });
  chapterSelect.addEventListener('change', () => {
    state.chapter = chapterSelect.value;
    loadProblems();
  });

  async function loadProblems() {
    problemList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2)">Loading…</div>';
    const q = new URLSearchParams({ subject: state.subject, limit: '200' });
    if (state.chapter) q.set('chapter', state.chapter);
    const data = await api(`/api/port/problems?${q}`);
    if (!data.success) {
      problemList.innerHTML = '<div style="padding:20px;color:var(--danger)">Failed.</div>';
      return;
    }
    // 章節
    const curVal = chapterSelect.value;
    chapterSelect.innerHTML = '<option value="">All chapters</option>' +
      data.chapters.map(c => `<option value="${c}">Chapter ${c}</option>`).join('');
    chapterSelect.value = curVal;

    state.problems = data.items;
    if (data.items.length === 0) {
      problemList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2)">No problems.</div>';
      return;
    }
    problemList.innerHTML = data.items.map(p => `
      <div class="problem-item" data-id="${escapeHtml(p.id)}">
        <span>${escapeHtml(p.id)}</span>
        <span class="pi-chapter">Ch.${p.chapter ?? '?'}</span>
      </div>
    `).join('');
    problemList.querySelectorAll('.problem-item').forEach(el => {
      el.addEventListener('click', () => selectProblem(el.dataset.id));
    });
    // 在 loadProblems() 末尾加入：
async function loadUserStates() {
  try {
    const r = await api(`/api/port/stats?subject=${state.subject}`);
    if (r.success && r.summary[state.subject]) {
      state.userStates = r.summary[state.subject].states || {};
    } else {
      state.userStates = {};
    }
  } catch { state.userStates = {}; }
}

// 在 selectProblem / render 時給題目加狀態圖標：
const st = state.userStates[p.id];
const icon = st === 'passed' ? '✓' : st === 'failed' ? '✗' : '';
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function selectProblem(id) {
    const p = state.problems.find(x => x.id === id);
    if (!p) return;
    state.current = p;

    problemList.querySelectorAll('.problem-item').forEach(el => {
      el.classList.toggle('active', el.dataset.id === id);
    });

    const panel = document.getElementById('problemPanel');
    panel.hidden = false;
    document.getElementById('ppId').textContent = p.id;
    document.getElementById('ppChapter').textContent = `Chapter ${p.chapter ?? '?'}`;
    document.getElementById('ppStatement').textContent = p.statement || '';
    document.getElementById('ppAnswer').textContent = p.answer || '';
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
  stepsInput.addEventListener('input', () => {
    state.steps = stepsInput.value;
    stepsCount.textContent = state.steps.length;
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
    const files = Array.from(e.dataTransfer.files || []);
    handleFiles(files);
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
          const s = r.result?.score;
          submitStatus.textContent = (s === -1)
            ? '✔ Graded (diagnostic)'
            : `✔ ${s} / ${state.current?.maxScore ?? '?'}`;
          state.submitting = false;
          updateSubmitBtn();
          return;
        }
        if (r.status === 'error') {
          submitStatus.className = 'sp-status err';
          submitStatus.textContent = 'Error: ' + (r.message || 'Grading failed');
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
  document.getElementById('subsRefresh').addEventListener('click', loadSubmissions);
  subsSubject.addEventListener('change', loadSubmissions);

  async function loadSubmissions() {
    subsList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2)">Loading…</div>';
    const q = new URLSearchParams({ limit: '50' });
    if (subsSubject.value) q.set('subject', subsSubject.value);
    const data = await api(`/api/port/submissions?${q}`);
    if (!data.success || !data.items?.length) {
      subsList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-2)">No submissions.</div>';
      return;
    }
    subsList.innerHTML = data.items.map(s => {
      const score = (s.score === -1)
        ? '<span class="sub-score">診斷</span>'
        : (s.score != null ? `<span class="sub-score">${s.score}${s.maxScore ? ' / ' + s.maxScore : ''}</span>` : '');
      return `
        <div class="sub-card" data-id="${escapeHtml(s.submissionId)}">
          <div class="sub-head">
            <div>
              <span class="sub-id">${escapeHtml(s.problemId)}</span>
              <span class="sub-meta">· ${escapeHtml(s.subject)} · ${new Date(s.createdAt).toLocaleString('zh-HK')}</span>
            </div>
            <div>
              <span class="sub-status ${escapeHtml(s.status)}">${escapeHtml(s.status)}</span>
              ${score}
            </div>
          </div>
          <div class="sub-comment">${escapeHtml((s.comment || '').slice(0, 300))}</div>
        </div>
      `;
    }).join('');
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