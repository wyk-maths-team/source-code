// app.js - 全局初始化
(function() {
  // 初始化应用
  initApp();

  function initApp() {
    if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);
  }

  // iOS 的 apple-touch-icon
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const appleIcon = document.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = '/icons/apple-touch-icon.png';
    document.head.appendChild(appleIcon);
  }

  // iOS 的 meta 標籤
  const iosMetaTags = [
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
    { name: 'apple-mobile-web-app-title', content: 'WYK Maths' },
    { name: 'mobile-web-app-capable', content: 'yes' }
  ];
  iosMetaTags.forEach(({ name, content }) => {
    if (!document.querySelector(`meta[name="${name}"]`)) {
      const meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
    }
  });
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
    if (savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
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