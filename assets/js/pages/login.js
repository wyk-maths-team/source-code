// 如果已登录，直接跳转
if (typeof isLoggedIn === 'function' && isLoggedIn()) {
  window.location.href = '/';
}

const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const agreeTerms = document.getElementById('agreeTerms'); // ⭐ 新增：免责声明复选框
const msLoginBtn = document.getElementById('msLoginBtn'); // ⭐ 新增：微软登录按钮

// 控制登录按钮的状态
function updateAuthState() {
  const btn = document.getElementById('loginBtn');
  if (!agreeTerms) return;

  // 不真正禁用按钮：未勾选时要能点，点了把焦点送过去
  btn.disabled = false;
  if (agreeTerms.checked) {
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    if (msLoginBtn) msLoginBtn.style.opacity = '1';
  } else {
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    if (msLoginBtn) msLoginBtn.style.opacity = '0.5';
  }
}

/** 没勾条款时：聚焦 + 轻微抖动 + 提示 */
function nudgeTerms() {
  if (!agreeTerms) return;
  try { agreeTerms.focus({ preventScroll: false }); } catch { agreeTerms.focus(); }
  agreeTerms.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const group = agreeTerms.closest('.terms-group');
  if (group) {
    group.classList.remove('shake');
    void group.offsetWidth;          // 重启动画
    group.classList.add('shake');
    setTimeout(() => group.classList.remove('shake'), 600);
  }
  showError('Please tick the Terms of Service box first.');
}

// 初始化状态，并监听复选框
if (agreeTerms) {
  agreeTerms.addEventListener('change', updateAuthState);
  updateAuthState();
}

// 登录按钮：必须在浏览器做 required 校验之前拦住，否则表单不会提交、submit 不触发
const loginBtnEl = document.getElementById('loginBtn');
if (loginBtnEl) {
  loginBtnEl.addEventListener('click', (e) => {
    if (!agreeTerms || !agreeTerms.checked) {
      e.preventDefault();
      e.stopPropagation();
      nudgeTerms();
    }
  }, true);
}

// 微软登录：没勾条款时点它 → 聚焦复选框而不是跳转
if (msLoginBtn) {
  msLoginBtn.style.pointerEvents = 'auto';
  msLoginBtn.addEventListener('click', (e) => {
    if (!agreeTerms || !agreeTerms.checked) {
      e.preventDefault();
      e.stopPropagation();
      nudgeTerms();
    }
  });
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!agreeTerms || !agreeTerms.checked) {
    nudgeTerms();
    return;
  }

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