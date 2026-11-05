    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    if (!token) { alert('Invalid link'); location.href='/'; }

    // s22r42 → WYK22R42（和库里一致）
    function toWyk(raw) {
      const s = String(raw || '').trim();
      const m = /^s(\d{2})([a-z])(\d{2})$/i.exec(s);
      if (m) return 'WYK' + m[1] + m[2].toUpperCase() + m[3];
      return /^WYK\d{2}[A-Z]\d{2}$/i.test(s) ? s.toUpperCase() : s;
    }

    let accountName = '';
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      accountName = toWyk(payload.username);
      document.getElementById('setupUsername').textContent = accountName;
      const hint = document.getElementById('setupUsernameNote');
      if (hint && payload.rawUsername && payload.rawUsername !== accountName) {
        hint.textContent = '（舊格式 ' + payload.rawUsername + ' 已改為 ' + accountName + '）';
        hint.style.display = '';
      }
    } catch(e) { alert('Invalid token'); location.href='/'; }

    document.getElementById('setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = document.getElementById('password').value;
      const cpw = document.getElementById('confirmPassword').value;
      const err = document.getElementById('setupError');
      if (pw !== cpw) { err.textContent = 'Passwords do not match'; err.style.display = 'block'; return; }
      const res = await fetch('/api/auth/complete-setup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ token, password: pw })
      });
      const data = await res.json();
      if (data.success) {
        // 设完密码直接登录，不用再回登录页
        if (data.token) {
          try { localStorage.setItem('auth_token', data.token); } catch (e) {}
          (window.DSHUI ? DSHUI.toast('Welcome, ' + (data.username || accountName) + '!', 'ok') : null);
          location.href = '/';
          return;
        }
        (window.DSHUI ? DSHUI.toast('Account created! Please sign in.', 'ok') : alert('Account created! Please sign in.'));
        location.href = '/login';
      } else {
        err.textContent = data.message; err.style.display = 'block';
      }
    });
  