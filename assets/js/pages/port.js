let currentProblem = null;
let draftTimer = null;
let allProblems = [];

Page.boot({ title: 'Port', requireAuth: true });

Page.ready(async (user) => {
  // 显示 Admin 按钮
  if (user.role === 'root') {
    document.getElementById('adminBtn').style.display = 'inline-block';
  }

  // 加载题目列表
  await loadProblems();

  // 事件绑定
  document.getElementById('subjectSelect').addEventListener('change', loadProblems);
  document.getElementById('searchInput').addEventListener('input', renderList);
  
  // 自动保存草稿
  const stepsInput = document.getElementById('stepsInput');
  stepsInput.addEventListener('input', () => {
    if (!currentProblem) return;
    document.getElementById('draftStatus').textContent = 'Saving...';
    clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
      await API.post('/api/port/draft', { problemId: currentProblem.id, steps: stepsInput.value });
      document.getElementById('draftStatus').textContent = 'Saved just now';
    }, 1000);
  });

  // 提交批改
  document.getElementById('submitBtn').addEventListener('click', async () => {
    if (!currentProblem) return;
    const steps = stepsInput.value.trim();
    if (!steps) return DSHUI.toast('Please write something first.', 'warn');

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> AI is grading... (approx 15-30s)';

    try {
      const res = await API.post('/api/port/submit', { 
        problemId: currentProblem.id, 
        subject: currentProblem.subject, 
        steps 
      });
      
      if (res.success) {
        showResult(res.result);
        stepsInput.value = '';
        await loadProblems(); // 刷新侧边栏状态
      }
    } catch (err) {
      DSHUI.toast(err.message || 'Grading failed', 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Submit for AI Grading';
    }
  });
});

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
    allProblems = probRes.items.map(p => ({
      ...p,
      status: stats[p.id] || 'none'
    }));
    
    renderList();
  } catch (err) {
    listEl.innerHTML = '<div style="padding:20px;color:red;">Failed to load</div>';
  }
}

function renderList() {
  const keyword = document.getElementById('searchInput').value.toLowerCase();
  const filtered = allProblems.filter(p => 
    p.id.toLowerCase().includes(keyword) || 
    (p.source && p.source.toLowerCase().includes(keyword))
  );

  const listEl = document.getElementById('problemList');
  if (filtered.length === 0) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No problems found.</div>';
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

  renderList(); // Update active state

  document.getElementById('headerTitle').textContent = `${p.id} - ${p.source || 'Practice'}`;
  document.getElementById('headerScore').textContent = `Max Score: ${p.maxScore || 100}`;
  
  const view = document.getElementById('problemView');
  view.innerHTML = `
    <div class="problem-statement" id="stmtArea">${p.statement || 'No statement provided.'}</div>
    <div class="result-panel" id="resultPanel" style="display:none;">
      <div class="result-header" id="resScore"></div>
      <div class="result-warning" id="resWarning" style="display:none;"></div>
      <div class="result-comment" id="resComment"></div>
    </div>
  `;

  // 加载草稿
  document.getElementById('submitArea').style.display = 'flex';
  document.getElementById('draftStatus').textContent = 'Loading draft...';
  try {
    const res = await API.get(`/api/port/draft?problemId=${id}`);
    document.getElementById('stepsInput').value = res.steps || '';
    document.getElementById('draftStatus').textContent = res.steps ? 'Draft loaded' : 'Ready';
  } catch(e) {
    document.getElementById('draftStatus').textContent = 'Ready';
  }

  renderMathInElement(view, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}] });
};

function showResult(result) {
  const panel = document.getElementById('resultPanel');
  if (!panel) return;
  panel.style.display = 'block';
  document.getElementById('resScore').textContent = `Score: ${result.score} / ${currentProblem.maxScore || 100}`;
  document.getElementById('resComment').innerHTML = marked.parse(result.comment || '');
  
  const warnEl = document.getElementById('resWarning');
  if (result.warnings && result.warnings.length > 0) {
    warnEl.style.display = 'block';
    warnEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <b>Warning:</b> ${result.warnings.join('<br>')}`;
  } else {
    warnEl.style.display = 'none';
  }

  renderMathInElement(panel, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}] });
}

// Admin
window.openAdminModal = function() {
  if (!currentProblem) return DSHUI.toast('Select a problem first', 'warn');
  document.getElementById('adminPid').value = currentProblem.id;
  document.getElementById('adminMaxScore').value = currentProblem.maxScore || 100;
  document.getElementById('adminStatement').value = currentProblem.statement || '';
  document.getElementById('adminAnswer').value = currentProblem.answer || '';
  document.getElementById('adminModal').style.display = 'flex';
};

window.saveProblem = async function() {
  const id = document.getElementById('adminPid').value;
  const maxScore = parseInt(document.getElementById('adminMaxScore').value) || 100;
  const statement = document.getElementById('adminStatement').value;
  const answer = document.getElementById('adminAnswer').value;

  try {
    await API.post('/api/port/problems?action=update', { id, maxScore, statement, answer });
    DSHUI.toast('Saved successfully', 'ok');
    document.getElementById('adminModal').style.display = 'none';
    await loadProblems();
    selectProblem(id);
  } catch (e) {
    DSHUI.toast(e.message, 'err');
  }
};