// assets/js/pages/admin-user-states.js —— 答题状态管理（仅 root）
//
// 流程：用户列表 → 点开某人 → 看到他的状态格子 → 点格子改状态 → Save 提交。
// 改动先记在内存里（pending），Save 才落库，这样可以对一个人改多处后一次性提交。

Page.boot({ title: 'Answer State Management', requireAuth: true });

Page.ready(async (user) => {
  const root = document.getElementById('usRoot');

  function esc(s) {
    return (window.DSHUI && DSHUI.esc) ? DSHUI.esc(s) : String(s == null ? '' : s);
  }

  // 只有 root 能用这个页面（后端也会挡）
  if (user?.role !== 'root') {
    root.innerHTML = `<div class="us-err">
      <b>Access denied</b><br>
      This page is restricted to <code>root</code>. Your role is <code>${esc(user?.role || 'unknown')}</code>.
    </div>`;
    return;
  }

  const STATE_LABEL = { passed: 'passed', failed: 'failed', not_started: 'not started' };
  const STATE_ORDER = ['passed', 'failed', 'not_started'];

  let allUsers = [];
  let filter = '';
  let expanded = null;            // 当前展开的 username
  let expandedRows = [];          // 该用户的题目行
  let pending = new Map();        // pid -> 新状态（未保存）

  // ══════════ 渲染用户列表 ══════════
  function renderList() {
    const q = filter.trim().toLowerCase();
    const list = q
      ? allUsers.filter(u =>
          u.username.toLowerCase().includes(q) ||
          (u.displayName || '').toLowerCase().includes(q) ||
          (u.realName || '').toLowerCase().includes(q))
      : allUsers;

    const header = `
      <div class="us-header">
        <h1 class="us-title"><i class="fas fa-list-check"></i> Answer State Management</h1>
        <div class="us-toolbar">
          <span class="us-legend">
            <span class="l-passed">passed</span>
            <span class="l-failed">failed</span>
            <span class="l-not_started">not started</span>
          </span>
          <input class="us-search" id="usSearch" placeholder="Search username / real name…" value="${esc(filter)}">
        </div>
      </div>`;

    if (!list.length) {
      root.innerHTML = header + `<div class="us-card"><div class="us-empty">No users match.</div></div>`;
      bindSearch();
      return;
    }

    const rows = list.map(u => {
      const isOpen = expanded === u.username;
      const roleCls = u.role === 'root' ? 'root' : u.role === 'admin' ? 'admin' : '';
      return `
        <div class="us-user${isOpen ? ' open' : ''}" data-user="${esc(u.username)}">
          <i class="fas fa-chevron-right caret"></i>
          <span class="uname">${esc(u.username)}</span>
          <span class="ureal">${esc(u.displayName || '')}${u.realName ? ' · ' + esc(u.realName) : ''}</span>
          <span class="urole ${roleCls}">${esc(u.role)}</span>
          <span class="ucount">${u.passed} passed / ${u.failed} failed</span>
        </div>
        ${isOpen ? renderPanel() : ''}`;
    }).join('');

    root.innerHTML = header + `<div class="us-card">${rows}</div>`;
    bindSearch();
    bindUsers();
    if (expanded) bindPanel();
  }

  function renderPanel() {
    if (!expandedRows.length) {
      return `<div class="us-panel">
        <div class="us-empty" style="padding:1rem;">This user has no recorded problem states.</div>
        ${renderAddBox()}
      </div>`;
    }

    const cells = expandedRows.map(r => {
      const cur = pending.has(r.problemId) ? pending.get(r.problemId) : r.state;
      const dirty = pending.has(r.problemId) && pending.get(r.problemId) !== r.state;
      const diff = r.difficulty == null ? '' : r.difficulty.toFixed(2);
      return `
        <button class="us-cell ${esc(cur)}${dirty ? ' dirty' : ''}"
                data-pid="${esc(r.problemId)}"
                title="${esc(r.problemId)}${r.exists === false ? ' (not in problem bank)' : ''} — click to change">
          <span class="pid">${esc(r.problemId)}</span>
          <span class="st">${esc(STATE_LABEL[cur] || cur)}</span>
          ${diff ? `<span class="st" style="opacity:.6;">Lv.${diff}</span>` : ''}
        </button>`;
    }).join('');

    const dirtyCount = [...pending.entries()].filter(([pid, v]) => {
      const row = expandedRows.find(r => r.problemId === pid);
      return row && row.state !== v;
    }).length;

    return `<div class="us-panel">
      <div class="us-grid">${cells}</div>
      ${renderAddBox()}
      <div class="us-footer">
        <button class="us-save" id="usSave" ${dirtyCount ? '' : 'disabled'}>
          <i class="fas fa-floppy-disk"></i> Save
        </button>
        ${dirtyCount ? `<span class="us-dirty">${dirtyCount} change${dirtyCount > 1 ? 's' : ''} not yet saved</span>` : '<span class="us-hint">Click a block to change its state.</span>'}
        <span class="us-hint" style="margin-left:auto;">${expandedRows.length} problems</span>
      </div>
    </div>`;
  }

  function renderAddBox() {
    return `<div class="us-add">
      <input id="usAddPid" placeholder="Add problem ID…" maxlength="32">
      <button id="usAddBtn">Add row</button>
    </div>`;
  }

  // ══════════ 事件 ══════════
  function bindSearch() {
    const el = document.getElementById('usSearch');
    if (!el) return;
    el.oninput = () => {
      filter = el.value;
      const pos = el.selectionStart;
      renderList();
      const again = document.getElementById('usSearch');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) {} }
    };
  }

  function bindUsers() {
    root.querySelectorAll('.us-user').forEach(el => {
      el.onclick = () => {
        const name = el.dataset.user;
        if (expanded === name) { expanded = null; expandedRows = []; pending.clear(); renderList(); return; }
        openUser(name);
      };
    });
  }

  function bindPanel() {
    root.querySelectorAll('.us-cell').forEach(el => {
      el.onclick = (ev) => {
        ev.stopPropagation();
        openPicker(el, el.dataset.pid);
      };
    });

    const addBtn = document.getElementById('usAddBtn');
    const addInput = document.getElementById('usAddPid');
    if (addBtn && addInput) {
      addBtn.onclick = () => {
        const pid = addInput.value.trim();
        if (!pid) return;
        if (expandedRows.some(r => r.problemId === pid)) {
          DSHUI.toast('That problem is already listed', 'warn');
          return;
        }
        expandedRows.unshift({ problemId: pid, state: 'not_started', difficulty: null, exists: true });
        addInput.value = '';
        renderList();
      };
      addInput.onkeydown = (e) => { if (e.key === 'Enter') addBtn.click(); };
    }

    const saveBtn = document.getElementById('usSave');
    if (saveBtn) saveBtn.onclick = save;
  }

  // 点格子：弹三选一
  function openPicker(cellEl, pid) {
    document.querySelectorAll('.us-picker').forEach(e => e.remove());

    const cur = pending.has(pid) ? pending.get(pid) : (expandedRows.find(r => r.problemId === pid)?.state || 'not_started');
    const rect = cellEl.getBoundingClientRect();

    const picker = document.createElement('div');
    picker.className = 'us-picker';
    picker.style.left = Math.min(rect.left, window.innerWidth - 176) + 'px';
    picker.style.top = Math.min(rect.bottom + 4, window.innerHeight - 130) + 'px';

    picker.innerHTML = STATE_ORDER.map(s =>
      `<button data-state="${s}" class="${s === cur ? 'cur' : ''}">
        ${s === cur ? '✓ ' : ''}${esc(STATE_LABEL[s])}
      </button>`
    ).join('');

    picker.querySelectorAll('button').forEach(b => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        const next = b.dataset.state;
        const row = expandedRows.find(r => r.problemId === pid);
        if (row && row.state === next) pending.delete(pid);
        else pending.set(pid, next);
        picker.remove();
        renderList();
      };
    });

    document.body.appendChild(picker);

    // 点别处关闭
    setTimeout(() => {
      const close = () => { picker.remove(); document.removeEventListener('click', close); };
      document.addEventListener('click', close, { once: true });
    }, 0);
  }

  // ══════════ 数据 ══════════
  async function loadUsers() {
    root.innerHTML = '<div class="us-empty">Loading users…</div>';
    try {
      const res = await apiCall('/api/admin-user-states?action=users');
      if (!res.success) throw new Error(res.message || 'Failed');
      allUsers = res.users || [];
      renderList();
    } catch (e) {
      root.innerHTML = `<div class="us-err"><b>Could not load users</b><br>${esc(e.message || e)}</div>`;
    }
  }

  async function openUser(username) {
    expanded = username;
    expandedRows = [];
    pending.clear();
    renderList();
    // 面板里先放个占位
    const panelHost = root.querySelector('.us-user.open');
    if (panelHost && panelHost.nextElementSibling && panelHost.nextElementSibling.classList.contains('us-panel')) {
      panelHost.nextElementSibling.innerHTML = '<div class="us-empty" style="padding:1rem;">Loading states…</div>';
    }

    try {
      const res = await apiCall(`/api/admin-user-states?action=states&username=${encodeURIComponent(username)}`);
      if (!res.success) throw new Error(res.message || 'Failed');
      expandedRows = res.rows || [];
      renderList();
    } catch (e) {
      DSHUI.toast('Failed to load states: ' + (e.message || e), 'err');
      expanded = null;
      expandedRows = [];
      renderList();
    }
  }

  async function save() {
    const changes = {};
    for (const [pid, v] of pending) {
      const row = expandedRows.find(r => r.problemId === pid);
      if (!row || row.state === v) continue;
      changes[pid] = v;
    }

    const keys = Object.keys(changes);
    if (!keys.length) { DSHUI.toast('Nothing changed', 'warn'); return; }

    if (!confirm(`Apply ${keys.length} state change${keys.length > 1 ? 's' : ''} for ${expanded}?\n\nThis writes directly to the database and cannot be undone.`)) return;

    const btn = document.getElementById('usSave');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…'; }

    try {
      const res = await apiCall('/api/admin-user-states?action=save', 'POST', {
        username: expanded,
        changes,
      });
      if (!res.success) throw new Error(res.message || 'Failed');

      DSHUI.toast(`Saved ${res.changed} change${res.changed === 1 ? '' : 's'}`, 'ok');
      pending.clear();

      // 重新拉一次，拿到服务端最终状态
      const fresh = await apiCall(`/api/admin-user-states?action=states&username=${encodeURIComponent(expanded)}`);
      if (fresh.success) expandedRows = fresh.rows || [];

      // 列表里的计数也变了
      const u = allUsers.find(x => x.username === expanded);
      if (u) {
        u.passed = expandedRows.filter(r => r.state === 'passed').length;
        u.failed = expandedRows.filter(r => r.state === 'failed').length;
      }

      renderList();
    } catch (e) {
      DSHUI.toast('Save failed: ' + (e.message || e), 'err');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save'; }
    }
  }

  await loadUsers();
});
