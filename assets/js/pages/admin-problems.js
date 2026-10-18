
    const user = getCurrentUser();
    if (!isLoggedIn() || (user?.role !== 'admin' && user?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    async function loadProblems() {
      try {
        const data = await apiCall('/api/problem?action=adminProblems');
        if (data.success) {
          const tbody = document.getElementById('problemsList');
          tbody.innerHTML = data.problems.map(p => `
            <tr>
              <td><input type="checkbox" class="problem-checkbox" data-id="${escapeHtml(p.id)}" /></td>
              <td><a href="/problems/${encodeURIComponent(p.id)}">${escapeHtml(p.id)}</a></td>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(String(p.ans))}</td>
              <td>${p.public ? 'Yes' : 'No'}</td>
              <td>
                <button class="btn btn-primary" onclick="window.location.href='/admin/problems/${encodeURIComponent(p.id)}'">Edit</button>
                <button class="btn btn-danger" onclick="deleteProblem('${escapeHtml(p.id)}')">Delete</button>
              </td>
            </tr>
          `).join('');

          document.getElementById('selectAll').addEventListener('change', function() {
            document.querySelectorAll('.problem-checkbox').forEach(cb => cb.checked = this.checked);
            toggleBatchActions();
          });

          document.querySelectorAll('.problem-checkbox').forEach(cb => {
            cb.addEventListener('change', toggleBatchActions);
          });

          toggleBatchActions();
        }
      } catch (err) { console.error(err); }
    }

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
  