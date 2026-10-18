    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    const currentUser = getCurrentUser();
    const isRoot = currentUser?.role === 'root';

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

      const username = document.getElementById('newUsername').value.trim();
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
          // ⭐ 不跳轉：清空表單，保留 role（方便連續建同角色）
          document.getElementById('newUsername').value = '';
          document.getElementById('newPassword').value = '';
          document.getElementById('newDisplayName').value = '';
          document.getElementById('newRealName').value = '';
          setMessage(`"${username}" created. Ready for next.`, false);
          document.getElementById('newUsername').focus();
        } else {
          setMessage(result.message || 'Error creating user.', true);
        }
      } catch (err) {
        setMessage('Network error: ' + err.message, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create User';
      }
    });

    document.getElementById('newUsername').focus();
  