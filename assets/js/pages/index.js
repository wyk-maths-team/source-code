
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

    // ── Recent Accepted 表格 + 全局 token 计数（公开，未登录也能看）──
var __recentAcTimer = null;

function fmtRecentTime(ts) {
  try {
    var d = new Date(ts);
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return Math.max(1, Math.floor(diff)) + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleDateString('zh-HK');
  } catch (e) { return ''; }
}

// 渲染成 .ac-item 卡片（页面用的是 grid 列表，不是 table）
function renderRecentAc(items) {
  var body = document.getElementById('recentAcBody');
  if (!body) return;
  var esc = (window.DSHUI && DSHUI.esc) || function (x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };
  if (!items || !items.length) {
    body.innerHTML = '<div class="recent-ac-empty">No accepted submissions yet.</div>';
    return;
  }
  // 名字太长把三列挤歪，这里截一段；完整名字留在 title 里
  function shortName(name) {
    var s = String(name == null ? '' : name);
    return s.length > 18 ? s.slice(0, 17) + '\u2026' : s;
  }

  body.innerHTML = items.map(function (it) {
    var who = shortName(it.displayName);
    return '<div class="ac-item">' +
      '<a class="ac-who" href="/users/' + encodeURIComponent(it.username) + '" title="' + esc(it.displayName) + '">' + esc(who) + '</a>' +
      '<a class="ac-problem" href="/problems/' + encodeURIComponent(it.problemId) + '" title="' + esc(it.problemName) + '">' + esc(it.problemName) + '</a>' +
      '<a class="ac-time" href="/submissions/' + encodeURIComponent(it.subid) + '/detail">' + esc(fmtRecentTime(it.timestamp)) + '</a>' +
    '</div>';
  }).join('');
}

function renderTokenMeter(n) {
  var el = document.getElementById('tokenMeterValue');
  if (!el) return;
  el.textContent = Number(n || 0).toLocaleString();
}

async function loadRecentAc() {
  try {
    var res = await fetch('/api/stats?action=recent-ac');
    var data = await res.json();
    if (data && data.success) renderRecentAc(data.items);
  } catch (e) { /* 首页这一块挂了不影响其它部分 */ }
}

async function loadTokenMeter() {
  try {
    var res = await fetch('/api/stats?action=tokens-used');
    var data = await res.json();
    if (data && data.success) renderTokenMeter(data.totalTokensUsed);
  } catch (e) { /* 同上 */ }
}

// ── 静默刷新：只在用户还在动的时候才去刷 ──
// 页面开着但人走了（切标签页、去吃饭）的情况下，继续每分钟打一次接口没有意义，
// 还白白把服务端缓存一直焐热。这里记一个「最后一次交互时间」，超过 IDLE_MS
// 就跳过这一轮，等用户一动自动恢复。
var IDLE_MS = 60 * 1000;
var __lastActiveAt = Date.now();
var __isVisible = !document.hidden;

function markActive() { __lastActiveAt = Date.now(); }
['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll', 'focus'].forEach(function (evt) {
  window.addEventListener(evt, markActive, { passive: true });
});
document.addEventListener('visibilitychange', function () {
  __isVisible = !document.hidden;
  if (__isVisible) { markActive(); loadRecentAc(); }
});

loadRecentAc();
loadTokenMeter();

__recentAcTimer = setInterval(function () {
  // 标签页在后台，或者人已经安静了一阵子 —— 这一轮不刷
  if (!__isVisible) return;
  if (Date.now() - __lastActiveAt > IDLE_MS) return;
  loadRecentAc();
}, 60 * 1000);

window.addEventListener('beforeunload', function () { if (__recentAcTimer) clearInterval(__recentAcTimer); });

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
  