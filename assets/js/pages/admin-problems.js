
    const user = getCurrentUser();
    if (!isLoggedIn() || (user?.role !== 'admin' && user?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    // ── 数据：一次性全量拉取，之后只在本地做筛选/虚拟渲染 ──
    let allProblems = [];
    let viewList = [];                 // 当前筛选结果
    const selectedIds = new Set();     // 跨滚动保持选中状态

    // 虚拟滚动参数。ROW_HEIGHT 必须与 CSS 里 tbody td 的 height 一致。
    const ROW_HEIGHT = 41;
    const BUFFER = 10;

    async function loadProblems() {
      try {
        const data = await apiCall('/api/problem?action=adminProblems');
        if (data.success) {
          allProblems = data.problems || [];
          applyFilter();
        }
      } catch (err) { console.error(err); }
    }

    function applyFilter(resetScroll) {
      const kw = (document.getElementById('pmSearch')?.value || '').toLowerCase().trim();
      viewList = !kw ? allProblems : allProblems.filter(p => {
        const hay = [p.id, p.name, p.ans, p.difficulty, (p.tags || []).join(' ')]
          .filter(v => v !== undefined && v !== null).join(' ').toLowerCase();
        return hay.includes(kw);
      });

      const countEl = document.getElementById('pmCount');
      if (countEl) {
        countEl.textContent = kw ? `${viewList.length} / ${allProblems.length}` : `${allProblems.length} problems`;
      }

      const wrap = document.querySelector('.pm-table-wrap');
      if (wrap && resetScroll) wrap.scrollTop = 0;
      renderVirtual();
    }

    function rowHtml(p) {
      return `
        <tr>
          <td><input type="checkbox" class="problem-checkbox" data-id="${escapeHtml(p.id)}" ${selectedIds.has(p.id) ? 'checked' : ''} /></td>
          <td><a href="/problems/${encodeURIComponent(p.id)}">${escapeHtml(p.id)}</a></td>
          <td>${escapeHtml(p.name)}</td>
          <td class="col-answer"><span class="pm-answer" title="${escapeHtml(String(p.ans ?? ''))}">${escapeHtml(String(p.ans ?? ''))}</span></td>
          <td>
            <label class="pm-switch" title="${p.public ? 'Public — click to hide' : 'Hidden — click to publish'}">
              <input type="checkbox" class="pm-pub" data-id="${escapeHtml(p.id)}" ${p.public ? 'checked' : ''} />
              <span class="pm-slider"></span>
            </label>
          </td>
          <td class="col-actions">
            <a class="btn btn-primary btn-icon" title="Edit" href="/admin/problems/${encodeURIComponent(p.id)}"><i class="fas fa-pencil-alt"></i></a>
            <button class="btn btn-danger btn-icon" title="Delete" onclick="deleteProblem('${escapeHtml(p.id)}')"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`;
    }

    function renderVirtual() {
      const tbody = document.getElementById('problemsList');
      const wrap = document.querySelector('.pm-table-wrap');
      if (!tbody || !wrap) return;

      const total = viewList.length;
      const scrollTop = wrap.scrollTop;
      const viewH = wrap.clientHeight || 600;

      let start = Math.floor(scrollTop / ROW_HEIGHT) - BUFFER;
      if (start < 0) start = 0;
      let end = Math.ceil((scrollTop + viewH) / ROW_HEIGHT) + BUFFER;
      if (end > total) end = total;
      if (end < start) end = start;

      const topPad = start * ROW_HEIGHT;
      const bottomPad = Math.max(0, (total - end) * ROW_HEIGHT);

      const parts = [];
      // 用两条 spacer 行占位，让滚动条长度对应真实行数
      if (topPad > 0) parts.push(`<tr class="pm-spacer" style="height:${topPad}px"><td colspan="6"></td></tr>`);
      for (let i = start; i < end; i++) parts.push(rowHtml(viewList[i]));
      if (bottomPad > 0) parts.push(`<tr class="pm-spacer" style="height:${bottomPad}px"><td colspan="6"></td></tr>`);

      tbody.innerHTML = parts.join('');
      bindRowEvents();
    }

    function bindRowEvents() {
      document.querySelectorAll('.problem-checkbox').forEach(cb => {
        cb.onchange = function () {
          if (this.checked) selectedIds.add(this.dataset.id);
          else selectedIds.delete(this.dataset.id);
          syncSelectAll();
          toggleBatchActions();
        };
      });

      // Public 开关：改单个，失败回滚
      document.querySelectorAll('.pm-pub').forEach(cb => {
        cb.onchange = async function () {
          const id = this.dataset.id;
          const next = this.checked;
          this.disabled = true;
          try {
            const r = await apiCall('/api/problem?action=adminProblems', 'PUT', { ids: [id], public: next });
            if (!r.success) throw new Error(r.message || 'update failed');
            const p = allProblems.find(x => x.id === id);
            if (p) p.public = next;
            showMessage(`"${id}" ${next ? 'published' : 'hidden'}`, 'success');
          } catch (e) {
            this.checked = !next;
            showMessage('Failed to update visibility', 'error');
          } finally {
            this.disabled = false;
          }
        };
      });

      syncSelectAll();
      toggleBatchActions();
    }

    function syncSelectAll() {
      const selAll = document.getElementById('selectAll');
      if (!selAll) return;
      const visible = Array.from(document.querySelectorAll('.problem-checkbox'));
      const checkedVisible = visible.filter(cb => cb.checked).length;
      selAll.checked = visible.length > 0 && checkedVisible === visible.length;
      selAll.indeterminate = checkedVisible > 0 && checkedVisible < visible.length;
    }

    function toggleBatchActions() {
      const batchDiv = document.getElementById('batchActions');
      const n = selectedIds.size;
      const selCount = document.getElementById('selCount');
      if (selCount) selCount.textContent = n ? `${n} selected` : '';
      if (n > 0) batchDiv.classList.add('visible');
      else batchDiv.classList.remove('visible');
    }

    // ── 批量操作 ──
    async function batchSetPublic(val) {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      const label = val ? 'Set public' : 'Set private';
      if (!confirm(`${label} for ${ids.length} problem(s)?`)) return;
      try {
        const r = await apiCall('/api/problem?action=adminProblems', 'PUT', { ids, public: val });
        showMessage(r.message || 'done', r.success ? 'success' : 'error');
        if (r.success) {
          ids.forEach(id => { const p = allProblems.find(x => x.id === id); if (p) p.public = val; });
          renderVirtual();
        }
      } catch (e) { showMessage('Error', 'error'); }
    }

    document.getElementById('batchPublicBtn').addEventListener('click', () => batchSetPublic(true));
    document.getElementById('batchPrivateBtn').addEventListener('click', () => batchSetPublic(false));

    document.getElementById('batchDeleteBtn').addEventListener('click', async function () {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      if (!confirm(`Delete ${ids.length} problem(s)?`)) return;
      try {
        const result = await apiCall('/api/problem?action=adminProblems', 'DELETE', { ids });
        showMessage(result.message, result.success ? 'success' : 'error');
        if (result.success) {
          ids.forEach(id => selectedIds.delete(id));
          loadProblems();
        }
      } catch (err) { showMessage('Error', 'error'); }
    });

    async function deleteProblem(id) {
      if (!confirm(`Delete problem "${id}"?`)) return;
      try {
        const result = await apiCall('/api/problem?action=adminProblems', 'DELETE', { id });
        showMessage(result.message, result.success ? 'success' : 'error');
        if (result.success) { selectedIds.delete(id); loadProblems(); }
      } catch (err) { showMessage('Error', 'error'); }
    }

    function showMessage(msg, type) {
      const el = document.getElementById('message');
      el.textContent = msg;
      el.style.color = type === 'error' ? 'var(--danger)' : '#2e7d32';
      setTimeout(() => el.textContent = '', 5000);
    }

    // ── 事件绑定 ──
    document.getElementById('pmSearch')?.addEventListener('input', () => applyFilter(true));

    document.getElementById('selectAll')?.addEventListener('change', function () {
      // 全选只作用于当前筛选结果，避免误选看不见的题
      viewList.forEach(p => {
        if (this.checked) selectedIds.add(p.id);
        else selectedIds.delete(p.id);
      });
      renderVirtual();
    });

    const tableWrap = document.querySelector('.pm-table-wrap');
    if (tableWrap) {
      let ticking = false;
      tableWrap.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => { ticking = false; renderVirtual(); });
      });
    }

    loadProblems();
