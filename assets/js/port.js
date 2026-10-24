let currentProblem = null;
let draftTimer = null;
let allProblems = [];

Page.boot({ title: 'Port', requireAuth: true });

Page.ready(async (user) => {
  // 所有 /api/port/* 端点都走 portAuth，那里面只放行 root。
  // 页面本身原来只要求「已登录」，结果普通学生能进来、却每个请求都 403，
  // 看到一片 Failed to load。这里提前拦掉，行为和 API 保持一致。
  if (!user || user.role !== 'root') {
    window.location.href = '/';
    return;
  }

  const elSteps = document.getElementById('stepsInput');
  const elSubmitBtn = document.getElementById('submitBtn');
  const elDraftStatus = document.getElementById('draftIndicator');
  const elResultPanel = document.getElementById('resultPanel');
  const elClearSteps = document.getElementById('clearSteps');

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

  await loadProblems();
  document.getElementById('subjectSelect').addEventListener('change', loadProblems);
  document.getElementById('searchInput').addEventListener('input', renderList);

  if (elClearSteps) {
    elClearSteps.addEventListener('click', () => {
      if (!currentProblem) return;
      if (confirm('Clear current draft?')) {
        elSteps.value = '';
        // 本地与云端都要清，否则下次选题时本地草稿会把旧内容带回来
        localStorage.removeItem(`port_draft_${currentProblem.id}`);
        saveDraft(currentProblem.id, '');
      }
    });
  }

  elSteps.addEventListener('input', () => {
    if (!currentProblem) return;
    document.getElementById('stepsCount').textContent = elSteps.value.length;
    elSubmitBtn.disabled = !elSteps.value.trim();
    if (!elDraftStatus) return;
    
    elDraftStatus.textContent = 'Saving...';
    localStorage.setItem(`port_draft_${currentProblem.id}`, elSteps.value);
    
    // 捕获当前题目 id：若 1 秒内切换题目，回调里的 currentProblem 已指向新题，
    // 直接读它会把旧内容写进新题的草稿（串号）。
    const pid = currentProblem.id;
    const val = elSteps.value;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => saveDraft(pid, val), 1000);
  });

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
  
  const CACHE_KEY = 'port_problems_cache';
  try {
    const [probRes, statRes] = await Promise.all([
      API.get(`/api/port/problems?subject=${subject}`),
      API.get(`/api/port/stats?subject=${subject}`)
    ]);
    const stats = statRes.summary?.[subject]?.states || {};
    
    // ⭐ 映射状态
    allProblems = probRes.items.map(p => ({ 
      ...p, 
      status: stats[p.id] || 'none' 
    }));

    // 全量缓存到 localStorage：换科目/断网时也能立刻查询，不必每次重拉
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        subject,
        updatedAt: Date.now(),
        items: allProblems
      }));
    } catch (e) {
      // 配额超限（题目太多）时静默跳过，不影响主流程
      console.warn('[port] cache write failed', e && e.message);
    }
    
    renderList();
  } catch (err) {
    // 接口失败时退回缓存，至少还能浏览/搜索上次的内容
    let restored = false;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached && Array.isArray(cached.items)) {
          allProblems = cached.items;
          renderList();
          restored = true;
          const note = document.createElement('div');
          note.style.cssText = 'padding:6px 10px;font-size:11px;color:#888;';
          note.textContent = `离线缓存（${new Date(cached.updatedAt).toLocaleString()}）`;
          listEl.prepend(note);
        }
      }
    } catch (e) { /* 缓存损坏则忽略 */ }
    if (!restored) listEl.innerHTML = '<div style="padding:20px;color:red;">Failed to load</div>';
  }
}

// ⭐ 优化的题库列表渲染
function renderList() {
  const keyword = (document.getElementById('searchInput').value || '').toLowerCase().trim();
  // 原来只匹配 id / chapterName，搜「三角」「Geometry」这类内容完全搜不到
  const filtered = !keyword ? allProblems : allProblems.filter(p => {
    const hay = [p.id, p.chapterName, p.chapter, p.source, p.statement, p.answer, p.ans]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(keyword);
  });

  const listEl = document.getElementById('problemList');
  if (!filtered.length) {
    listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666;">No problems.</div>';
    return;
  }

  listEl.innerHTML = filtered.map(p => {
    // 状态图标
    let statusIcon = '<i class="fas fa-circle" style="color: #333; font-size: 10px;"></i>'; // 未做
    if (p.status === 'passed') statusIcon = '<i class="fas fa-check-circle" style="color: #2ecc71;"></i>';
    if (p.status === 'failed') statusIcon = '<i class="fas fa-times-circle" style="color: #e74c3c;"></i>';

    // id / source 来自数据库，直接拼进 innerHTML 会被内容里的标签或引号破坏；
    // 内联 onclick 也有同样问题（id 含单引号会截断字符串）。改为 data 属性 + 事件委托。
    return `
      <div class="sb-item ${currentProblem?.id === p.id ? 'active' : ''}" data-pid="${DSHUI.esc(p.id)}">
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; color: ${currentProblem?.id === p.id ? '#4a90d9' : '#ddd'}; font-size: 14px;">
            ${DSHUI.esc(p.id)}
          </div>
          <div style="font-size: 11px; color: #888; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${DSHUI.esc(p.chapterName ? p.chapterName : (p.chapter ? 'Ch.' + p.chapter : ''))} ${p.source ? `· ${DSHUI.esc(p.source)}` : ''}
          </div>
        </div>
        <div style="flex-shrink: 0; margin-left: 10px; display: flex; align-items: center; justify-content: center; width: 20px;">
          ${statusIcon}
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.sb-item').forEach(el => {
    el.addEventListener('click', () => window.selectProblem(el.dataset.pid));
  });
}

window.selectProblem = async function(id) {
  const p = allProblems.find(x => x.id === id);
  if (!p) return;
  currentProblem = p;
  renderList();

  document.getElementById('problemEmpty').hidden = true;
  document.getElementById('problemPanel').hidden = false;
  // 先禁用，等下面把草稿读出来后再按内容决定是否可提交。
  // 原来直接设 false，会出现「空白草稿也能点提交」，点了才弹提示。
  document.getElementById('submitBtn').disabled = true;
  
  document.getElementById('ppId').textContent = p.id;
  document.getElementById('ppChapter').textContent = p.chapterName ? p.chapterName : (p.chapter ? `Ch.${p.chapter}` : '');
  document.getElementById('ppSource').textContent = p.source || '';
  document.getElementById('ppMaxScore').textContent = `Max: ${p.maxScore || 100}`;
  document.getElementById('ppStatement').innerHTML = p.statement || 'No statement.';
  
  // ⭐ 修复：兼容 ans 字段
  document.getElementById('ppAnswer').innerHTML = p.ans || p.answer || 'No answer.';

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
    const res = await API.get(`/api/port/draft?problemId=${encodeURIComponent(id)}`);
    // 用 !== undefined 判断：清空草稿后背端返回 steps:''，
    // 旧的 if (res.steps) 会把空串当「没有草稿」，于是又回填 localStorage 里的旧内容，
    // 导致「Clear draft」实际无效。
    if (res.steps !== undefined && res.steps !== null) {
      elSteps.value = res.steps;
      if (res.steps) {
        localStorage.setItem(`port_draft_${id}`, res.steps);
        document.getElementById('draftIndicator').textContent = 'Cloud draft loaded';
      } else {
        localStorage.removeItem(`port_draft_${id}`);
        document.getElementById('draftIndicator').textContent = 'Ready';
      }
    } else if (!localDraft) {
      elSteps.value = '';
      document.getElementById('draftIndicator').textContent = 'Ready';
    }
  } catch(e) {
    document.getElementById('draftIndicator').textContent = 'Ready (offline)';
  }
  document.getElementById('stepsCount').textContent = elSteps.value.length;
  // 草稿加载完毕，按实际内容决定提交按钮状态
  document.getElementById('submitBtn').disabled = !elSteps.value.trim();
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
      await loadProblems(); // 重新加载以刷新左侧状态图标
    }
  } catch (err) {
    DSHUI.toast(err.message || 'Grading failed', 'err');
  } finally {
    elSubmitBtn.disabled = false;
    elSubmitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit';
  }
}

/**
 * 净化 AI 返回的 HTML。
 * marked.parse 默认不做 sanitize，AI 若在 comment 里写 <img onerror=...>
 * 就会直接执行（浏览器里已验证可触发）。这里用 DOM 解析后剔除危险节点与属性。
 */
function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(el => el.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const val = String(attr.value || '').toLowerCase().replace(/[\s\u0000]/g, '');
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'formaction') && val.startsWith('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return tpl.innerHTML;
}

function showResult(result) {
  const elResultPanel = document.getElementById('resultPanel');
  elResultPanel.hidden = false;
  document.getElementById('resultScore').textContent = `Score: ${result.score} / ${currentProblem.maxScore || 100}`;
  
  const commentHtml = window.marked ? sanitizeHtml(marked.parse(result.comment || '')) : DSHUI.esc(result.comment || '');
  document.getElementById('resultComment').innerHTML = commentHtml;
  
  const warnEl = document.getElementById('resultWarning');
  if (result.warnings && result.warnings.length > 0) {
    warnEl.style.display = 'block';
    // warnings 由 AI 生成，属于不可信内容，必须转义后再插入
    warnEl.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <b>Warning:</b> ${result.warnings.map(w => DSHUI.esc(String(w))).join('<br>')}`;
  } else {
    warnEl.style.display = 'none';
  }

  renderMathInElement(elResultPanel, { delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}] });
}

// 其他页面逻辑不变...
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
          <strong style="color:#4a90d9;">${DSHUI.esc(s.problemId)} (${DSHUI.esc(s.subject)})</strong>
          <span style="color:${s.score >= 90 ? '#2ecc71' : '#e74c3c'}; font-weight:bold;">
            ${s.score !== null && s.score !== undefined ? `${DSHUI.esc(String(s.score))}/${DSHUI.esc(String(s.maxScore))}` : DSHUI.esc(String(s.status || '').toUpperCase())}
          </span>
        </div>
        <div style="font-size:13px; color:#aaa; margin-bottom:8px;">${DSHUI.esc(new Date(s.createdAt).toLocaleString())}</div>
        <div style="font-size:14px; color:#ccc; white-space:pre-wrap;">${s.steps ? DSHUI.esc(String(s.steps).slice(0, 100)) + '...' : 'Image submission'}</div>
      </div>
    `).join('');
  } catch (e) {
    listEl.innerHTML = '<div style="padding:20px;color:red;">Failed to load</div>';
  }
}

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

// ⭐ Admin 弹窗兼容 ans
window.openAdminModal = function() {
  if (!currentProblem) return DSHUI.toast('Select a problem first', 'warn');
  document.getElementById('adminPid').value = currentProblem.id;
  document.getElementById('adminMaxScore').value = currentProblem.maxScore || 100;
  document.getElementById('adminStatement').value = currentProblem.statement || '';
  document.getElementById('adminAnswer').value = currentProblem.ans || currentProblem.answer || '';
  document.getElementById('adminModal').style.display = 'flex';
};

window.saveProblem = async function() {
  const id = document.getElementById('adminPid').value;
  const maxScore = parseInt(document.getElementById('adminMaxScore').value) || 100;
  const statement = document.getElementById('adminStatement').value;
  const ans = document.getElementById('adminAnswer').value;

  try {
    // ⭐ 传 ans 字段
    await API.post('/api/port/problems?action=update', { id, maxScore, statement, ans });
    DSHUI.toast('Saved successfully', 'ok');
    document.getElementById('adminModal').style.display = 'none';
    await loadProblems();
    selectProblem(id);
  } catch (e) { DSHUI.toast(e.message, 'err'); }
};