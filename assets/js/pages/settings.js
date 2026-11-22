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


  // ═══════════════ 导航配色（只影响 topbar / sidebar）═══════════════
  const NAV_THEME_KEY = 'navTheme';
  let currentNavTheme = 'green';

  function readNavTheme() {
    try {
      const t = localStorage.getItem(NAV_THEME_KEY);
      return t === 'blue' ? 'blue' : 'green';   // 默认绿色
    } catch (e) { return 'green'; }
  }

  function applyNavTheme(t) {
    currentNavTheme = t === 'blue' ? 'blue' : 'green';
    document.documentElement.setAttribute('data-nav-theme', currentNavTheme);
  }

  function paintNavThemePicker() {
    document.querySelectorAll('.nav-theme-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.navTheme === currentNavTheme);
    });
  }

  function initNavTheme() {
    applyNavTheme(readNavTheme());
    paintNavThemePicker();
    document.querySelectorAll('.nav-theme-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyNavTheme(btn.dataset.navTheme);   // 立即预览
        paintNavThemePicker();
      });
    });
  }

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

      // PDF 渲染清晰度：1.6（省流）~ 3.0（最清晰）
      const q = Number(localStorage.getItem('pdfRenderScale')) || 2.2;
      const range = $('pdfQualityRange');
      if (range) {
        range.value = String(q);
        const label = $('pdfQualityValue');
        if (label) label.textContent = q.toFixed(1) + '×';
      }
      initNavTheme();
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
      const qr = $('pdfQualityRange');
      if (qr) localStorage.setItem('pdfRenderScale', String(Number(qr.value) || 2.2));
      localStorage.setItem(NAV_THEME_KEY, currentNavTheme);
      applyNavTheme(currentNavTheme);

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

      // PDF 清晰度滑块：拖动时就更新数字，松手即存（不用等按保存）
      const range = $('pdfQualityRange');
      if (range) {
        const label = $('pdfQualityValue');
        const sync = (persist) => {
          const v = Number(range.value) || 2.2;
          if (label) label.textContent = v.toFixed(1) + '\u00d7';
          if (persist) localStorage.setItem('pdfRenderScale', String(v));
        };
        range.addEventListener('input', () => sync(false));
        range.addEventListener('change', () => sync(true));
        sync(false);
      }

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
      $('clearIdbBtn')?.addEventListener('click', () => this.clearIndexedDB());
      this.renderIdbSize();
      this.renderStorageUsage();
      this.renderCategories();
      this.bindRetention();
      window.addEventListener('storage', () => { this.renderStorageUsage(); this.renderCategories(); });
      // 进到 System 标签时再量一次（别的时候长度可能变了）
      document.querySelectorAll('.nav-item[data-tab]').forEach((n) => {
        if (n.dataset.tab === 'system') n.addEventListener('click', () => setTimeout(() => { this.renderStorageUsage(); this.renderCategories(); }, 60));
      });
    },

    // localStorage 按用途分类，方便只删某一类
    CATEGORIES: [
      { id: 'draft', label: 'Question drafts', icon: 'fa-pen', match: (k) => k.startsWith('pd_draft') || k.startsWith('pd_workbench_drafts:') },
      { id: 'scratchpad', label: 'Scratchpad boards', icon: 'fa-tablet-screen-button', match: (k) => k.startsWith('pd_scratchpad:') },
      { id: 'coursePad', label: 'Course drawing boards', icon: 'fa-draw-polygon', match: (k) => k.startsWith('coursePad:') },
      { id: 'paperPad', label: 'Paper (DSE) boards', icon: 'fa-file-lines', match: (k) => k.startsWith('paperPad:') },
      { id: 'inlinePad', label: 'Inline question boards', icon: 'fa-pen-nib', match: (k) => k.startsWith('inlinePad:') },
      { id: 'pdfPad', label: 'PDF answer boxes', icon: 'fa-file-pdf', match: (k) => /^pdfPad|^pdf_box|^pdfPage/i.test(k) },
      { id: 'cache', label: 'Problem list & caches', icon: 'fa-database', match: (k) => /Cache|^problemList|cacheClean|favoritesCache|userStatesCache/.test(k) },
      { id: 'prefs', label: 'Display preferences', icon: 'fa-sliders', match: (k) => /^(theme|navTheme|compactMode|fontSize|hideDifficulty|goodUI|ui3d|uiType|animations|randomAnimation|showNekos|neko|genshinIcons|osScale|osDetailRules|pdfRenderScale|stmtAsImage|showTags|problemFilterTags|sidebarOpen|paperFast|paperUltra|padstore_ttl)/.test(k) },
    ],

    renderCategories() {
      const host = $('lsCategories');
      if (!host) return;
      const fmt = (b) => b < 1024 ? b + ' B' : b < 1024 * 1024 ? (b / 1024).toFixed(1) + ' KB' : (b / 1024 / 1024).toFixed(2) + ' MB';

      const rows = this.CATEGORIES.map((cat) => {
        let bytes = 0, count = 0;
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !cat.match(k)) continue;
            bytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
            count++;
          }
        } catch (e) {}
        return { ...cat, bytes, count };
      });

      host.innerHTML = rows.map((r) => (
        '<div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border-color);">' +
          '<span style="flex:1;font-size:.88rem;"><i class="fas ' + r.icon + '" style="width:18px;color:var(--text-secondary);"></i> ' + r.label + '</span>' +
          '<span style="font-size:.78rem;color:var(--text-secondary);font-variant-numeric:tabular-nums;min-width:110px;text-align:right;">' +
            (r.count ? r.count + ' · ' + fmt(r.bytes) : 'empty') + '</span>' +
          '<button class="btn btn-danger ls-cat-del" data-cat="' + r.id + '"' + (r.count ? '' : ' disabled') +
            ' style="padding:5px 12px;font-size:.78rem;">Delete</button>' +
        '</div>'
      )).join('');

      host.querySelectorAll('.ls-cat-del').forEach((b) => {
        b.addEventListener('click', () => this.deleteCategory(b.dataset.cat));
      });
    },

    deleteCategory(id) {
      const cat = this.CATEGORIES.find((c) => c.id === id);
      if (!cat) return;
      const keys = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && cat.match(k)) keys.push(k);
        }
      } catch (e) {}
      if (!keys.length) return;
      if (!confirm('Delete ' + keys.length + ' entries under "' + cat.label + '"?\nThis cannot be undone.')) return;

      keys.forEach((k) => {
        // 画板类还要清掉 IndexedDB 里可能存在的副本
        if (/^(pd_scratchpad:|coursePad:|paperPad:|inlinePad:|pdfPad)/.test(k) && window.PadStore) PadStore.remove(k);
        else { try { localStorage.removeItem(k); } catch (e) {} }
      });

      this.renderCategories();
      this.renderStorageUsage();
    },

    bindRetention() {
      const input = $('padTtlDays');
      const save = $('padTtlSave');
      const purge = $('padPurgeNow');
      const msg = $('padTtlMsg');
      if (input && window.PadStore) input.value = String(PadStore.ttlDays());

      save?.addEventListener('click', () => {
        if (!window.PadStore) return;
        const d = PadStore.setTtlDays(input.value);
        input.value = String(d);
        if (msg) { msg.textContent = 'Saved — drafts expire after ' + d + ' days'; setTimeout(() => { msg.textContent = ''; }, 2500); }
      });

      purge?.addEventListener('click', async () => {
        if (!window.PadStore) return;
        if (msg) msg.textContent = 'Purging…';
        const n = await PadStore.purgeExpired();
        if (msg) msg.textContent = n ? 'Removed ' + n + ' expired draft' + (n === 1 ? '' : 's') : 'Nothing expired';
        this.renderCategories();
        this.renderStorageUsage();
      });
    },

    // 读 localStorage 实际占用（UTF-16，每字符 2 字节），并按来源归类
    measureStorage() {
      let bytes = 0;
      let keys = 0;
      const buckets = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k) continue;
          const v = localStorage.getItem(k) || '';
          const size = (k.length + v.length) * 2;
          bytes += size;
          keys++;
          // 归到一个容易读的类别：取冒号前的前缀
          const group = k.includes(':') ? k.split(':')[0] : k;
          buckets[group] = (buckets[group] || 0) + size;
        }
      } catch (e) { /* 隐私模式下可能抛 */ }
      return { bytes, keys, buckets };
    },

    renderStorageUsage() {
      const hint = $('lsUsageHint');
      const bar = $('lsUsageBar');
      const text = $('lsUsageText');
      const top = $('lsUsageTop');
      if (!bar || !text) return;

      const { bytes, keys, buckets } = this.measureStorage();

      // 浏览器配额通常 5MB 左右（按字符算），这里用 5MB 的字节数做分母
      const QUOTA = 5 * 1024 * 1024;
      const pct = Math.min(100, (bytes / QUOTA) * 100);

      const fmt = (b) => b < 1024 ? b + ' B' : b < 1024 * 1024 ? (b / 1024).toFixed(1) + ' KB' : (b / 1024 / 1024).toFixed(2) + ' MB';

      if (hint) {
        hint.textContent = bytes
          ? keys + ' keys · ' + fmt(bytes) + ' of roughly 5 MB'
          : 'Nothing stored yet, or this browser blocks storage access.';
      }

      bar.style.width = Math.max(pct, bytes ? 0.8 : 0) + '%';
      bar.style.background = pct > 85 ? '#dc2626' : pct > 60 ? '#d97706' : '#4a90d9';
      text.textContent = fmt(bytes) + ' used · ' + pct.toFixed(1) + '% of 5 MB';

      if (top) {
        const rows = Object.entries(buckets)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([k, v]) => k + ' — ' + fmt(v));
        top.innerHTML = rows.length ? rows.join('<br>') : '';
      }
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

    // 报告 IndexedDB 里画板库的占用（能测出来就显示，测不出来就算了）
    async renderIdbSize() {
      const hint = $('idbSizeHint');
      if (!hint || !navigator.storage || !navigator.storage.estimate) return;
      try {
        const est = await navigator.storage.estimate();
        const used = est && est.usage ? est.usage : 0;
        if (!used) return;
        const fmt = used < 1024 * 1024 ? (used / 1024).toFixed(0) + ' KB' : (used / 1024 / 1024).toFixed(2) + ' MB';
        hint.innerHTML = 'Drawing drafts are now kept in IndexedDB. This removes the whole <code>wyk_pads</code> database. '
          + 'This site currently stores about <b>' + fmt + '</b> in total.';
      } catch (e) { /* 浏览器不支持时保持原文案 */ }
    },

    // 清空画板专用的 IndexedDB 库
    async clearIndexedDB() {
      if (!confirm('Delete all drawing drafts stored in IndexedDB?\nYour login and other data are untouched.')) return;
      const btn = $('clearIdbBtn');
      const orig = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Clearing...';

      const drop = (name) => new Promise((resolve) => {
        try {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
          req.onblocked = () => resolve(false);   // 别的标签页还开着
        } catch (e) { resolve(false); }
      });

      let ok = await drop('wyk_pads');
      // localforage 还会建一个同名的元数据库，一并清掉
      await drop('wyk_pads_meta').catch(() => {});
      // 兜底：万一还有别的 localforage 实例名
      await drop('localforage').catch(() => {});

      btn.disabled = false;
      btn.innerHTML = orig;
      if (window.PadStore && PadStore.purgeExpired) {
        // 顺带清掉可能残留在 localStorage 的兜底副本
        try {
          Object.keys(localStorage)
            .filter((k) => /^(pd_scratchpad:|coursePad:|paperPad:|inlinePad:|pdfPad)/.test(k))
            .forEach((k) => localStorage.removeItem(k));
        } catch (e) {}
      }
      this.renderCategories();
      this.renderStorageUsage();
      this.renderIdbSize();
      alert(ok ? 'IndexedDB cleared. Reload the page to see empty boards.' : 'Could not clear IndexedDB — another tab may still have it open.');
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