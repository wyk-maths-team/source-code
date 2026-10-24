
    const user = getCurrentUser();
    if (!isLoggedIn() || (user?.role !== 'admin' && user?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    let allProblems = [];

    async function loadProblems() {
      try {
        const data = await apiCall('/api/problem?action=adminProblems');
        if (data.success) {
          allProblems = data.problems || [];
          renderRows();
        }
      } catch (err) { console.error(err); }
    }

    function renderRows() {
      const kw = (document.getElementById('pmSearch')?.value || '').toLowerCase().trim();
      const filtered = !kw ? allProblems : allProblems.filter(p => {
        const hay = [p.id, p.name, p.ans, p.difficulty, (p.tags || []).join(' ')]
          .filter(v => v !== undefined && v !== null).join(' ').toLowerCase();
        return hay.includes(kw);
      });

      const tbody = document.getElementById('problemsList');
      tbody.innerHTML = filtered.map(p => `
        <tr>
          <td><input type="checkbox" class="problem-checkbox" data-id="${escapeHtml(p.id)}" /></td>
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
        </tr>
      `).join('');

      const countEl = document.getElementById('pmCount');
      if (countEl) countEl.textContent = kw ? `${filtered.length} / ${allProblems.length}` : `${allProblems.length} problems`;

      bindRowEvents();
    }

    function bindRowEvents() {
      const selAll = document.getElementById('selectAll');
      if (selAll) {
        selAll.onchange = function () {
          document.querySelectorAll('.problem-checkbox').forEach(cb => cb.checked = this.checked);
          toggleBatchActions();
        };
      }
      document.querySelectorAll('.problem-checkbox').forEach(cb => { cb.onchange = toggleBatchActions; });

      // Public 开关：直接改单个题目的可见性，失败则回滚，避免 UI 与库不一致
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

      toggleBatchActions();
    }

    document.getElementById('pmSearch')?.addEventListener('input', renderRows);

    function toggleBatchActions() {
      const checked = document.querySelectorAll('.problem-checkbox:checked').length;
      const batchDiv = document.getElementById('batchActions');
      if (checked > 0) batchDiv.classList.add('visible');
      else batchDiv.classList.remove('visible');
    }

    async function deleteProblem(id) {
      if (!confirm(`Delete problem "${id}"?`)) return;
      try {
        const result = await apiCall('/api/problem?action=adminProblems', 'DELETE', { id });
        showMessage(result.message, result.success ? 'success' : 'error');
        if (result.success) loadProblems();
      } catch (err) { showMessage('Error', 'error'); }
    }

    document.getElementById('batchDeleteBtn').addEventListener('click', async function() {
      const checked = document.querySelectorAll('.problem-checkbox:checked');
      if (!checked.length) return;
      const ids = Array.from(checked).map(cb => cb.dataset.id);
      if (!confirm(`Delete ${ids.length} problem(s)?`)) return;
      try {
        const result = await apiCall('/api/problem?action=adminProblems', 'DELETE', { ids });
        showMessage(result.message, result.success ? 'success' : 'error');
        if (result.success) loadProblems();
      } catch (err) { showMessage('Error', 'error'); }
    });

    document.getElementById('batchHideBtn').addEventListener('click', async function() {
      const checked = document.querySelectorAll('.problem-checkbox:checked');
      if (!checked.length) return;
      const ids = Array.from(checked).map(cb => cb.dataset.id);
      if (!confirm(`Hide ${ids.length} problem(s)? (They will be invisible to students)`)) return;
      try {
        const result = await apiCall('/api/problem?action=adminProblems', 'PUT', { ids, public: false });
        showMessage(result.message, result.success ? 'success' : 'error');
        if (result.success) loadProblems();
      } catch (err) { showMessage('Error', 'error'); }
    });

    function showMessage(msg, type) {
      const el = document.getElementById('message');
      el.textContent = msg;
      el.style.color = type === 'error' ? 'var(--danger)' : '#2e7d32';
      setTimeout(() => el.textContent = '', 5000);
    }

    loadProblems();
