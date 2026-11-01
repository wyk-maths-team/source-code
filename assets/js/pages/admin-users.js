// admin-users.js —— 用戶管理：搜尋 / 角色過濾 / 建立 / 封禁 / 刪除
//
// 包進 IIFE（避免 admin-newuser 那種 currentUser 撞名）；
// 表格裡的 inline onclick 需要的兩個函式顯式掛到 window。
(function () {
  'use strict';

  const editorUser = getCurrentUser();
  if (!editorUser || (editorUser.role !== 'admin' && editorUser.role !== 'root')) {
    window.location.href = '/index.html';
    return;
  }

  if (editorUser.role !== 'root') {
    const adminOption = document.getElementById('adminOption');
    if (adminOption) adminOption.style.display = 'none';
  }

  let allUsers = [];

  function escapeHtml(s) {
    return ((window.DSHUI && window.DSHUI.esc) || function (v) {
      return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
      });
    })(s);
  }

  function showMessage(msg, type) {
    const el = document.getElementById('message');
    el.textContent = msg;
    el.style.color = type === 'error' ? 'var(--danger)' : '#2e7d32';
    setTimeout(() => { el.textContent = ''; }, 5000);
  }

  // 關鍵字比對 username / displayName / realName，再疊 role
  function applyFilter() {
    const q = (document.getElementById('userSearch')?.value || '').trim().toLowerCase();
    const role = document.getElementById('roleFilter')?.value || '';

    const filtered = allUsers.filter((u) => {
      if (role && u.role !== role) return false;
      if (!q) return true;
      return (
        String(u.username || '').toLowerCase().includes(q) ||
        String(u.displayName || '').toLowerCase().includes(q) ||
        String(u.realName || '').toLowerCase().includes(q)
      );
    });

    const counter = document.getElementById('userCount');
    if (counter) {
      counter.textContent = 'Showing ' + filtered.length + ' / ' + allUsers.length + ' users';
    }

    renderRows(filtered);
  }

  function renderRows(list) {
    const tbody = document.getElementById('usersList');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--text-secondary);">No users match your filter.</td></tr>';
      return;
    }

    const order = { root: 0, admin: 1, student: 2 };
    const sorted = [...list].sort((a, b) => {
      const oa = order[a.role] ?? 99;
      const ob = order[b.role] ?? 99;
      if (oa !== ob) return oa - ob;
      return String(a.username).localeCompare(String(b.username));
    });

    tbody.innerHTML = sorted.map((u) => {
      const isRoot = u.role === 'root';
      const canEdit = editorUser.role === 'root' ? !isRoot : (u.role === 'student');
      const canDelete = editorUser.role === 'root' ? !isRoot : (u.role === 'student');
      const canBan = editorUser.role === 'root' ? !isRoot : (u.role === 'student');

      let roleBadge = '';
      if (u.role === 'root') roleBadge = '<span style="background:#8e44ad; color:#fff; padding:2px 6px; border-radius:4px; font-size:12px; font-weight:bold;">ROOT</span>';
      else if (u.role === 'admin') roleBadge = '<span style="background:#2980b9; color:#fff; padding:2px 6px; border-radius:4px; font-size:12px; font-weight:bold;">ADMIN</span>';
      else roleBadge = '<span style="background:#7f8c8d; color:#fff; padding:2px 6px; border-radius:4px; font-size:12px;">STUDENT</span>';

      let statusBadge = u.banned
        ? '<span style="color:#d93025; font-weight:bold;"><i class="fas fa-ban"></i> Banned</span>'
        : '<span style="color:#2e7d32;"><i class="fas fa-check-circle"></i> Active</span>';

      if (!u.banned && u.yellowCards > 0) {
        statusBadge += ' <span style="background:#e3a008; color:#fff; padding:2px 6px; border-radius:4px; font-size:11px; margin-left:5px;" title="Yellow Cards">' + u.yellowCards + ' Warn</span>';
      }

      const editBtn = canEdit
        ? '<a href="/admin/users/' + encodeURIComponent(u.username) + '" class="btn btn-warning" style="padding: 4px 10px;" title="Edit"><i class="fas fa-edit"></i></a>'
        : '';
      const banBtn = canBan
        ? '<button class="btn ' + (u.banned ? 'btn-primary' : 'btn-danger') + '" style="padding: 4px 10px;" onclick="toggleBan(\'' + escapeHtml(u.username) + '\', ' + (u.banned ? 'true' : 'false') + ')" title="' + (u.banned ? 'Unban' : 'Ban') + '"><i class="fas ' + (u.banned ? 'fa-unlock' : 'fa-gavel') + '"></i></button>'
        : '';
      const delBtn = canDelete
        ? '<button class="btn btn-danger" style="padding: 4px 10px;" onclick="deleteUser(\'' + escapeHtml(u.username) + '\')" title="Delete"><i class="fas fa-trash"></i></button>'
        : '';

      return (
        '<tr style="border-bottom: 1px solid var(--border-color);">' +
          '<td style="padding: 10px;">' +
            '<div style="font-weight:bold; color:var(--text-primary);">' + escapeHtml(u.displayName || u.username) + '</div>' +
            '<div style="font-size: 12px; color:var(--text-secondary);">@' + escapeHtml(u.username) + '</div>' +
          '</td>' +
          '<td style="padding: 10px; font-size: 14px;">' + escapeHtml(u.realName || '-') + '</td>' +
          '<td style="padding: 10px;">' + roleBadge + '</td>' +
          '<td style="padding: 10px;">' + statusBadge + '</td>' +
          '<td style="padding: 10px; text-align: right;"><div style="display: flex; gap: 6px; justify-content: flex-end;">' +
            editBtn + banBtn + delBtn +
          '</div></td>' +
        '</tr>'
      );
    }).join('');
  }

  async function loadUsers() {
    try {
      const data = await apiCall('/api/users?action=adminList');
      if (data.success) {
        allUsers = data.users || [];
        applyFilter();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function toggleBan(username, currentlyBanned) {
    const action = currentlyBanned ? 'unban' : 'ban';
    if (!confirm('Are you sure you want to ' + action + ' user "' + username + '"?')) return;
    try {
      const result = await apiCall('/api/users?action=adminUpdate&username=' + encodeURIComponent(username), 'PUT', {
        banned: !currentlyBanned,
      });
      showMessage(result.message, result.success ? 'success' : 'error');
      if (result.success) loadUsers();
    } catch (err) {
      showMessage('Error', 'error');
    }
  }

  async function deleteUser(username) {
    if (!confirm('Delete user "' + username + '"? This cannot be undone.')) return;
    try {
      const result = await apiCall('/api/users?action=adminDelete&username=' + encodeURIComponent(username), 'DELETE');
      showMessage(result.message, result.success ? 'success' : 'error');
      if (result.success) loadUsers();
    } catch (err) {
      showMessage('Error', 'error');
    }
  }

  // 表格裡的 inline onclick 需要這兩個在全域
  window.toggleBan = toggleBan;
  window.deleteUser = deleteUser;

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
    } catch (err) {
      showMessage('Error', 'error');
    }
  });

  document.getElementById('userSearch').addEventListener('input', applyFilter);
  document.getElementById('roleFilter').addEventListener('change', applyFilter);

  loadUsers();
})();
