(function () {
  'use strict';

  if (!isLoggedIn()) { window.location.href = '/index.html'; return; }

  const $ = id => document.getElementById(id);

  function showMsg(id, text, ok = true) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'message ' + (ok ? 'ok' : 'err');
    el.style.display = 'block';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  // ⭐ 侧边栏切换逻辑
  const NAV = {
    init() {
      document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
          // 移除所有 active
          document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
          document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
          
          // 添加当前 active
          item.classList.add('active');
          $(`tab-${item.dataset.tab}`).classList.add('active');
        });
      });
    }
  };

  // ═══════════════ [A] Appearance ═══════════════
  const APPEARANCE = {
    load() {
      $('themeSelect').value = localStorage.getItem('theme') || 'light';
      $('fontSizeSelect').value = localStorage.getItem('fontSize') || '16';
      $('compactToggle').checked = localStorage.getItem('compactMode') === 'true';
      $('animationToggle').checked = localStorage.getItem('animations') !== 'false';
      $('ui3dToggle').checked = localStorage.getItem('ui3d') === 'true';
      $('genshinIconsToggle').checked = localStorage.getItem('genshinIcons') === 'true';
      $('randomAnimToggle').checked = localStorage.getItem('randomAnimation') !== 'false';
      $('hideDifficultyToggle').checked = localStorage.getItem('hideDifficulty') === 'true';
      $('showTagsToggle').checked = localStorage.getItem('showTags') !== 'false';
      $('pkInviteToggle').checked = localStorage.getItem('pkInviteEnabled') !== 'false';
      $('stmtImageToggle').checked = localStorage.getItem('stmtAsImage') === '1';
    },

    applyTheme() {
      const t = $('themeSelect').value;
      if (t === 'dark' || t === 'scifi') document.documentElement.setAttribute('data-theme', t);
      else document.documentElement.removeAttribute('data-theme');
    },
    applyFontSize() { document.documentElement.style.fontSize = $('fontSizeSelect').value + 'px'; },
    applyCompact(on) { document.body.classList.toggle('compact-mode', on); },
    applyAnimations(on) { document.body.classList.toggle('no-animations', !on); },
    applyUi3d(on) { document.body.classList.toggle('ui-3d', on); },

    save() {
      localStorage.setItem('theme', $('themeSelect').value);
      localStorage.setItem('fontSize', $('fontSizeSelect').value);
      localStorage.setItem('compactMode', $('compactToggle').checked);
      localStorage.setItem('animations', $('animationToggle').checked);
      localStorage.setItem('ui3d', $('ui3dToggle').checked);
      localStorage.setItem('genshinIcons', $('genshinIconsToggle').checked);
      localStorage.setItem('randomAnimation', $('randomAnimToggle').checked);
      localStorage.setItem('hideDifficulty', $('hideDifficultyToggle').checked);
      localStorage.setItem('showTags', $('showTagsToggle').checked);
      localStorage.setItem('pkInviteEnabled', $('pkInviteToggle').checked);
      localStorage.setItem('stmtAsImage', $('stmtImageToggle').checked ? '1' : '0');

      this.applyTheme();
      this.applyFontSize();
      this.applyCompact($('compactToggle').checked);
      this.applyAnimations($('animationToggle').checked);
      this.applyUi3d($('ui3dToggle').checked);

      showMsg('saveMessage', '✅ Saved!', true);
      
      // 图标换了需要刷新
      setTimeout(() => location.reload(), 600);
    },

    bind() {
      $('saveSettingsBtn').addEventListener('click', () => this.save());
      
      // 彩蛋
      let clicks = 0, timer = null;
      $('animationToggle').addEventListener('click', () => {
        if (!timer) timer = setTimeout(() => { clicks = 0; timer = null; }, 2000);
        if (++clicks >= 5) { clearTimeout(timer); window.location.href = '/settings/extra'; }
      });
    },
  };

  // ═══════════════ [B] Display Name ═══════════════
  const DISPLAY_NAME = {
    init() {
      if (currentUser && currentUser.displayName) $('displayNameInput').value = currentUser.displayName;
    },
    async submit() {
      const newname = $('displayNameInput').value.trim();
      if (!newname) return showMsg('nameMessage', 'Display name cannot be empty.', false);
      try {
        const result = await apiCall('/api/users?action=changename', 'POST', { newname });
        if (result.success) {
          showMsg('nameMessage', 'Display name updated!', true);
          if (currentUser) currentUser.displayName = newname;
          const span = $('currentUsername');
          if (span) span.textContent = newname;
        } else {
          showMsg('nameMessage', result.message || 'Update failed.', false);
        }
      } catch (err) {
        showMsg('nameMessage', err?.message || 'Network error.', false);
      }
    },
    bind() { $('changeNameBtn').addEventListener('click', () => this.submit()); },
  };

  // ═══════════════ [C] Profile Picture ═══════════════
  const PFP = {
    base64: '', MAX_BYTES: 2 * 1024 * 1024,
    init() {
      const self = this;
      $('pfpSelectBtn').addEventListener('click', () => $('pfpInput').click());
      $('pfpInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > self.MAX_BYTES) return showMsg('pfpMessage', 'Image too large (max 2MB)', false);
        const reader = new FileReader();
        reader.onload = (ev) => {
          self.base64 = ev.target.result;
          $('pfpPreview').src = self.base64;
          $('pfpPreview').style.display = 'inline-block';
          $('pfpSaveBtn').disabled = false;
        };
        reader.readAsDataURL(file);
      });
      $('pfpSaveBtn').addEventListener('click', () => self.save());
    },
    async save() {
      if (!this.base64) return;
      if (!confirm('Ensure this image contains no inappropriate content.')) return;
      const btn = $('pfpSaveBtn');
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        const res = await apiCall('/api/users?action=pfp', 'POST', { image: this.base64 });
        if (res.success) {
          showMsg('pfpMessage', 'Profile picture saved!', true);
          if (currentUser) currentUser.pfp = res.pfp || '';
        } else showMsg('pfpMessage', res.message || 'Upload failed', false);
      } catch (err) {
        showMsg('pfpMessage', err?.message || 'Network error', false);
      } finally {
        btn.disabled = false; btn.textContent = 'Save Image';
      }
    },
  };

  // ═══════════════ [D] Change Password ═══════════════
  const PASSWORD = {
    MIN_LEN: 8,
    bind() { $('changePasswordBtn').addEventListener('click', () => this.submit()); },
    async submit() {
      const oldPw = $('oldPassword').value.trim();
      const newPw = $('newPassword').value.trim();
      const confirmPw = $('confirmPassword').value.trim();

      if (!oldPw || !newPw || !confirmPw) return showMsg('passwordMessage', 'All fields required.', false);
      if (newPw !== confirmPw) return showMsg('passwordMessage', 'New passwords do not match.', false);
      if (newPw.length < this.MIN_LEN) return showMsg('passwordMessage', `Must be at least ${this.MIN_LEN} chars.`, false);

      try {
        const result = await apiCall('/api/users?action=changepassword', 'POST', { oldPassword: oldPw, newPassword: newPw });
        if (result.success) {
          showMsg('passwordMessage', 'Password changed!', true);
          $('oldPassword').value = ''; $('newPassword').value = ''; $('confirmPassword').value = '';
        } else showMsg('passwordMessage', result.message || 'Update failed.', false);
      } catch (err) {
        showMsg('passwordMessage', err?.message || 'Network error.', false);
      }
    },
  };

  // ═══════════════ [E] Advanced / System ═══════════════
  const SYSTEM = {
    bind() {
      $('clearCacheBtn').addEventListener('click', () => this.clearCache());
      $('clearLocalStorageBtn').addEventListener('click', () => this.clearLocalStorage());
    },

    // 1. 彻底清除缓存
    async clearCache() {
      if (!confirm('Clear browser cache? This will force re-downloading all scripts and styles, and unregister the Service Worker.')) return;
      const btn = $('clearCacheBtn');
      const orig = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';

      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        // 强制刷新，加个随机参数绕过 HTTP 缓存
        const url = new URL(location.href);
        url.searchParams.set('_t', Date.now().toString());
        location.replace(url.toString());
      } catch (err) {
        alert('Failed: ' + err.message);
        btn.disabled = false; btn.innerHTML = orig;
      }
    },

    // 2. 删除本地数据（⚠️ 保护 auth_token）
    clearLocalStorage() {
      if (!confirm('This will delete drawpads, cached problem lists, and all preferences (like themes). You will remain logged in. Proceed?')) return;
      
      try {
        // 先备份 token
        const token = localStorage.getItem('auth_token');
        
        // 清空所有 localStorage
        localStorage.clear();
        
        // 把 token 塞回去
        if (token) {
          localStorage.setItem('auth_token', token);
        }

        // 给出提示并刷新
        alert('Local data cleared. Refreshing page...');
        location.reload();
      } catch (err) {
        alert('Failed to clear local storage: ' + err.message);
      }
    }
  };

  // ═══════════════ [Init] ═══════════════
  function init() {
    NAV.init();
    
    APPEARANCE.load();
    APPEARANCE.applyTheme();
    APPEARANCE.applyFontSize();
    APPEARANCE.applyCompact(localStorage.getItem('compactMode') === 'true');
    APPEARANCE.applyAnimations(localStorage.getItem('animations') !== 'false');
    APPEARANCE.applyUi3d(localStorage.getItem('ui3d') === 'true');

    APPEARANCE.bind();
    DISPLAY_NAME.init();
    DISPLAY_NAME.bind();
    PFP.init();
    PASSWORD.bind();
    SYSTEM.bind();
  }

  init();
})();