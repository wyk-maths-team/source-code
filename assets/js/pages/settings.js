(function () {
  'use strict';

  if (!isLoggedIn()) { window.location.href = '/index.html'; return; }

  // ═══════════════ 工具 ═══════════════
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

  // ═══════════════ [A] Appearance ═══════════════
  const APPEARANCE = {
    keys: ['theme', 'fontSize', 'compactMode', 'animations',
           'randomAnimation', 'hideDifficulty', 'showTags', 'pkInviteEnabled'],

    load() {
      $('themeSelect').value = localStorage.getItem('theme') || 'light';
      $('fontSizeSelect').value = localStorage.getItem('fontSize') || '16';
      $('compactToggle').checked = localStorage.getItem('compactMode') === 'true';
      $('animationToggle').checked = localStorage.getItem('animations') !== 'false';
      $('randomAnimToggle').checked = localStorage.getItem('randomAnimation') !== 'false';
      $('hideDifficultyToggle').checked = localStorage.getItem('hideDifficulty') === 'true';
      $('showTagsToggle').checked = localStorage.getItem('showTags') !== 'false';
      $('pkInviteToggle').checked = localStorage.getItem('pkInviteEnabled') !== 'false';

    },

    applyTheme() {
      const t = $('themeSelect').value;
      // 'scifi' is a visual skin, not a colour scheme; store and apply it the
      // same way as 'dark' so every page picks it up via data-theme.
      if (t === 'dark' || t === 'scifi') document.documentElement.setAttribute('data-theme', t);
      else document.documentElement.removeAttribute('data-theme');
    },

    applyFontSize() {
      document.documentElement.style.fontSize = $('fontSizeSelect').value + 'px';
    },

    applyCompact(on) {
      document.body.classList.toggle('compact-mode', on);
    },

    applyAnimations(on) {
      document.body.classList.toggle('no-animations', !on);
    },

    save() {
      const theme = $('themeSelect').value;
      const fontSize = $('fontSizeSelect').value;
      const compact = $('compactToggle').checked;
      const animations = $('animationToggle').checked;
      const randomAnim = $('randomAnimToggle').checked;
      const hideDifficulty = $('hideDifficultyToggle').checked;
      const showTags = $('showTagsToggle').checked;
      const pkInvite = $('pkInviteToggle').checked;

      localStorage.setItem('theme', theme);
      localStorage.setItem('fontSize', fontSize);
      localStorage.setItem('compactMode', compact);
      localStorage.setItem('animations', animations);
      localStorage.setItem('randomAnimation', randomAnim);
      localStorage.setItem('hideDifficulty', hideDifficulty);
      localStorage.setItem('showTags', showTags);
      localStorage.setItem('pkInviteEnabled', pkInvite);

      this.applyTheme();
      this.applyFontSize();
      this.applyCompact(compact);
      this.applyAnimations(animations);

      showMsg('saveMessage', '✅ Saved!', true);
    },

    bind() {
      $('themeSelect').addEventListener('change', () => this.applyTheme());
      $('fontSizeSelect').addEventListener('change', () => this.applyFontSize());
      $('saveSettingsBtn').addEventListener('click', () => this.save());


      // ⭐ 彩蛋：連續點 Animations 5 次 → /settings/extra
      let clicks = 0, timer = null;
      $('animationToggle').addEventListener('click', () => {
        if (!timer) {
          timer = setTimeout(() => { clicks = 0; timer = null; }, 2000);
        }
        if (++clicks >= 5) {
          clearTimeout(timer);
          window.location.href = '/settings/extra';
        }
      });
    },
  };

  // ═══════════════ [B] Display Name ═══════════════
  const DISPLAY_NAME = {
    init() {
      const input = $('displayNameInput');
      if (currentUser && currentUser.displayName) {
        input.value = currentUser.displayName;
      }
    },

    async submit() {
      const newname = $('displayNameInput').value.trim();

      // ⭐ 前端只檢查空值，其餘全部交給後端
      if (!newname) {
        showMsg('nameMessage', 'Display name cannot be empty.', false);
        return;
      }

      try {
        const result = await apiCall('/api/users?action=changename', 'POST', { newname });

        if (result.success) {
          showMsg('nameMessage', 'Display name updated!', true);
          if (currentUser) currentUser.displayName = newname;
          const span = $('currentUsername');
          if (span) span.textContent = newname;
        } else {
          // ⭐ 直接顯示後端消息
          showMsg('nameMessage', result.message || 'Update failed.', false);
        }
      } catch (err) {
        const msg = err?.data?.message || err?.message || 'Network error. Please try again.';
        showMsg('nameMessage', msg, false);
      }
    },

    bind() {
      $('changeNameBtn').addEventListener('click', () => this.submit());
    },
  };

  // ═══════════════ [C] Profile Picture ═══════════════
  const PFP = {
    base64: '',
    MAX_BYTES: 2 * 1024 * 1024,

    init() {
      const self = this;
      $('pfpSelectBtn').addEventListener('click', () => $('pfpInput').click());

      $('pfpInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > self.MAX_BYTES) {
          showMsg('pfpMessage', 'Image too large (max 2MB)', false);
          return;
        }
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
      if (!confirm(
        'Please ensure this image does NOT contain any pornographic, ' +
        'violent, religious or political content.'
      )) return;

      const btn = $('pfpSaveBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const res = await apiCall('/api/users?action=pfp', 'POST', { image: this.base64 });
        if (res.success) {
          showMsg('pfpMessage', 'Profile picture saved!', true);
          if (currentUser) currentUser.pfp = res.pfp || '';
        } else {
          showMsg('pfpMessage', res.message || 'Upload failed', false);
        }
      } catch (err) {
        const msg = err?.data?.message || err?.message || 'Network error';
        showMsg('pfpMessage', msg, false);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Image';
      }
    },
  };

  // ═══════════════ [D] Change Password ═══════════════
  const PASSWORD = {
    MIN_LEN: 8,

    bind() {
      $('changePasswordBtn').addEventListener('click', () => this.submit());
    },

    async submit() {
      const oldPassword = $('oldPassword').value.trim();
      const newPassword = $('newPassword').value.trim();
      const confirmPassword = $('confirmPassword').value.trim();

      if (!oldPassword || !newPassword || !confirmPassword) {
        return showMsg('passwordMessage', 'All fields are required.', false);
      }
      if (newPassword !== confirmPassword) {
        return showMsg('passwordMessage', 'New passwords do not match.', false);
      }
      if (newPassword.length < this.MIN_LEN) {
        return showMsg('passwordMessage',
          `Password must be at least ${this.MIN_LEN} characters.`, false);
      }

      try {
        const result = await apiCall('/api/users?action=changepassword', 'POST', {
          oldPassword, newPassword,
        });
        if (result.success) {
          showMsg('passwordMessage', 'Password changed successfully!', true);
          $('oldPassword').value = '';
          $('newPassword').value = '';
          $('confirmPassword').value = '';
        } else {
          showMsg('passwordMessage', result.message || 'Update failed.', false);
        }
      } catch (err) {
        const msg = err?.data?.message || err?.message || 'Network error. Please try again.';
        showMsg('passwordMessage', msg, false);
      }
    },
  };

  // ═══════════════ [E] Advanced ═══════════════
  const ADVANCED = {
    bind() {
      $('clearCacheBtn').addEventListener('click', () => this.clearCache());
    },

    async clearCache() {
      if (!confirm('Confirm?\n\nThis will re-download all scripts')) return;

      const btn = $('clearCacheBtn');
      const origHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';

      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map(r => r.unregister()));
        }
        const url = new URL(location.href);
        url.searchParams.set('_t', Date.now().toString());
        location.replace(url.toString());
      } catch (err) {
        (window.DSHUI ? DSHUI.toast('Failed: ' + err.message, 'err') : alert('Failed: ' + err.message));
        btn.disabled = false;
        btn.innerHTML = origHTML;
      }
    },
  };

  // ═══════════════ [Init] ═══════════════
  function init() {
    APPEARANCE.load();
    APPEARANCE.applyTheme();
    APPEARANCE.applyFontSize();
    APPEARANCE.applyCompact(localStorage.getItem('compactMode') === 'true');
    APPEARANCE.applyAnimations(localStorage.getItem('animations') !== 'false');

    APPEARANCE.bind();
    DISPLAY_NAME.init();
    DISPLAY_NAME.bind();
    PFP.init();
    PASSWORD.bind();
    ADVANCED.bind();
  }

  // DOM 已經 ready（script 放在 body 最後）
  init();
})();
