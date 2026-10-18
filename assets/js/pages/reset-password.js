    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const msg = document.getElementById('msg');
    const subtitle = document.getElementById('rpSubtitle');
    const form = document.getElementById('rpForm');
    const btn = document.getElementById('rpBtn');

    if (!token) {
      subtitle.textContent = '';
      msg.className = 'msg error visible';
      msg.textContent = 'No reset token. Please use the "Forgot password?" link again.';
      form.style.display = 'none';
    } else {
      // 从 JWT payload 里读出 username 显示（不验证签名，仅展示用）
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.username) {
          subtitle.innerHTML = `For account <code>${payload.username.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</code>`;
        } else {
          subtitle.textContent = '';
        }
      } catch {
        subtitle.textContent = '';
      }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!token) return;

      const pw1 = document.getElementById('pw1').value;
      const pw2 = document.getElementById('pw2').value;

      if (pw1 !== pw2) {
        msg.className = 'msg error visible';
        msg.textContent = 'Passwords do not match.';
        return;
      }
      if (pw1.length < 4) {
        msg.className = 'msg error visible';
        msg.textContent = 'Password must be at least 4 characters.';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Updating…';
      msg.className = 'msg';

      try {
        const res = await fetch('/api/auth?action=complete-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password: pw1 }),
        });
        const data = await res.json();

        if (data.success) {
          msg.className = 'msg success visible';
          msg.textContent = '✓ Password updated! Redirecting to sign in…';
          form.style.display = 'none';
          setTimeout(() => { window.location.href = '/login'; }, 1500);
        } else {
          msg.className = 'msg error visible';
          msg.textContent = data.message || 'Update failed.';
          btn.disabled = false;
          btn.textContent = 'Update Password';
        }
      } catch (err) {
        msg.className = 'msg error visible';
        msg.textContent = 'Network error. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Update Password';
      }
    });
  