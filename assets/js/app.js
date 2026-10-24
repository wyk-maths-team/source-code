// app.js - 全局初始化
(function() {
  // 初始化应用
  // ═══════════════════════════════════════════════════
// PWA：強制從 OS 啟動
// ═══════════════════════════════════════════════════
(function forcePWAHome() {
  // 檢測是否以 PWA standalone 模式打開
  if (window.top !== window.self) return;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches;

  if (!isStandalone) return;                       // 瀏覽器模式 → 不重定向
  if (location.pathname.startsWith('/os')) return; // 已在 OS → 不重定向
  if (location.pathname.startsWith('/admin')) return; // 管理端 → 不重定向

  // 本次 PWA 會話是否已經進過 OS？
  // 沒進過 → 第一次從圖標啟動，重定向到 /os
  // 進過   → 是 OS 內部導航，放行
  try {
    if (!sessionStorage.getItem('pwaEnteredOS')) {
      sessionStorage.setItem('pwaEnteredOS', '1');
      location.replace('/os' + location.search + location.hash);
    }
  } catch (e) {
    // sessionStorage 不可用時，保守處理：不重定向
  }
})();
  initApp();

  function initApp() {
    const currentUser = (typeof getCurrentUser === 'function') ? getCurrentUser() : { displayName: 'Guest' };
    const displayName = currentUser ? (currentUser.displayName || currentUser.username || 'Guest') : 'Guest';

    const usernameSpan = document.getElementById('currentUsername');
    const clockEl = document.getElementById('clockTime');
    const logoutBtnHeader = document.getElementById('logoutBtnHeader');
    const sidebar = document.getElementById('sidebarContainer');
    const topbarLeft = document.querySelector('.topbar-left');
    const topbarRight = document.querySelector('.topbar-right');
    const mobileToggle = document.getElementById('sidebarToggle');

    if (usernameSpan) usernameSpan.textContent = displayName;

    // GMT+8 时钟
    function getGMT8Date(date) {
      const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
      return new Date(utc + (8 * 3600000));
    }
    function updateClock() {
      if (!clockEl) return;
      const gmt8 = getGMT8Date(new Date());
      const time = [gmt8.getHours(), gmt8.getMinutes(), gmt8.getSeconds()]
          .map(v => String(v).padStart(2, '0')).join(':');
      clockEl.textContent = time;
    }
    updateClock();
    setInterval(updateClock, 500);

    // 退出按钮
    if (logoutBtnHeader) {
      logoutBtnHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
          // 未登录时不处理
        } else {
          if (typeof logout === 'function') logout();
          localStorage.removeItem('sidebarOpen');
          window.location.href = '/';
        }
      });
    }

    function updateAuthUI() {
      const loggedIn = typeof isLoggedIn === 'function' && isLoggedIn();
      if (logoutBtnHeader) logoutBtnHeader.style.display = loggedIn ? 'block' : 'none';
      if (usernameSpan) {
        const user = loggedIn ? getCurrentUser() : null;
        usernameSpan.textContent = user ? (user.displayName || user.username) : 'Guest';
      }
    }
    updateAuthUI();

    // 监听其他标签页的登录状态变化
    window.addEventListener('authChanged', (e) => {
      updateAuthUI();
    });

    // 窗口大小变化响应
    window.addEventListener('resize', () => {
      if (!sidebar) return;
      if (window.innerWidth > 768) {
        document.body.classList.remove('sidebar-closed');
      }
    });

    // 键盘快捷键 Ctrl+B
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        if (sidebar) {
          sidebar.classList.toggle('open');
          const isOpen = sidebar.classList.contains('open');
          document.body.classList.toggle('sidebar-closed', !isOpen);
          if (window.innerWidth <= 768) {
            localStorage.setItem('sidebarOpen', isOpen);
          }
        }
      }
    });

    // 侧边栏链接高亮
    const sidebarLinks = document.querySelectorAll('.sidebar-link');
    const currentPath = window.location.pathname;
    sidebarLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && currentPath.endsWith(href)) link.classList.add('active');
      link.addEventListener('click', function() {
        if (window.innerWidth <= 768 && sidebar) {
          sidebar.classList.remove('open');
          document.body.classList.add('sidebar-closed');
          localStorage.setItem('sidebarOpen', 'false');
        }
      });
    });

    // 登录模态框（保留）
    const loginModal = document.getElementById('loginModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const modalForm = document.getElementById('modalLoginForm');
    const modalUsername = document.getElementById('modalUsername');
    const modalPassword = document.getElementById('modalPassword');
    const modalError = document.getElementById('modalLoginError');
    const loginSubmitBtn = document.querySelector('#modalLoginForm .login-btn');

    function hideLoginModal() {
      if (loginModal) loginModal.style.display = 'none';
      if (modalError) modalError.classList.add('hidden');
      if (modalForm) modalForm.reset();
      window._pendingLoginCallback = null;
      resetLoginButton();
    }

    function resetLoginButton() {
      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = false;
        loginSubmitBtn.textContent = 'Sign In';
        loginSubmitBtn.style.background = '';
      }
    }

    function setLoginButtonCooldown() {
      if (loginSubmitBtn) {
        loginSubmitBtn.disabled = true;
        loginSubmitBtn.textContent = 'Logging in...';
        loginSubmitBtn.style.background = '#a0c4ff';
      }
    }

    if (modalForm) {
      modalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = modalUsername.value.trim();
        const password = modalPassword.value;
        if (!username || !password) {
          if (modalError) {
            modalError.textContent = 'Please enter both fields.';
            modalError.classList.remove('hidden');
          }
          return;
        }
        setLoginButtonCooldown();
        try {
          const result = await login(username, password);
          if (result.success) {
            updateAuthUI();
            hideLoginModal();
            if (window._pendingLoginCallback) {
              window._pendingLoginCallback();
              window._pendingLoginCallback = null;
            } else {
              location.reload();
            }
          } else {
            if (modalError) {
              modalError.textContent = result.message;
              modalError.classList.remove('hidden');
            }
            resetLoginButton();
          }
        } catch (err) {
          if (modalError) {
            modalError.textContent = 'Network error. Please try again.';
            modalError.classList.remove('hidden');
          }
          resetLoginButton();
        }
      });
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', hideLoginModal);
    if (loginModal) loginModal.addEventListener('click', (e) => { if (e.target === loginModal) hideLoginModal(); });

    // 受保护链接拦截
    document.addEventListener('click', function(e) {
      const target = e.target.closest('.require-login');
      if (!target) return;
      if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
        e.preventDefault();
        e.stopPropagation();
        const targetUrl = target.getAttribute('href') || target.getAttribute('data-href') || '';
        const currentPath = targetUrl || (window.location.pathname + window.location.search);
        window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
      }
    }, true);

    // 恢复用户偏好设置
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark' || savedTheme === 'scifi') {
      document.documentElement.setAttribute('data-theme', savedTheme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    const savedFontSize = localStorage.getItem('fontSize');
    if (savedFontSize) {
      document.documentElement.style.fontSize = savedFontSize + 'px';
    }
    if (localStorage.getItem('goodUI') === 'true') {
      document.body.classList.add('good-ui');
    } else {
      document.body.classList.remove('good-ui');
    }
    if (localStorage.getItem('compactMode') === 'true') {
      document.body.classList.add('compact-mode');
    } else {
      document.body.classList.remove('compact-mode');
    }
    if (localStorage.getItem('animations') === 'false') {
      document.body.classList.add('no-animations');
    } else {
      document.body.classList.remove('no-animations');
    }
    // 3D 按钮：纯视觉偏好，缺省关闭
    if (localStorage.getItem('ui3d') === 'true') {
      document.body.classList.add('ui-3d');
    } else {
      document.body.classList.remove('ui-3d');
    }

    console.log(`WYK Maths Team ready. Welcome, ${displayName}!`);
  }
})();
(function() {
  // 打包版 WebView 的 User-Agent 會包含 'WYKApp'
  // 網頁版（Safari / Chrome / Edge…）不會
  const IS_PACKAGED_APP = /WYKApp/.test(navigator.userAgent);
  if (!IS_PACKAGED_APP) return;

  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => console.log('[App] SW registered:', reg.scope))
      .catch((err) => console.warn('[App] SW registration failed:', err));
  });
})();

// 把这个函数加到 app.js 的最后
function showSystemMessageModal(count) {
  if (document.getElementById('sys-msg-global-modal')) return;
  
  const modal = document.createElement('div');
  modal.id = 'sys-msg-global-modal';
  // 暗黑风格，贴合你网页的设计
  modal.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:var(--card-bg);border:2px solid #d93025;padding:20px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);max-width:340px;color:var(--text-primary);';
  
  modal.innerHTML = `
    <h3 style="margin:0 0 10px;font-size:16px;color:#d93025;display:flex;align-items:center;gap:8px;">
      <i class="fas fa-bell"></i> System Alert
    </h3>
    <p style="font-size:14px;line-height:1.5;margin-bottom:16px;">
      You have <b>${count}</b> unread message(s). Please check your inbox.
    </p>
    <button onclick="location.href='/messages'" style="width:100%;padding:10px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-family:inherit;">
      Go to Messages
    </button>
    <button onclick="this.parentElement.remove()" style="width:100%;padding:10px;background:transparent;color:var(--text-secondary);border:none;border-radius:6px;cursor:pointer;margin-top:8px;font-family:inherit;">
      Dismiss
    </button>
  `;
  document.body.appendChild(modal);
}