(function() {
    "use strict";

    if (!isLoggedIn()) window.location.href = '/index.html';

    // ========== 缓存清理 ==========
    if (!localStorage.getItem('cacheClean_v3')) {
      localStorage.removeItem('problemListCache');
      localStorage.removeItem('problemListVersion');
      localStorage.removeItem('userStatesCache');
      localStorage.removeItem('favoritesCache');
      localStorage.setItem('cacheClean_v3', '1');
    }
        // ========== 随机题目抽奖动画 ==========
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 单个滚轮的滚动动画
    function spinReel(el, pool, target, duration) {
      return new Promise(resolve => {
        if (!el) return resolve();
        const start = Date.now();
        const safePool = pool && pool.length > 0 ? pool : [target];

        function tick() {
          const elapsed = Date.now() - start;
          if (elapsed >= duration) {
            el.textContent = target;
            el.classList.add('landed');
            resolve();
            return;
          }
          // 逐渐减速：前期快，后期慢
          const progress = elapsed / duration;
          const wait = 40 + Math.pow(progress, 2.5) * 260;
          el.textContent = safePool[Math.floor(Math.random() * safePool.length)];
          setTimeout(tick, wait);
        }
        tick();
      });
    }

    // 播放整个抽奖流程，返回 Promise（动画结束后 resolve）
    async function playRandomAnimation(targetId) {
      // 解析目标
      const m = String(targetId).match(/^([A-Za-z]+)(.*)$/);
      if (!m) return;
      const targetPrefix = m[1].toUpperCase();
      const targetSuffix = m[2];

      // 从缓存里收集池子
      const problemCacheRaw = localStorage.getItem('problemListCache_full');
      let allIds = [];
      try {
        allIds = (JSON.parse(problemCacheRaw)?.problems || []).map(p => p.id);
      } catch (e) {}

      const prefixSet = new Set();
      const suffixMap = {};
      for (const id of allIds) {
        const mm = String(id).match(/^([A-Za-z]+)(.*)$/);
        if (!mm) continue;
        const p = mm[1].toUpperCase();
        prefixSet.add(p);
        if (!suffixMap[p]) suffixMap[p] = [];
        suffixMap[p].push(mm[2]);
      }

      let prefixPool = Array.from(prefixSet);
      let suffixPool = suffixMap[targetPrefix] || [targetSuffix];

      // 池子至少要有 2 个才有滚动感（否则补一个相同的凑数）
      if (prefixPool.length < 2) prefixPool = [targetPrefix, targetPrefix];
      if (suffixPool.length < 2) suffixPool = [targetSuffix, targetSuffix];

      // 创建遮罩
      const overlay = document.createElement('div');
      overlay.className = 'slot-overlay';
      overlay.innerHTML = `
        <div class="slot-machine">
          <div class="slot-title">🎲 Random Problem 🎲</div>
          <div class="slot-reels">
            <div class="slot-reel" id="slotPrefix">—</div>
            <div class="slot-reel" id="slotSuffix">—</div>
          </div>
          <div class="slot-status" id="slotStatus">Rolling…</div>
        </div>
      `;
      document.body.appendChild(overlay);
      // 触发 fade-in
      requestAnimationFrame(() => overlay.classList.add('show'));

      const prefixEl = document.getElementById('slotPrefix');
      const suffixEl = document.getElementById('slotSuffix');
      const statusEl = document.getElementById('slotStatus');

      // 1) 先滚前缀
      await sleep(200);
      await spinReel(prefixEl, prefixPool, targetPrefix, 900);

      // 2) 再滚后缀
      statusEl.textContent = 'Locking…';
      await sleep(100);
      await spinReel(suffixEl, suffixPool, targetSuffix, 800);

      // 3) 展示结果
      statusEl.textContent = `🎉 ${targetPrefix}${targetSuffix}`;
      statusEl.classList.add('done');
      await sleep(500);

      // 4) 淡出
      overlay.classList.add('fade-out');
      await sleep(300);
      overlay.remove();
    }
    const mainContainer = document.getElementById('mainContent');

    // ========== 标签分类配置 ==========
    // ⭐ 修改这里即可调整分类与标签
    const TAG_CATEGORIES = [
      {
        title: 'Learn',
        tags: [
          { name: 'Tricks', placeholder: true },
          { name: 'Advanced skills', placeholder: true },
        ],
      },
      {
        title: 'Exercises',
        tags: [
          { name: 'DSE' },
        ],
      },
      {
        title: 'Local Competitions',
        tags: [
          { name: 'HKMHASC' },
          { name: 'HKMO' },
          { name: 'IMO Prelim' },
        ],
      },
      {
        title: 'External Competitions',
        tags: [
          { name: 'IMO Shortlist', placeholder: true },
          { name: 'CMO', placeholder: true },
          { name: 'APMO', placeholder: true },
        ],
      },
    ];

    // ========== 状态变量 ==========
    let allProblems = [];
    let filteredProblems = [];
    let allTags = [];
    let userStates = {};
    let activeTags = new Set();
    let currentPage = 1;
    const pageLimit = 60;
    let totalPages = 1;
    let sortBy = 'id';
    let sortOrder = 'asc';
    let idFilterPattern = '';
    let visibilityFilter = 'all';
    window.favorites = new Set();

    // 刷新冷却相关
    let refreshCooldownRemaining = 0;
    let refreshCooldownTimer = null;

    // ========== 辅助函数 ==========
    function escapeHtml(str) {
      return String(str).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]);
    }

    function getPageFromURL() {
      const p = parseInt(new URLSearchParams(window.location.search).get('page'));
      return (p > 0) ? p : 1;
    }

    // ========== 刷新按钮冷却 ==========
    function updateRefreshButtonState() {
      const btn = document.getElementById('refreshProblemsBtn');
      if (!btn) return;
      if (refreshCooldownRemaining > 0) {
        btn.disabled = true;
        btn.title = `${refreshCooldownRemaining}s`;
      } else {
        btn.disabled = false;
        btn.title = '';
      }
    }

    function startRefreshCooldown(seconds = 30) {
      refreshCooldownRemaining = seconds;
      if (refreshCooldownTimer) clearInterval(refreshCooldownTimer);
      refreshCooldownTimer = setInterval(() => {
        refreshCooldownRemaining--;
        if (refreshCooldownRemaining <= 0) {
          clearInterval(refreshCooldownTimer);
          refreshCooldownRemaining = 0;
        }
        updateRefreshButtonState();
      }, 1000);
      updateRefreshButtonState();
    }

    // ========== UserStates 缓存 ==========
    function loadUserStatesFromCache() {
      const raw = localStorage.getItem('userStatesCache');
      if (!raw) return false;
      try {
        const data = JSON.parse(raw);
        if (data.timestamp && (Date.now() - data.timestamp > 24 * 60 * 60 * 1000)) return false;
        if (!data.states) return false;
        userStates = data.states;
        return true;
      } catch { return false; }
    }

    function saveUserStatesToCache(states) {
      localStorage.setItem('userStatesCache', JSON.stringify({
        states: states,
        timestamp: Date.now()
      }));
    }

    // ========== Favorites 缓存 ==========
    function loadFavoritesFromCache() {
      const raw = localStorage.getItem('favoritesCache');
      if (!raw) return false;
      try {
        const data = JSON.parse(raw);
        if (data.timestamp && (Date.now() - data.timestamp > 24 * 60 * 60 * 1000)) return false;
        if (!data.favorites) return false;
        window.favorites = new Set(data.favorites);
        return true;
      } catch { return false; }
    }

    function saveFavoritesToCache(favs) {
      localStorage.setItem('favoritesCache', JSON.stringify({
        favorites: Array.from(favs),
        timestamp: Date.now()
      }));
    }

    // ========== 题目列表缓存 ==========
    function loadProblemsFromCache() {
      const cacheKey = 'problemListCache_full';
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return false;
      try {
        const data = JSON.parse(cached);
        if (data.timestamp && (Date.now() - data.timestamp > 24 * 60 * 60 * 1000)) return false;
        if (!data.problems || !data.allTags) return false;
        allProblems = data.problems;
        allTags = data.allTags;
        return true;
      } catch { return false; }
    }

    function saveProblemsToCache(problems, tags) {
      localStorage.setItem('problemListCache_full', JSON.stringify({
        problems: problems,
        allTags: tags,
        timestamp: Date.now()
      }));
    }

    // ========== 从服务器获取数据 ==========
    async function fetchAllProblems(knownVersion) {
      try {
        const data = await apiCall('/api/problem?all=1');
        if (data.success && data.problems) {
          allProblems = data.problems;
          allTags = data.allTags || [];
          saveProblemsToCache(allProblems, allTags);
          if (knownVersion !== undefined) {
            localStorage.setItem('problemListVersion', String(knownVersion));
          } else {
            const verRes = await apiCall('/api/problem?checkVersion=1');
            if (verRes.success) localStorage.setItem('problemListVersion', String(verRes.version));
          }
          return true;
        }
      } catch (e) { console.error(e); }
      return false;
    }

    async function fetchUserStates() {
      try {
        const data = await apiCall('/api/users?action=stats');
        if (data.success) {
          userStates = data.states || {};
          saveUserStatesToCache(userStates);
        }
      } catch (e) { console.error(e); }
    }

    async function fetchFavorites() {
      try {
        const data = await apiCall('/api/users?action=favorites');
        if (data.success) {
          window.favorites = new Set(data.favorites || []);
          saveFavoritesToCache(window.favorites);
        }
      } catch (e) { console.error(e); }
    }

    // ========== 刷新数据（核心优化） ==========
    async function refreshData() {
      const [verRes, preload] = await Promise.all([
        apiCall('/api/problem?checkVersion=1').catch(e => {
          console.warn('[refreshData] checkVersion failed:', e.message);
          return null;
        }),
        apiCall('/api/users?action=preload').catch(e => {
          console.warn('[refreshData] preload failed:', e.message);
          return null;
        })
      ]);

      if (preload && preload.success) {
        userStates = preload.states || {};
        window.favorites = new Set(preload.favorites || []);
        saveUserStatesToCache(userStates);
        saveFavoritesToCache(window.favorites);
      }

      let versionChanged = false;
      if (verRes && verRes.success) {
        const newVersion = String(verRes.version);
        const cachedVersion = localStorage.getItem('problemListVersion');
        if (!cachedVersion || cachedVersion !== newVersion) {
          versionChanged = true;
          try {
            await fetchAllProblems(newVersion);
          } catch (e) {
            console.error('[refreshData] fetchAllProblems failed:', e);
          }
        }
      } else {
        console.warn('[refreshData] checkVersion failed, cannot verify version');
      }

      applyFiltersAndSort();
      renderFullPage();

      return { versionChanged };
    }

    // ========== 客户端过滤与排序 ==========
    function applyFiltersAndSort() {
      let problems = allProblems.slice();

      if (idFilterPattern) {
        const pattern = idFilterPattern;
        problems = problems.filter(prob => {
          const id = String(prob.id);
          if (pattern.startsWith('%') && pattern.endsWith('%')) {
            const middle = pattern.slice(1, -1);
            return id.includes(middle);
          } else if (pattern.startsWith('%')) {
            const suffix = pattern.slice(1);
            return id.endsWith(suffix);
          } else if (pattern.endsWith('%')) {
            const prefix = pattern.slice(0, -1);
            return id.startsWith(prefix);
          } else {
            return id === pattern;
          }
        });
      }

      // ⭐ AND 逻辑：题目必须同时包含所有选中的标签
      if (activeTags.size > 0) {
        const activeArr = Array.from(activeTags);
        problems = problems.filter(p => {
          const pTags = Array.isArray(p.tags) ? p.tags : [];
          return activeArr.every(t => pTags.includes(t));
        });
      }

      if (visibilityFilter === 'public') {
        problems = problems.filter(p => p.public !== false);
      } else if (visibilityFilter === 'hidden') {
        problems = problems.filter(p => p.public === false);
      }

      const sorted = problems.sort((a, b) => {
        let valA, valB;
        if (sortBy === 'difficulty') {
          valA = a.difficulty || 0;
          valB = b.difficulty || 0;
        } else if (sortBy === 'solves') {
          valA = a.solves || 0;
          valB = b.solves || 0;
        } else {
          const regex = /^([A-Za-z]*)(\d+)$/;
          const matchA = a.id.match(regex);
          const matchB = b.id.match(regex);
          if (matchA && matchB) {
            const prefixA = matchA[1].toLowerCase();
            const prefixB = matchB[1].toLowerCase();
            if (prefixA !== prefixB) {
              return sortOrder === 'asc' ? prefixA.localeCompare(prefixB) : prefixB.localeCompare(prefixA);
            }
            const numA = parseInt(matchA[2], 10);
            const numB = parseInt(matchB[2], 10);
            return sortOrder === 'asc' ? numA - numB : numB - numA;
          }
          if (a.id < b.id) return sortOrder === 'asc' ? -1 : 1;
          if (a.id > b.id) return sortOrder === 'asc' ? 1 : -1;
          return 0;
        }
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      });

      filteredProblems = sorted;
      totalPages = Math.ceil(filteredProblems.length / pageLimit) || 1;
      if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
    }

    // ========== 渲染：分类卡片网格 ==========
    function renderTagCategories() {
      const tagCounts = {};
      allProblems.forEach(p => {
        (p.tags || []).forEach(t => {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        });
      });

      let html = '<div class="cat-grid">';
      TAG_CATEGORIES.forEach(cat => {
        html += '<div class="cat-col">';
        html += '<div class="cat-box">';
        html += `<div class="cat-heading">${escapeHtml(cat.title)}</div>`;
        html += '<ul class="cat-list">';
        cat.tags.forEach(tag => {
          const count = tagCounts[tag.name] || 0;
          const active = activeTags.has(tag.name) ? ' active' : '';
          const disabled = tag.placeholder ? ' disabled' : '';
          html += `<li class="cat-item${active}${disabled}" data-tag="${escapeHtml(tag.name)}">
            <span class="cat-text">${escapeHtml(tag.name)}</span>
            <span class="cat-badge">${count}</span>
          </li>`;
        });
        html += '</ul></div></div>';
      });
      html += '</div>';
      return html;
    }
        // ========== 渲染：Tags dropdown ==========
    function renderTagsDropdown() {
      // 统计所有出现的 tag
      const tagCounts = {};
      allProblems.forEach(p => {
        (p.tags || []).forEach(t => {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        });
      });

      // union：分类配置里的 tag + 题目中实际出现的 tag
      const union = new Set();
      TAG_CATEGORIES.forEach(cat => cat.tags.forEach(t => union.add(t.name)));
      Object.keys(tagCounts).forEach(t => union.add(t));

      const sorted = Array.from(union).sort((a, b) => a.localeCompare(b));

      if (sorted.length === 0) {
        return '<li class="tag-dd-empty">No tags yet.</li>';
      }

      return sorted.map(t => {
        const count = tagCounts[t] || 0;
        const isActive = activeTags.has(t);
        const active = isActive ? ' active' : '';
        const empty = (count === 0 && !isActive) ? ' empty' : '';
        return `<li>
          <a href="javascript:void(0)"
             class="tag-dd-item${active}${empty}"
             data-tag="${escapeHtml(t)}">
            <span class="tag-dd-text">${escapeHtml(t)}</span>
            <span class="tag-dd-badge">${count}</span>
          </a>
        </li>`;
      }).join('');
    }

    // ========== 渲染：骨架屏 ==========
    function renderSkeletonRows(count = 30) {
      let html = '';
      for (let i = 0; i < count; i++) {
        html += `<tr class="skeleton-row">
          <td><span class="skeleton-line" style="width:30px"></span></td>
          <td><span class="skeleton-line" style="width:60px"></span></td>
          <td><span class="skeleton-line" style="width:120px"></span></td>
          <td><span class="skeleton-line" style="width:100px"></span></td>
          <td><span class="skeleton-line" style="width:50px"></span></td>
          <td><span class="skeleton-line" style="width:40px"></span></td>
        </tr>`;
      }
      return html;
    }

    function renderPagination() {
      let html = '<div class="pagination-placeholder">';
      if (totalPages > 1) {
        html += '<div class="pagination">';
        for (let i = 1; i <= totalPages; i++) {
          html += `<a class="${i === currentPage ? 'active' : ''}" href="?page=${i}">${i}</a>`;
        }
        html += '</div>';
      } else {
        html += '<div style="height:40px;"></div>';
      }
      html += '</div>';
      return html;
    }

    function renderTableBody(problems) {
      const isAdmin = getCurrentUser()?.role === 'admin' || getCurrentUser()?.role === 'root';
      let rowsHtml = '';
      problems.forEach(prob => {
        const state = userStates[prob.id] || 'not_started';
        const rowClass = state === 'failed' ? 'state-failed' : (state === 'passed' ? 'state-passed' : 'state-not_started');
        const isFav = window.favorites?.has(prob.id) || false;
        const starIcon = `<i class="favorite-star ${isFav ? 'fas' : 'far'} fa-star" style="cursor:pointer;font-size:1.2rem;color:${isFav ? '#f1c40f' : '#aaa'};"></i>`;
        let statusIcon = '';
        if (state === 'passed') statusIcon = '<i class="fa fa-check-circle fa-green"></i>';
        else if (state === 'failed') statusIcon = '<i class="fa fa-times-circle fa-red"></i>';
        let publicIcon = '';
        if (isAdmin && prob.public === false) {
          publicIcon = `<i class="fas fa-eye-slash" style="color: var(--text-secondary); margin-left: 0.3rem; text-decoration: line-through;" title="Not public"></i>`;
        }
        const tagsHtml = (prob.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
        let diffDisplay, colorStyle = '', extraClass = '';
        if (prob.difficulty === 0) {
          diffDisplay = '∞';
        } else {
          const diff = prob.difficulty;
          diffDisplay = diff.toFixed(2);
          if (diff >= 1 && diff < 2) {
            const lightness = 85;
            colorStyle = `background-color:hsl(0,0%,${lightness}%)!important;color:#000000!important;border-radius:4px;padding:0 6px;`;
          } else if (diff >= 2 && diff < 3) {
            const t = (diff - 2) / 1;
            const lightness = 70 - t * 35;
            colorStyle = `background-color:hsl(120,60%,${lightness}%)!important;color:#ffffff!important;border-radius:4px;padding:0 6px;`;
          } else if (diff >= 3 && diff < 4) {
            const t = (diff - 3) / 1;
            const lightness = 65 - t * 30;
            colorStyle = `background-color:hsl(210,70%,${lightness}%)!important;color:#ffffff!important;border-radius:4px;padding:0 6px;`;
          } else if (diff >= 4 && diff < 5) {
            const t = (diff - 4) / 1;
            const lightness = 65 - t * 30;
            colorStyle = `background-color:hsl(280,60%,${lightness}%)!important;color:#ffffff!important;border-radius:4px;padding:0 6px;`;
          } else if (diff >= 5 && diff < 6) {
            const t = (diff - 5) / 1;
            const lightness = 70 - t * 30;
            colorStyle = `background-color:hsl(45,80%,${lightness}%)!important;color:#000000!important;border-radius:4px;padding:0 6px;`;
          } else if (diff >= 6 && diff < 7) {
            const t = (diff - 6) / 1;
            const lightness = 60 - t * 25;
            colorStyle = `background-color:hsl(0,70%,${lightness}%)!important;color:#ffffff!important;border-radius:4px;padding:0 6px;`;
          } else if (diff >= 7 && diff < 8) {
            extraClass = 'rainbow-bg';
            colorStyle = `color:#000000!important;border-radius:4px;padding:0 6px;`;
          } else if (diff >= 8 && diff < 9) {
            extraClass = 'star-shine';
            colorStyle = `color:#000000!important;border-radius:4px;padding:0 6px;`;
          } else {
            extraClass = 'chaos';
            colorStyle = `color:#ffffff!important;border-radius:4px;padding:0 6px;`;
          }
        }
        rowsHtml += `<tr class="problem-row ${rowClass}" data-id="${prob.id}" onclick="sessionStorage.setItem('problemListScroll',window.scrollY);location.href='/problems/${encodeURIComponent(prob.id)}'">
          <td class="col-fav" onclick="event.stopPropagation(); toggleFavorite('${prob.id}', this)">${starIcon}</td>
          <td class="col-id">${prob.id}</td>
          <td class="col-name">${escapeHtml(prob.name)}${statusIcon}${publicIcon}</td>
          <td class="col-tags"><div class="tags-container">${tagsHtml}</div></td>
          <td class="col-level difficulty-cell ${extraClass}" style="${colorStyle}">${diffDisplay}</td>
          <td class="col-solves">${prob.solves || 0}</td>
        </tr>`;
      });
      return rowsHtml;
    }

    function renderFullPage() {
      const isAdmin = getCurrentUser()?.role === 'admin' || getCurrentUser()?.role === 'root';
      const showTags = localStorage.getItem('showTags') === 'true';
      const start = (currentPage - 1) * pageLimit;
      const pageProblems = filteredProblems.slice(start, start + pageLimit);

      // ⭐ 分类卡片（替代原 filter-bar）
      const filterHtml = renderTagCategories();

      let visibilityHtml = '';
      if (isAdmin) {
        const labels = { 'all': 'All', 'public': 'Public', 'hidden': 'Hidden' };
        visibilityHtml = `<div style="margin-top:0.5rem;display:flex;gap:0.5rem;align-items:center;">
          <button id="visibilityFilterBtn" class="btn btn-secondary" style="padding:0.2rem 0.8rem;">Visibility: ${labels[visibilityFilter]}</button>
        </div>`;
      }

      let rowsHtml;
      if (pageProblems.length === 0) {
        rowsHtml = '<tr><td colspan="6" class="loading-msg">No problems found.</td></tr>';
      } else {
        rowsHtml = renderTableBody(pageProblems);
      }

      const pagHtml = renderPagination();

      const fullHtml = `
        <div class="updates-panel" style="padding:0.5rem;">
          <div class="updates-header">
            <h2>Problem Set</h2>
            <div>
              <button id="refreshProblemsBtn" class="btn btn-primary" style="margin-left:0.5rem;"><i class="fas fa-sync-alt"></i></button>
              <button id="randomUnsolvedBtn" class="btn btn-primary" style="margin-left:1rem;">Random Unsolved</button>
              <a href="/problems/bookmarked" class="btn btn-secondary" style="margin-left:0.5rem;">Bookmarked</a>
            </div>
          </div>
          <div class="tag-dd-row">
            <div class="tag-dd" id="tagDropdown">
              <button class="tag-dd-btn" id="tagDropdownBtn" type="button">
                <i class="fas fa-tag"></i>
                <span>Tags</span>
                <span class="caret">▾</span>
              </button>
              <ul class="tag-dd-menu" id="tagDropdownMenu">
                ${renderTagsDropdown()}
              </ul>
            </div>
            <span class="tag-dd-hint"><code>AND</code></span>
          </div>
          ${filterHtml}
          <div class="visibility-filter-container">${visibilityHtml}</div>
          <div class="id-filter-bar" style="margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <span style="font-weight:600;">Filter ID:</span>
            <input type="text" id="idFilterInput" style="padding:0.2rem 0.5rem; border:1px solid var(--border-color); border-radius:4px; flex:1; min-width:150px;">
            <button class="btn btn-secondary" id="idFilterClearBtn" style="padding:0.2rem 0.8rem;">Clear</button>
          </div>
          <div id="paginationTopContainer">${pagHtml}</div>
          <div class="table-responsive">
            <table class="problems-table ${showTags ? 'show-tags' : ''}">
              <thead>
                <tr>
                  <th class="col-fav"></th>
                  <th class="col-id sortable" data-sort="id">ID</th>
                  <th class="col-name sortable" data-sort="id">Name</th>
                  <th class="col-tags">Tags</th>
                  <th class="col-level sortable" data-sort="difficulty">Level</th>
                  <th class="col-solves sortable" data-sort="solves">Solves</th>
                </tr>
              </thead>
              <tbody id="problemsBody">${rowsHtml}</tbody>
            </table>
          </div>
          <div id="paginationContainer">${pagHtml}</div>
        </div>
      `;

      mainContainer.innerHTML = fullHtml;
      const idInput = document.getElementById('idFilterInput');
      if (idInput) idInput.value = idFilterPattern;
      bindEvents();
      updateRefreshButtonState();
    }

    function showSkeleton() {
      const skeletonRows = renderSkeletonRows(30);
      const html = `
        <div class="updates-panel refreshing" style="padding:0.5rem;">
          <div class="updates-header">
            <h2>Loading Problem Set...</h2>
            <div></div>
          </div>
          <div class="tag-dd-row">
            <button class="tag-dd-btn" disabled>
              <i class="fas fa-tag"></i>
              <span>Tags</span>
              <span class="caret">▾</span>
            </button>
          </div>
          <div class="cat-grid">
            <div class="cat-col">
              <div class="cat-box">
                <div class="cat-heading">Loading...</div>
                <ul class="cat-list">
                  <li class="cat-item disabled"><span class="cat-text">—</span><span class="cat-badge">–</span></li>
                </ul>
              </div>
            </div>
          </div>
          <div id="paginationTopContainer"></div>
          <div class="table-responsive">
            <table class="problems-table">
              <thead>
                <tr>
                  <th class="col-fav"></th>
                  <th class="col-id sortable" data-sort="id">ID</th>
                  <th class="col-name sortable" data-sort="id">Name</th>
                  <th class="col-tags">Tags</th>
                  <th class="col-level sortable" data-sort="difficulty">Level</th>
                  <th class="col-solves sortable" data-sort="solves">Solves</th>
                </tr>
              </thead>
              <tbody id="problemsBody">${skeletonRows}</tbody>
            </table>
          </div>
          <div id="paginationContainer"></div>
        </div>
      `;
      mainContainer.innerHTML = html;
    }

    // ========== 事件绑定 ==========
    function bindEvents() {
      document.querySelectorAll('.sortable').forEach(th => {
        if (th.dataset.listener) return;
        th.dataset.listener = 'true';
        th.addEventListener('click', () => {
          const field = th.dataset.sort;
          if (sortBy === field) {
            sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
          } else {
            sortBy = field;
            sortOrder = 'asc';
          }
          currentPage = 1;
          applyFiltersAndSort();
          updateURL();
          renderFullPage();
        });
      });
      document.querySelectorAll('.cat-item:not(.disabled)').forEach(item => {
        if (item.dataset.listener) return;
        item.dataset.listener = 'true';
        item.addEventListener('click', () => {
          const tag = item.dataset.tag;

          // 找出这个 tag 属于哪个分类
          const cat = TAG_CATEGORIES.find(c => c.tags.some(t => t.name === tag));
          if (cat) {
            // 先清掉同分类下的其他 tag
            for (const t of cat.tags) {
              if (t.name !== tag) activeTags.delete(t.name);
            }
          }

          // 再 toggle 当前 tag
          if (activeTags.has(tag)) activeTags.delete(tag);
          else activeTags.add(tag);

          localStorage.setItem('problemFilterTags', JSON.stringify(Array.from(activeTags)));
          currentPage = 1;
          applyFiltersAndSort();
          updateURL();
          renderFullPage();
        });
      });
            // ⭐ Tags dropdown 开关
      const tagDropdown = document.getElementById('tagDropdown');
      const tagDropdownBtn = document.getElementById('tagDropdownBtn');
      if (tagDropdownBtn && !tagDropdownBtn.dataset.listener) {
        tagDropdownBtn.dataset.listener = 'true';
        tagDropdownBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          tagDropdown.classList.toggle('open');
        });
      }

      // ⭐ document 层级：点击外部关闭（只绑一次）
      if (!window.__tagDropdownGlobalBound) {
        window.__tagDropdownGlobalBound = true;
        document.addEventListener('click', (e) => {
          const dd = document.getElementById('tagDropdown');
          if (dd && dd.classList.contains('open') && !dd.contains(e.target)) {
            dd.classList.remove('open');
          }
        });
      }

      // ⭐ dropdown 内 tag 点击 → 直接 apply filter
      document.querySelectorAll('.tag-dd-item:not(.empty)').forEach(item => {
        if (item.dataset.listener) return;
        item.dataset.listener = 'true';
        item.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const tag = item.dataset.tag;
          if (activeTags.has(tag)) activeTags.delete(tag);
          else activeTags.add(tag);
          localStorage.setItem('problemFilterTags', JSON.stringify(Array.from(activeTags)));
          currentPage = 1;
          applyFiltersAndSort();
          updateURL();
          renderFullPage();
          // 重建后保持 dropdown 打开，方便连续选择
          const dd = document.getElementById('tagDropdown');
          if (dd) dd.classList.add('open');
        });
      });

      document.querySelectorAll('.pagination a').forEach(link => {
        if (link.dataset.listener) return;
        link.dataset.listener = 'true';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const href = link.getAttribute('href');
          if (!href) return;
          const page = parseInt(new URLSearchParams(href.substring(href.indexOf('?'))).get('page'));
          if (page && page !== currentPage) {
            currentPage = page;
            updateURL();
            renderFullPage();
          }
        });
      });

      const randomBtn = document.getElementById('randomUnsolvedBtn');
      if (randomBtn && !randomBtn.dataset.listener) {
        randomBtn.dataset.listener = 'true';
        randomBtn.onclick = async () => {
          try {
            const problemCacheRaw = localStorage.getItem('problemListCache_full');
            if (!problemCacheRaw) {
              alert('Problem list not cached. Please refresh the page.');
              return;
            }
            const problemCache = JSON.parse(problemCacheRaw);
            if (!problemCache.problems || !Array.isArray(problemCache.problems)) {
              alert('Invalid problem cache.');
              return;
            }
            const allIds = problemCache.problems.map(p => p.id);

            const stateCacheRaw = localStorage.getItem('userStatesCache');
            let userStates = {};
            if (stateCacheRaw) {
              const stateCache = JSON.parse(stateCacheRaw);
              userStates = stateCache.states || {};
            }

            // 过滤未解决
            const unsolved = allIds.filter(id => userStates[id] !== 'passed');
            if (unsolved.length === 0) {
              alert('🎉 All problems solved!');
              return;
            }

            // 按前缀分组
            const PREFIXES = ['IP', 'HA', 'MO'];
            const buckets = {};
            PREFIXES.forEach(p => buckets[p] = []);
            for (const id of unsolved) {
              const m = String(id).match(/^([A-Za-z]+)/);
              if (!m) continue;
              const prefix = m[1].toUpperCase();
              if (buckets[prefix]) buckets[prefix].push(id);
            }

            const available = PREFIXES.filter(p => buckets[p].length > 0);
            if (available.length === 0) {
              alert('🎉 All problems solved!');
              return;
            }

            // 均匀选前缀 → 从该前缀池随机抽一道
            const chosenPrefix = available[Math.floor(Math.random() * available.length)];
            const pool = buckets[chosenPrefix];
            const randomId = pool[Math.floor(Math.random() * pool.length)];

            // ⭐ 看 settings 开关决定是否播放动画
            const animEnabled = localStorage.getItem('randomAnimation') !== 'false';

            if (animEnabled) {
              // 禁用按钮防连点
              randomBtn.disabled = true;
              try {
                await playRandomAnimation(randomId);
              } catch (e) {
                console.warn('Animation failed:', e);
              }
              location.href = `/problems/${encodeURIComponent(randomId)}`;
              // 注意：跳转后本页卸载，不需要恢复按钮
            } else {
              location.href = `/problems/${encodeURIComponent(randomId)}`;
            }

          } catch (e) {
            console.error('Random unsolved error:', e);
            alert('Error selecting random problem. Please try again.');
          }
        };
      }

      const idInput = document.getElementById('idFilterInput');
      if (idInput && !idInput.dataset.listener) {
        idInput.dataset.listener = 'true';
        idInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); applyIdFilter(); }
        });
      }

      const clearBtn = document.getElementById('idFilterClearBtn');
      if (clearBtn && !clearBtn.dataset.listener) {
        clearBtn.dataset.listener = 'true';
        clearBtn.addEventListener('click', () => {
          const input = document.getElementById('idFilterInput');
          if (input) input.value = '';
          idFilterPattern = '';
          currentPage = 1;
          applyFiltersAndSort();
          updateURL();
          renderFullPage();
        });
      }

      const visBtn = document.getElementById('visibilityFilterBtn');
      if (visBtn && !visBtn.dataset.listener) {
        visBtn.dataset.listener = 'true';
        visBtn.addEventListener('click', () => {
          const modes = ['all', 'public', 'hidden'];
          let idx = modes.indexOf(visibilityFilter);
          idx = (idx + 1) % modes.length;
          visibilityFilter = modes[idx];
          currentPage = 1;
          applyFiltersAndSort();
          updateURL();
          renderFullPage();
        });
      }

      const refreshBtn = document.getElementById('refreshProblemsBtn');
      if (refreshBtn && !refreshBtn.dataset.listener) {
        refreshBtn.dataset.listener = 'true';
        refreshBtn.addEventListener('click', async function() {
          if (this.disabled) return;
          startRefreshCooldown(30);
          const result = await refreshData();
          if (result && result.versionChanged) {
            const btn = this;
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i>';
            setTimeout(() => { btn.innerHTML = orig; }, 800);
          }
        });
      }
    }

    // ========== 其他功能 ==========
    function applyIdFilter() {
      const input = document.getElementById('idFilterInput');
      if (!input) return;
      const raw = input.value.trim();
      idFilterPattern = raw;
      currentPage = 1;
      applyFiltersAndSort();
      updateURL();
      renderFullPage();
    }

    function updateURL() {
      const params = new URLSearchParams();
      params.set('page', currentPage);
      if (sortBy !== 'id') params.set('sortBy', sortBy);
      if (sortOrder !== 'asc') params.set('order', sortOrder);
      if (activeTags.size > 0) params.set('tags', Array.from(activeTags).join(','));
      if (idFilterPattern) params.set('idfilter', idFilterPattern);
      if (visibilityFilter !== 'all') params.set('visibility', visibilityFilter);
      window.history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
    }

    async function toggleFavorite(problemId, starCell) {
      const starIcon = starCell.querySelector('i');
      const reallyFav = starIcon.classList.contains('fas');
      if (reallyFav) {
        starIcon.classList.replace('fas', 'far');
        starIcon.style.color = '#aaa';
        window.favorites.delete(problemId);
        saveFavoritesToCache(window.favorites);
      } else {
        starIcon.classList.replace('far', 'fas');
        starIcon.style.color = '#f1c40f';
        window.favorites.add(problemId);
        saveFavoritesToCache(window.favorites);
      }
      try {
        const res = await apiCall('/api/users?action=favorite', 'POST', { problemId });
        if (res.success) {
          window.favorites = new Set(res.favorites);
          saveFavoritesToCache(window.favorites);
        } else {
          if (reallyFav) {
            window.favorites.add(problemId);
            starIcon.classList.replace('far', 'fas');
            starIcon.style.color = '#f1c40f';
          } else {
            window.favorites.delete(problemId);
            starIcon.classList.replace('fas', 'far');
            starIcon.style.color = '#aaa';
          }
          saveFavoritesToCache(window.favorites);
          alert('Error toggling favorite');
        }
      } catch (e) {
        if (reallyFav) {
          window.favorites.add(problemId);
          starIcon.classList.replace('far', 'fas');
          starIcon.style.color = '#f1c40f';
        } else {
          window.favorites.delete(problemId);
          starIcon.classList.replace('fas', 'far');
          starIcon.style.color = '#aaa';
        }
        saveFavoritesToCache(window.favorites);
        alert('Network error');
      }
    }

    // ========== 初始化 ==========
    async function init() {
      const params = new URLSearchParams(window.location.search);
      sortBy = params.get('sortBy') || 'id';
      sortOrder = params.get('order') || 'asc';
      if (params.has('tags')) {
        activeTags = new Set(params.get('tags').split(','));
      } else {
        const saved = localStorage.getItem('problemFilterTags');
        if (saved) {
          try { activeTags = new Set(JSON.parse(saved)); } catch (e) {}
        }
      }
      if (params.has('idfilter')) {
        idFilterPattern = params.get('idfilter');
      } else {
        idFilterPattern = '';
      }
      if (params.has('visibility')) {
        visibilityFilter = params.get('visibility');
        if (!['all', 'public', 'hidden'].includes(visibilityFilter)) visibilityFilter = 'all';
      } else {
        visibilityFilter = 'all';
      }
      currentPage = getPageFromURL();

      const hasProblems = loadProblemsFromCache();
      const hasStates = loadUserStatesFromCache();
      const hasFavs = loadFavoritesFromCache();

      if (hasProblems && hasStates && hasFavs) {
        applyFiltersAndSort();
        renderFullPage();
        refreshData();
      } else {
        showSkeleton();
        const [problemsRes, preload] = await Promise.all([
          fetchAllProblems(),
          apiCall('/api/users?action=preload')
        ]);
        if (preload.success) {
          userStates = preload.states || {};
          window.favorites = new Set(preload.favorites || []);
          saveUserStatesToCache(userStates);
          saveFavoritesToCache(window.favorites);
        }
        applyFiltersAndSort();
        renderFullPage();
      }

      const savedScroll = sessionStorage.getItem('problemListScroll');
      if (savedScroll) {
        window.scrollTo(0, parseInt(savedScroll));
        sessionStorage.removeItem('problemListScroll');
      }
    }

    window.toggleFavorite = toggleFavorite;
    window.addEventListener('popstate', init);
    init();
  })();