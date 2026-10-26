    // ═══════════════════════════════════════════════════════
    //                      權限檢查
    // ═══════════════════════════════════════════════════════
    (function() {
      if (!isLoggedIn()) {
        window.location.href = '/index.html';
        return;
      }
      const user = getCurrentUser() || {};
      if (user.role !== 'admin' && user.role !== 'root') {
        window.location.href = '/index.html';
        return;
      }

      const subtitle = document.getElementById('dashSubtitle');
      if (subtitle) {
        const name = user.displayName || user.username || 'admin';
        const roleLabel = user.role === 'root' ? 'Root' : 'Admin';
        subtitle.textContent = `歡迎回來，${name} · ${roleLabel}`;
      }

      // ⭐ Danger Zone 完全 root only
      const dangerSection = document.querySelector('.danger-section');
      if (user.role === 'root') {
        const dangerRootBlock = document.getElementById('rootOnlyDangerBlock');
        if (dangerRootBlock) dangerRootBlock.hidden = false;
        // dangerSection 保持顯示
      } else {
        if (dangerSection) dangerSection.style.display = 'none';
      }
    })();
    // ═══════════════════════════════════════════════════════
    //                    危險區域：解鎖
    // ═══════════════════════════════════════════════════════
    (function() {
      const zone = document.getElementById('dangerZone');
      const mist = document.getElementById('dangerMist');
      if (!zone || !mist) return;

      mist.addEventListener('click', () => {
        const ok = confirm(
          '⚠️  危險區域警告\n\n' +
          '你即将打开数据库备份管理页面\n' +
          '以下是使用规则：\n' +
          '1. 如果不是紧急情况（如遭人删库），不可肆意回档或随意备份\n\n' +
          '2. 如果是紧急情况，应该立即前往/backup下载最新的10个备份（10天）。你应该立即暂停vercel的网站，防止进一步进攻。\n\n' +
          '3. 每一次的数据库回档必须在学校进行纸本记录。'+
          '4. 数据库级别回档不会被任何形式记录下来，设计中会把这次操作者的所有行为发到webhook上面。'
        );
        if (!ok) return;
        zone.classList.remove('locked');
        zone.classList.add('unlocked');
      });
    })();

    // ═══════════════════════════════════════════════════════
    //                  CDN Purge（複選清單）
    // ═══════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════
    //               CDN Purge（動態從 GitHub 拉取清單）
    // ═══════════════════════════════════════════════════════

    const REPO = 'wyk-math-team/resources';
    const REPO_BRANCH = 'main';
    const PURGE_BASE = `https://purge.jsdelivr.net/gh/${REPO}`;
    const GITHUB_TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${REPO_BRANCH}?recursive=1`;
    const COOLDOWN_MS = 60_000;
    const COOLDOWN_KEY = 'cdnPurgeLastRun';
    const TREE_CACHE_KEY = 'cdnTreeCache_v1';
    const TREE_CACHE_TTL = 5 * 60 * 1000;   // 5 分鐘
    const MAX_FILES_PER_GROUP = 30;         // 每組超過 30 檔 → 用通配符

    // ⭐ fallback 清單：GitHub API 掛掉時使用
    const PURGE_FALLBACK = [
      { id: 'web_css', label: 'Stylesheet', icon: 'fas fa-brush',
        files: ['web_css/styles.css', 'web_css/submissions.css'] },
      { id: 'script', label: 'Scripts', icon: 'fas fa-broom',
        files: ['script/auth.js', 'script/app.js', 'script/topbar.js',
                'script/sidebar.js', 'script/problems-1.js', 'script/pd-script.js'] },
      { id: 'static', label: 'Static files', icon: 'fas fa-database',
        files: ['static/_problems/*'] }
    ];

    // ⭐ 目錄友善名稱
    const DIR_LABELS = {
      web_css:  { label: 'Stylesheet',   icon: 'fas fa-brush' },
      script:   { label: 'Scripts',      icon: 'fas fa-broom' },
      static:   { label: 'Static files', icon: 'fas fa-database' },
      images:   { label: 'Images',       icon: 'fas fa-image' },
      icons:    { label: 'Icons',        icon: 'fas fa-icons' },
      fonts:    { label: 'Fonts',        icon: 'fas fa-font' },
    };

    let currentCatalog = PURGE_FALLBACK;

    // ── 從 GitHub 拉取 flat 路徑列表 ──
    async function fetchTreeFromGithub() {
      const res = await fetch(GITHUB_TREE_API, {
        headers: { 'Accept': 'application/vnd.github+json' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      if (!data.tree || !Array.isArray(data.tree)) {
        throw new Error('Invalid tree response');
      }
      return data.tree
        .filter(it => it.type === 'blob')
        .map(it => it.path)
        .sort();
    }

    // ── 帶 TTL 快取 ──
    async function getTree(force = false) {
      if (!force) {
        try {
          const cached = JSON.parse(localStorage.getItem(TREE_CACHE_KEY) || 'null');
          if (cached && cached.timestamp &&
              Date.now() - cached.timestamp < TREE_CACHE_TTL) {
            return { paths: cached.paths, fromCache: true };
          }
        } catch {}
      }
      const paths = await fetchTreeFromGithub();
      try {
        localStorage.setItem(
          TREE_CACHE_KEY,
          JSON.stringify({ timestamp: Date.now(), paths })
        );
      } catch {}
      return { paths, fromCache: false };
    }

    // ── flat paths → catalog 結構 ──
    function buildCatalogFromPaths(paths) {
      const kept = paths.filter(p => !p.startsWith('static/'));
      const groups = {};
      for (const p of kept) {
        const slash = p.indexOf('/');
        if (slash === -1) {
          (groups._root = groups._root || []).push(p);
        } else {
          const top = p.slice(0, slash);
          (groups[top] = groups[top] || []).push(p);
        }
      }

      const catalog = [];

      // 根目錄散檔
      if (groups._root && groups._root.length) {
        catalog.push({
          id: '_root',
          label: 'Root files',
          icon: 'fas fa-file',
          files: groups._root,
        });
        delete groups._root;
      }

      // 各頂層目錄
      for (const top of Object.keys(groups).sort()) {
        const files = groups[top];
        const meta = DIR_LABELS[top] || { label: top, icon: 'fas fa-folder' };
        if (files.length > MAX_FILES_PER_GROUP) {
          catalog.push({
            id: top,
            label: meta.label,
            icon: meta.icon,
            files: [`${top}/*`],
            totalFiles: files.length,
          });
        } else {
          catalog.push({
            id: top,
            label: meta.label,
            icon: meta.icon,
            files,
            totalFiles: files.length,
          });
        }
      }
      return catalog;
    }

    // ── 異步初始化：先 fallback，再拉 GitHub ──
    async function initCatalog(force = false) {
      const status = document.getElementById('purgeCatalogStatus');
      const reloadBtn = document.getElementById('purgeReloadBtn');

      // 1) 立即渲染 fallback（不阻塞）
      renderChecklist(currentCatalog);

      // 2) UI 進入 loading 狀態
      if (status) {
        status.classList.add('loading');
        status.textContent = '載入清單…';
        status.style.color = '';
      }
      if (reloadBtn) {
        reloadBtn.disabled = true;
        reloadBtn.classList.add('spinning');
      }

      try {
        const { paths, fromCache } = await getTree(force);
        currentCatalog = buildCatalogFromPaths(paths);
        renderChecklist(currentCatalog);
        if (status) {
          status.classList.remove('loading');
          status.textContent =
            `已載入 ${paths.length} 個檔案${fromCache ? '（快取）' : ''}`;
        }
      } catch (err) {
        console.warn('[purge] GitHub tree 載入失敗，使用預設清單：', err);
        if (status) {
          status.classList.remove('loading');
          status.textContent = '無法連線 GitHub，使用預設清單';
          status.style.color = '#e67e22';
        }
      } finally {
        if (reloadBtn) {
          reloadBtn.disabled = false;
          reloadBtn.classList.remove('spinning');
        }
      }
    }

    // ── 冷卻 ──
    function getCooldownRemaining() {
      try {
        const ts = parseInt(localStorage.getItem(COOLDOWN_KEY) || '0', 10);
        const remaining = COOLDOWN_MS - (Date.now() - ts);
        return remaining > 0 ? remaining : 0;
      } catch { return 0; }
    }
    function setCooldown() {
      try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch {}
    }

    // ── 日誌面板 ──
    const logEl = document.getElementById('purgeLog');
    function logLine(text, cls = '') {
      if (!logEl) return;
      logEl.classList.add('visible');
      const p = document.createElement('p');
      p.className = 'log-line' + (cls ? ' ' + cls : '');
      p.textContent = text;
      logEl.appendChild(p);
      logEl.scrollTop = logEl.scrollHeight;
    }
    function clearLog() {
      if (!logEl) return;
      logEl.innerHTML = '';
      logEl.classList.add('visible');
    }

    // ── 生成複選清單 ──
    function renderChecklist(catalog) {
      const container = document.getElementById('purgeChecklist');
      if (!container) return;

      let html = '';
      for (const cat of catalog) {
        const total = cat.totalFiles || cat.files.length;
        html += `
          <div class="purge-category" data-cat="${cat.id}">
            <div class="purge-cat-header">
              <span class="purge-cat-name">
                <i class="${cat.icon}"></i>
                ${cat.label}
                <span class="count" data-count="${cat.id}">0/${cat.files.length}</span>
              </span>
              <label class="purge-select-all">
                <input type="checkbox" data-select-all="${cat.id}">
                <span>全選</span>
              </label>
            </div>
            <div class="purge-file-list">
              ${cat.files.map(f => {
                const isWildcard = f.includes('*');
                return `
                  <label class="purge-file-item">
                    <input type="checkbox" data-file="${f}" data-cat="${cat.id}">
                    <span class="file-path">${f}</span>
                    ${isWildcard
                      ? `<span class="file-badge wildcard">WILDCARD · ${total}</span>`
                      : ''}
                  </label>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
      container.innerHTML = html;

      // 事件綁定
      container.querySelectorAll('input[type="checkbox"][data-file]').forEach(cb => {
        cb.addEventListener('change', updateCounts);
      });
      container.querySelectorAll('input[type="checkbox"][data-select-all]').forEach(cb => {
        cb.addEventListener('change', () => {
          const catId = cb.dataset.selectAll;
          container.querySelectorAll(`input[data-file][data-cat="${catId}"]`)
            .forEach(f => { f.checked = cb.checked; });
          updateCounts();
        });
      });
      updateCounts();
    }

    function updateCounts() {
      const container = document.getElementById('purgeChecklist');
      const selectedBtn = document.getElementById('purgeSelectedBtn');
      if (!container || !selectedBtn) return;

      let totalSelected = 0;

      for (const cat of currentCatalog) {
        const all = container.querySelectorAll(`input[data-file][data-cat="${cat.id}"]`);
        const checked = container.querySelectorAll(`input[data-file][data-cat="${cat.id}"]:checked`);
        const countEl = container.querySelector(`[data-count="${cat.id}"]`);
        if (countEl) countEl.textContent = `${checked.length}/${all.length}`;
        totalSelected += checked.length;

        const selectAll = container.querySelector(`input[data-select-all="${cat.id}"]`);
        if (selectAll) {
          selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
          selectAll.checked = checked.length > 0 && checked.length === all.length;
        }
      }

      const span = selectedBtn.querySelector('span');
      if (span) span.textContent = `Cleared(${totalSelected})`;
      selectedBtn.disabled = totalSelected === 0 || getCooldownRemaining() > 0;
    }

    function getSelectedFiles() {
      const container = document.getElementById('purgeChecklist');
      if (!container) return [];
      const files = [];
      container.querySelectorAll('input[data-file]:checked').forEach(cb => {
        files.push(cb.dataset.file);
      });
      return filterPurgeList(files);   // ⭐ 过滤
    }

    // ── 單一 URL 清空 ──
    async function purgeOne(path) {
      const url = `${PURGE_BASE}/${path}`;
      logLine(`→ ${url}`, 'log-info');
      try {
        const res = await fetch(url, { cache: 'no-store' });
        let data = null;
        try { data = await res.json(); } catch {}
        if (res.ok) {
          const status = (data && data.status) || 'ok';
          logLine(`   ✓ ${status}`, 'log-ok');
          return { ok: true, path };
        }
        logLine(`   ✗ HTTP ${res.status}`, 'log-err');
        return { ok: false, path };
      } catch (err) {
        try {
          await fetch(url, { mode: 'no-cors', cache: 'no-store' });
          logLine(`   ✓ 已送出（no-cors，無法讀取回應）`, 'log-ok');
          return { ok: true, path };
        } catch (err2) {
          logLine(`   ✗ ${err2.message || 'failed'}`, 'log-err');
          return { ok: false, path };
        }
      }
    }
    // ⭐ 新增：排除 static/ 目录
    function filterPurgeList(files) {
      return files.filter(f => {
        // 通配符 static/* 也排除
        if (f === 'static/*') return false;
        if (f.startsWith('static/')) return false;
        return true;
      });
    }
    // ── 執行清空 ──
    async function runPurge(files, label) {
      if (!files.length) return;
      const t0 = Date.now();
      logLine(`\n━━━ 開始清除：${label}（${files.length} 個檔案）━━━`, 'log-info');

      const results = [];
      for (const path of files) {
        results.push(await purgeOne(path));
      }

      const okCount = results.filter(r => r.ok).length;
      const errCount = results.length - okCount;
      const dur = ((Date.now() - t0) / 1000).toFixed(1);
      if (errCount === 0) {
        logLine(`━━━ 完成：${okCount}/${results.length} 成功（${dur}s）━━━`, 'log-ok');
      } else {
        logLine(`━━━ 完成：${okCount} 成功 · ${errCount} 失敗（${dur}s）━━━`, 'log-err');
      }
    }

    // ── 冷卻 UI ──
    let cooldownTimer = null;
    function refreshCooldownUI() {
      const info = document.getElementById('purgeCooldownInfo');
      const selectedBtn = document.getElementById('purgeSelectedBtn');
      const allBtn = document.getElementById('purgeAllBtn');
      const remaining = getCooldownRemaining();

      if (remaining > 0) {
        const sec = Math.ceil(remaining / 1000);
        if (info) {
          info.classList.add('active');
          info.innerHTML = `<i class="fas fa-hourglass-half"></i> 冷卻中… ${sec}s`;
        }
        if (selectedBtn) selectedBtn.disabled = true;
        if (allBtn) allBtn.disabled = true;
        clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(refreshCooldownUI, 300);
      } else {
        if (info) {
          info.classList.remove('active');
          info.innerHTML = '';
        }
        if (selectedBtn) selectedBtn.disabled = (getSelectedFiles().length === 0);
        if (allBtn) allBtn.disabled = false;
        clearTimeout(cooldownTimer);
      }
    }

    // ── 綁定主按鈕 + Reload ──
    function bindPurgeButtons() {
      const selectedBtn = document.getElementById('purgeSelectedBtn');
      const allBtn = document.getElementById('purgeAllBtn');
      const reloadBtn = document.getElementById('purgeReloadBtn');

      if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
          initCatalog(true);   // 強制刷新
        });
      }

      selectedBtn.addEventListener('click', async () => {
        if (getCooldownRemaining() > 0) {
          (window.DSHUI ? DSHUI.toast(`請稍候 ${Math.ceil(getCooldownRemaining() / 1000)} 秒後再試。`) : alert(`請稍候 ${Math.ceil(getCooldownRemaining() / 1000)} 秒後再試。`));
          return;
        }
        const files = getSelectedFiles();
        if (!files.length) return;

        const ok = confirm(
          `⚠️  確認清除 ${files.length} 個 CDN 檔案？\n\n` +
          files.slice(0, 8).join('\n') +
          (files.length > 8 ? `\n… （還有 ${files.length - 8} 個）` : '') +
          '\n\n使用者下次訪問時會下載最新版本。\n\n確定要執行嗎？'
        );
        if (!ok) return;

        setCooldown();
        refreshCooldownUI();
        clearLog();
        logLine(`[${new Date().toLocaleTimeString('zh-HK')}] 使用者觸發：清除所選`, 'log-dim');
        try {
          await runPurge(files, '自訂選擇');
        } catch (err) {
          logLine(`✗ 整體錯誤：${err.message}`, 'log-err');
        }
      });

      allBtn.addEventListener('click', async () => {
        if (getCooldownRemaining() > 0) {
          (window.DSHUI ? DSHUI.toast(`請稍候 ${Math.ceil(getCooldownRemaining() / 1000)} 秒後再試。`) : alert(`請稍候 ${Math.ceil(getCooldownRemaining() / 1000)} 秒後再試。`));
          return;
        }
        const allFiles = filterPurgeList(currentCatalog.flatMap(c => c.files));
        const ok = confirm(
          `⚠️  確認清除全部 ${allFiles.length} 個 CDN 檔案？\n\n` +
          '這將會清除整個 resources repo 的快取。\n' +
          '所有使用者下次訪問時會下載最新版本。\n\n確定要執行嗎？'
        );
        if (!ok) return;

        setCooldown();
        refreshCooldownUI();
        clearLog();
        logLine(`[${new Date().toLocaleTimeString('zh-HK')}] 使用者觸發：清除全部`, 'log-dim');
        try {
          await runPurge(allFiles, '全部');
        } catch (err) {
          logLine(`✗ 整體錯誤：${err.message}`, 'log-err');
        }
      });
    }

    // ── 啟動 ──
    bindPurgeButtons();
    refreshCooldownUI();
    initCatalog();   // ⭐ 異步
    // ═══════════════════════════════════════════════════════
//              Danger Zone: Database Backup
// ═══════════════════════════════════════════════════════
(function () {
  const logEl = document.getElementById('backupLog');
  const ghBtn = document.getElementById('backupToGithubBtn');
  const dlBtn = document.getElementById('backupDownloadBtn');
  if (!logEl || !ghBtn || !dlBtn) return;

  function log(text, cls = '') {
    logEl.classList.add('visible');
    const p = document.createElement('p');
    p.className = 'log-line' + (cls ? ' ' + cls : '');
    p.textContent = text;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function clear() {
    logEl.innerHTML = '';
    logEl.classList.add('visible');
  }

  const token = () => localStorage.getItem('auth_token') || '';

  // ── 备份到 GitHub ──
  ghBtn.addEventListener('click', async () => {
    const ok = confirm(
      '⚠️  Backup database to GitHub?\n\n' +
      'Each collection is gzipped and uploaded as an asset on a NEW GitHub Release\n' +
      '(tag: backup-<timestamp>), plus a _manifest.json.gz with the doc counts.'
    );
    if (!ok) return;

    clear();
    log(`[${new Date().toLocaleTimeString()}] Backup started…`, 'log-info');
    ghBtn.disabled = true;

    try {
      const res = await fetch('/api/admin?action=backupDatabase', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token() },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        log(`✗ ${data.message || 'Failed'}`, 'log-err');
        return;
      }
      // 後端回傳的是 { release, results } —— 沒有 dir，也沒有 url
      log(`✓ Backup release: ${data.release || '(unknown)'}`, 'log-ok');
      for (const r of data.results) {
        if (r.error) log(`   ✗ ${r.collection}: ${r.error}`, 'log-err');
        else log(`   ✓ ${r.collection}: ${r.count} docs (${(r.size / 1024).toFixed(1)} KB gz)`, 'log-ok');
      }
    } catch (err) {
      log(`✗ ${err.message}`, 'log-err');
    } finally {
      ghBtn.disabled = false;
    }
  });

  // ── 下载到本地 ──
  dlBtn.addEventListener('click', async () => {
    const ok = confirm(
      '⚠️  Download entire database as JSON?\n\n' +
      'Large databases may exceed browser/server limits.\n' +
      'Continue?'
    );
    if (!ok) return;

    clear();
    log(`[${new Date().toLocaleTimeString()}] Preparing dump…`, 'log-info');
    dlBtn.disabled = true;

    try {
      const res = await fetch('/api/admin?action=dumpDatabase', {
        headers: { 'Authorization': 'Bearer ' + token() },
      });
      if (!res.ok) {
        log(`✗ HTTP ${res.status}`, 'log-err');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup-${new Date().toISOString().slice(0,19).replace(/[:.]/g,'-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      log(`✓ Downloaded ${(blob.size / 1024 / 1024).toFixed(2)} MB`, 'log-ok');
    } catch (err) {
      log(`✗ ${err.message}`, 'log-err');
    } finally {
      dlBtn.disabled = false;
    }
  });
})();
// ═══════════════════════════════════════════════════════
//              Danger Zone: Recover Database
// ═══════════════════════════════════════════════════════
(function () {
  const listEl = document.getElementById('backupList');
  const statusEl = document.getElementById('backupListStatus');
  const reloadBtn = document.getElementById('reloadBackupsBtn');
  const restoreBtn = document.getElementById('restoreSelectedBtn');
  const logEl = document.getElementById('restoreLog');
  if (!listEl || !reloadBtn || !restoreBtn || !logEl) return;

  function log(text, cls = '') {
    logEl.classList.add('visible');
    const p = document.createElement('p');
    p.className = 'log-line' + (cls ? ' ' + cls : '');
    p.textContent = text;
    logEl.appendChild(p);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function clearLog() {
    logEl.innerHTML = '';
    logEl.classList.add('visible');
  }

  const token = () => localStorage.getItem('auth_token') || '';
  let backups = [];
  let selectedReleaseId = null;

  async function loadBackups() {
    listEl.innerHTML = '<div class="backup-item" style="cursor:default;opacity:.6">Loading…</div>';
    statusEl.classList.add('loading');
    statusEl.textContent = 'Loading…';
    statusEl.style.color = '';
    reloadBtn.disabled = true;

    try {
      const res = await fetch('/api/admin?action=listBackups', {
        headers: { 'Authorization': 'Bearer ' + token() },
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || `HTTP ${res.status}`);
      backups = data.backups || [];
      statusEl.classList.remove('loading');
      statusEl.textContent = `${backups.length} backup${backups.length === 1 ? '' : 's'}`;
      renderList();
    } catch (err) {
      statusEl.classList.remove('loading');
      statusEl.textContent = 'Failed to load';
      statusEl.style.color = '#e67e22';
      listEl.innerHTML = `<div class="backup-item" style="cursor:default;color:#ff9b8f">${err.message}</div>`;
    } finally {
      reloadBtn.disabled = false;
    }
  }

  function renderList() {
    if (backups.length === 0) {
      listEl.innerHTML = '<div class="backup-item" style="cursor:default;opacity:.6">No backups found.</div>';
      restoreBtn.disabled = true;
      return;
    }
    listEl.innerHTML = backups.map(b => {
      const when = b.isoDate ? new Date(b.isoDate).toLocaleString() : b.timestamp;
      const sizeKB = (b.totalSize / 1024).toFixed(1);
      return `
        <label class="backup-item" data-id="${b.id}">
          <input type="radio" name="backup-pick" value="${b.id}">
          <div class="backup-item-info">
            <div class="backup-item-title">${when}</div>
            <div class="backup-item-meta">
              ${b.collectionCount} collections · ${b.fileCount} files · ${sizeKB} KB
              ${b.hasManifest ? '· 📋 manifest' : ''}
            </div>
          </div>
        </label>
      `;
    }).join('');

    listEl.querySelectorAll('input[name="backup-pick"]').forEach(r => {
      r.addEventListener('change', () => {
        selectedReleaseId = r.value;
        // ⭐ 用的 data-id（對應 dataset.id），不是 dataset.dir ——
        //    之前寫成 .dir 導致高亮永遠不生效
        listEl.querySelectorAll('.backup-item').forEach(el => {
          el.classList.toggle('selected', el.dataset.id === selectedReleaseId);
        });
        restoreBtn.disabled = false;
      });
    });
    restoreBtn.disabled = true;
  }

  reloadBtn.addEventListener('click', loadBackups);

    restoreBtn.addEventListener('click', async () => {
    if (!selectedReleaseId) return;
    // ⭐ 備份物件的主鍵是 id（GitHub release id），不是 dir。
    //    之前寫 x.dir，b 恆為 undefined，接下來讀 b.totalSize 就會拋錯。
    const b = backups.find(x => String(x.id) === String(selectedReleaseId));
    if (!b) {
      log('✗ Selected backup is no longer in the list — reload and try again.', 'log-err');
      return;
    }
    const when = b.isoDate ? new Date(b.isoDate).toLocaleString() : b.release;

    clearLog();

    // ⭐ STEP 0: Re-authentication
    try {
      log(`[${new Date().toLocaleTimeString()}] Re-authentication required…`, 'log-info');
      await ensureReauth();
      log(`   ✓ Identity confirmed`, 'log-ok');
    } catch (e) {
      log(`✗ Cancelled at re-auth step`, 'log-err');
      return;
    }

    // ⭐ STEP 1: Backup integrity check
    const MIN_SIZE = 5 * 1024 * 1024;   // 5 MB
    const MIN_COLLECTIONS = 18;
    const sizeMB = b.totalSize / 1024 / 1024;

    log(`[${new Date().toLocaleTimeString()}] Integrity check on selected backup…`, 'log-info');
    log(`   Size: ${sizeMB.toFixed(2)} MB (min required: 5.00 MB)`, 'log-info');
    log(`   Collections: ${b.collectionCount} (min required: 18)`, 'log-info');

    if (b.totalSize < MIN_SIZE) {
      log(`✗ REFUSED — Backup is too small (${sizeMB.toFixed(2)} MB < 5 MB).`, 'log-err');
      log(`   This usually means the backup was incomplete or interrupted.`, 'log-err');
      log(`   Restoring from it would silently destroy data.`, 'log-err');
      return;
    }
    if (b.collectionCount < MIN_COLLECTIONS) {
      log(`✗ REFUSED — Only ${b.collectionCount} collections in backup (< 18).`, 'log-err');
      log(`   This backup is missing entire collections and must not be restored.`, 'log-err');
      return;
    }
    log(`   ✓ Backup passed integrity check`, 'log-ok');

    // 三重确认 #1
    const ok1 = confirm(
      `⚠️  You are about to RESTORE the live database.\n\n` +
      `Backup:  ${when}\n` +
      `Collections:  ${b?.collections?.join(', ') || '?'}\n\n` +
      `This will WIPE all current data and REPLACE it with this backup.\n\n` +
      `Continue?`
    );
    if (!ok1) return;

    // 三重确认 #2：打字
    const typed = prompt(`Type RESTORE (uppercase) to proceed:`);
    if (typed !== 'RESTORE') {
      log('✗ Cancelled (confirmation text did not match)', 'log-err');
      return;
    }

    clearLog();
    log(`[${new Date().toLocaleTimeString()}] Dry-run…`, 'log-info');

    // Dry-run
    try {
      const dryRes = await fetch('/api/admin?action=restoreDatabase', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ releaseId: selectedReleaseId, dryRun: true }),
      });
      const dryData = await dryRes.json();
      if (!dryRes.ok || !dryData.success) {
        log(`✗ Dry-run failed: ${dryData.message || 'Unknown'}`, 'log-err');
        return;
      }
      log(`[Dry-run] Would restore:`, 'log-info');
      for (const r of dryData.results) {
        log(`   ${r.action || '?'}  ${r.collection}: ${r.count} docs`, 'log-info');
      }
      log(`Total: ${dryData.totalDocs} docs`, 'log-info');
    } catch (err) {
      log(`✗ Dry-run error: ${err.message}`, 'log-err');
      return;
    }

    // 三重确认 #3
    const ok3 = confirm(
      `⚠️  FINAL confirmation.\n\n` +
      `All current data will be permanently lost.\n\n` +
      `Are you ABSOLUTELY sure?`
    );
    if (!ok3) {
      log('✗ Cancelled at final step', 'log-dim');
      return;
    }

    // 真恢复
    log(`[${new Date().toLocaleTimeString()}] Restoring…`, 'log-info');
    restoreBtn.disabled = true;
    try {
      const res = await fetch('/api/admin?action=restoreDatabase', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ releaseId: selectedReleaseId, dryRun: false }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        log(`✗ Restore failed: ${data.message || 'Unknown'}`, 'log-err');
        return;
      }
      log(`✓ Restore complete: ${data.collectionsRestored} collections, ${data.totalDocs} docs`, 'log-ok');
      // ⭐ 後端在恢復前會自動打一次快照，把它印出來 —— 出事了要能找回這個 tag
      if (data.preRestoreBackup) {
        log(`   ↳ Pre-restore snapshot: ${data.preRestoreBackup}`, 'log-info');
        log(`     (restore the current state back from this release if needed)`, 'log-dim');
      }
      for (const r of data.results) {
        if (r.error) log(`   ✗ ${r.collection}: ${r.error}`, 'log-err');
        else log(`   ✓ ${r.collection}: ${r.count} docs`, 'log-ok');
      }
    } catch (err) {
      log(`✗ ${err.message}`, 'log-err');
    } finally {
      restoreBtn.disabled = false;
    }
  });

  loadBackups();
})();
// ═══════════════════════════════════════════════════════
//              CDN Zone: 点击展开
// ═══════════════════════════════════════════════════════
(function () {
  const zone = document.getElementById('cdnZone');
  if (!zone) return;

  zone.addEventListener('click', () => {
    if (!zone.classList.contains('locked')) return;
    zone.classList.remove('locked');
    zone.classList.add('unlocked');
  });
})();
// ═══════════════════════════════════════════════════════
//              Root Re-authentication Modal
// ═══════════════════════════════════════════════════════
function ensureReauth() {
  return new Promise((resolve, reject) => {
    const modal = document.getElementById('reauthModal');
    const userInp = document.getElementById('reauthUser');
    const passInp = document.getElementById('reauthPass');
    const errEl = document.getElementById('reauthError');
    const cancelBtn = document.getElementById('reauthCancel');
    const verifyBtn = document.getElementById('reauthVerify');

    // 默认填当前登录的用户名
    const cur = (typeof getCurrentUser === 'function' && getCurrentUser()) || {};
    userInp.value = cur.username || '';
    passInp.value = '';
    errEl.hidden = true;
    errEl.textContent = '';
    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Verify & Continue';

    modal.hidden = false;
    setTimeout(() => (cur.username ? passInp : userInp).focus(), 50);

    const cleanup = () => {
      modal.hidden = true;
      verifyBtn.removeEventListener('click', onVerify);
      cancelBtn.removeEventListener('click', onCancel);
      passInp.removeEventListener('keydown', onKey);
      userInp.removeEventListener('keydown', onKey);
    };
    const onCancel = () => { cleanup(); reject(new Error('cancelled')); };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); onVerify(); } };

    const onVerify = async () => {
      const u = userInp.value.trim();
      const p = passInp.value;
      if (!u || !p) {
        errEl.textContent = 'Username and password are required';
        errEl.hidden = false;
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying…';
      errEl.hidden = true;

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || `HTTP ${res.status}`);
        }
        if (data.user.role !== 'root') {
          throw new Error('This account is not root');
        }
        cleanup();
        resolve(data);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify & Continue';
        passInp.select();
      }
    };

    verifyBtn.addEventListener('click', onVerify);
    cancelBtn.addEventListener('click', onCancel);
    passInp.addEventListener('keydown', onKey);
    userInp.addEventListener('keydown', onKey);
  });
}
  