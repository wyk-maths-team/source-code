
    // 权限检查
    if(isLoggedIn())apiCall('/api/users?action=markAdminVisit', 'POST').catch(() => {});
    if (!isLoggedIn()) window.location.href = '/index.html';
    const editorUser = getCurrentUser();
    if (!editorUser || (editorUser.role !== 'admin' && editorUser.role !== 'root')) {
      window.location.href = '/index.html';
    }

    // 根据当前用户显示可创建的角色
    if (editorUser.role !== 'root') {
      document.getElementById('adminOption').style.display = 'none';
    }

    async function loadUsers() {
      try {
        const data = await apiCall(`/api/users?action=adminList`);
        if (data.success) {
          const tbody = document.getElementById('usersList');
          // 排序：root → admin → student，同角色按 username
          const order = { root: 0, admin: 1, student: 2 };
          const sorted = [...data.users].sort((a, b) => {
            const oa = order[a.role] ?? 99;
            const ob = order[b.role] ?? 99;
            if (oa !== ob) return oa - ob;
            return String(a.username).localeCompare(String(b.username));
          });
          tbody.innerHTML = sorted.map(u => {
            const isRoot = u.role === 'root';
            const canEdit = editorUser.role === 'root' ? !isRoot : (u.role === 'student');
            const canDelete = editorUser.role === 'root' ? !isRoot : (u.role === 'student');
            const canBan = editorUser.role === 'root' ? !isRoot : (u.role === 'student');

            return `
              <tr>
                <td>${escapeHtml(u.displayName)}</td>
                <td>${escapeHtml(u.username)}</td>
                <td>${u.role}</td>
                <td>${u.banned ? '🔴 Banned' : '🟢 Normal'}</td>
                <td>
                  ${canEdit ? `<button class="btn btn-warning" onclick="window.location.href='/admin/users/${encodeURIComponent(u.username)}'">Edit</button>` : ''}
                  ${canBan ? `<button class="btn ${u.banned ? 'btn-primary' : 'btn-danger'}" onclick="toggleBan('${escapeHtml(u.username)}', ${u.banned})">${u.banned ? 'Unban' : 'Ban'}</button>` : ''}
                  ${canDelete ? `<button class="btn btn-danger" onclick="deleteUser('${escapeHtml(u.username)}')">Delete</button>` : ''}
                </td>
              </tr>
            `;
          }).join('');
        }
      } catch (err) { console.error(err); }
    }
    async function toggleBan(username, currentlyBanned) {
      const action = currentlyBanned ? 'unban' : 'ban';
      if (!confirm(`Are you sure you want to ${action} user "${username}"?`)) return;
      try {
        const result = await apiCall(`/api/users?action=adminUpdate&username=${encodeURIComponent(username)}`, 'PUT', {
          banned: !currentlyBanned
        });
        showMessage(result.message, result.success ? 'success' : 'error');
        if (result.success) loadUsers();
      } catch (err) { showMessage('Error', 'error'); }
    }

    async function deleteUser(username) {
      if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
      try {
        const result = await apiCall(`/api/users?action=adminDelete&username=${encodeURIComponent(username)}`, 'DELETE');
        showMessage(result.message, result.success ? 'success' : 'error');
        if (result.success) loadUsers();
      } catch (err) { showMessage('Error', 'error'); }
    }

    document.getElementById('addUserForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('newUsername').value.trim();
      const password = document.getElementById('newPassword').value;
      const displayName = document.getElementById('newDisplayName').value.trim();
      const realName = document.getElementById('newRealName').value.trim();
      const role = document.getElementById('newRole').value;

      if (!username || !password) {
        showMessage('Username and password are required.', 'error');
        return;
      }

      try {
        const body = { username, password, displayName, realName };
        if (editorUser.role === 'root') body.role = role;

        const result = await apiCall('/api/users?action=adminCreate', 'POST', body);
        showMessage(result.message, result.success ? 'success' : 'error');
        if (result.success) {
          document.getElementById('addUserForm').reset();
          loadUsers();
        }
      } catch (err) { showMessage('Error', 'error'); }
    });
    function showMessage(msg, type) {
      const el = document.getElementById('message');
      el.textContent = msg;
      el.style.color = type === 'error' ? 'var(--danger)' : '#2e7d32';
      setTimeout(() => el.textContent = '', 5000);
    }

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    loadUsers();
  