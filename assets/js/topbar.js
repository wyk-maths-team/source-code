// topbar.js
(function() {
  console.log('topbar.js executing...');

  function getCurrentUserName() {
    try {
      if (typeof getCurrentUser === 'function') {
        const user = getCurrentUser();
        return user?.displayName || user?.username || 'guest';
      }
    } catch(e) { console.error('getCurrentUser error:', e); }
    return 'guest';
  }

  const container = document.getElementById('topbarContainer');
  if (!container) {
    console.error('topbarContainer not found!');
    return;
  }

  const username = getCurrentUserName();
  const loggedIn = (typeof isLoggedIn === 'function') && isLoggedIn();

  let realUsername = 'guest';
  if (typeof getCurrentUser === 'function') {
    const user = getCurrentUser();
    realUsername = user?.username || 'guest';
  }

  // 判断移动端
  const isMobile = window.innerWidth <= 768;

  // 移动端截断用户名
  let displayUsername = username;
  if (isMobile && username.length > 7) {
    displayUsername = username.substring(0, 4) + '...';
  }
  
  

  // ---------- 头像缓存 ----------
  let avatarCache = null;
  function getCachedAvatar() {
    if (avatarCache !== null) return avatarCache;
    const cached = sessionStorage.getItem('userAvatar_' + realUsername);
    if (cached) {
      try {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < 3600 * 1000) {
          avatarCache = data.url;
          return avatarCache;
        }
      } catch(e) {}
    }
    return null;
  }
  function setCachedAvatar(url) {
    avatarCache = url;
    try {
      sessionStorage.setItem('userAvatar_' + realUsername, JSON.stringify({ url, timestamp: Date.now() }));
    } catch(e) {}
  }

  // ---------- 加载头像 ----------
  async function loadUserAvatar() {
    const avatarImg = document.getElementById('userAvatar');
    if (!avatarImg) return;

    const cached = getCachedAvatar();
    if (cached) {
      avatarImg.src = cached;
      avatarImg.style.display = 'inline-block';
      return;
    }

    if (!loggedIn || !realUsername) return;

    try {
      const data = await apiCall(`/api/users?action=pfp&username=${encodeURIComponent(realUsername)}`);
      if (data.success && data.pfp) {
        avatarImg.src = data.pfp;
        avatarImg.style.display = 'inline-block';
        setCachedAvatar(data.pfp);
      } else {
        avatarImg.style.display = 'none';
      }
    } catch (err) {
      console.warn('Failed to load avatar:', err);
      avatarImg.style.display = 'none';
    }
  }

  // ---------- 下拉切换 ----------
  function toggleDropdown(e) {
    if (e) e.stopPropagation();
    if (!loggedIn) {
      const currentPath = window.location.pathname + window.location.search;
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
      return;
    }
    const dropdown = document.getElementById('userDropdown');
    if (!dropdown) return;
    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
  }

  function closeDropdown(e) {
    const dropdown = document.getElementById('userDropdown');
    const menu = document.getElementById('userMenu');
    if (!dropdown || !menu) return;
    if (menu.contains(e.target)) return;
    dropdown.style.display = 'none';
  }

  // ---------- 登出 ----------
  function performLogout() {
    if (typeof logout === 'function') logout();
    localStorage.removeItem('sidebarOpen');
    window.location.href = '/index.html';
  }

  // ---------- 移动端侧边栏切换 ----------
  function toggleSidebarMobile(e) {
    e.stopPropagation();
    if (typeof window.toggleSidebar === 'function') {
      window.toggleSidebar();
    } else {
      const sidebar = document.getElementById('sidebarContainer');
      if (!sidebar) return;
      sidebar.classList.toggle('open');
      const isOpen = sidebar.classList.contains('open');
      if (isOpen) {
        sidebar.style.transform = 'translateY(0)';
        document.body.classList.remove('sidebar-closed');
        if (window.innerWidth <= 768) localStorage.setItem('sidebarOpen', 'true');
      } else {
        sidebar.style.transform = 'translateY(-100%)';
        document.body.classList.add('sidebar-closed');
        if (window.innerWidth <= 768) localStorage.setItem('sidebarOpen', 'false');
      }
    }
  }

  // ---------- 桌面端侧边栏隐藏/显示 ----------
  const SIDEBAR_HIDDEN_KEY = 'sidebarHiddenDesktop';

  function applyDesktopSidebarState(hidden) {
    if (hidden) {
      document.body.classList.add('sidebar-hidden-desktop');
    } else {
      document.body.classList.remove('sidebar-hidden-desktop');
    }
    // 更新按钮图标
    const iconEl = document.querySelector('#fullscreenToggleBtn i');
    if (iconEl) {
      iconEl.className = hidden
        ? 'fa-solid fa-angles-right'
        : 'fa-solid fa-angles-left';
    }
  }

  function toggleDesktopSidebar(e) {
    if (e) e.stopPropagation();
    if (window.innerWidth <= 768) return; // 移动端不处理
    const isHidden = document.body.classList.contains('sidebar-hidden-desktop');
    const newHidden = !isHidden;
    applyDesktopSidebarState(newHidden);
    try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, newHidden ? '1' : '0'); } catch (e) {}
  }

  // ---------- 构建 Topbar HTML ----------
  let topbarHTML = `
    <div class="topbar-left">
      <span class="brand-name">
        <a href="/" style="display:flex; align-items:center; gap:8px; text-decoration:none; color:#ffffff; font-weight:800; letter-spacing:1px;">
          <img src="/favicon.svg" alt="Home" style="display:block; width:28px; height:28px; border-radius:50%; flex-shrink:0;" id="brandIcon">
          <span class="brand-text">WYK Maths Team</span>
        </a>
      </span>
    </div>
    <div class="topbar-right">
  `;

  if (loggedIn) {
    topbarHTML += `
      <div class="user-menu" id="userMenu">
        <div class="user-box" id="userBox">
          <div class="user-box-left">
            <img id="userAvatar" src="" alt="avatar" class="user-box-avatar">
            <span id="currentUsername" class="user-box-name">${escapeHtml(displayUsername)}</span>
          </div>
          <div class="user-box-right" id="userBoxArrow">
            <i class="fa fa-caret-down"></i>
          </div>
        </div>
        <div id="userDropdown" class="user-dropdown">
          <a href="/users/${encodeURIComponent(realUsername)}" class="dropdown-item">
            <i class="fa fa-user fa-fw"></i> Profile
          </a>
          <a href="/settings" class="dropdown-item">
            <i class="fa fa-pencil fa-fw"></i> Settings
          </a>
          <button class="logout-btn" id="logoutBtnHeader">
            <i class="fa fa-sign-out fa-fw"></i> Logout
          </button>
        </div>
      </div>
    `;
  } else {
    topbarHTML += `
      <div class="user-menu" id="userMenu">
        <a href="/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}" class="login-btn-header">
          <i class="fa fa-sign-in-alt fa-fw"></i> Login
        </a>
      </div>
    `;
  }
  
  // 全屏侧边栏切换按钮（桌面可见）
    // 移動端漢堡按鈕（桌面端由 CSS 隱藏）
  if (isMobile) {
  topbarHTML += `
      <button class="topbar-sidebar-toggle" id="mobileSidebarToggle" title="Menu">
        ☰
      </button>
  `;
  }
    // ⭐ WYK OS 啟動按鈕（僅桌面 / iPad）
  if (!isMobile) {
    topbarHTML += `
      <button class="os-launch-btn" id="osLaunchBtn" title="Enter WYK OS">
        <i class="fas fa-desktop"></i>
      </button>
    `;
  }


  // 桌面端全屏側邊欄切換按鈕（移動端由 CSS 隱藏）
  topbarHTML += `
      <button class="topbar-fullscreen-toggle" id="fullscreenToggleBtn" title="Toggle sidebar">
        <i class="fa-solid fa-angles-left"></i>
      </button>
      <div class="clock">
        <span class="clock-time" id="clockTime">00:00:00</span>
      </div>
    </div>
  `;

  container.innerHTML = topbarHTML;

  // ---------- 绑定事件 ----------
  // 移动端汉堡按钮
  const mobileToggle = document.getElementById('mobileSidebarToggle');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', toggleSidebarMobile);
  }

  // 桌面端全屏按钮
  const fullscreenBtn = document.getElementById('fullscreenToggleBtn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleDesktopSidebar);
  }
    // ⭐ WYK OS 按鈕（桌面 / iPad 才渲染，DOM 已存在，可以安全綁定）
  const osLaunchBtn = document.getElementById('osLaunchBtn');
  if (osLaunchBtn) {
    osLaunchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.href = '/os';
    });
  }

  // 用户框：点击整块（左+右）都触发 dropdown
  const userBox = document.getElementById('userBox');
  if (userBox) {
    userBox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown(e);
    });
  }

  // 登出按钮
  const logoutBtn = document.getElementById('logoutBtnHeader');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      performLogout();
    });
  }

  // 暴露全局（保留向后兼容）
  window.toggleDropdown = toggleDropdown;
  window.performLogout = performLogout;

  // 点击页面其他区域关闭下拉
  document.addEventListener('click', closeDropdown);

  // 加载头像
  if (loggedIn && realUsername) {
    setTimeout(loadUserAvatar, 100);
  }

  // 恢复桌面端侧边栏状态
  try {
    if (window.innerWidth > 768 && localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1') {
      applyDesktopSidebarState(true);
    }
  } catch (e) { /* ignore */ }

  // 时钟
  function updateClock() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const el = document.getElementById('clockTime');
    if (el) el.textContent = timeStr;
  }
  setInterval(updateClock, 1000);
  updateClock();

  function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  }

  // ---------- 样式 ----------
  const style = document.createElement('style');
  style.textContent = `
    /* ===== 基础布局：topbar 高度满格 ===== */
    .topbar { overflow-y: visible !important; z-index: 9998 !important; padding: 0 0 0 24px !important; }
    .topbar-right {
      display: flex;
      align-items: stretch;
      gap: 12px;
      height: 100%;
      padding-right: 24px;
    }
    .topbar-right > .clock,
    .topbar-right > .topbar-fullscreen-toggle,
    .topbar-right > .login-btn-header {
      align-self: center;
    }

    /* ===== 用户框：两个长方形 ===== */
    .user-menu {
      position: relative;
      z-index: 9999 !important;
      align-self: stretch;
      display: flex;
      align-items: stretch;
      height: 100%;
    }
    .user-box {
      display: flex;
      align-items: stretch;
      height: 100%;
      cursor: pointer;
      background: rgba(255,255,255,0.06);
      overflow: hidden;
      user-select: none;
      transition: background 0.15s ease;
    }
    .user-box:hover { background: rgba(255,255,255,0.1); }
    .user-box-left {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px;
      transition: background 0.15s ease;
      min-width: 0;
    }
    .user-box-left:hover { background: rgba(255,255,255,0.08); }
    .user-box-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      display: none;
      flex-shrink: 0;
    }
    .user-box-name {
      font-weight: 500;
      font-size: 0.9rem;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 180px;
    }
    .user-box-right {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      background: rgba(255,255,255,0.08);
      border-left: 1px solid rgba(255,255,255,0.12);
      transition: background 0.15s ease;
      color: #ffffff;
      font-size: 0.8rem;
    }
    .user-box-right:hover { background: rgba(255,255,255,0.18); }
    .user-box.open .user-box-right i,
    .user-menu.open .user-box-right i { transform: rotate(180deg); }
    .user-box-right i { transition: transform 0.2s ease; }

    /* ===== 下拉菜单 ===== */
    .user-dropdown {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      background: #fff;
      border-radius: var(--radius-sm, 6px);
      box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));
      min-width: 160px;
      overflow: hidden;
      z-index: 99999;
    }
    .user-dropdown .dropdown-item,
    .user-dropdown .logout-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 11px 18px;
      background: #fff;
      color: var(--text-primary, #212529);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      border: none;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s;
    }
    .user-dropdown .dropdown-item:hover { background: #f0f2f5; }
    .user-dropdown .logout-btn { color: var(--danger, #dc3545); }
    .user-dropdown .logout-btn:hover { background: #fef2f2; }

    /* ===== 全屏按钮 ===== */
    .topbar-fullscreen-toggle {
      background: rgba(255,255,255,0.08);
      border: none;
      color: var(--topbar-text, #e0e0e0);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.95rem;
      transition: background 0.2s;
    }
    .topbar-fullscreen-toggle:hover {
      background: rgba(255,255,255,0.18);
      color: #fff;
    }

    /* ===== 登录按钮 ===== */
    .login-btn-header {
      display: inline-block;
      padding: 6px 16px;
      background: var(--accent, #4a90d9);
      color: #fff;
      border-radius: 20px;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.9rem;
      transition: background 0.2s;
    }
    .login-btn-header:hover { background: var(--accent-hover, #3a7bc8) !important; }

    /* ===== 深色模式 ===== */
    [data-theme="dark"] .user-dropdown { background: #1e1e1e; border: 1px solid #444; }
    [data-theme="dark"] .user-dropdown .dropdown-item,
    [data-theme="dark"] .user-dropdown .logout-btn { background: #1e1e1e; color: #e0e0e0; }
    [data-theme="dark"] .user-dropdown .dropdown-item:hover,
    [data-theme="dark"] .user-dropdown .logout-btn:hover { background: #2a2a2a; }
    [data-theme="dark"] .user-dropdown .logout-btn { color: #f85149; }
    [data-theme="dark"] .user-dropdown .logout-btn:hover { background: #3a1a1a; }
        /* ⭐ WYK OS 按鈕 */
    .os-launch-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border: 1px solid rgba(100, 150, 220, 0.4);
      border-radius: 20px;
      background: linear-gradient(135deg, rgba(74, 144, 217, 0.25) 0%, rgba(46, 95, 160, 0.2) 100%);
      color: #d6e4ff;
      font-size: 0.82rem;
      font-weight: 700;
      font-family: inherit;
      letter-spacing: 0.5px;
      cursor: pointer;
      transition: all 0.18s ease;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
      flex-shrink: 0;
    }
    .os-launch-btn:hover {
      background: linear-gradient(135deg, rgba(74, 144, 217, 0.5) 0%, rgba(46, 95, 160, 0.4) 100%);
      border-color: var(--accent, #4a90d9);
      color: #fff;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(74,144,217,.35), inset 0 1px 0 rgba(255,255,255,0.15);
    }
    .os-launch-btn:active { transform: translateY(0); }
    .os-launch-btn i { font-size: 0.9rem; }

    @media (max-width: 768px) {
      .os-launch-btn { display: none !important; }
    }
    /* ===== 桌面端侧边栏隐藏状态 ===== */
    @media (min-width: 769px) {
      .sidebar {
        transition: transform 0.3s ease !important;
      }
      body.sidebar-hidden-desktop .sidebar {
        transform: translateX(-100%) !important;
      }
      body.sidebar-hidden-desktop {
        padding-left: 0 !important;
      }
    }

    /* ===== 移动端 ===== */
    @media (max-width: 768px) {
      .topbar { padding: 0 12px !important; }
      .topbar-right { padding-right: 0; gap: 8px; align-items: center; }
      .clock { display: none !important; }
      .topbar-fullscreen-toggle { display: none !important; }
      .brand-name a { font-size: 14px !important; }
      .brand-text { font-size: 14px !important; }
      .user-box-avatar { width: 22px !important; height: 22px !important; }
      .user-box-name { font-size: 0.8rem; max-width: 90px; }
      .user-box-left { padding: 0 10px; }
      .user-box-right { width: 32px; font-size: 0.7rem; }
      .login-btn-header { font-size: 0.8rem; padding: 4px 12px; }
      .user-dropdown { right: 0; left: auto; min-width: 130px; }
    }
  `;
  document.head.appendChild(style);

  if (!document.querySelector('link[href*="font-awesome"]')) {
    const faLink = document.createElement('link');
    faLink.rel = 'stylesheet';
    faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css';
    document.head.appendChild(faLink);
  }
})();

// ============ 顶部进度条 ============
(function () {
  const bar = document.createElement('div');
  bar.id = 'top-progress';
  bar.style.cssText = `
    position: fixed; top: 0; left: 0; height: 3px; width: 0;
    background: linear-gradient(90deg, #4a90d9, #58a6ff);
    z-index: 99999; transition: width 0.2s ease, opacity 0.3s ease;
    box-shadow: 0 0 8px rgba(88,166,255,0.8); opacity: 0;
    pointer-events: none;
  `;
  document.documentElement.appendChild(bar);

  let timer = null;
  let width = 0;

  window.__startProgress = () => {
    clearInterval(timer);
    width = 0;
    bar.style.opacity = '1';
    bar.style.width = '0%';
    timer = setInterval(() => {
      const inc = (90 - width) * 0.1;
      width = Math.min(90, width + inc);
      bar.style.width = width + '%';
    }, 200);
  };

  window.__doneProgress = () => {
    clearInterval(timer);
    bar.style.width = '100%';
    setTimeout(() => {
      bar.style.opacity = '0';
      setTimeout(() => { bar.style.width = '0%'; }, 300);
    }, 200);
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const isPageNav = url && url.startsWith(location.origin) && !url.includes('/api/');
    if (isPageNav) {
      window.__startProgress();
      return origFetch.apply(this, args).finally(() => window.__doneProgress());
    }
    return origFetch.apply(this, args);
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || a.target === '_blank' || a.hasAttribute('download')) return;
    try {
      const url = new URL(href, location.href);
      if (url.origin === location.origin && url.pathname !== location.pathname) {
        window.__startProgress();
      }
    } catch {}
  });
})();
