
  (function () {
    'use strict';

    // ═══════════ 日期 ═══════════
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('zh-HK', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
      });
    }

    // ═══════════ Hero 歡迎詞 ═══════════
    (function updateHero() {
      const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
      const greetEl = document.getElementById('heroGreet');
      const subEl   = document.getElementById('heroSub');
      const btnEl   = document.getElementById('heroBtn');
      const labelEl = document.getElementById('heroBtnLabel');
      if (!greetEl) return;

      if (user && user.username) {
        const hour = new Date().getHours();
        const timeGreet =
          hour < 5  ? 'Late night' :
          hour < 12 ? 'Good morning' :
          hour < 18 ? 'Good afternoon' :
                      'Good evening';

        greetEl.textContent = `${timeGreet}, ${user.displayName || user.username}`;
        subEl.textContent = 'What are we solving today?';
        btnEl.href = '/problems';
        btnEl.innerHTML = '<i class="fas fa-play"></i><span id="heroBtnLabel">Start Solving</span>';
      } else {
        greetEl.textContent = 'Welcome to WYK Maths';
        subEl.textContent = 'Sign in to start solving problems.';
        btnEl.href = '/login';
        btnEl.innerHTML = '<i class="fas fa-sign-in-alt"></i><span id="heroBtnLabel">Sign In</span>';
      }
    })();

    // ═══════════ Progress 卡片 ═══════════
    (async function loadProgress() {
      const user = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
      if (!user || !user.username) return;

      const card = document.getElementById('progressCard');
      if (!card) return;

      card.style.display = '';

      try {
        const data = await apiCall(
          `/api/users?action=profile&username=${encodeURIComponent(user.username)}`
        );
        if (!data || !data.success) return;

        const solved = Number(data.totalPassed) || 0;
        const total  = Number(data.totalProblems) || 0;
        const pct    = total > 0 ? Math.round((solved / total) * 100) : 0;

        document.getElementById('statSolved').textContent = solved;
        document.getElementById('statTotal').textContent  = total;
        document.getElementById('statPct').textContent    = pct + '%';

        requestAnimationFrame(() => {
          document.getElementById('progressFill').style.width = pct + '%';
        });
      } catch (err) {
        console.warn('[home] progress load failed:', err);
        card.style.display = 'none';
      }
    })();

    // ═══════════ Updates 渲染 ═══════════
    const updatesBody = document.getElementById('updatesBody');

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    const domPurifyConfig = {
      ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span', 'div', 'code', 'pre', 'img'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'src', 'style']
    };

    function renderSkeleton() {
      let html = '';
      for (let i = 0; i < 3; i++) {
        html += `
          <div class="skeleton-card">
            <div class="skeleton-line short"></div>
            <div class="skeleton-line long"></div>
            <div class="skeleton-line medium"></div>
          </div>
        `;
      }
      updatesBody.innerHTML = html;
    }

    let allUpdates = [];

    function renderUpdates(updates, showAll = false) {
      const total = updates.length;
      const display = showAll ? updates : updates.slice(0, 4);
      const hasMore = !showAll && total > 4;

      let html = '';
      display.forEach(u => {
        const titleHtml = u.title ? `<h3>${escapeHtml(u.title)}</h3>` : '';
        const contentHtml = u.content ? DOMPurify.sanitize(u.content, domPurifyConfig) : '';
        html += `
          <div class="update-card">
            <div class="update-card-header">
              <span class="update-badge ${escapeHtml(u.badge)}">${escapeHtml(u.badgeText)}</span>
              <span class="update-time">${escapeHtml(u.time)}</span>
            </div>
            ${titleHtml}
            <p>${contentHtml}</p>
          </div>
        `;
      });

      if (hasMore) {
        html += `
          <div class="load-more-wrapper">
            <button class="load-more-btn" id="loadMoreBtn">
              Load More (${total - 4})
            </button>
          </div>
        `;
      }

      updatesBody.innerHTML = html;

      if (hasMore) {
        const btn = document.getElementById('loadMoreBtn');
        if (btn) {
          btn.addEventListener('click', function () {
            this.disabled = true;
            this.textContent = 'Loading...';
            renderUpdates(allUpdates, true);
          });
        }
      }
    }

    async function loadUpdates() {
      renderSkeleton();
      try {
        const res = await fetch('/api/updates');
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        if (data.success && data.updates.length > 0) {
          allUpdates = data.updates;
          renderUpdates(allUpdates, false);
        } else {
          updatesBody.innerHTML = '<div class="placeholder-card">No updates yet.</div>';
        }
      } catch (err) {
        updatesBody.innerHTML = '<div class="error-msg">Could not load updates.</div>';
      }
    }

    loadUpdates();
  })();
  