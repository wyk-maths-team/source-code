if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
  window.location.href = '/index.html';
}

const mainContainer = document.getElementById('mainContent');
const currentUsername = getCurrentUser()?.username || '';

const state = { user: '', problem: '', result: '', start: '', end: '', page: 1 };

(function initFromURL() {
  const p = new URLSearchParams(location.search);
  state.user = p.get('user') || '';
  state.problem = p.get('problem') || '';
  state.result = p.get('result') || '';
  // ⭐ 時間區間：保留 datetime-local 原生格式，直接回填到控件
  state.start = p.get('starttime') || '';
  state.end = p.get('endtime') || '';
  state.page = Math.max(1, parseInt(p.get('page')) || 1);
})();

let lastQuerySnapshot = null;

function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

function statusClass(statusText) {
  if (statusText === 'Accepted') return 'status-accepted';
  if (statusText === 'Wrong Answer') return 'status-wrong';
  if (statusText.startsWith('Partial Score')) return 'status-partial';
  if (statusText === 'Pending') return 'status-pending';
  if (statusText === 'System Error') return 'status-system';
  return 'status-system';
}
function formatTime(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const pad = n => String(n).padStart(2, '0');
  const local = new Date(d.getTime() + 8 * 3600000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ` +
         `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
}
function makeSnapshot() {
  return JSON.stringify({ user: state.user, problem: state.problem, result: state.result, start: state.start, end: state.end, page: state.page });
}

const RESULT_LABELS = {
  accepted: 'Accepted', wrong: 'Wrong Answer', partial: 'Partial Score', pending: 'Pending', system: 'System Error'
};

// ⭐ 自动补全核心逻辑
function setupAutocomplete(inputId, dropdownId, actionType, onSelectCallback) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;
  
  let timer = null;
  let activeIndex = -1;

  input.addEventListener('input', (e) => {
    const keyword = e.target.value.trim();
    if (timer) clearTimeout(timer);
    if (!keyword) { dropdown.style.display = 'none'; return; }

    timer = setTimeout(async () => {
      try {
        const res = await apiCall(`/api/search?action=${actionType}&keyword=${encodeURIComponent(keyword)}`);
        if (res.success) renderDropdown(res.data);
      } catch (err) { console.error('Search failed', err); }
    }, 300);
  });

  function renderDropdown(data) {
    activeIndex = -1;
    if (!data || data.length === 0) {
      dropdown.innerHTML = '<div style="padding:8px;color:#888;font-size:12px;">No results</div>';
      dropdown.style.display = 'block'; return;
    }

    dropdown.innerHTML = data.map((item, i) => {
      if (actionType === 'search_user') {
        return `<div class="ac-item" data-idx="${i}" data-val="${escapeHtml(item.username)}" style="padding: 6px 10px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 12px;">
          <div style="font-weight:bold;">${escapeHtml(item.username)}</div>
          <div style="color:#666; font-size:11px;">${escapeHtml(item.displayName)} ${item.realName ? `(${escapeHtml(item.realName)})` : ''}</div>
        </div>`;
      } else {
        return `<div class="ac-item" data-idx="${i}" data-val="${escapeHtml(item.id)}" style="padding: 6px 10px; cursor: pointer; border-bottom: 1px solid #eee; font-size: 12px;">
          <div>${escapeHtml(item.id)} - ${escapeHtml(item.name || '')}</div>
        </div>`;
      }
    }).join('');
    dropdown.style.display = 'block';
  }

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.ac-item[data-val]');
    if (!items.length || dropdown.style.display === 'none') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % items.length; updateActive(items); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; updateActive(items); }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIndex >= 0 && items[activeIndex]) items[activeIndex].click(); }
    else if (e.key === 'Escape') dropdown.style.display = 'none';
  });

  function updateActive(items) {
    items.forEach((item, i) => {
      item.style.background = i === activeIndex ? 'var(--card-hover, #f0f0f0)' : '';
      if (i === activeIndex) item.scrollIntoView({ block: 'nearest' });
    });
  }

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.ac-item[data-val]');
    if (!item) return;
    input.value = item.dataset.val;
    dropdown.style.display = 'none';
    if (onSelectCallback) onSelectCallback(item.dataset.val);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none';
  });
}

function renderUserFilterCell() {
  if (state.user) {
    return `<div class="filter-current">User: <b>${escapeHtml(state.user)}</b><button type="button" class="btn-remove" data-clear="user"><i class="fas fa-times"></i></button></div>`;
  }
  return `<form class="adv-filter-form" id="formUser" autocomplete="off">
    <div style="position: relative;">
      <input type="text" id="filterUser" placeholder="Username" value="">
      <div id="ac-dropdown-user" style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--card-bg); border:1px solid var(--border-color); z-index:100; box-shadow:0 4px 12px rgba(0,0,0,0.15); max-height:200px; overflow-y:auto;"></div>
    </div>
    <div class="adv-filter-buttons"><button type="submit" class="btn-apply">Apply</button><button type="button" class="btn-self" id="selfBtn">Self</button></div>
  </form>`;
}

function renderProblemFilterCell() {
  if (state.problem) {
    return `<div class="filter-current">Problem: <b>${escapeHtml(state.problem)}</b><button type="button" class="btn-remove" data-clear="problem"><i class="fas fa-times"></i></button></div>`;
  }
  return `<form class="adv-filter-form" id="formProblem" autocomplete="off">
    <div style="position: relative;">
      <input type="text" id="filterProblem" placeholder="Problem ID" value="">
      <div id="ac-dropdown-prob" style="display:none; position:absolute; top:100%; left:0; right:0; background:var(--card-bg); border:1px solid var(--border-color); z-index:100; box-shadow:0 4px 12px rgba(0,0,0,0.15); max-height:200px; overflow-y:auto;"></div>
    </div>
    <div class="adv-filter-buttons"><button type="submit" class="btn-apply">Apply</button></div>
  </form>`;
}

function renderResultFilterCell() {
  if (state.result) {
    return `<div class="filter-current">Result: <b>${escapeHtml(RESULT_LABELS[state.result] || state.result)}</b><button type="button" class="btn-remove" data-clear="result"><i class="fas fa-times"></i></button></div>`;
  }
  return `<form class="adv-filter-form" id="formResult" autocomplete="off">
    <select id="filterResult"><option value="">All</option><option value="accepted">Accepted</option><option value="wrong">Wrong Answer</option><option value="partial">Partial Score</option><option value="pending">Pending</option><option value="system">System Error</option></select>
    <div class="adv-filter-buttons"><button type="submit" class="btn-apply">Apply</button></div>
  </form>`;
}

/**
 * 時間區間篩選（和學生版一致）。
 * 兩個 datetime-local：起點 / 終點，任一端留空即該端不限。
 */
function renderTimeFilterCell() {
  if (state.start || state.end) {
    const short = (v) => v ? v.replace('T', ' ') : '…';
    return `<div class="filter-current">Time: <b>${escapeHtml(short(state.start))} → ${escapeHtml(short(state.end))}</b><button type="button" class="btn-remove" data-clear="time"><i class="fas fa-times"></i></button></div>`;
  }
  return `<form class="adv-filter-form" id="formTime" autocomplete="off">
    <input type="datetime-local" id="filterStart" title="From (inclusive)">
    <input type="datetime-local" id="filterEnd" title="To (inclusive)">
    <div class="adv-filter-buttons"><button type="submit" class="btn-apply">Apply</button></div>
  </form>`;
}

async function fetchHeaderInfo() {
  const info = {};
  if (state.problem) {
    try { const res = await apiCall(`/api/problem?action=page&id=${encodeURIComponent(state.problem)}`); if (res.success && res.problem) info.problem = res.problem; } catch (e) {}
  }
  if (state.user) {
    try { const res = await apiCall(`/api/users?action=pfp&username=${encodeURIComponent(state.user)}`); if (res.success) info.pfp = res.pfp || ''; } catch (e) {}
  }
  return info;
}

function buildFilterHeader(info, submissions) {
  let html = '';
  if (state.problem) {
    const p = info.problem || {};
    const name = p.name || state.problem;
    const diff = p.difficulty ?? 0;
    const diffStr = diff === 0 ? '∞' : diff.toFixed(2);
    html += `<div class="filter-header"><h2><a href="/problems/${encodeURIComponent(state.problem)}">${escapeHtml(name)}</a></h2><div class="filter-meta"><span class="meta-btn">${escapeHtml(state.problem)}</span><span class="meta-btn">Difficulty: ${diffStr}</span><a href="/problems/${encodeURIComponent(state.problem)}" class="meta-btn info">View Problem</a></div></div>`;
  }
  if (state.user) {
    let displayName = state.user;
    if (submissions && submissions.length > 0) {
      const match = submissions.find(s => s.username === state.user);
      if (match && match.displayName) displayName = match.displayName;
    }
    const pfp = info.pfp || '';
    const avatarHtml = pfp ? `<img src="${escapeHtml(pfp)}" class="profile-40" alt="avatar">` : '';
    html += `<div class="filter-header"><h2><a href="/users/${encodeURIComponent(state.user)}">${avatarHtml} ${escapeHtml(displayName)}</a></h2><div class="filter-meta"><span class="meta-btn">Username: ${escapeHtml(state.user)}</span><a href="/submissions/user/${encodeURIComponent(state.user)}" class="meta-btn info">Submissions</a><a href="/users/${encodeURIComponent(state.user)}" class="meta-btn purple">Profile</a></div></div>`;
  }
  return html;
}

function renderLayout() {
  mainContainer.innerHTML = `
    <div class="submissions-wrapper">
      <div class="header-actions">
        <h2>All Submissions (Admin)</h2>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <button id="refreshSubmissionsBtn" title="Refresh"><i class="fas fa-sync-alt"></i></button>
          <button class="btn" id="resetFiltersBtn">Reset Filters</button>
        </div>
      </div>
      <div class="to-mark-bar"><a href="/admin/marker">To mark: <span id="toMarkCount">…</span></a></div>
      <div id="filterHeaderContainer"></div>
      <div class="pagination-nav" id="paginationTop"></div>
      <div class="table-responsive">
        <table class="submissions-table">
          <thead><tr>
            <th class="col-id">ID</th><th class="col-datetime">Date / Time ${renderTimeFilterCell()}</th>
            <th class="col-user left-align">User ${renderUserFilterCell()}</th>
            <th class="col-problem left-align">Problem ${renderProblemFilterCell()}</th>
            <th class="col-answer">Answer</th><th class="col-status">Result ${renderResultFilterCell()}</th>
            <th class="col-actions" style="width:120px;">Actions</th>
          </tr></thead>
          <tbody id="submissionsBody"><tr><td colspan="7" class="loading-msg">Loading submissions…</td></tr></tbody>
        </table>
      </div>
      <div class="pagination-nav" id="paginationBottom"></div>
    </div>
  `;
  bindFilterEvents();
}

function bindFilterEvents() {
  const formUser = document.getElementById('formUser');
  if (formUser) {
    setupAutocomplete('filterUser', 'ac-dropdown-user', 'search_user', (val) => {
      state.user = val; state.page = 1; applyFilters();
    });
    formUser.addEventListener('submit', e => { e.preventDefault(); state.user = document.getElementById('filterUser').value.trim(); state.page = 1; applyFilters(); });
  }
  const formProblem = document.getElementById('formProblem');
  if (formProblem) {
    setupAutocomplete('filterProblem', 'ac-dropdown-prob', 'search_prob', (val) => {
      state.problem = val; state.page = 1; applyFilters();
    });
    formProblem.addEventListener('submit', e => { e.preventDefault(); state.problem = document.getElementById('filterProblem').value.trim(); state.page = 1; applyFilters(); });
  }
  const formResult = document.getElementById('formResult');
  if (formResult) {
    formResult.addEventListener('submit', e => { e.preventDefault(); state.result = document.getElementById('filterResult').value; state.page = 1; applyFilters(); });
    document.getElementById('filterResult').addEventListener('change', () => { state.result = document.getElementById('filterResult').value; state.page = 1; applyFilters(); });
  }
  const selfBtn = document.getElementById('selfBtn');
  if (selfBtn) selfBtn.addEventListener('click', () => { state.user = currentUsername; state.page = 1; applyFilters(); });

  // ⭐ 時間區間
  const formTime = document.getElementById('formTime');
  if (formTime) {
    formTime.addEventListener('submit', e => {
      e.preventDefault();
      state.start = document.getElementById('filterStart').value || '';
      state.end   = document.getElementById('filterEnd').value || '';
      // 起點晚於終點時自動對調，比報錯順手
      if (state.start && state.end && state.start > state.end) {
        const t = state.start; state.start = state.end; state.end = t;
      }
      state.page = 1; applyFilters();
    });
  }

  document.querySelectorAll('.btn-remove[data-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.clear;
      if (field === 'user') state.user = '';
      else if (field === 'problem') state.problem = '';
      else if (field === 'result') state.result = '';
      else if (field === 'time') { state.start = ''; state.end = ''; }
      state.page = 1; applyFilters();
    });
  });
  const refreshBtn = document.getElementById('refreshSubmissionsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (refreshBtn.disabled) return; refreshBtn.disabled = true; refreshBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i>';
      try { lastQuerySnapshot = null; updateURL(); await loadSubmissions(); } finally { refreshBtn.disabled = false; refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>'; }
    });
  }
  const resetBtn = document.getElementById('resetFiltersBtn');
  if (resetBtn) resetBtn.addEventListener('click', () => { state.user = ''; state.problem = ''; state.result = ''; state.start = ''; state.end = ''; state.page = 1; applyFilters(); });
}

function applyFilters() {
  updateURL();
  const snap = makeSnapshot();
  if (snap === lastQuerySnapshot) return;
  renderLayout();
  loadSubmissions();
}

function updateURL() {
  const params = new URLSearchParams();
  if (state.user) params.set('user', state.user);
  if (state.problem) params.set('problem', state.problem);
  if (state.result) params.set('result', state.result);
  if (state.start) params.set('starttime', state.start);
  if (state.end) params.set('endtime', state.end);
  if (state.page > 1) params.set('page', state.page);
  const qs = params.toString();
  window.history.replaceState({}, '', qs ? `/admin/submissions?${qs}` : '/admin/submissions');
}

async function loadSubmissions() {
  const tbody = document.getElementById('submissionsBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="loading-msg">Loading…</td></tr>';
  const params = new URLSearchParams({ admin: '1', page: state.page, limit: 50 });
  if (state.user) params.set('user', state.user);
  if (state.problem) params.set('problem_id', state.problem);
  if (state.result) params.set('status', state.result);
  // ⭐ datetime-local 是本地时间（无时区），转 ISO 再传，避免服务器 UTC 偏移
  if (state.start) params.set('starttime', new Date(state.start).toISOString());
  if (state.end)   params.set('endtime',   new Date(state.end).toISOString());
  try {
    const [headerInfo, data] = await Promise.all([fetchHeaderInfo(), apiCall(`/api/submissions?${params.toString()}`)]);
    if (!data.success) throw new Error(data.message || 'Failed');
    const headerContainer = document.getElementById('filterHeaderContainer');
    if (headerContainer) headerContainer.innerHTML = buildFilterHeader(headerInfo, data.submissions);
    const toMarkEl = document.getElementById('toMarkCount');
    if (toMarkEl) toMarkEl.textContent = data.toMark ?? 0;
    renderTable(data.submissions);
    renderPagination(data.page, data.totalPages, data.total);
    lastQuerySnapshot = makeSnapshot();
  } catch (err) {
    console.error(err);
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="error-msg">Failed to load submissions.</td></tr>';
  }
}

function renderTable(submissions) {
  const tbody = document.getElementById('submissionsBody');
  if (!tbody) return;
  if (!submissions || submissions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="loading-msg">No submissions found.</td></tr>'; return;
  }
  let html = '';
  submissions.forEach(s => {
    const time = formatTime(s.timestamp);
    const statusText = s.status || 'Pending';
    const cls = statusClass(statusText);
    const subId = s.subid || s._id || '-';
    const problemDisplay = `${escapeHtml(s.problemId)} - ${escapeHtml(s.problemName || '')}`;
    const userDisplay = `${escapeHtml(s.username)}${s.displayName && s.displayName !== s.username ? ` - ${escapeHtml(s.displayName)}` : ''}`;
    const answerHtml = s.type === 'image' ? '<i>Image</i>' : s.answerHidden ? '<span style="color:var(--text-secondary);font-style:italic;">Hidden</span>' : escapeHtml(String(s.answer || '-'));
    html += `<tr>
      <td class="col-id"><a href="/submissions/${encodeURIComponent(subId)}/detail">${escapeHtml(subId)}</a></td>
      <td class="col-datetime">${time}</td>
      <td class="col-user left-align"><a href="/users/${encodeURIComponent(s.username)}">${userDisplay}</a></td>
      <td class="col-problem left-align"><a href="/problems/${encodeURIComponent(s.problemId)}">${problemDisplay}</a></td>
      <td class="col-answer">${answerHtml}</td>
      <td class="col-status"><a href="/submissions/${encodeURIComponent(subId)}/detail"><span class="status-badge ${cls}">${escapeHtml(statusText)}</span></a></td>
      <td class="col-actions" style="white-space:nowrap;">
        <button class="btn-sm btn-primary" data-rejudge="${escapeHtml(s._id)}">Rej</button>
        <button class="btn-sm btn-danger" data-delete="${escapeHtml(s._id)}">Del</button>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;
  tbody.querySelectorAll('[data-rejudge]').forEach(btn => btn.addEventListener('click', () => rejudgeSubmission(btn.dataset.rejudge, btn)));
  tbody.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteSubmission(btn.dataset.delete, btn)));
}

function getMaxVisiblePages() { const w = window.innerWidth; if (w < 400) return 5; if (w < 600) return 7; if (w < 900) return 9; return 10; }
function computePageItems(current, total, maxVisible) {
  if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1);
  const inner = maxVisible - 2; const half = Math.floor(inner / 2);
  let start = Math.max(2, current - half); let end = Math.min(total - 1, start + inner - 1); start = Math.max(2, end - inner + 1);
  const items = [1]; if (start > 2) items.push('…');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < total - 1) items.push('…'); items.push(total); return items;
}

function renderPagination(page, totalPages, total) {
  window.__lastPagination = { page, totalPages, total };
  const render = (container) => {
    if (!container) return;
    if (!totalPages || totalPages <= 1) { container.innerHTML = `<span class="page-info">${total} submission${total !== 1 ? 's' : ''}</span>`; return; }
    const items = computePageItems(page, totalPages, getMaxVisiblePages());
    let html = '<ul class="pagination-list">';
    html += `<li class="page-item ${page <= 1 ? 'disabled' : ''}"><span class="page-link arrow" ${page > 1 ? `onclick="goToPage(${page - 1})"` : ''}>‹</span></li>`;
    for (const it of items) {
      if (it === '…') html += `<li class="page-item ellipsis"><span class="page-link">…</span></li>`;
      else if (it === page) html += `<li class="page-item active"><span class="page-link">${it}</span></li>`;
      else html += `<li class="page-item"><span class="page-link" onclick="goToPage(${it})">${it}</span></li>`;
    }
    html += `<li class="page-item ${page >= totalPages ? 'disabled' : ''}"><span class="page-link arrow" ${page < totalPages ? `onclick="goToPage(${page + 1})"` : ''}>›</span></li>`;
    html += `</ul><span class="page-info" style="margin-left:0.5rem;">${total} submissions</span>`;
    container.innerHTML = html;
  };
  render(document.getElementById('paginationTop')); render(document.getElementById('paginationBottom'));
}

window.goToPage = function(newPage) {
  if (newPage === state.page) return;
  state.page = newPage; updateURL(); loadSubmissions(); window.scrollTo({ top: 0, behavior: 'smooth' });
};

let _paginationResizeTimer = null;
window.addEventListener('resize', () => {
  if (_paginationResizeTimer) clearTimeout(_paginationResizeTimer);
  _paginationResizeTimer = setTimeout(() => {
    const last = window.__lastPagination;
    if (last && document.getElementById('paginationTop')) renderPagination(last.page, last.totalPages, last.total);
  }, 200);
});

async function deleteSubmission(id, btn) {
  if (!confirm('Delete this submission? This cannot be undone.')) return;
  if (btn) btn.disabled = true;
  try {
    const result = await apiCall('/api/submissions?admin=1', 'DELETE', { submissionId: id });
    if (result.success) { showMessage('Deleted', 'success'); await loadSubmissions(); } 
    else { showMessage(result.message || 'Delete failed', 'error'); if (btn) btn.disabled = false; }
  } catch (err) { showMessage('Error deleting', 'error'); if (btn) btn.disabled = false; }
}

async function rejudgeSubmission(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const result = await apiCall('/api/submissions?admin=1', 'PUT', { submissionId: id });
    if (result.success) {
      let msg;
      if (result.systemError) msg = 'System Error';
      else if (result.score === 100) msg = 'Accepted';
      else if (result.score === 0) msg = 'Wrong Answer';
      else if (result.score !== undefined) msg = `Partial Score (${result.score}%)`;
      else msg = result.correct ? 'Accepted' : 'Wrong Answer';
      showMessage(`Rejudged: ${msg}`, 'success'); await loadSubmissions();
    } else { showMessage(result.message || 'Error rejudging', 'error'); if (btn) btn.disabled = false; }
  } catch (err) { showMessage('Error rejudging', 'error'); if (btn) btn.disabled = false; }
}

function showMessage(msg, type) {
  const existing = mainContainer.querySelector('.message'); if (existing) existing.remove();
  const msgDiv = document.createElement('div'); msgDiv.className = 'message'; msgDiv.textContent = msg;
  msgDiv.style.color = type === 'error' ? 'var(--danger)' : '#2e7d32'; msgDiv.style.fontWeight = '600'; msgDiv.style.textAlign = 'center';
  mainContainer.prepend(msgDiv); setTimeout(() => msgDiv.remove(), 3000);
}

renderLayout(); loadSubmissions();