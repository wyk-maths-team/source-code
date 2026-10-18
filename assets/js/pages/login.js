    // 如果已登录，直接跳转
    if (typeof isLoggedIn === 'function' && isLoggedIn()) {
      window.location.href = '/';
    }

    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  if (!username || !password) {
    showError('Please enter both username and password.');
    return;
  }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = 'Signing in';
  hideError();

  // 让浏览器先渲染 disabled 状态
  await new Promise(r => requestAnimationFrame(() => r()));

  try {
    if (typeof window.login !== 'function') throw new Error('Login function not available');
    const result = await window.login(username, password);

    if (result.success) {
      const redirect = new URLSearchParams(window.location.search).get('redirect') || '/';

      // ⭐ 1. 卡片轻微下沉
      const card = document.querySelector('.login-card');
      if (card) card.classList.add('sinking');

      // ⭐ 2. 遮罩从按钮位置扩散铺满
      const rect = btn.getBoundingClientRect();
      const veil = document.getElementById('loginVeil');
      veil.style.setProperty('--fx', (rect.left + rect.width  / 2) + 'px');
      veil.style.setProperty('--fy', (rect.top  + rect.height / 2) + 'px');
      veil.classList.add('active');


      // ⭐ 4. 动画跑完再跳
      setTimeout(() => { window.location.href = redirect; }, 680);
      return;   // ⚠️ 走这条路不恢复按钮
    }

    showError(result.message || 'Invalid username or password.');
  } catch (err) {
    console.error('Login error:', err);
    showError('Network error. Please try again.');
  }

  // 只有失败才会走到这里
  btn.disabled = false;
  btn.classList.remove('loading');
  btn.textContent = 'Sign In';
});
function showError(msg) {
      loginError.textContent = msg;
      loginError.style.display = 'block';
    }
    function hideError() {
      loginError.textContent = '';
      loginError.style.display = 'none';
    }
  