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
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
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
