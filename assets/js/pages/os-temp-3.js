/* ═══════════ OS 鎖屏邏輯（獨立於主程式） ═══════════ */
window.__setupOSLockScreen = function (options) {
  options = options || {};
  const onUnlock = typeof options.onUnlock === 'function' ? options.onUnlock : function(){};

  const lock        = document.getElementById('os-lock');
  const clockScreen = document.getElementById('osLockClockScreen');
  const loginScreen = document.getElementById('osLoginScreen');
  const timeEl      = document.getElementById('osLockTime');
  const dateEl      = document.getElementById('osLockDate');
  if (!lock) return;

  // ⭐ 每次加载都顯示鎖屏
  lock.style.display = 'flex';
  lock.style.opacity = '1';

  /* ── 時鐘 ── */
  function tick() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const MM = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    // ⭐ HH:MM + 小字秒
    timeEl.innerHTML = `${h}:${m}<span class="os-lock-sec">:${s}</span>`;
    dateEl.textContent = `${yyyy}-${MM}-${dd}`;
  }
  tick();
  const clockTimer = setInterval(tick, 1000);   // ⭐ 每秒更新

  /* ── 解鎖：淡出鎖屏 → 回調 onUnlock ── */
  let unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    clearInterval(clockTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer);

    // ⭐ 先啟動 OS 初始化（在鎖屏下方）
    onUnlock();

    if (typeof document.startViewTransition === 'function') {
      // ⭐ 無縫解鎖：View Transitions API
      //    瀏覽器快照鎖屏「之前」的樣子，執行回調（隱藏鎖屏），
      //    再快照「之後」的樣子，並在兩者之間播放過渡動畫。
      const transition = document.startViewTransition(() => {
        lock.style.display = 'none';
      });

      // 過渡結束後清理 view-transition-name（避免殘留）
      if (transition && transition.finished) {
        transition.finished.finally(() => {
          lock.style.viewTransitionName = 'none';
        });
      }
    } else {
      // ⭐ 降級方案：手動 CSS 動畫（不支援 API 的瀏覽器）
      lock.style.transition =
        'opacity .55s cubic-bezier(.4,0,.2,1), ' +
        'transform .55s cubic-bezier(.4,0,.2,1), ' +
        'filter .5s ease';
      requestAnimationFrame(() => {
        lock.style.opacity = '0';
        lock.style.transform = 'scale(1.08)';
        lock.style.filter = 'blur(10px)';
      });
      setTimeout(() => { lock.style.display = 'none'; }, 650);
    }
  }

  /* ── 階段切換：時鐘 → (已登入? 解鎖 : 登入表單) ── */
  let advanced = false;
  function advanceToLogin() {
    if (advanced || unlocked) return;
    advanced = true;
    clearInterval(clockTimer);

    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer);

    // ⭐ 已登入 → 直接解鎖進入 OS
    if (typeof isLoggedIn === 'function' && isLoggedIn()) {
      unlock();
      return;
    }

    // ⭐ 未登入 → 顯示登入表單
    clockScreen.style.transition = 'opacity .3s ease';
    clockScreen.style.opacity = '0';
    setTimeout(() => {
      clockScreen.style.display = 'none';
      loginScreen.style.display = '';
      setTimeout(() => {
        const un = document.getElementById('osLoginUsername');
        if (un) un.focus();
      }, 120);
    }, 300);
  }

  function onKey(e) {
    if (['Shift','Control','Alt','Meta','CapsLock','Tab'].includes(e.key)) return;
    advanceToLogin();
  }
  function onPointer(e) {
    if (e.button !== 0) return;
    advanceToLogin();
  }

  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer);
  clockScreen.addEventListener('click', advanceToLogin);

  /* ── 登入表單 ── */
  const form     = document.getElementById('osLoginForm');
  const usernameI= document.getElementById('osLoginUsername');
  const passwordI= document.getElementById('osLoginPassword');
  const submitBtn= document.getElementById('osLoginSubmit');
  const errorEl  = document.getElementById('osLoginError');
  const eyeBtn   = document.getElementById('osLoginEye');

  eyeBtn.addEventListener('click', () => {
    const isPwd = passwordI.type === 'password';
    passwordI.type = isPwd ? 'text' : 'password';
    eyeBtn.querySelector('i').className = isPwd ? 'fas fa-eye-slash' : 'fas fa-eye';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = usernameI.value.trim();
    const p = passwordI.value;
    if (!u || !p) {
      errorEl.textContent = 'Please enter both username and password';
      return;
    }

    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in…';

    try {
      const result = await window.login(u, p);
      if (result && result.success) {
        // ⭐ 登入成功 → 直接解鎖（不 reload）
        unlock();
      } else {
        errorEl.textContent = (result && result.message) || 'Invalid credentials';
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span class="os-login-submit-text">Sign In</span>';
        passwordI.value = '';
        passwordI.focus();
      }
    } catch (err) {
      errorEl.textContent = 'Network error. Please try again.';
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span class="os-login-submit-text">Sign In</span>';
    }
  });

  [usernameI, passwordI].forEach(inp => {
    inp.addEventListener('input', () => {
      if (errorEl.textContent) errorEl.textContent = '';
    });
  });

  document.getElementById('osLoginMs').addEventListener('click', () => {
    window.location.href = '/api/auth/microsoft';
  });
};
