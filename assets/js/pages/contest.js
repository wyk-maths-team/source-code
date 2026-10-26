
    if (!isLoggedIn()) window.location.href = '/index.html';

    const mainContainer = document.getElementById('mainContent');
    const limit = 20;

    // ── State ──
    let currentPage = 1;
    let totalPages = 1;
    let allContests = [];       // 當前頁的比賽
    let activeFilter = 'all';   // all | upcoming | ongoing | ended

    // ═══════════ Utils ═══════════
    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    function getStatus(c) {
      const start = new Date(c.startTime).getTime();
      if (!Number.isFinite(start)) return 'upcoming';
      const durMs = (Number(c.duration) || 0) * 60000;
      const end = start + durMs;
      const now = Date.now();
      if (now < start) return 'upcoming';
      if (now > end)   return 'ended';
      return 'ongoing';
    }

    function fmtDateTime(iso) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      const pad = n => String(n).padStart(2, '0');
      const local = new Date(d.getTime() + 8 * 3600000);
      return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ` +
             `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
    }

    function fmtDuration(min) {
      const m = Number(min) || 0;
      const h = Math.floor(m / 60);
      const mm = m % 60;
      if (h > 0) return `${h}h ${mm}m`;
      return `${mm}m`;
    }

    function fmtCountdown(ms) {
      if (ms <= 0) return '00:00:00';
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      const pad = n => String(n).padStart(2, '0');
      if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(ss)}`;
      return `${pad(h)}:${pad(m)}:${pad(ss)}`;
    }

    // ═══════════ Countdown engine ═══════════
    let _cdTimer = null;
    function stopCountdowns() {
      if (_cdTimer) { clearInterval(_cdTimer); _cdTimer = null; }
    }
    function startCountdowns() {
      stopCountdowns();
      const tick = () => {
        const now = Date.now();
        document.querySelectorAll('.ct-countdown[data-start]').forEach(box => {
          const start = Number(box.dataset.start);
          const end   = Number(box.dataset.end);
          const lbl   = box.querySelector('.ct-countdown-label');
          const val   = box.querySelector('.ct-countdown-val');
          if (!lbl || !val) return;
          if (now < start) {
            lbl.textContent = 'Starts in';
            val.textContent = fmtCountdown(start - now);
          } else if (now < end) {
            lbl.textContent = 'Ends in';
            val.textContent = fmtCountdown(end - now);
          } else {
            lbl.textContent = 'Ended';
            val.textContent = '—';
          }
        });
      };
      tick();
      _cdTimer = setInterval(tick, 1000);
    }

    // ═══════════ Data ═══════════
    async function loadContests(page = 1) {
      try {
        const data = await apiCall(`/api/contests?action=list&page=${page}&limit=${limit}`);
        if (data.success) {
          totalPages = data.totalPages || 1;
          currentPage = data.page || 1;
          return data.contests || [];
        }
      } catch (err) {
        console.error(err);
      }
      return [];
    }

    // ═══════════ Filter counts ═══════════
    function computeCounts(contests) {
      const c = { all: contests.length, upcoming: 0, ongoing: 0, ended: 0 };
      contests.forEach(x => { c[getStatus(x)]++; });
      return c;
    }

    // ═══════════ Render ═══════════
    function render() {
      stopCountdowns();

      const counts = computeCounts(allContests);

      // Filter
      const filtered = activeFilter === 'all'
        ? allContests
        : allContests.filter(c => getStatus(c) === activeFilter);

      let html = `<div class="ct-wrap">`;

      // Hero
      html += `
        <div class="ct-hero">
          <div class="ct-hero-inner">
            <h1 class="ct-hero-name">
              <i class="fas fa-trophy"></i>
              Contests
            </h1>
            <p class="ct-hero-sub">Compete, solve, and climb the leaderboard.</p>
          </div>
        </div>
      `;

      // Tabs
      html += `
        <div class="ct-tabs" id="ctTabs">
          <button class="ct-tab ${activeFilter === 'all' ? 'active' : ''}" data-filter="all">
            <i class="fas fa-list"></i>
            <span>All</span>
            <span class="count">${counts.all}</span>
          </button>
          <button class="ct-tab ${activeFilter === 'ongoing' ? 'active' : ''}" data-filter="ongoing">
            <i class="fas fa-circle-play"></i>
            <span>Live</span>
            <span class="count">${counts.ongoing}</span>
          </button>
          <button class="ct-tab ${activeFilter === 'upcoming' ? 'active' : ''}" data-filter="upcoming">
            <i class="fas fa-clock"></i>
            <span>Upcoming</span>
            <span class="count">${counts.upcoming}</span>
          </button>
          <button class="ct-tab ${activeFilter === 'ended' ? 'active' : ''}" data-filter="ended">
            <i class="fas fa-flag-checkered"></i>
            <span>Ended</span>
            <span class="count">${counts.ended}</span>
          </button>
        </div>
      `;

      // Grid / empty
      if (allContests.length === 0) {
        html += `
          <div class="ct-empty">
            <i class="fas fa-inbox"></i>
            <div class="ct-empty-title">No contests yet</div>
            <div>Check back later for upcoming events.</div>
          </div>
        `;
      } else if (filtered.length === 0) {
        html += `
          <div class="ct-empty">
            <i class="fas fa-filter-circle-xmark"></i>
            <div class="ct-empty-title">No ${escapeHtml(activeFilter)} contests on this page</div>
            <div>Try a different filter or go to another page.</div>
          </div>
        `;
      } else {
        html += `<div class="ct-grid">`;
        filtered.forEach(c => {
          const status = getStatus(c);
          const startMs = new Date(c.startTime).getTime();
          const endMs = startMs + (Number(c.duration) || 0) * 60000;
          const count = c.contestantCount ?? 0;

          const statusIcon = { upcoming: 'fa-clock', ongoing: 'fa-circle-play', ended: 'fa-flag-checkered' }[status];
          const statusLabel = { upcoming: 'Upcoming', ongoing: 'Live', ended: 'Ended' }[status];

          html += `
            <a class="ct-card ${status}" href="/contest/${c.id}">
              <div class="ct-card-top">
                <span class="ct-badge ${status}">
                  <span class="dot"></span>
                  <i class="fas ${statusIcon}"></i>
                  ${statusLabel}
                </span>
                <span class="ct-card-id">#${c.id}</span>
              </div>

              <h3 class="ct-card-name">${escapeHtml(c.name)}</h3>

              <div class="ct-card-meta">
                <div class="ct-meta-item">
                  <i class="fas fa-play"></i>
                  <span>${escapeHtml(fmtDateTime(c.startTime))}</span>
                </div>
                <div class="ct-meta-item">
                  <i class="fas fa-stopwatch"></i>
                  <span>${escapeHtml(fmtDuration(c.duration))}</span>
                </div>
                <div class="ct-meta-item">
                  <i class="fas fa-users"></i>
                  <span>${count} participant${count !== 1 ? 's' : ''}</span>
                </div>
              </div>

              <div class="ct-countdown" data-start="${startMs}" data-end="${endMs}">
                <span class="ct-countdown-label">—</span>
                <span class="ct-countdown-val">--:--:--</span>
              </div>
            </a>
          `;
        });
        html += `</div>`;
      }

      // Pagination
      if (totalPages > 1) {
        html += `<div class="ct-pagination" id="ctPagination"></div>`;
      }

      html += `</div>`;
      mainContainer.innerHTML = html;

      // Bind tabs
      document.querySelectorAll('#ctTabs .ct-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          activeFilter = tab.dataset.filter;
          render();
        });
      });

      // Render pagination
      if (totalPages > 1) {
        renderPagination(document.getElementById('ctPagination'));
      }

      // Start countdowns
      if (allContests.length > 0) startCountdowns();
    }

    // ═══════════ Pagination ═══════════
    function getMaxVisiblePages() {
      const w = window.innerWidth;
      if (w < 400) return 5;
      if (w < 600) return 7;
      if (w < 900) return 9;
      return 10;
    }

    function computePageItems(current, total, maxVisible) {
      if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1);
      const inner = maxVisible - 2;
      const half = Math.floor(inner / 2);
      let start = Math.max(2, current - half);
      let end = Math.min(total - 1, start + inner - 1);
      start = Math.max(2, end - inner + 1);
      const items = [1];
      if (start > 2) items.push('…');
      for (let p = start; p <= end; p++) items.push(p);
      if (end < total - 1) items.push('…');
      items.push(total);
      return items;
    }

    function renderPagination(container) {
      if (!container) return;
      const maxVisible = getMaxVisiblePages();
      const items = computePageItems(currentPage, totalPages, maxVisible);

      let html = '';
      html += `<button class="ct-page-btn" ${currentPage <= 1 ? 'disabled' : ''} data-page="${currentPage - 1}">‹</button>`;
      for (const it of items) {
        if (it === '…') {
          html += `<span class="ct-page-btn ellipsis">…</span>`;
        } else if (it === currentPage) {
          html += `<button class="ct-page-btn active">${it}</button>`;
        } else {
          html += `<button class="ct-page-btn" data-page="${it}">${it}</button>`;
        }
      }
      html += `<button class="ct-page-btn" ${currentPage >= totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">›</button>`;
      container.innerHTML = html;

      container.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = parseInt(btn.dataset.page, 10);
          if (p >= 1 && p <= totalPages && p !== currentPage) {
            gotoPage(p);
          }
        });
      });
    }

    async function gotoPage(page) {
      allContests = await loadContests(page);
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ═══════════ Init ═══════════
    (async function init() {
      allContests = await loadContests(1);
      render();
    })();

    // 視窗改變時重繪分頁
    let _resizeTimer = null;
    window.addEventListener('resize', () => {
      if (_resizeTimer) clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(() => {
        if (totalPages > 1) renderPagination(document.getElementById('ctPagination'));
      }, 200);
    });

    // Cleanup
    window.addEventListener('beforeunload', stopCountdowns);
  