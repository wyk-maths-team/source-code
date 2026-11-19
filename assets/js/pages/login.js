// 如果已登录，直接跳转
if (typeof isLoggedIn === 'function' && isLoggedIn()) {
  // 有 redirect 就回原页面，别一律回首页
  const back = new URLSearchParams(location.search).get('redirect');
  window.location.href = back || '/';
}

const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const agreeTerms = document.getElementById('agreeTerms'); // ⭐ 新增：免责声明复选框
const msLoginBtn = document.getElementById('msLoginBtn'); // ⭐ 新增：微软登录按钮

// ⭐ 被会话检查踢回登录页时，明确告诉用户为什么。
// 以前这条路径是静默的：token 解析失败/过期 → 删 token → 跳首页 →
// 用户看到的是「登录了但没登录」，没有任何线索。
(function showSessionNotice() {
  const p = new URLSearchParams(location.search);
  const reason = p.get('reason');
  if (!reason) return;
  const MSG = {
    expired: 'Your session has expired. Please sign in again.',
    invalid: 'Your saved session could not be read. Please sign in again.',
  };
  const text = MSG[reason];
  if (!text) return;   // signed_out 等正常情况不打扰
  if (!loginError) return;
  loginError.textContent = text;
  loginError.style.display = 'block';
})();

// 控制登录按钮的状态
function updateAuthState() {
  const btn = document.getElementById('loginBtn');
  if (!agreeTerms) return;

  // 不真正禁用按钮：未勾选时要能点，点了把焦点送过去
  btn.disabled = false;
  // 微软按钮初始带 pointer-events:none（避免没勾条款就点走）。
  // 这里必须同时把 pointer-events 恢复成 auto，只改 opacity 的话
  // 勾了条款按钮依然点不动 —— 这就是「Microsoft 登录不可用」的原因。
  if (agreeTerms.checked) {
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    if (msLoginBtn) {
      msLoginBtn.style.opacity = '1';
      msLoginBtn.style.pointerEvents = 'auto';
      msLoginBtn.style.cursor = 'pointer';
      msLoginBtn.removeAttribute('aria-disabled');
    }
  } else {
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    if (msLoginBtn) {
      msLoginBtn.style.opacity = '0.5';
      msLoginBtn.style.pointerEvents = 'none';
      msLoginBtn.setAttribute('aria-disabled', 'true');
    }
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
      // 被封禁的账号只能停在首页 —— 直接送去首页，别先跳到原页面
      // 再被 auth-gate 弹回来（那样看起来像登录失败）。
      let redirect = new URLSearchParams(window.location.search).get('redirect') || '/';
      if (result.banned) redirect = '/index.html';

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