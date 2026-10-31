
    if (!isLoggedIn()) window.location.href = '/index.html';

    const mainContainer = document.getElementById('mainContent');
    const currentUsername = getCurrentUser()?.username || '';

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    // ⭐ 相对时间
    function formatLastSeen(ts) {
      if (!ts) return 'never';
      const d = new Date(ts);
      const now = Date.now();
      const diff = now - d.getTime();

      if (diff < 0) return 'just now';
      if (diff < 60_000) return 'just now';
      if (diff < 3600_000) {
        const m = Math.floor(diff / 60_000);
        return `${m} minute${m > 1 ? 's' : ''} ago`;
      }
      if (diff < 86400_000) {
        const h = Math.floor(diff / 3600_000);
        return `${h} hour${h > 1 ? 's' : ''} ago`;
      }

      const p = n => String(n).padStart(2, '0');
      const hhmm = `${p(d.getHours())}:${p(d.getMinutes())}`;
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);

      if (d.toDateString() === yesterday.toDateString()) return `yesterday ${hhmm}`;
      if (d.getFullYear() === today.getFullYear()) {
        return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hhmm}`;
      }
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    // ⭐ 头像 + 绿点
    function avatarHtml(user, size = 24) {
      const pfp = user.pfp;
      const online = user.online;
      const inner = pfp
        ? `<img src="${escapeHtml(pfp)}" alt="" loading="lazy" decoding="async">`
        : `<div class="avatar-placeholder"><i class="fas fa-user"></i></div>`;
      const dot = online ? '<span class="online-dot" title="Online"></span>' : '';
      return `<span class="user-avatar-wrap" style="width:${size}px;height:${size}px;">${inner}${dot}</span>`;
    }

    /* ═══════════════════════════════════════════════
       ⭐ Rating 字重 + 徽章
       ═══════════════════════════════════════════════ */

    function ratingWeight(rating) {
      if (rating >= 2900) return 900;

      const bounds = [
        { min: 2600, base: 700, inc: 100 },  // [2600, 2900)
        { min: 2400, base: 600, inc: 100 },  // [2400, 2600)
        { min: 2200, base: 600, inc: 100 },  // [2200, 2400)
        { min: 2100, base: 500, inc: 100 },  // [2100, 2200)
        { min: 1900, base: 500, inc: 100 },  // [1900, 2100)
        { min: 1600, base: 500, inc: 100 },  // [1600, 1900)
        { min: 1400, base: 400, inc: 100 },  // [1400, 1600)
        { min: 1200, base: 400, inc: 100 },  // [1200, 1400)
        { min: 1000, base: 400, inc: 100 },  // [1000, 1200)
      ];

      let tier = bounds[bounds.length - 1];
      let nextMin = 1200;
      let tierIdx = bounds.length - 1;

      for (let i = 0; i < bounds.length; i++) {
        if (rating >= bounds[i].min) {
          tier = bounds[i];
          nextMin = i > 0 ? bounds[i - 1].min : 2900;
          tierIdx = i;
          break;
        }
      }

      const range = nextMin - tier.min;
      const p = range > 0 ? (rating - tier.min) / range : 0;
      let weight = tier.base + p * tier.inc;

      if (rating === tier.min && tierIdx < bounds.length - 1) {
        weight += 100;
      }

      return Math.round(weight);
    }

    function ratingBadge(rating, tierColor, tierGlow) {
      if (typeof rating !== 'number' || !Number.isFinite(rating)) return '';
      const fw = ratingWeight(rating);

      if (rating >= 2900) {
        return `<span class="user-rating user-rating--legend"
                      style="font-weight:${fw};">${rating}</span>`;
      }

      const extraClass = rating >= 2600 ? ' user-rating--elite' : '';

      return `<span class="user-rating${extraClass}"
                    style="color:${tierColor};
                           font-weight:${fw};
                           text-shadow: 0 0 6px ${tierGlow};">
                ${rating}
              </span>`;
    }

    // ═══════════════ Skeleton ═══════════════
    function renderSkeleton() {
      mainContainer.innerHTML = `
        <div class="leaderboard-container">
          <div class="page-header">
            <div class="header-left">
              <h1>Leaderboard</h1>
              <div class="period-tabs" id="periodTabs">
                <button class="period-btn active" data-period="overall">Overall</button>
                <button class="period-btn" data-period="monthly">Monthly</button>
                <button class="period-btn" data-period="weekly">Weekly</button>
                <button class="period-btn" data-period="daily">Daily</button>
              </div>
            </div>
            <div class="btn-group">
              <button class="btn btn-info" data-sort="solves">By Solves</button>
              <button class="btn" data-sort="rating">By Rating</button>
              <button class="btn" data-sort="tokens">By Tokens</button>
              <a href="/charts" class="btn">Chart</a>
              <button class="btn" id="refreshBtn" title="Refresh leaderboard">
                <i class="fas fa-rotate"></i> Refresh <span class="rf-time" id="refreshTime"></span>
              </button>
            </div>
          </div>
          <div class="table-responsive">
            <table class="submissions-table">
              <thead>
                <tr>
                  <th style="width:10%" class="text-center">Rank</th>
                  <th style="width:75%">User</th>
                  <th id="metricHead" style="width:15%" class="text-center">Tasks Solved</th>
                </tr>
              </thead>
              <tbody id="leaderboardBody">
                <tr>
                  <td colspan="3" class="text-center">
                    <span class="spinner"></span> Loading leaderboard…
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    }

    // ═══════════════ Tooltip ═══════════════
    const tooltip = document.createElement('div');
    tooltip.id = 'userTooltip';
    document.body.appendChild(tooltip);

    let tooltipTargetEl = null;
    let leaderboardUserMap = {};

    function showTooltip(user) {
      const avatarInner = user.pfp
        ? `<img class="tip-avatar" src="${escapeHtml(user.pfp)}" alt="">`
        : `<div class="tip-avatar placeholder"><i class="fas fa-user"></i></div>`;
      const avatar = `
        <div class="tip-avatar-wrap">
          ${avatarInner}
          ${user.online ? '<span class="online-dot" title="Online"></span>' : ''}
        </div>`;

      const ratingLine = (typeof user.rating === 'number')
        ? `Rating: ${ratingBadge(user.rating, user.tierColor, user.tierGlow)}<br>`
        : '';

      tooltip.innerHTML = `
        ${avatar}
        <div class="tip-info">
          <div class="tip-display">${escapeHtml(user.displayName || user.username)}</div>
          <div class="tip-username">@${escapeHtml(user.username)}</div>
          ${user.realName ? `<div class="tip-realname">${escapeHtml(user.realName)}</div>` : ''}
          <div class="tip-realname" style="margin-top:4px;">
            ${ratingLine}
            <span style="color:${user.online ? '#2ecc71' : '#aaa'};">
              <i class="fas fa-circle" style="font-size:6px;vertical-align:middle;"></i>
              ${user.online
                ? 'Online'
                : user.explicitlyOffline
                  ? `Offline (logged out) · Last seen: ${escapeHtml(formatLastSeen(user.lastSeenAt))}`
                  : `Last seen: ${escapeHtml(formatLastSeen(user.lastSeenAt))}`}
            </span>
          </div>
        </div>
      `;
      tooltip.style.display = 'flex';
      void tooltip.offsetWidth;
      tooltip.classList.add('visible');
    }

    function hideTooltip() {
      tooltipTargetEl = null;
      tooltip.classList.remove('visible');
      setTimeout(() => {
        if (!tooltipTargetEl) tooltip.style.display = 'none';
      }, 120);
    }

    function moveTooltip(e) {
      if (!tooltipTargetEl) return;
      const pad = 14;
      const w = tooltip.offsetWidth;
      const h = tooltip.offsetHeight;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
      tooltip.style.left = Math.max(8, x) + 'px';
      tooltip.style.top  = Math.max(8, y) + 'px';
    }

    // ═══════════════ Leaderboard ═══════════════
    let isLoadingLeaderboard = false;
    let periodMode = 'overall';   // 'overall' | 'monthly' | 'weekly' | 'daily'
    let sortMode = 'solves';      // 'solves' | 'rating' | 'tokens'
    let lastData = null;

    // 财富显示：M / K / B / T，最多一位小数，数字+单位不超过 6 个字符
    function formatTokens(n) {
      const num = Number(n) || 0;
      const sign = num < 0 ? '-' : '';
      let abs = Math.abs(num);
      const units = ['', 'K', 'M', 'B', 'T'];
      let i = 0;

      while (abs >= 1000 && i < units.length - 1) { abs /= 1000; i++; }
      if (i === 0) return sign + String(Math.round(abs));

      let v = abs.toFixed(1);
      // 999,999,999 这类会被四舍五入成 "1000.0M"，进一位变成 1.0B
      if (Number(v) >= 1000 && i < units.length - 1) {
        v = (Number(v) / 1000).toFixed(1);
        i++;
      }
      return sign + v + units[i];
    }

    function formatTime(d) {
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    // ⭐ 只有 overall 才允许按 rating 排序，其余周期榜强制按 solves
    function sortedEntries(entries) {
      if (sortMode === 'tokens') return entries;   // 后端已按 tokens 排好
      if (periodMode !== 'overall' || sortMode !== 'rating') return entries;
      return [...entries]
        .sort((a, b) => (b.rating - a.rating) || (b.solves - a.solves) || a.username.localeCompare(b.username))
        .map((e, i) => ({ ...e, rank: i + 1 }));
    }

    function updatePeriodButtons() {
      document.querySelectorAll('[data-period]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === periodMode);
      });
    }

    function updateSortButtons() {
      document.querySelectorAll('[data-sort]').forEach(btn => {
        const active = btn.dataset.sort === sortMode;
        // 周期榜只对 rating 无效，tokens 和 solves 都可以
        const forcedDisabled = (periodMode !== 'overall' && btn.dataset.sort === 'rating');
        btn.classList.toggle('btn-info', active);
        btn.disabled = active || forcedDisabled;
      });

      const mh = document.getElementById('metricHead');
      if (mh) {
        if (sortMode === 'tokens') {
          mh.textContent = 'Tokens';
        } else if (periodMode !== 'overall') {
          const label = { monthly: 'This Month', weekly: 'This Week', daily: 'Today' }[periodMode] || 'Solves';
          mh.textContent = label;
        } else {
          mh.textContent = sortMode === 'rating' ? 'Rating' : 'Tasks Solved';
        }
      }
    }

    function renderLeaderboardBody(data) {
      const tbody = document.getElementById('leaderboardBody');
      if (!tbody) return;
      if (!data || !data.leaderboard || data.leaderboard.length === 0) {
        const emptyMsg = sortMode === 'tokens'
          ? (periodMode === 'overall'
              ? 'No token data yet.'
              : 'No snapshot from the start of this period yet — the board fills in as daily snapshots accumulate.')
          : 'No solves yet.';
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">' + emptyMsg + '</td></tr>';
        updateSortButtons();
        return;
      }

      leaderboardUserMap = {};
      const entries = sortedEntries(data.leaderboard);
      let html = '';
      let rendered = 0;

      entries.forEach(entry => {
        if (sortMode !== 'tokens' && entry.solves === 0) return;   // 财富榜不按解题数过滤
        rendered++;
        leaderboardUserMap[entry.username] = entry;
        const isMe = (currentUsername && entry.username === currentUsername);
        const hasRating = typeof entry.rating === 'number' && Number.isFinite(entry.rating);

        // 右侧指标单元格
        let metricCell;
        if (sortMode === 'tokens') {
          const total = Number(entry.tokens) || 0;
          metricCell = '<span title="' + total.toLocaleString('en-US') + ' tokens">' +
            formatTokens(total) + '</span>';
        } else if (periodMode === 'overall' && sortMode === 'rating' && hasRating) {
          metricCell = ratingBadge(entry.rating, entry.tierColor, entry.tierGlow);
        } else {
          metricCell = entry.solves;
        }

        html += `
          <tr${isMe ? ' class="mine"' : ''}>
            <td class="text-center">${entry.rank}</td>
            <td>
              <a href="/users/${encodeURIComponent(entry.username)}"
                 class="user-link"
                 data-username="${escapeHtml(entry.username)}"
                 style="display:flex;align-items:center;gap:6px;">
                ${avatarHtml(entry, 24)}
                <span>${escapeHtml(entry.username)} - ${escapeHtml(entry.displayName || entry.username)}</span>
                ${periodMode === 'overall' && hasRating ? ratingBadge(entry.rating, entry.tierColor, entry.tierGlow) : ''}
              </a>
            </td>
            <td class="text-center">${metricCell}</td>
          </tr>`;
      });

      if (rendered === 0) {
        const msg = sortMode === 'tokens' ? 'No token history for this period yet.' : 'No solves in this period.';
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">' + msg + '</td></tr>';
        updateSortButtons();
        return;
      }

      tbody.innerHTML = html;
      updateSortButtons();

      tbody.querySelectorAll('.user-link').forEach(link => {
        link.addEventListener('mouseenter', (e) => {
          const u = leaderboardUserMap[link.dataset.username];
          if (!u) return;
          tooltipTargetEl = link;
          showTooltip(u);
          moveTooltip(e);
        });
        link.addEventListener('mousemove', moveTooltip);
        link.addEventListener('mouseleave', hideTooltip);
      });
    }

    async function loadLeaderboard() {
      if (isLoadingLeaderboard) return;
      isLoadingLeaderboard = true;

      const tbody = document.getElementById('leaderboardBody');
      const btn = document.getElementById('refreshBtn');
      if (!tbody) { isLoadingLeaderboard = false; return; }

      tbody.classList.add('refreshing');
      if (btn) { btn.disabled = true; btn.classList.add('spinning'); }

      try {
        // ⭐ 根据 period 拼接 API
        let url = '/api/users?action=leaderboard';
        if (periodMode !== 'overall') {
          url += `&period=${encodeURIComponent(periodMode)}`;
        }
        if (sortMode === 'tokens') {
          url += '&sort=tokens';
        }
        const data = await apiCall(url);
        lastData = data;
        renderLeaderboardBody(data);

        const rt = document.getElementById('refreshTime');
        if (rt) rt.textContent = `(${formatTime(new Date())})`;
      } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">Failed to load leaderboard.</td></tr>';
      } finally {
        isLoadingLeaderboard = false;
        tbody.classList.remove('refreshing');
        if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
      }
    }

    // ═══════════════ 事件（手动刷新 + 排序切换 + period 切换） ═══════════════
    document.addEventListener('click', (e) => {
      // period 切换
      const periodBtn = e.target.closest('[data-period]');
      if (periodBtn) {
        const p = periodBtn.dataset.period;
        if (p === periodMode || isLoadingLeaderboard) return;
        periodMode = p;
        // 周期榜不支持 rating，其余（solves / tokens）保留
        if (p !== 'overall' && sortMode === 'rating') sortMode = 'solves';
        updatePeriodButtons();
        updateSortButtons();
        loadLeaderboard();
        return;
      }

      // 手动刷新
      const refreshBtn = e.target.closest('#refreshBtn');
      if (refreshBtn) {
        if (isLoadingLeaderboard) return;
        loadLeaderboard();
        return;
      }

      // 排序切换
      const sortBtn = e.target.closest('[data-sort]');
      if (sortBtn) {
        if (sortBtn.disabled) return;
        const mode = sortBtn.dataset.sort;
        // 周期榜不允许切到 rating
        if (periodMode !== 'overall' && mode === 'rating') return;
        if (mode === sortMode) return;
        const prev = sortMode;
        sortMode = mode;
        // tokens 的数据只在这条请求里出现，进出 tokens 都要重新拉
        if (mode === 'tokens' || prev === 'tokens') {
          loadLeaderboard();
        } else if (lastData) {
          renderLeaderboardBody(lastData);
        }
      }
    });

    renderSkeleton();
    updatePeriodButtons();
    updateSortButtons();
    loadLeaderboard();
  