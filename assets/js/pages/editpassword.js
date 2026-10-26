    // 登录检查
    if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
      window.location.href = '/index.html';
    }

    const form = document.getElementById('editPasswordForm');
    const messageEl = document.getElementById('message');
    const backBtn = document.getElementById('backBtn');

    backBtn.addEventListener('click', () => {
      window.history.back();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      messageEl.style.display = 'none';

      const oldPassword = document.getElementById('oldPassword').value.trim();
      const newPassword = document.getElementById('newPassword').value.trim();
      const confirmPassword = document.getElementById('confirmPassword').value.trim();

      if (!oldPassword || !newPassword || !confirmPassword) {
        messageEl.textContent = 'All fields are required.';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
        return;
      }

      if (newPassword !== confirmPassword) {
        messageEl.textContent = 'New passwords do not match.';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
        return;
      }

      if (newPassword.length < 4) {
        messageEl.textContent = 'Password must be at least 4 characters.';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
        return;
      }

      try {
        const result = await apiCall('/api/users?action=changepassword', 'POST', {
          oldPassword,
          newPassword
        });

        if (result.success) {
          messageEl.textContent = 'Password changed successfully!';
          messageEl.className = 'message success';
          messageEl.style.display = 'block';
          form.reset();
        } else {
          messageEl.textContent = result.message || 'Update failed.';
          messageEl.className = 'message error';
          messageEl.style.display = 'block';
        }
      } catch (err) {
        messageEl.textContent = 'Network error. Please try again.';
        messageEl.className = 'message error';
        messageEl.style.display = 'block';
      }
    });
  