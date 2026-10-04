// publichttps://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/auth.js
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  if (!token) return;

  // ⭐ 解析 payload，判断是不是真正的登录 token
  let payload;
  try {
    payload = JSON.parse(atob(token.split('.')[1]));
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

function isLoggedIn() {
  return !!getToken();
}

function getCurrentUser() {
  if (currentUser) return currentUser;
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
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
    }
    return data;
  } catch (err) {
    return { success: false, message: 'Network error' };
  }
}

function logout() {
  const token = getToken();
  if (token) {
    try {
      fetch('/api/heartbeat?action=offline', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        keepalive: true,
      }).catch(() => {});
    } catch (e) {}
  }

  // ⭐ 清除 root_persist cookie
  try {
    fetch('/api/root-session?action=logout', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
    }).catch(() => {});
  } catch (e) {}

  setToken(null);
  currentUser = null;
  window.location.href = '/';
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
    alert('Too many requests!');
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
    if (data.message && data.message.includes('banned')) {
      logout();
      alert('Account Banned');
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

// 初始化：检查 token 是否有效
(function() {
  const rawPath = window.location.pathname;
  const path = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;

  const isPublic =
    path === '/' || path === '/index.html' || path === '/404' || path === '/404.html' ||
    path === '/credits' || path === '/credits.html' ||
    path === '/guide' || path === '/guide.html' ||
    path === '/guides' || path === '/guides.html' || path === '/login' ||
    path === '/os' || path === '/os.html' || path === '/root-login' ||
    path.startsWith('/os') ||
    path === '/auth/forgot-password' || path === '/auth/reset-password' ||
    path === '/ranklist.html' || path === '/forgot-password.html' ||
    path === '/reset-password.html' || path.startsWith('/auth/');

  const token = getToken();

  // ── 有 token：驗證是否過期 ──
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 < Date.now()) {
        setToken(null);
        tryRestoreRootCookie(isPublic);
        return;
      }
      restoreSettings();
      return;
    } catch {
      setToken(null);
      tryRestoreRootCookie(isPublic);
      return;
    }
  }

  // ── 無 token：先嘗試用 root cookie 自動恢復 ──
  tryRestoreRootCookie(isPublic);
})();

// ⭐ 無 token 時嘗試用 root_persist cookie 換新 token
function tryRestoreRootCookie(isPublic) {
  fetch('/api/root-session', {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })
    .then(r => {
      if (!r.ok) throw new Error('no_session');
      return r.json();
    })
    .then(data => {
      if (data.success && data.token) {
        setToken(data.token);
        currentUser = null;          // 讓 getCurrentUser 重新解析
        location.reload();
        return;
      }
      throw new Error('bad_response');
    })
    .catch(() => {
      if (!isPublic) window.location.href = '/index.html';
      else restoreSettings();
    });
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