    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    if (!token) { alert('Invalid link'); location.href='/'; }
    try {
      document.getElementById('setupUsername').textContent = JSON.parse(atob(token.split('.')[1])).username;
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
        (window.DSHUI ? DSHUI.toast('Account created! Please sign in.', 'ok') : alert('Account created! Please sign in.'));
        location.href = '/login';
      } else {
        err.textContent = data.message; err.style.display = 'block';
      }
    });
  