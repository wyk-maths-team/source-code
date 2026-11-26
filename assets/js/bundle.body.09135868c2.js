/* moj core bundle [body] · 8 files
 * 位置是语义的：head 段不碰 DOM，body 段必须在 <body> 之后执行。
 * 由 tools/build-bundle.mjs 生成，勿手改。
 * 关闭方式：localStorage.removeItem('moj:perf:bundle') */
/* auth.js */
// publichttps://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/auth.js
//
// ⭐ JWT payload 解码（必须用 base64url，不能用裸 atob）
//
// JWT 的 payload 段是 base64url（RFC 4648 §5）：'+' 写成 '-'，'/' 写成 '_'，
// 并省略末尾的 '='。而 atob() 只接受标准 base64，遇到 '-' 或 '_' 会直接抛
// InvalidCharacterError。
//
// 这里以前三个地方都是裸 atob(token.split('.')[1])，于是只要 payload 里恰好
// 出现这两个字符，解码就失败 —— 症状正是「登录成功但被当成未登录」：
// 登录接口返回 200、token 也确实写进了 localStorage，但下一页初始化解析失败，
// 逻辑把 token 删掉再跳回首页，全程没有任何提示。
// 是否复现取决于 payload 的具体字节，所以看起来像随机故障。
function b64urlToJson(part) {
  if (!part) throw new Error('empty jwt segment');
  var s = String(part).replace(/-/g, '+').replace(/_/g, '/');
  var pad = s.length % 4;
  if (pad === 1) throw new Error('bad jwt segment length');
  if (pad) s += new Array(5 - pad).join('=');
  var bin = atob(s);
  // JWT 规定 UTF-8：先取字节再按 UTF-8 解码，避免中文 displayName 变乱码
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  var json;
  try {
    json = new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    json = bin;
  }
  return JSON.parse(json);
}
function decodeJwtPayload(token) {
  return b64urlToJson(String(token || '').split('.')[1]);
}
window.decodeJwtPayload = decodeJwtPayload;
/**
 * 从地址栏读 token。
 *
 * 不用 URLSearchParams.get()：它把未编码的 '+' 解码成空格。JWT 本身是
 * base64url（不含 '+'），但复制粘贴、某些客户端/中间层重写 URL 时会把
 * '-' '_' 换回 '+' '/'，那一步之后 token 就会被拆成「含空格的一串」，
 * 存进 localStorage 后每个请求都带着坏 token —— 服务端只会回
 * "invalid token"（jsonwebtoken 的默认文案），前端再一匹配就 logout。
 * 这里把空格换回 '+'，至少让这一路还能救回来。
 */
function readUrlToken() {
  var m = /[?&]token=([^&]*)/.exec(window.location.search);
  if (!m) return null;
  var raw = m[1];
  try { raw = decodeURIComponent(raw); } catch (e) { /* 编码本身就是坏的，按原样用 */ }
  if (raw.indexOf(' ') >= 0) raw = raw.replace(/ /g, '+');
  return raw || null;
}
window.readUrlToken = readUrlToken;
(function() {
  const token = readUrlToken();
  if (!token) return;
  // ⭐ 解析 payload，判断是不是真正的登录 token
  let payload;
  try {
    payload = decodeJwtPayload(token);
  } catch {
    return;   // 不是合法 JWT，不管
  }
  // setup / reset token 有 action 字段，不是登录 token → 忽略
  if (payload.action === 'setup' || payload.action === 'reset') {
    return;   // ⭐ 让页面自己处理 URL 里的 token
  }
  // 真登录 token 必须有 username 和 role
  if (!payload.username || !payload.role) return;
  // 正常登录流程
  localStorage.setItem('auth_token', token);
  const newUrl = location.pathname + location.search.replace(/[?&]token=[^&]*/, '').replace(/^&/, '?');
  history.replaceState({}, document.title, newUrl);
  location.reload();
})();
let currentUser = null;
// 使用 localStorage 存储 token（跨标签页共享）
const TOKEN_KEY = 'auth_token';
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}
const BAN_KEY = 'ban_info';
function saveBanInfo(info) {
  try {
    if (!info || (!info.reason && !info.until && info.type !== 'manually')) {
      localStorage.removeItem(BAN_KEY);
      return;
    }
    localStorage.setItem(BAN_KEY, JSON.stringify(info));
  } catch (e) {}
}
function getBanInfo() {
  try {
    const raw = localStorage.getItem(BAN_KEY);
    if (!raw) return null;
    const info = JSON.parse(raw);
    // 限期封禁到期就自动作废，不用等后端再说一次
    if (info.until && new Date(info.until).getTime() <= Date.now()) {
      localStorage.removeItem(BAN_KEY);
      return null;
    }
    return info;
  } catch (e) { return null; }
}
function isBanned() { return !!getBanInfo(); }
function isLoggedIn() {
  return !!getToken();
}
function getCurrentUser() {
  if (currentUser) return currentUser;
  const token = getToken();
  if (!token) return null;
  try {
    const payload = decodeJwtPayload(token);
    if (payload.exp * 1000 < Date.now()) {
      setToken(null);
      return null;
    }
    currentUser = {
      username: payload.username,
      role: payload.role || 'student',
      displayName: payload.displayName || payload.username
    };
    return currentUser;
  } catch {
    return null;
  }
}
// 清除缓存用户对象（当 token 变化时调用）
function clearCurrentUser() {
  currentUser = null;
}
async function login(username, password) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      setToken(data.token);
      currentUser = data.user;
      // 封禁状态跟着登录结果一起落地：只有 index 能用，别的页面会被守卫踢回去。
      saveBanInfo(data.banned ? {
        type: data.banType || 'manually',
        reason: data.banReason || '',
        until: data.bannedUntil || null,
      } : null);
    }
    return data;
  } catch (err) {
    return { success: false, message: 'Network error' };
  }
}
function logout() {
  const token = getToken();
  // ⭐ 1. 通知後端離線
  // （HttpOnly cookie 前端 JS 讀不到，只能請後端清）
  if (token) {
    try {
      fetch('/api/heartbeat?action=offline', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        keepalive: true,
      }).catch(() => {});
    } catch (e) {}
  }
  // root-session 已永久取消：root_persist cookie 不再存在，无需清理。
  // ⭐ 2. 只清认证相关的 key
  //
  // 原来这里是 localStorage.clear() —— 清空全部。问题是这个函数不只由「用户点了
  // 登出」触发，任何一个 API 返回 401 且消息里带 unauthorized/expired 也会调它
  // （见下面的 apiCall）。于是一次token校验失败就把主题、字号、各种开关、
  // 还有 moj:perf:bundle 这个加载方式标记一起清了，用户重新登录后发现所有
  // 偏好都没了，还以为是设置坏了。
  //
  // 代码里一共用到 17 个 localStorage key，其中只有 auth_token 是认证状态。
  try {
    localStorage.removeItem('auth_token');
  } catch (e) {
    // 私密模式可能抛错，此时本来也删不掉，忽略
  }
  // ⭐ 3. 清 sessionStorage（全部）
  try {
    sessionStorage.clear();
  } catch (e) {
    try {
      Object.keys(sessionStorage).forEach(k => sessionStorage.removeItem(k));
    } catch {}
  }
  // ⭐ 4. 清所有 JS 可訪問的 cookie
  // （HttpOnly cookie 這裡清不到，但上面 API 已經請後端清了）
  try {
    const cookies = document.cookie ? document.cookie.split(';') : [];
    const paths = ['/', '/api', '/auth', location.pathname];
    // 判斷當前 domain（處理 subdomain）
    const host = location.hostname;
    const domains = [''];
    // 例如 moj.wyk.edu.hk → 也試 .wyk.edu.hk 和 .moj.wyk.edu.hk
    const parts = host.split('.');
    if (parts.length >= 2) {
      domains.push('.' + parts.slice(-2).join('.'));
    }
    if (parts.length >= 3) {
      domains.push('.' + parts.slice(-3).join('.'));
    }
    for (const raw of cookies) {
      const eq = raw.indexOf('=');
      if (eq < 0) continue;
      const name = raw.slice(0, eq).trim();
      if (!name) continue;
      // 對每個 path × domain 組合清一次
      for (const p of paths) {
        for (const d of domains) {
          const parts2 = [`${name}=`, 'expires=Thu, 01 Jan 1970 00:00:00 GMT', `path=${p}`];
          if (d) parts2.push(`domain=${d}`);
          document.cookie = parts2.join('; ');
        }
      }
    }
  } catch (e) {}
  // ⭐ 5. 清快取（Cache Storage）
  try {
    if ('caches' in window) {
      caches.keys().then(keys => {
        keys.forEach(k => caches.delete(k));
      }).catch(() => {});
    }
  } catch (e) {}
  // ⭐ 6. 清 IndexedDB（如果有用）
  try {
    if (indexedDB && indexedDB.databases) {
      indexedDB.databases().then(dbs => {
        dbs.forEach(db => {
          if (db.name) indexedDB.deleteDatabase(db.name);
        });
      }).catch(() => {});
    }
  } catch (e) {}
  // ⭐ 7. 記憶體狀態
  try {
    currentUser = null;
  } catch (e) {}
  // ⭐ 8. 跳轉（用 replace 避免用戶按「上一頁」回到已登入頁）
  window.location.replace('/');
}
async function apiCall(endpoint, method = 'GET', body = null) {
  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  if (res.status === 429) {
    // alert('Too many requests!');
    const data = await res.json().catch(() => ({ message: 'Too many requests' }));
    throw new Error(data.message || 'Too many requests');
  }
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}));
    if (data.message && (
      data.message.toLowerCase().includes('unauthorized') ||
      data.message.toLowerCase().includes('expired') ||
      data.message.toLowerCase().includes('invalid token')
    )) {
      logout();
      throw new Error('Session expired');
    }
    alert('Unauthorized: ' + (data.message || 'Please check login status!'));
    throw new Error(data.message || 'Unauthorized');
  }
  if (res.status === 403) {
    const data = await res.json();
    if (data.banned) {
      // 本地闸门挡下来的请求不算会话失效 —— 页面上已经有红色横幅了，
      // 再盖一层全屏遮挡只会让人没法读内容。
      if (data.guardBlocked) throw new Error('Banned');
      // 真的是服务端拒绝的，才走全屏那一屏
      if (window.BanScreen && window.BanScreen.show) {
        window.BanScreen.show({
          type: data.banType || 'manually',
          reason: data.banReason || '',
          until: data.bannedUntil || null,
        });
      }
      throw new Error('Banned');
    }
    if (data.message && /banned/i.test(data.message)) {
      throw new Error('Banned');
    }
    throw new Error(data.message || 'Forbidden');
  }
  if (!res.ok) {
    const errData = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(errData.message || `HTTP ${res.status}`);
  }
  return res.json();
}
// 监听 storage 事件（其他标签页修改 localStorage 时触发）
window.addEventListener('storage', (e) => {
  if (e.key === TOKEN_KEY) {
    // 清空缓存的用户对象，让 getCurrentUser 重新解析
    clearCurrentUser();
    // 可选：强制刷新 UI 或重载页面（但更好的方式是通过事件驱动）
    // 我们让 app.js 监听这个事件来更新 UI
    const event = new CustomEvent('authChanged', { detail: { token: e.newValue } });
    window.dispatchEvent(event);
  }
});
/**
 * 会话不可用时的统一出口。
 *
 * 公开页（首页、登录页、题库等）只是清掉本地状态，让人继续浏览；
 * 需要登录的页面才真的跳走，并带上 expired / invalid 让登录页给出对应文案。
 *
 * 之前这个函数被误删过，四处调用全在抛 ReferenceError，
 * 结果是 token 过期时页面既不跳转也不清状态，看起来像「登着但什么都没权限」。
 */
function bounceToLogin(isPublic, reason) {
  try { setToken(null); } catch (e) {}
  try { clearCurrentUser(); } catch (e) {}
  if (isPublic) return;
  var back = encodeURIComponent(location.pathname + location.search);
  var why = reason ? '&reason=' + encodeURIComponent(reason) : '';
  window.location.replace('/login.html?redirect=' + back + why);
}
// 初始化：检查 token 是否有效
(function() {
  const rawPath = window.location.pathname;
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  // 页面可以用 <meta name="requires-auth" content="false"> 自己声明为公开页，
  // 这样新增页面不需要回来改这份白名单。
  const _authMeta = document.querySelector('meta[name="requires-auth"]');
  const _declaredPublic = !!_authMeta && _authMeta.getAttribute('content') === 'false';
  const isPublic =
    _declaredPublic ||
    path === '/' || path === '/index.html' || path === '/404' || path === '/404.html' ||
    path === '/credits' || path === '/credits.html' ||
    path === '/guide' || path === '/guide.html' ||
    path === '/guides' || path === '/guides.html' || path === '/login' || path === '/login.html' ||
    path === '/os' || path === '/os.html' || path === '/root-login' ||
    path.startsWith('/os') ||
    path === '/auth/forgot-password' || path === '/auth/reset-password' ||
    path === '/ranklist.html' || path === '/leaderboard' || path === '/forgot-password.html' ||
    path === '/reset-password.html' || path.startsWith('/auth/');
  const token = getToken();
  // ── 有 token：驗證是否過期 ──
  if (token) {
    try {
      const payload = decodeJwtPayload(token);
      if (payload.exp * 1000 < Date.now()) {
        setToken(null);
        bounceToLogin(isPublic, 'expired');
        return;
      }
      restoreSettings();
      return;
    } catch (e) {
      // 解码失败分两种：token 真的损坏，或我们自己的解码出错。
      // 无论哪种都不该静默删掉 token 再跳首页 —— 那会让用户完全不知道
      // 发生了什么，看起来就像「登录了但没登录」。
      console.warn('[auth] token payload decode failed:', e);
      setToken(null);
      bounceToLogin(isPublic, 'invalid');
      return;
    }
  }
  // ── 無 token：先嘗試用 root cookie 自動恢復 ──
  // root-session 功能已永久取消：无 token 时直接按需登录处理
  bounceToLogin(isPublic, 'signed_out');
})();
// 已停用：root_persist cookie 自动登录（功能永久取消，保留空壳避免旧缓存页面报错）
function tryRestoreRootCookie(isPublic) {
  // root-session 永久取消：不再请求服务端，直接按「没有可恢复会话」处理。
  bounceToLogin(isPublic, 'signed_out');
}
function restoreSettings() {
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
  const uiType = localStorage.getItem('uiType') || 'default';
  if (uiType === 'type2') {
    document.documentElement.classList.add('ui-type2');
  } else {
    document.documentElement.classList.remove('ui-type2');
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
}
window.isLoggedIn = isLoggedIn;
window.getCurrentUser = getCurrentUser;
window.login = login;
window.getBanInfo = getBanInfo;
window.isBanned = isBanned;
window.saveBanInfo = saveBanInfo;
window.logout = logout;
window.apiCall = apiCall;
// ═══════════════════════════════════════════════════════
// ⭐ 跨页过渡：从登录页跳过来时，播放"揭幕"动画
// ═══════════════════════════════════════════════════════
(function () {
  let shouldPlay = false;
  try {
    shouldPlay = sessionStorage.getItem('__loginTransition') === '1';
    if (shouldPlay) sessionStorage.removeItem('__loginTransition');
  } catch { /* 隐私模式忽略 */ }
  if (!shouldPlay) return;
  const play = () => {
    const veil = document.createElement('div');
    veil.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'background:var(--accent,#337ab7)',
      'pointer-events:none',
      'clip-path:circle(160% at 50% 50%)',
    ].join(';');
    // 光晕层
    const glow = document.createElement('div');
    glow.style.cssText = [
      'position:absolute', 'inset:0',
      'background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.28) 0%,transparent 55%)',
      'opacity:.9',
      'transition:opacity .6s ease',
    ].join(';');
    veil.appendChild(glow);
    document.body.appendChild(veil);
    // 下一帧开始收缩
    requestAnimationFrame(() => {
      veil.style.transition = 'clip-path .65s cubic-bezier(.4,0,.2,1)';
      glow.style.opacity = '0';
      veil.style.clipPath = 'circle(0% at 50% 50%)';
      setTimeout(() => veil.remove(), 720);
    });
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', play);
  } else {
    play();
  }
})();
;
/* app.js */
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
// 系统消息不再用浮窗提示：它每次心跳都会重新弹出来，关掉也只安静到下 3 分钟，
// 结果就是没人再看。改由 heartbeat.js 点亮侧栏 Messages 的红点。
// pk 的通知弹窗在 pk-notify.js 里，与这里无关，保持原样。
;
/* topbar.js */
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
  // ⭐ 格式化数字（100K, 23M）
  function formatTokens(n) {
    if (n === undefined || n === null) return '0';
    const num = Number(n);
    if (isNaN(num)) return '0';
    const absNum = Math.abs(num);
    const sign = num < 0 ? '-' : '';
    if (absNum >= 1_000_000_000_000){
      return sign + (absNum / 1_000_000_000_000).toFixed(2).replace(/\.0$/, '') + 'T';
    }
    if (absNum >= 1_000_000_000){
      return sign + (absNum / 1_000_000_000).toFixed(2).replace(/\.0$/, '') + 'B';
    }
    if (absNum >= 1_000_000) {
      return sign + (absNum / 1_000_000).toFixed(2).replace(/\.0$/, '') + 'M';
    }
    if (absNum >= 10_000) {
      return sign + (absNum / 1_000).toFixed(0) + 'K';
    }
    if (absNum >= 1_000) {
      return sign + (absNum / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return sign + absNum;
  }
  // Token 图标。
  function tokenIcon(which, size) {
    let genshin = false;
    try { genshin = localStorage.getItem('genshinIcons') === 'true'; } catch (e) { genshin = false; }
    if (genshin) {
      const src = which === 'daily' ? '/assets/img/ml.png' : '/assets/img/ys.png';
      return `<img src="${src}" alt="" style="width:${size}px;height:${size}px;object-fit:contain;">`;
    }
    const cls = which === 'daily' ? 'fa-bolt' : 'fa-coins';
    return `<i class="fas ${cls}" style="color:#f1c40f;"></i>`;
  }
  // ⭐ 暴露全局更新方法，供其他地方直接调用
  window.updateTopbarTokens = function(daily, global) {
    if (!loggedIn) return;
    const displayEl = document.getElementById('tokenDisplay');
    const dailyExactEl = document.getElementById('tokenDailyExact');
    const globalExactEl = document.getElementById('tokenGlobalExact');
    if (displayEl) {
      const dailyCls = daily < 3000 ? '#d93025' : '#fff';
      const globalCls = global < 0 ? '#d93025' : '#00ff00';
      const oldHtml = displayEl.innerHTML;
      displayEl.innerHTML = `
        <span style="color:${dailyCls}; font-weight:bold; display: inline-flex; align-items: center; gap: 4px;" title="Daily Tokens: ${daily.toLocaleString()}">
          ${tokenIcon('daily', 16)} ${formatTokens(daily)}
        </span>
        <span style="margin:0 4px; opacity:0.4;">|</span>
        <span style="color:${globalCls}; font-weight:bold; display: inline-flex; align-items: center; gap: 4px;" title="Global Tokens: ${global.toLocaleString()}">
          ${tokenIcon('global', 16)} ${formatTokens(global)}
        </span>
      `;
      if (dailyExactEl) {
        dailyExactEl.textContent = daily.toLocaleString();
        dailyExactEl.style.color = daily < 3000 ? '#d93025' : '#fff';
      }
      if (globalExactEl) {
        globalExactEl.textContent = global.toLocaleString();
        globalExactEl.style.color = global < 0 ? '#d93025' : '#00ff00';
      }
      if (oldHtml !== '' && oldHtml !== displayEl.innerHTML) {
        displayEl.classList.remove('topbar-token-pop');
        void displayEl.offsetWidth;
        displayEl.classList.add('topbar-token-pop');
      }
    }
  };
  async function loadTokens() {
    if (!loggedIn) return;
    try {
      const res = await apiCall('/api/token');
      if (res.success) {
        window.updateTopbarTokens(res.daily, res.global);
      }
    } catch(e) {}
  }
  // ---------- 下拉切换（User） ----------
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
    const iconEl = document.querySelector('#fullscreenToggleBtn i');
    if (iconEl) {
      iconEl.className = hidden ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
    }
  }
  function toggleDesktopSidebar(e) {
    if (e) e.stopPropagation();
    if (window.innerWidth <= 768) return;
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
          ${isMobile?'':`<span class="brand-text">WYK Maths Team</span>`}
        </a>
      </span>
    </div>
    <div class="topbar-right">
  `;
  if (loggedIn) {
    topbarHTML += `
      <div class="token-menu" id="tokenMenu">
        <div id="tokenDisplay" class="token-display-box" title="Click for details"></div>
        <div id="tokenDropdown" class="token-dropdown">
          <div class="token-detail-row">
            <span>${tokenIcon('daily', 20)} Daily free:</span>
            <strong id="tokenDailyExact">0</strong>
          </div>
          <div class="token-detail-row">
            <span style="display: flex; align-items: center; gap: 6px;">
              ${tokenIcon('global', 20)}
              Global:
            </span>
            <strong id="tokenGlobalExact">0</strong>
          </div>
        </div>
      </div>
    `;
  }
  if (loggedIn) {
    topbarHTML += `
      <div class="user-menu" id="userMenu">
        <div class="user-box" id="userBox">
          <!-- 点击左边去 Profile -->
          <div class="user-box-left" id="userBoxLeft">
            <img id="userAvatar" src="" alt="avatar" class="user-box-avatar">
            <span id="currentUsername" class="user-box-name">${escapeHtml(displayUsername)}</span>
          </div>
          <!-- 点击右边开下拉 -->
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
    // ⭐ 添加了 align-items: center 强行垂直居中
    topbarHTML += `
      <div class="user-menu" id="userMenu" style="align-items: center;">
        <a href="/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}" class="login-btn-header">
          <i class="fa fa-sign-in-alt fa-fw"></i> Login
        </a>
      </div>
    `;
  }
  if (isMobile) {
    topbarHTML += `
      <button class="topbar-sidebar-toggle" id="mobileSidebarToggle" title="Menu">
        ☰
      </button>
    `;
  }
  topbarHTML += `
      <button class="topbar-fullscreen-toggle" id="fullscreenToggleBtn" title="Toggle sidebar">
        <i class="fa-solid fa-angles-left"></i>
      </button>
      <div class="clock">
        <span class="clock-time" id="clockTime">00:00:00</span>
      </div>
    </div>
  `;
  // ⭐ 渲染 HTML
  container.innerHTML = topbarHTML;
  // ==========================================
  // ⭐ 渲染完之后再绑定事件
  // ==========================================
  // 1. 绑定 Token 下拉事件
  const tokenDisplayBtn = document.getElementById('tokenDisplay');
  const tokenDropdownMenu = document.getElementById('tokenDropdown');
  const tokenMenuContainer = document.getElementById('tokenMenu');
  if (tokenDisplayBtn && tokenDropdownMenu) {
    tokenDisplayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = tokenDropdownMenu.style.display === 'block';
      tokenDropdownMenu.style.display = isVisible ? 'none' : 'block';
    });
    document.addEventListener('click', (e) => {
      if (tokenMenuContainer && !tokenMenuContainer.contains(e.target)) {
        tokenDropdownMenu.style.display = 'none';
      }
    });
  }
  // 2. 绑定其他事件
  const mobileToggle = document.getElementById('mobileSidebarToggle');
  if (mobileToggle) {
    mobileToggle.addEventListener('click', toggleSidebarMobile);
  }
  const fullscreenBtn = document.getElementById('fullscreenToggleBtn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleDesktopSidebar);
  }
  // ⭐ 拆分 User 的点击事件
  const userBoxLeft = document.getElementById('userBoxLeft');
  if (userBoxLeft) {
    userBoxLeft.addEventListener('click', (e) => {
      e.stopPropagation();
      if (realUsername !== 'guest') {
        window.location.href = `/users/${encodeURIComponent(realUsername)}`;
      }
    });
  }
  const userBoxArrow = document.getElementById('userBoxArrow');
  if (userBoxArrow) {
    userBoxArrow.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDropdown(e);
    });
  }
  const logoutBtn = document.getElementById('logoutBtnHeader');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      performLogout();
    });
  }
  window.toggleDropdown = toggleDropdown;
  window.performLogout = performLogout;
  document.addEventListener('click', closeDropdown);
  if (loggedIn && realUsername) {
    setTimeout(loadUserAvatar, 100);
  }
  if(loggedIn){
    setTimeout(loadTokens, 200);
  }
  try {
    if (window.innerWidth > 768 && localStorage.getItem(SIDEBAR_HIDDEN_KEY) === '1') {
      applyDesktopSidebarState(true);
    }
  } catch (e) { /* ignore */ }
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
    /* ===== 基础布局 ===== */
    .topbar { overflow-y: visible !important; z-index: 9998 !important; padding: 0 0 0 24px !important; }
    .topbar-right {
      display: flex;
      align-items: stretch;
      gap: 12px;
      height: 100%;
      padding-right: 24px;
    }
    .topbar-right > .clock,
    .topbar-right > .topbar-fullscreen-toggle {
      align-self: center;
    }
    /* ===== 用户框 ===== */
    .user-menu {
      position: relative;
      z-index: 9999 !important;
      /* 这里不设置 align-self: stretch，避免影响到内部按钮 */
      display: flex;
      height: 100%;
    }
    /* 针对已登录状态的 user-menu，继续保持拉伸 */
    #userMenu:has(.user-box) {
      align-self: stretch;
      align-items: stretch;
    }
    .user-box {
      display: flex;
      align-items: stretch;
      height: 100%;
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
      cursor: pointer;
    }
    .user-box-left:hover { background: rgba(255,255,255,0.08); }
    .user-box-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      object-fit: cover; display: none; flex-shrink: 0;
    }
    .user-box-name {
      font-weight: 500; font-size: 0.9rem; color: #ffffff;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;
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
      cursor: pointer;
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
      background: var(--card-bg, #fff);
      border-radius: var(--radius-sm, 6px);
      box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));
      min-width: 160px;
      overflow: hidden;
      z-index: 99999;
    }
    .user-dropdown .dropdown-item,
    .user-dropdown .logout-btn {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 11px 18px; background: var(--card-bg, #fff);
      color: var(--text-primary, #212529); text-decoration: none;
      font-size: 0.9rem; font-weight: 500; border: none; cursor: pointer;
      text-align: left; transition: background 0.15s;
    }
    .user-dropdown .dropdown-item:hover { background: #f0f2f5; }
    .user-dropdown .logout-btn { color: var(--danger, #dc3545); }
    .user-dropdown .logout-btn:hover { background: #fef2f2; }
    /* ===== 全屏按钮 ===== */
    .topbar-fullscreen-toggle {
      background: rgba(255,255,255,0.08); border: none; color: var(--topbar-text, #e0e0e0);
      width: 36px; height: 36px; border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.95rem; transition: background 0.2s;
    }
    .topbar-fullscreen-toggle:hover { background: rgba(255,255,255,0.18); color: #fff; }
    /* ⭐ 恢复蓝色，并在内部强制垂直居中 */
    .login-btn-header {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 34px; /* 定死高度 */
      padding: 0 16px;
      margin: 0;
      background: var(--accent, #4a90d9) !important; /* 恢复蓝色 */
      color: #fff !important;
      border: none; /* 蓝色按钮不要边框更干净 */
      border-radius: 20px;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 600;
      transition: background 0.2s ease;
      cursor: pointer;
    }
    .login-btn-header:hover {
      background: var(--accent-hover, #3a7bc8) !important; /* 恢复 hover 颜色 */
    }
    /* ===== 深色模式 ===== */
    [data-theme="dark"] .user-dropdown { background: #1e1e1e; border: 1px solid #444; }
    [data-theme="dark"] .user-dropdown .dropdown-item,
    [data-theme="dark"] .user-dropdown .logout-btn { background: #1e1e1e; color: #e0e0e0; }
    [data-theme="dark"] .user-dropdown .dropdown-item:hover,
    [data-theme="dark"] .user-dropdown .logout-btn:hover { background: #2a2a2a; }
    [data-theme="scifi"] .user-dropdown .dropdown-item:hover,
    [data-theme="scifi"] .user-dropdown .logout-btn:hover { background: #0f2231; }
    [data-theme="scifi"] .user-dropdown .logout-btn:hover { background: #2a1118; }
    [data-theme="dark"] .user-dropdown .logout-btn { color: #f85149; }
    [data-theme="dark"] .user-dropdown .logout-btn:hover { background: #3a1a1a; }
    /* ===== 桌面端侧边栏隐藏状态 ===== */
    @media (min-width: 769px) {
      .sidebar { transition: transform 0.3s ease !important; }
      body.sidebar-hidden-desktop .sidebar { transform: translateX(-100%) !important; }
      body.sidebar-hidden-desktop { padding-left: 0 !important; }
    }
    /* ===== Token 跳动特效 ===== */
    @keyframes tokenPop {
      0% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; text-shadow: 0 0 10px rgba(255,255,255,0.6); }
      100% { transform: scale(1); opacity: 1; }
    }
    .topbar-token-pop { animation: tokenPop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
    /* ===== Token 下拉菜单 ===== */
    .token-menu { position: relative; display: flex; align-items: center; margin-right: 15px; }
    .token-display-box {
      display: flex; align-items: center; font-family: monospace; font-size: 14px;
      background: rgba(255,255,255,0.08); padding: 4px 12px; border-radius: 12px;
      cursor: pointer; transition: background 0.15s; user-select: none;
    }
    .token-display-box:hover { background: rgba(255,255,255,0.15); }
    .token-dropdown {
      display: none; position: absolute; top: calc(100% + 8px); right: 0;
      background: #1e1e1e; border: 1px solid #444; border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5); min-width: 180px;
      z-index: 99999; padding: 6px 0;
    }
    .token-detail-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 16px; font-size: 13px; color: #ccc;
    }
    .token-detail-row strong { font-family: monospace; font-size: 14px; color: #fff; }
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
      .login-btn-header { font-size: 0.8rem; padding: 0 12px; height: 32px; }
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
;
/* sidebar.js */
// sidebar.js
(function() {
  console.log('sidebar.js executing...');
  const sidebar = document.getElementById('sidebarContainer');
  if (!sidebar) {
    console.warn('sidebarContainer not found');
    return;
  }
  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const isRoot  = user && user.role === 'root';
  const isAdmin = user && (user.role === 'admin' || user.role === 'root');
  const currentUser = getCurrentUser();
  const ownSubmissionsUrl = currentUser
    ? `/submissions/user/${encodeURIComponent(currentUser.username)}`
    : '/submissions';
  // ---- 管理員：單一入口 ----
  const adminMenu = `
    <li>
      <a href="/admin" class="sidebar-link require-login sidebar-link-admin" data-page="admin">
        <i class="fa-solid fa-shield-halved fa-fw"></i> Admin Dashboard
      </a>
    </li>
    <li>
      <a href="/reports" class="sidebar-link require-login sidebar-link-admin" data-page="admin-webreports">
        <i class="fa-solid fa-flag fa-fw"></i> Web Reports
      </a>
    </li>
    <li>
      <a href="/admin/solutions" class="sidebar-link require-login sidebar-link-admin" data-page="admin-solutions">
        <i class="fa-solid fa-lightbulb fa-fw"></i> Solutions
      </a>
    </li>
    <li>
      <a href="/admin/sysmessages" class="sidebar-link require-login sidebar-link-admin" data-page="admin-sysmessages">
        <i class="fa-solid fa-bullhorn fa-fw"></i> System Messages
      </a>
    </li>
    <li>
      <a href="/problem-reports" class="sidebar-link require-login sidebar-link-admin" data-page="admin-reports">
        <i class="fa-solid fa-triangle-exclamation fa-fw"></i> Problem Reports
      </a>
    </li>
    <li>
      <a href="/submission-reports" class="sidebar-link require-login sidebar-link-admin" data-page="admin-submission-reports">
        <i class="fa-solid fa-file-circle-exclamation fa-fw"></i> Submission Reports
      </a>
    </li>
    <li>
      <a href="/admin/grading" class="sidebar-link require-login sidebar-link-admin" data-page="admin-grading">
        <i class="fa-solid fa-list-check fa-fw"></i> Grading Queue
      </a>
    </li>
  `;
  // ═══════════════ 扩展导航 ═══════════════
  // 新增页面时只改这里（或用 npm run new:page 自动追加），不要再手写 li。
  // 字段：href / page / icon / label / adminOnly / guestOk / match
  const EXTRA_NAV = [
    { href: '/feedback', page: 'reports', icon: 'fa-flag', label: 'Reports' },
  ];
  function renderExtraNav() {
    return EXTRA_NAV
      .filter((it) => !it.adminOnly || isAdmin)
      .map((it) => {
        const cls = 'sidebar-link' + (it.guestOk ? '' : ' require-login');
        return '<li><a href="' + it.href + '" class="' + cls + '" data-page="' + it.page + '"><i class="fa-solid ' + it.icon + ' fa-fw"></i> ' + it.label + '</a></li>';
      })
      .join('\n        ');
  }
  const sidebarHTML = `
    <nav class="sidebar-nav">
      <ul>
        <li><a href="/problems" class="sidebar-link require-login" data-page="problems"><i class="fa-solid fa-list-check fa-fw"></i> Problems</a></li>
        <li><a href="${ownSubmissionsUrl}" class="sidebar-link require-login" data-page="submissions"><i class="fa-solid fa-paper-plane fa-fw"></i> Your Submissions</a></li>
        <li><a href="/submissions" class="sidebar-link require-login" data-page="all-submissions"><i class="fa-solid fa-pen-to-square fa-fw"></i> All Submissions</a></li>
        <li><a href="/leaderboard" class="sidebar-link require-login" data-page="ranklist"><i class="fa-solid fa-ranking-star fa-fw"></i> Leaderboard</a></li>
        <li><a href="/course" class="sidebar-link require-login fx-course" data-page="course"><i class="fa-solid fa-graduation-cap fa-fw"></i> Course</a></li>
        <li><a href="/resources" class="sidebar-link require-login" data-page="resources"><i class="fa-solid fa-folder-open fa-fw"></i> Resources</a></li>
        <li><a href="/contest" class="sidebar-link require-login" data-page="contest"><i class="fa-solid fa-trophy fa-fw"></i> Contests</a></li>
        ${isAdmin ? `
          <li><hr style="margin:8px 0; border-color:rgba(255,255,255,0.2);"></li>
          ${adminMenu}
          <li><hr style="margin:8px 0; border-color:rgba(255,255,255,0.2);"></li>
        ` : ''}
        <li><a href="/settings" class="sidebar-link require-login" data-page="template"><i class="fa-solid fa-gear fa-fw"></i> Settings</a></li>
        <!-- Messages 放在 Settings 下面：原来埋在底部的 EXTRA_NAV 里没人点，
             393 条系统通知积到没人看。红点由 heartbeat 按未读数点亮。 -->
        <li><a href="/messages" class="sidebar-link require-login" data-page="messages"><i class="fa-solid fa-envelope fa-fw"></i> Messages<span class="nav-dot" id="navMsgDot" hidden></span></a></li>
        <li><a href="/tokens" class="sidebar-link require-login" data-page="tokens"><i class="fa-solid fa-coins fa-fw"></i></i> Tokens</a></li>
        <li><a href="/credits" class="sidebar-link" data-page="credits"><i class="fa-solid fa-heart fa-fw"></i> Credits</a></li>
        <li><a href="/guide" class="sidebar-link" data-page="guide"><i class="fa-solid fa-book-open fa-fw"></i> Guides</a></li>
        ${renderExtraNav()}
      </ul>
    </nav>
  `;
  sidebar.innerHTML = sidebarHTML;
  const isWide = window.innerWidth > 768;
  let isOpen;
  if (isWide) {
    isOpen = true;
  } else {
    const saved = localStorage.getItem('sidebarOpen');
    isOpen = saved === null ? false : saved === 'true';
  }
  if (!isWide) {
    sidebar.style.position = 'fixed';
    sidebar.style.top = 'var(--topbar-height)';
    sidebar.style.left = '0';
    sidebar.style.width = '100%';
    sidebar.style.height = 'calc(100vh - var(--topbar-height))';
    sidebar.style.transform = 'translateY(-100%)';
    sidebar.style.transition = 'transform 0.3s ease';
    sidebar.style.overflowY = 'auto';
    sidebar.style.zIndex = '9999';
    sidebar.style.display = isOpen ? 'block' : 'none';
  }
  sidebar.style.transition = 'none';
  if (isOpen) {
    sidebar.classList.add('open');
    document.body.classList.remove('sidebar-closed');
    if (!isWide) {
      sidebar.style.transform = 'translateY(0)';
      sidebar.style.display = 'block';
    }
  } else {
    sidebar.classList.remove('open');
    document.body.classList.add('sidebar-closed');
    if (!isWide) {
      sidebar.style.transform = 'translateY(-100%)';
      sidebar.style.display = 'none';
    }
  }
  void sidebar.offsetHeight;
  sidebar.style.transition = '';
  function saveSidebarState(open) {
    if (!isWide) localStorage.setItem('sidebarOpen', open);
  }
  function toggleSidebar() {
    if (isWide) return;
    const nowOpen = sidebar.classList.contains('open');
    if (nowOpen) {
      sidebar.classList.remove('open');
      sidebar.style.transform = 'translateY(-100%)';
      document.body.classList.add('sidebar-closed');
      const onTransitionEnd = () => {
        sidebar.removeEventListener('transitionend', onTransitionEnd);
        if (!sidebar.classList.contains('open')) sidebar.style.display = 'none';
      };
      sidebar.addEventListener('transitionend', onTransitionEnd);
      saveSidebarState(false);
    } else {
      sidebar.style.display = 'block';
      void sidebar.offsetHeight;
      sidebar.classList.add('open');
      sidebar.style.transform = 'translateY(0)';
      document.body.classList.remove('sidebar-closed');
      saveSidebarState(true);
    }
  }
  window.toggleSidebar = toggleSidebar;
  const toggleBtn = document.getElementById('sidebarToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleSidebar);
    if (isWide) toggleBtn.style.display = 'none';
  }
  let currentIsWide = isWide;
  window.addEventListener('resize', () => {
    const nowWide = window.innerWidth > 768;
    if (nowWide !== currentIsWide) {
      currentIsWide = nowWide;
      if (nowWide) {
        sidebar.style.position = '';
        sidebar.style.top = '';
        sidebar.style.left = '';
        sidebar.style.width = '';
        sidebar.style.height = '';
        sidebar.style.transform = '';
        sidebar.style.transition = '';
        sidebar.style.overflowY = '';
        sidebar.style.zIndex = '';
        sidebar.style.display = '';
        sidebar.classList.add('open');
        document.body.classList.remove('sidebar-closed');
        if (toggleBtn) toggleBtn.style.display = 'none';
      } else {
        sidebar.style.position = 'fixed';
        sidebar.style.top = 'var(--topbar-height)';
        sidebar.style.left = '0';
        sidebar.style.width = '100%';
        sidebar.style.height = 'calc(100vh - var(--topbar-height))';
        sidebar.style.transform = 'translateY(-100%)';
        sidebar.style.transition = 'transform 0.3s ease';
        sidebar.style.overflowY = 'auto';
        sidebar.style.zIndex = '9999';
        const saved = localStorage.getItem('sidebarOpen');
        const shouldOpen = saved === null ? false : saved === 'true';
        if (shouldOpen) {
          sidebar.style.display = 'block';
          sidebar.classList.add('open');
          sidebar.style.transform = 'translateY(0)';
          document.body.classList.remove('sidebar-closed');
        } else {
          sidebar.style.display = 'none';
          sidebar.classList.remove('open');
          sidebar.style.transform = 'translateY(-100%)';
          document.body.classList.add('sidebar-closed');
        }
        if (toggleBtn) toggleBtn.style.display = '';
      }
    }
  });
  // ---- Active 高亮 ----
  const path = window.location.pathname;
  const links = sidebar.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    const page = link.getAttribute('data-page');
    // Admin Dashboard：只要路徑以 /admin 開頭就高亮
    if (page === 'admin' && path.startsWith('/admin')) {
      link.classList.add('active');
      return;
    }
    if (page === 'problems' && path.startsWith('/problems')) link.classList.add('active');
    else if (page === 'resources' && path.startsWith('/resources')) link.classList.add('active');
    else if (page === 'submissions' && path.startsWith('/submissions/user')) link.classList.add('active');
    else if (page === 'all-submissions' && path === '/submissions') link.classList.add('active');
    else if (page === 'ranklist' && path.startsWith('/leaderboard')) link.classList.add('active');
    else if (page === 'template' && path.startsWith('/settings')) link.classList.add('active');
    else if (page === 'credits' && path.startsWith('/credits')) link.classList.add('active');
    else if (page === 'contest' && path.startsWith('/contest')) link.classList.add('active');
    else if (page === 'guide' && path.startsWith('/guide')) link.classList.add('active');
    else if (page === 'token'&& path.startsWith('/tokens')) link.classList.add('active');
    else {
      // 扩展导航（EXTRA_NAV）：按 match / href 前缀自动高亮
      const extra = EXTRA_NAV.find((it) => it.page === page);
      if (extra) {
        const prefix = extra.match || extra.href;
        if (path === extra.href || path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/')) {
          link.classList.add('active');
        }
      }
    }
  });
  links.forEach(link => {
    link.addEventListener('click', function() {
      if (!isWide && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        sidebar.style.transform = 'translateY(-100%)';
        document.body.classList.add('sidebar-closed');
        const onEnd = () => {
          sidebar.removeEventListener('transitionend', onEnd);
          if (!sidebar.classList.contains('open')) sidebar.style.display = 'none';
        };
        sidebar.addEventListener('transitionend', onEnd);
        saveSidebarState(false);
      }
    });
  });
  // ---- 未登入攔截 ----
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.require-login');
    if (link && typeof isLoggedIn === 'function' && !isLoggedIn()) {
      e.preventDefault();
      const currentPath = window.location.pathname + window.location.search;
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
    }
  });
})();
// 預取
// (function () {
//   const prefetched = new Set();
//   let hoverTimer = null;
//   function prefetch(url) {
//     if (prefetched.has(url)) return;
//     prefetched.add(url);
//     fetch(url, { priority: 'low' }).catch(() => {});
//   }
//   document.addEventListener('mouseover', (e) => {
//     const a = e.target.closest('a');
//     if (!a) return;
//     const href = a.getAttribute('href');
//     if (!href) return;
//     if (a.target && a.target !== '_self') return;
//     if (a.hasAttribute('download')) return;
//     let url;
//     try { url = new URL(href, location.href); } catch { return; }
//     if (url.origin !== location.origin) return;
//     if (url.pathname === location.pathname) return;
//     clearTimeout(hoverTimer);
//     hoverTimer = setTimeout(() => prefetch(url.href), 100);
//   });
//   document.addEventListener('mouseout', () => clearTimeout(hoverTimer));
//   document.addEventListener('touchstart', (e) => {
//     const a = e.target.closest('a');
//     if (!a) return;
//     try {
//       const url = new URL(a.href, location.href);
//       if (url.origin === location.origin) prefetch(url.href);
//     } catch {}
//   }, { passive: true });
// })();
;
/* core/polling.js */
// assets/js/core/polling.js
//
// 前端轮询节奏的唯一来源。
//
// 为什么值得单独一个文件：这里的每个数字都会乘上在线人数，变成 Vercel 的函数调用量。
// 30 个人同时开着页面、每 60 秒轮询一次 = 每分钟 30 次回源；
// 把某个值从 60 秒改成 1.5 秒，同一个按钮就让月配额涨 40 倍。
// 这类数字散落在各个页面里时，没人会去算这笔账；集中到一个具名常量上，
// 改动前至少得先看一眼前面的注释。
//
// 用法：
//   var P = window.__POLL__ || {};
//   setInterval(poll, P.homeRecentAc || 60_000);
//
// 页面可以在加载本文件之前设置 window.__POLL__ 来覆盖（心跳那边原本就有
// window.__HB_CONFIG__ 的机制，这里保持一致的思路）。
(function () {
  'use strict';
  var DEFAULTS = {
    // 首页「最近 AC」列表 + 累计 token
    homeRecentAc: 60_000,
    // 多久没有交互就停刷（切标签页、人离开）
    homeIdle: 60_000,
    // 在线心跳：告诉服务端「我还在这儿」
    heartbeat: 180_000,
    // 多久内有交互才算活跃（低于心跳间隔会给每次 tick 都发）
    heartbeatActivity: 180_000,
    // PK 邀请红点
    pkInvite: 180_000,
    // PK 通知角标
    pkNotify: 20_000,
    // PK 房间内：对手在动 vs 静止，两种节奏
    pkRoomMoving: 5_000,
    pkRoomStill: 15_000,
    // 多久没操作就把 PK 房间轮询休眠
    pkRoomIdle: 120_000,
  };
  window.__POLL__ = Object.assign({}, DEFAULTS, window.__POLL__ || {});
  // ── 硬下限 ──
  // 任何人想往轮询里塞一个 1.5 秒的间隔，都会先在控制台看到这条警告。
  // 3 秒是「毫秒级体验」和「别把配额烧光」之间的分界线：
  // 低于这个值的轮询，用户感知不到差别，账单却能差一个数量级。
  var MIN_INTERVAL_MS = 3_000;
  Object.keys(window.__POLL__).forEach(function (key) {
    var v = Number(window.__POLL__[key]);
    if (!Number.isFinite(v) || v <= 0) {
      window.__POLL__[key] = DEFAULTS[key];
      return;
    }
    if (v < MIN_INTERVAL_MS && /Ms$|Idle$|RecentAc$|heartbeat$|Notify$|Invite$|Moving$|Still$/.test(key)) {
      console.warn('[poll] ' + key + '=' + v + 'ms 低于下限，已提升到 ' + MIN_INTERVAL_MS + 'ms');
      window.__POLL__[key] = MIN_INTERVAL_MS;
    }
  });
})();
;
/* heartbeat.js */
// resources/script/heartbeat.js
// 实时在线状态上报：用户有活动时，每 N 分钟向服务器打一次卡
(function () {
  'use strict';
  // 间隔来自 core/polling.js（全站唯一来源）；__HB_CONFIG__ 仍可覆盖
  const POLL = window.__POLL__ || {};
  const CFG = Object.assign({
    intervalMs:   POLL.heartbeat || 180_000,          // 每 3 分钟 tick 一次
    activityMs:   POLL.heartbeatActivity || 180_000,  // 3 分钟内还有活动才算
    minMovePx:    5,
    initialDelay: 5_000,
  }, window.__HB_CONFIG__ || {});
  let lastActivityAt = Date.now();
  let lastMouseX = null, lastMouseY = null;
  function markActivity() { lastActivityAt = Date.now(); }
  function hasRecentActivity() { return Date.now() - lastActivityAt < CFG.activityMs; }
  // 鼠标移动（带阈值）
  document.addEventListener('mousemove', (e) => {
    if (lastMouseX === null) {
      lastMouseX = e.clientX; lastMouseY = e.clientY;
      markActivity();
      return;
    }
    if (Math.abs(e.clientX - lastMouseX) > CFG.minMovePx ||
        Math.abs(e.clientY - lastMouseY) > CFG.minMovePx) {
      lastMouseX = e.clientX; lastMouseY = e.clientY;
      markActivity();
    }
  }, { passive: true });
  // 其他活动
  ['keydown', 'click', 'touchstart', 'scroll', 'wheel'].forEach(evt =>
    document.addEventListener(evt, markActivity, { passive: true }));
  // 从后台切回前台
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') markActivity();
  });
  async function tick() {
    if (!hasRecentActivity()) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    try {
      const res = await fetch('/api/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
      });
      const data = await res.json();
      updateMessageDot(Number(data.unreadMessages) || 0);
    } catch (e) { /* 静默 */ }
  }
  // 未读数点亮侧栏 Messages 的红点。
  //
  // 这里原本弹一个右下角的「System Alert」浮窗，每次心跳都检查一遍、
  // 关掉之后下一轮又弹。学生的反应是不看，210 条系统通知就这么积着。
  // 改成安静的红点：不打断、不重复弹，想点的时候点。
  function updateMessageDot(count) {
    var el = document.getElementById('navMsgDot');
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }
  // 进过 messages 页就立刻清掉，不等下一次心跳
  function clearMessageDot() { updateMessageDot(0); }
  window.__clearMessageDot = clearMessageDot;
  // 启动
  setTimeout(tick, CFG.initialDelay);
  setInterval(tick, CFG.intervalMs);
  // 对外暴露（调试用）
  window.__heartbeat = { tick, markActivity, getLastActivity: () => lastActivityAt };
})();
;
/* pk-invite-widget.js */
/*
 * ═══════════════════════════════════════════════════════════════════════
 * 【已停用 — 全文注释，请勿恢复】
 *
 * 本文件是 assets/js/heartbeat.js 的完整逐行副本，不含任何「PK 邀请」逻辑。
 * 它曾被注入全部 24 个页面，与 heartbeat.js 同时执行，导致每个页面都发起
 * 两次 POST /api/heartbeat —— 这就是「所有页面双心跳」的原因。
 *
 * 心跳功能请统一使用 assets/js/heartbeat.js，本文件仅作历史保留。
 * 原文件大小 63 行，以下为原内容（已注释，不会执行）：
 * ═══════════════════════════════════════════════════════════════════════
 *
// resources/script/heartbeat.js
// 实时在线状态上报：用户有活动时，每 N 分钟向服务器打一次卡
(function () {
  'use strict';
const CFG = Object.assign({
  intervalMs:   (window.__POLL__ || {}).pkInvite || 180_000,   // 每 3 分钟 tick 一次
  activityMs:   180_000,   // 3 分钟内有活动才算「活跃」
  minMovePx:    5,
  initialDelay: 5_000,
}, window.__HB_CONFIG__ || {});
  let lastActivityAt = Date.now();
  let lastMouseX = null, lastMouseY = null;
  function markActivity() { lastActivityAt = Date.now(); }
  function hasRecentActivity() { return Date.now() - lastActivityAt < CFG.activityMs; }
  // 鼠标移动（带阈值）
  document.addEventListener('mousemove', (e) => {
    if (lastMouseX === null) {
      lastMouseX = e.clientX; lastMouseY = e.clientY;
      markActivity();
      return;
    }
    if (Math.abs(e.clientX - lastMouseX) > CFG.minMovePx ||
        Math.abs(e.clientY - lastMouseY) > CFG.minMovePx) {
      lastMouseX = e.clientX; lastMouseY = e.clientY;
      markActivity();
    }
  }, { passive: true });
  // 其他活动
  ['keydown', 'click', 'touchstart', 'scroll', 'wheel'].forEach(evt =>
    document.addEventListener(evt, markActivity, { passive: true }));
  // 从后台切回前台
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') markActivity();
  });
  async function tick() {
    if (!hasRecentActivity()) return;                 // 没活动 → 不发
    const token = localStorage.getItem('auth_token');
    if (!token) return;                               // 没登录 → 不发
    try {
      await fetch('/api/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
      });
    } catch (e) { /* 静默（原注释结束符已移除，避免截断外层块注释） }
  }
  // 启动
  setTimeout(tick, CFG.initialDelay);
  setInterval(tick, CFG.intervalMs);
  // 对外暴露（调试用）
  window.__heartbeat = { tick, markActivity, getLastActivity: () => lastActivityAt };
})();
 *
 * ═══════════════════════════════════════════════════════════════════════
 */
;
/* pk-notify.js */
// assets/js/pk-notify.js
//
// 全局 PK 邀请通知。
//
// 背景：原先只有「邀请详情页」(pk-invite.html) 能接受邀请 —— 必须由发起方
// 把链接分享给你，你点进去才看得到。没有任何地方在你已经打开的页面上提醒
// 有人邀请你，所以从被邀请者的视角，PK 邀请几乎是「不存在」的。
//
// 这个脚本做三件事：
//   1. 每 20 秒问一次 /api/pk?action=pending
//   2. 收到 incoming 邀请时弹出卡片，可当场接受/拒绝
//   3. 接受后直接跳到 PK 房间
//
// 刻意保持克制：无邀请时完全不渲染任何 DOM；同一条邀请只弹一次（关闭后不会
// 因为下一轮轮询又弹）；在 /pk/ 相关页面与邀请详情页不启动，避免重复与干扰。
(function () {
  'use strict';
  if (window.__pkNotifyLoaded) return;
  window.__pkNotifyLoaded = true;
  var POLL_MS = (window.__POLL__ || {}).pkNotify || 20000;
  var FIRST_DELAY_MS = 3000;
  var DISMISS_KEY = 'pk_notify_dismissed';   // 记住被关掉的邀请 id
  var pollTimer = null;
  var currentInvite = null;
  var overlayEl = null;
  var dismissedId = null;
  function path() {
    return location.pathname.replace(/\/+$/, '') || '/';
  }
  // 这些页面自己就在处理邀请/房间，全局提醒只会添乱
  function shouldSkip() {
    var p = path();
    if (p.indexOf('/pk/') === 0 && p !== '/pk') return true;
    if (p.indexOf('pk-') === 0) return true;          // pk-room / pk-waiting / pk-invite
    if (p.indexOf('/pk-') >= 0) return true;
    if (localStorage.getItem('pkInviteEnabled')==='true')return true;
    if (localStorage.getItem('pkInviteEnabled')==='false'||!localStorage.getItem('pkInviteEnabled'))return false;
    return false;
  }
  function esc(s) {
    if (window.DSHUI && window.DSHUI.esc) return window.DSHUI.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function api(url, method, body) {
    if (typeof window.apiCall === 'function') return window.apiCall(url, method, body);
    return fetch(url, {
      method: method || 'GET',
      headers: (function () {
        var h = { 'Content-Type': 'application/json' };
        var t = localStorage.getItem('auth_token');
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
      })(),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json(); });
  }
  function tryRestoreDismissed() {
    try { dismissedId = localStorage.getItem(DISMISS_KEY); } catch (e) { dismissedId = null; }
  }
  function rememberDismissed(id) {
    dismissedId = id;
    try { localStorage.setItem(DISMISS_KEY, id || ''); } catch (e) {}
  }
  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }
  function render(invite) {
    removeOverlay();
    currentInvite = invite;
    var from = invite.fromDisplay || invite.from || 'Someone';
    var stake = Number(invite.stake) || 0;
    var secLeft = Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 1000));
    // 跟着站点主题走：暗色用深紫渐变，浅色用淡紫渐变
    var dark = document.documentElement.getAttribute('data-theme');
    var bg = dark
      ? 'linear-gradient(135deg,#221a38 0%,#171226 100%)'
      : 'linear-gradient(135deg,#ffffff 0%,#f4eefc 100%)';
    var textColor = dark ? '#e8e2f7' : '#2b2340';
    var subColor = dark ? 'rgba(232,226,247,.65)' : '#6b6183';
    var wrap = document.createElement('div');
    wrap.id = 'pkNotifyOverlay';
    wrap.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:99999',
      'width:320px', 'max-width:calc(100vw - 36px)',
      'background:' + bg,
      'color:' + textColor,
      'border:1px solid rgba(125,91,176,.35)',
      'border-left:4px solid #8e5cf7',
      'border-radius:12px',
      'box-shadow:0 12px 34px rgba(93,58,168,.28)',
      'padding:14px 14px 12px',
      'font-size:14px',
      'animation:pkNotifyIn .18s ease-out'
    ].join(';');
    wrap.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:10px;">' +
        '<div style="font-size:20px;line-height:1;color:#8e5cf7;"><i class="fas fa-swords"></i></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:700;margin-bottom:2px;">PK invitation</div>' +
          '<div style="font-size:13px;color:' + subColor + ';word-break:break-word;">' +
            esc(from) + ' wants to challenge you' +
          '</div>' +
          (stake ? '<div style="font-size:13px;margin-top:3px;">Stake: <b>' + stake.toLocaleString() + '</b> tokens</div>' : '') +
          '<div id="pkNotifyTtl" style="font-size:12px;color:' + subColor + ';margin-top:4px;">' +
            (secLeft > 0 ? ('expires in ' + secLeft + 's') : 'expired') +
          '</div>' +
        '</div>' +
        '<button id="pkNotifyClose" type="button" title="Dismiss" ' +
          'style="background:none;border:none;color:var(--text-secondary,#888);cursor:pointer;font-size:16px;line-height:1;padding:0 2px;">×</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button id="pkNotifyAccept" class="btn" type="button" ' +
          'style="flex:1;padding:8px 0;border:none;border-radius:8px;font-weight:700;color:#fff;' +
          'background:linear-gradient(135deg,#9b6cf7,#6a3fc9);box-shadow:0 4px 12px rgba(106,63,201,.35);">Accept</button>' +
        '<button id="pkNotifyDecline" class="btn" type="button" ' +
          'style="flex:1;padding:8px 0;border-radius:8px;font-weight:600;color:' + (dark ? '#e8e2f7' : '#5b4a7d') + ';' +
          'background:transparent;border:1px solid rgba(125,91,176,.45);">Decline</button>' +
      '</div>';
    if (!document.getElementById('pkNotifyStyle')) {
      var st = document.createElement('style');
      st.id = 'pkNotifyStyle';
      st.textContent = '@keyframes pkNotifyIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(st);
    }
    document.body.appendChild(wrap);
    overlayEl = wrap;
    document.getElementById('pkNotifyClose').onclick = function () {
      rememberDismissed(invite.id);
      removeOverlay();
    };
    document.getElementById('pkNotifyAccept').onclick = function () {
      acceptInvite(invite, this, document.getElementById('pkNotifyDecline'));
    };
    document.getElementById('pkNotifyDecline').onclick = function () {
      declineInvite(invite, document.getElementById('pkNotifyAccept'), this);
    };
    // 本地倒计时，到期自动收起（不用等下一轮轮询）
    var ttlEl = document.getElementById('pkNotifyTtl');
    var tick = setInterval(function () {
      if (!document.body.contains(wrap)) { clearInterval(tick); return; }
      var left = Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 1000));
      if (left <= 0) {
        clearInterval(tick);
        if (ttlEl) ttlEl.textContent = 'expired';
        removeOverlay();
        return;
      }
      if (ttlEl) ttlEl.textContent = 'expires in ' + left + 's';
    }, 1000);
  }
  function acceptInvite(invite, btnA, btnD) {
    btnA.disabled = btnD.disabled = true;
    btnA.textContent = 'Accepting…';
    api('/api/pk-bet?action=accept', 'POST', { inviteId: invite.id })
      .then(function (res) {
        if (res && res.success && res.roomId) {
          rememberDismissed('');
          location.href = '/pk-bet-room?id=' + encodeURIComponent(res.roomId);
        } else {
          btnA.disabled = btnD.disabled = false;
          btnA.textContent = 'Accept';
          if (window.DSHUI && DSHUI.toast) DSHUI.toast((res && res.message) || 'Failed to accept', 'err');
        }
      })
      .catch(function () {
        btnA.disabled = btnD.disabled = false;
        btnA.textContent = 'Accept';
        if (window.DSHUI && DSHUI.toast) DSHUI.toast('Network error', 'err');
      });
  }
  function declineInvite(invite, btnA, btnD) {
    btnA.disabled = btnD.disabled = true;
    api('/api/pk-bet?action=decline', 'POST', { inviteId: invite.id })
      .catch(function () {})
      .then(function () {
        rememberDismissed(invite.id);
        removeOverlay();
      });
  }
  function poll() {
    if (shouldSkip()) return;
    if (!localStorage.getItem('auth_token')) return;
    api('/api/pk-bet?action=pending').then(function (res) {
      if (!res || !res.success) return;
      var inv = res.incoming;
      if (!inv) {
        if (overlayEl) removeOverlay();
        currentInvite = null;
        return;
      }
      // 已经因为关闭而记住这条邀请，就别再弹
      if (inv.id === dismissedId) return;
      // 同一条已经在显示
      if (overlayEl && currentInvite && currentInvite.id === inv.id) return;
      render(inv);
    }).catch(function () {});
  }
  function start() {
    tryRestoreDismissed();
    if (shouldSkip()) return;
    if (!localStorage.getItem('auth_token')) return;
    setTimeout(function () {
      poll();
      pollTimer = setInterval(poll, POLL_MS);
    }, FIRST_DELAY_MS);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
