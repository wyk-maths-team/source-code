// admin-newuser.js —— 建立新用戶
//
// 以前這個檔案是裸的 top-level 腳本，直接 `const currentUser = ...`，
// 會和 app.js 已經宣告的全域 currentUser 撞名：
//   Uncaught SyntaxError: Identifier 'currentUser' has already been declared
// 整個檔案因此不執行，表單的 submit 沒人接，按「Create User」完全沒反應。
// 現在整段包進 IIFE，變數都在函式作用域裡。
(function () {
  'use strict';

  if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
    window.location.href = '/index.html';
    return;
  }

  const me = getCurrentUser();
  const isRoot = me?.role === 'root';

  if (isRoot) {
    document.getElementById('roleGroup').style.display = 'block';
  }

  function setMessage(text, isError) {
    const el = document.getElementById('message');
    el.textContent = text;
    el.style.color = isError ? 'var(--danger)' : '#2e7d32';
  }

  document.getElementById('newUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawUsername = document.getElementById('newUsername').value.trim();
    // 旧格式 s22r42 → WYK22R42（后端也会再规范化一次）
    const m0 = /^s(\d{2})([a-z])(\d{2})$/i.exec(rawUsername);
    const username = m0 ? ('WYK' + m0[1] + m0[2].toUpperCase() + m0[3]) : rawUsername;
    const password = document.getElementById('newPassword').value;
    const displayName = document.getElementById('newDisplayName').value.trim();
    const realName = document.getElementById('newRealName').value.trim();
    const role = isRoot ? document.getElementById('newRole').value : undefined;

    if (!username || !password) {
      setMessage('Username and password are required.', true);
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
      const body = { username, password, displayName, realName };
      if (isRoot) body.role = role;

      const result = await apiCall('/api/users?action=adminCreate', 'POST', body);

      if (result.success) {
        // 不跳轉：清空表單，方便連續建帳號
        document.getElementById('newUsername').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('newDisplayName').value = '';
        document.getElementById('newRealName').value = '';
        setMessage('"' + username + '" created. Ready for next.', false);
        document.getElementById('newUsername').focus();
      } else {
        setMessage(result.message || 'Error creating user.', true);
      }
    } catch (err) {
      setMessage('Error: ' + (err.message || 'Failed to create user'), true);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create User';
    }
  });

  document.getElementById('newUsername').focus();
})();
