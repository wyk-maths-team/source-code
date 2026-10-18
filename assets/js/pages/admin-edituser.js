
    if(isLoggedIn())apiCall('/api/users?action=markAdminVisit', 'POST').catch(() => {});
    if (!isLoggedIn()) window.location.href = '/index.html';
    const editorUser = getCurrentUser();
    if (!editorUser || (editorUser.role !== 'admin' && editorUser.role !== 'root')) {
      window.location.href = '/index.html';
    }

    const pathMatch = window.location.pathname.match(/^\/admin\/users\/([^/]+)$/);
    if (!pathMatch) {
      document.getElementById('mainContent').innerHTML = '<div class="error-msg">Invalid URL.</div>';
      throw new Error('No username');
    }
    const username = decodeURIComponent(pathMatch[1]);
    document.title = `Edit ${username} - WYK Maths Team`;

    async function loadUser() {
      try {
        const data = await apiCall(`/api/users?action=adminList&username=${encodeURIComponent(username)}`);
        return data.success ? data.user : null;
      } catch (err) { console.error(err); return null; }
    }

    function renderForm(targetUser) {
      if (!targetUser) {
        document.getElementById('mainContent').innerHTML = '<div class="error-msg">User not found.</div>';
        return;
      }

      const isTargetRoot = targetUser.role === 'root';
      if (isTargetRoot) {
        document.getElementById('mainContent').innerHTML = '<div class="error-msg">Root user cannot be edited.</div>';
        return;
      }

      // 权限判断：只有 root 可以修改角色，admin 可以编辑学生但不能改角色
      let canEdit = false;
      let canChangeRole = false;
      let canBan = false;
      if (editorUser.role === 'root') {
        canEdit = true;
        canChangeRole = true;   // root 可以改角色
        canBan = true;
      } else if (editorUser.role === 'admin') {
        if (targetUser.role === 'student') {
          canEdit = true;
          canChangeRole = false;   // admin 不能改角色，只能编辑基本信息
          canBan = true;
        } else {
          document.getElementById('mainContent').innerHTML = '<div class="error-msg">Admin cannot edit other admins or root.</div>';
          return;
        }
      } else {
        document.getElementById('mainContent').innerHTML = '<div class="error-msg">You do not have permission to edit this user.</div>';
        return;
      }

      const roleDisabled = !canChangeRole;

      const html = `
        <div class="admin-container">
          <h2>Edit User: ${escapeHtml(targetUser.username)}</h2>
          <form id="editForm">
            <div class="form-group">
              <label>Display Name: <input type="text" id="editDisplayName" value="${escapeHtml(targetUser.displayName)}" required /></label>
            </div>
            <div class="form-group">
              <label>Real Name: <input type="text" id="editRealName" value="${escapeHtml(targetUser.realName || '')}" maxlength="60" placeholder="Real name (optional)" /></label>
            </div>
            <div class="form-group">
              <label>Username: <input type="text" id="editUsername" value="${escapeHtml(targetUser.username)}" required /></label>
            </div>
            <div class="form-group">
              <label>New Password (leave blank to keep): <input type="password" id="editPassword" placeholder="New password" /></label>
            </div>
            <div class="form-group">
              <label>Role:
                <select id="editRole" ${roleDisabled ? 'disabled' : ''}>
                  <option value="student" ${targetUser.role === 'student' ? 'selected' : ''}>Student</option>
                  <option value="admin" ${targetUser.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
              </label>
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="editBanned" ${targetUser.banned ? 'checked' : ''} ${canBan ? '' : 'disabled'}> Banned
              </label>
            </div>
            <div style="margin-top:1.5rem;">
              <button type="submit" class="btn btn-primary">Save Changes</button>
              <a href="/admin/users" class="btn btn-secondary">Cancel</a>
            </div>
          </form>
          <div id="message" class="message"></div>
        </div>
      `;

      document.getElementById('mainContent').innerHTML = html;

      document.getElementById('editForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const displayName = document.getElementById('editDisplayName').value.trim();
        const newUsername = document.getElementById('editUsername').value.trim();
        const realName = document.getElementById('editRealName').value.trim();
        const password = document.getElementById('editPassword').value;
        const role = canChangeRole ? document.getElementById('editRole').value : undefined;
        const banned = canBan ? document.getElementById('editBanned').checked : undefined;

        const updateBody = { displayName, realName };
        if (newUsername !== targetUser.username) updateBody.newUsername = newUsername;
        if (password) updateBody.password = password;
        if (role !== undefined) updateBody.role = role;
        if (banned !== undefined) updateBody.banned = banned;

        try {
                    const result = await apiCall(`/api/users?action=adminUpdate&username=${encodeURIComponent(username)}`, 'PUT', updateBody);
          const msgEl = document.getElementById('message');
          msgEl.textContent = result.message;
          msgEl.style.color = result.success ? '#2e7d32' : 'var(--danger)';
          if (result.success && newUsername !== username) {
            window.location.href = `/admin/users/${encodeURIComponent(newUsername)}`;
          }
        } catch (err) {
          document.getElementById('message').textContent = 'Error updating user.';
        }
      });
    }

    function escapeHtml(s) { return (window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }; }

    (async function init() {
      const user = await loadUser();
      renderForm(user);
    })();
  