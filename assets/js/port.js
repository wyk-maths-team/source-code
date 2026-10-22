let currentProblem = null;
let draftTimer = null;
let allProblems = [];

Page.boot({ title: 'Port', requireAuth: true });

Page.ready(async (user) => {
  // ==========================================
  // ⭐ 所有的 DOM 获取必须在 ready 内部执行
  // ==========================================
  const elSteps = document.getElementById('stepsInput');
  const elSubmitBtn = document.getElementById('submitBtn');
  const elDraftStatus = document.getElementById('draftIndicator');
  const elResultPanel = document.getElementById('resultPanel');
  const elClearSteps = document.getElementById('clearSteps');

  // 绑定视图切换
  document.querySelectorAll('.ptb-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ptb-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const view = tab.dataset.view;
      document.querySelectorAll('.port-view').forEach(v => v.hidden = true);
      
      const targetView = document.getElementById(`view-${view}`);
      if (targetView) targetView.hidden = false;
      
      if (view === 'submissions') loadSubmissions(1);
      if (view === 'settings') loadSettings();
    });
  });

  // 加载题目
  await loadProblems();
  document.getElementById('subjectSelect').addEventListener('change', loadProblems);
  document.getElementById('searchInput').addEventListener('input', renderList);

  // 清空草稿
  if (elClearSteps) {
    elClearSteps.addEventListener('click', () => {
      if (!currentProblem) return;
      if (confirm('Clear current draft?')) {
        elSteps.value = '';
        saveDraft(currentProblem.id, '');
      }
    });
  }

  // 自动保存草稿（LocalStorage + API）
  elSteps.addEventListener('input', () => {
    if (!currentProblem) return;
    document.getElementById('stepsCount').textContent = elSteps.value.length;
    elSubmitBtn.disabled = !elSteps.value.trim();
    if (!elDraftStatus) return;
    
    elDraftStatus.textContent = 'Saving...';
    localStorage.setItem(`port_draft_${currentProblem.id}`, elSteps.value);
    
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(currentProblem.id, elSteps.value), 1000);
  });

  // 提交
  elSubmitBtn.addEventListener('click', handleSubmit);
  document.getElementById('resultClose').addEventListener('click', () => elResultPanel.hidden = true);
});

async function saveDraft(problemId, steps) {
  try {
    await API.post('/api/port/draft', { problemId, steps });
    const el = document.getElementById('draftIndicator');
    if (el) el.textContent = 'Saved just now';
  } catch (e) { 
    const el = document.getElementById('draftIndicator');
    if (el) el.textContent = 'Saved locally'; 
  }
}

async function loadProblems() {
  const subject = document.getElementById('subjectSelect').value;
  const listEl = document.getElementById('problemList');
  listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">Loading...</div>';
  
  try {
    const [probRes, statRes] = await Promise.all([
      API.get(`/api/port/problems?subject=${subject}`),
      API.get(`/api/port/stats?subject=${subject}`)
    ]);
    const stats = statRes.summary?.[subject]?.states || {};
    allProblems = probRes.items.map(p => ({ ...p, status: stats[p.id] || 'none' }));
    renderList();
  } catch (err) {
    listEl.innerHTML = '<div style="padding:20px;color:red;">Failed to load</div>';
  }
}

function renderList() {
  const keyword = document.getElementById('searchInput').value.toLowerCase();
  const filtered = allProblems.filter(p => p.id.toLowerCase().includes(keyword));
  const listEl = document.getElementById('problemList');
  if (!filtered.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No problems.</div>';
    return;
  }
  listEl.innerHTML = filtered.map(p => `
    <div class="sb-item ${currentProblem?.id === p.id ? 'active' : ''}" onclick="selectProblem('${p.id}')">
      <span>${p.id} ${p.source ? `- ${p.source}` : ''}</span>
      <span class="${p.status === 'passed' ? 'status-pass' : ''}">${p.status === 'passed' ? '✓' : (p.status === 'failed' ? '✗' : '')}</span>
    </div>
  `).join('');
}

window.selectProblem = async function(id) {
  const p = allProblems.find(x => x.id === id);
  if (!p) return;
  currentProblem = p;
  renderList();

  document.getElementById('problemEmpty').hidden = true;
  document.getElementById('problemPanel').hidden = false;
  document.getElementById('submitBtn').disabled = false;
  
  document.getElementById('ppId').textContent = p.id;
  document.getElementById('ppChapter').textContent = p.chapter ? `Ch.${p.chapter}` : '';
  document.getElementById('ppSource').textContent = p.source || '';
  document.getElementById('ppMaxScore').textContent = `Max: ${p.maxScore || 100}`;
  document.getElementById('ppStatement').innerHTML = p.statement || 'No statement.';
  document.getElementById('ppAnswer').innerHTML = p.answer || 'No answer.';

  renderMathInElement(document.getElementById('problemPanel'), { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}] });

  const elResultPanel = document.getElementById('resultPanel');
  const elSteps = document.getElementById('stepsInput');
  elResultPanel.hidden = true;

  document.getElementById('draftIndicator').textContent = 'Loading...';
  const localDraft = localStorage.getItem(`port_draft_${id}`);
  if (localDraft) {
    elSteps.value = localDraft;
    document.getElementById('draftIndicator').textContent = 'Local draft loaded';
  }

  try {
    const res = await API.get(`/api/port/draft?problemId=${id}`);
    if (res.steps) {
      elSteps.value = res.steps;
      localStorage.setItem(`port_draft_${id}`, res.steps);
      document.getElementById('draftIndicator').textContent = 'Cloud draft loaded';
    } else if (!localDraft) {
      elSteps.value = '';
      document.getElementById('draftIndicator').textContent = 'Ready';
    }
  } catch(e) {
    document.getElementById('draftIndicator').textContent = 'Ready (offline)';
  }
  document.getElementById('stepsCount').textContent = elSteps.value.length;
};

async function handleSubmit() {
  if (!currentProblem) return;
  const elSteps = document.getElementById('stepsInput');
  const elSubmitBtn = document.getElementById('submitBtn');
  const elResultPanel = document.getElementById('resultPanel');
  
  const steps = elSteps.value.trim();
  if (!steps) return DSHUI.toast('Please write something first.', 'warn');

  elSubmitBtn.disabled = true;
  elSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Grading... (approx 15-30s)';
  elResultPanel.hidden = true;

  try {
    const res = await API.post('/api/port/submit', { problemId: currentProblem.id, subject: currentProblem.subject, steps });
    if (res.success) {
      showResult(res.result);
      document.getElementById('draftIndicator').textContent = 'Submitted!';
      localStorage.removeItem(`port_draft_${currentProblem.id}`);
      await loadProblems();
    }
  } catch (err) {
    DSHUI.toast(err.message || 'Grading failed', 'err');
  } finally {
    elSubmitBtn.disabled = false;
    elSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
  }
}

function showResult(result) {
  const elResultPanel = document.getElementById('resultPanel');
  elResultPanel.hidden = false;
  document.getElementById('resultScore').textContent = `Score: ${result.score} / ${currentProblem.maxScore || 100}`;
  
  const commentHtml = window.marked ? marked.parse(result.comment || '') : (result.comment || '');
  document.getElementById('resultComment').innerHTML = commentHtml;
  
  const warnEl = document.getElementById('resultWarning');
  if (result.warnings && result.warnings.length > 0) {
    warnEl.style.display = 'block';
    warnEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <b>Warning:</b> ${result.warnings.join('<br>')}`;
  } else {
    warnEl.style.display = 'none';
  }

  renderMathInElement(elResultPanel, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}] });
}

// ⭐ 恢复提交记录页面
async function loadSubmissions(page = 1) {
  const listEl = document.getElementById('subsList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="padding:20px;text-align:center;">Loading...</div>';
  
  const subject = document.getElementById('subsSubject').value;
  
  try {
    const params = new URLSearchParams({ page, limit: 20 });
    if (subject) params.set('subject', subject);
    const res = await API.get(`/api/port/submissions?${params.toString()}`);
    
    if (!res.items.length) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No submissions yet.</div>';
      return;
    }
    
    listEl.innerHTML = res.items.map(s => `
      <div style="background:#141414; border:1px solid #333; padding:16px; margin-bottom:12px; border-radius:6px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
          <strong style="color:#4a90d9;">${s.problemId} (${s.subject})</strong>
          <span style="color:${s.score >= 90 ? '#2ecc71' : '#e74c3c'}; font-weight:bold;">
            ${s.score !== null ? `${s.score}/${s.maxScore}` : s.status.toUpperCase()}
          </span>
        </div>
        <div style="font-size:13px; color:#aaa; margin-bottom:8px;">${new Date(s.createdAt).toLocaleString()}</div>
        <div style="font-size:14px; color:#ccc; white-space:pre-wrap;">${s.steps ? s.steps.slice(0, 100) + '...' : 'Image submission'}</div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<div style="padding:20px;color:red;">Failed to load</div>';
  }
}

// ⭐ 恢复设置页面
async function loadSettings() {
  const input = document.getElementById('chatUrlInput');
  if (!input) return;
  try {
    const res = await API.get('/api/port/settings');
    input.value = res.currentChatUrl || '';
  } catch (e) {}
  
  const btn = document.getElementById('chatUrlSave');
  btn.onclick = async () => {
    try {
      await API.put('/api/port/settings', { currentChatUrl: input.value });
      document.getElementById('chatUrlStatus').textContent = 'Saved!';
      setTimeout(() => document.getElementById('chatUrlStatus').textContent = '', 2000);
    } catch (e) {
      DSHUI.toast('Save failed', 'err');
    }
  };
}