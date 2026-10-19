
    (function() {
      if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
        window.location.href = '/index.html';
        return;
      }

      const pathMatch = window.location.pathname.match(/^\/users\/(.+)$/);
      if (!pathMatch) {
        document.getElementById('mainContent').innerHTML = '<div class="error-msg">Invalid profile URL.</div>';
        return;
      }
              // ═══════════════ 成就元数据（前端缓存）═══════════════
      const ACHIEVEMENTS = {
        // Milestone
        'first-blood':  { name: 'First Blood',      desc: 'AC your first problem',   fa: 'fa-droplet',        rarity: 'common' },
        'solved-10':    { name: 'Getting Started',  desc: 'AC 10 problems',          fa: 'fa-seedling',       rarity: 'common' },
        'solved-25':    { name: 'Warming Up',       desc: 'AC 25 problems',          fa: 'fa-mug-hot',        rarity: 'common' },
        'solved-50':    { name: 'Half Century',     desc: 'AC 50 problems',          fa: 'fa-person-running', rarity: 'uncommon' },
        'solved-100':   { name: 'Centurion',        desc: 'AC 100 problems',         fa: 'fa-award',          rarity: 'rare' },
        'solved-200':   { name: 'Double Century',   desc: 'AC 200 problems',         fa: 'fa-landmark',       rarity: 'rare' },
        'solved-500':   { name: 'Five Hundred',     desc: 'AC 500 problems',         fa: 'fa-mountain',       rarity: 'epic' },
        'solved-1000':  { name: 'Millennium',       desc: 'AC 1000 problems',        fa: 'fa-meteor',         rarity: 'epic' },
        'solved-2000':  { name: 'Two Millenniums',  desc: 'AC 2000 problems',        fa: 'fa-rocket',         rarity: 'legendary' },

        // Difficulty
        'hard-3':  { name: 'Beyond Easy',      desc: 'AC a problem with difficulty ≥ 3', fa: 'fa-shield-halved',  rarity: 'common' },
        'hard-4':  { name: 'Rising Challenge', desc: 'AC a problem with difficulty ≥ 4', fa: 'fa-shield',         rarity: 'uncommon' },
        'hard-5':  { name: 'Midway',           desc: 'AC a problem with difficulty ≥ 5', fa: 'fa-trophy',         rarity: 'uncommon' },
        'hard-6':  { name: 'Into the Deep',    desc: 'AC a problem with difficulty ≥ 6', fa: 'fa-fire',           rarity: 'rare' },
        'hard-7':  { name: 'Elite Solver',     desc: 'AC a problem with difficulty ≥ 7', fa: 'fa-gem',            rarity: 'epic' },

        // Streak
        'streak-3':   { name: 'Hat Trick',        desc: 'Submit 3 days in a row',   fa: 'fa-fire-flame-curved', rarity: 'common' },
        'streak-7':   { name: 'Week Warrior',     desc: 'Submit 7 days in a row',   fa: 'fa-bolt',              rarity: 'uncommon' },
        'streak-30':  { name: 'Monthly Devotion', desc: 'Submit 30 days in a row',  fa: 'fa-moon',              rarity: 'rare' },
        'streak-100': { name: 'Century Streak',   desc: 'Submit 100 days in a row', fa: 'fa-crown',             rarity: 'epic' },

        // Efficiency
        'first-try':    { name: 'One Shot',       desc: 'First try AC on a problem',    fa: 'fa-bullseye',    rarity: 'common' },
        'first-try-10': { name: 'Sharp Shooter',  desc: '10 problems first-try AC',     fa: 'fa-crosshairs',  rarity: 'uncommon' },
        'first-try-50': { name: 'Perfect Aim',    desc: '50 problems first-try AC',     fa: 'fa-compass',     rarity: 'rare' },
        'daily-5':      { name: 'Daily Five',     desc: 'AC 5 problems in one day',     fa: 'fa-cloud-sun',   rarity: 'uncommon' },
        'daily-10':     { name: 'Busy Bee',       desc: 'AC 10 problems in one day',    fa: 'fa-spa',         rarity: 'rare' },
        'daily-15':     { name: 'Fifteen Frenzy', desc: 'AC 15 problems in one day',    fa: 'fa-hurricane',   rarity: 'epic' },
        'daily-20':     { name: 'Daily Marathon', desc: 'AC 20 problems in one day',    fa: 'fa-medal',       rarity: 'legendary' },

        // Fun
        'night-owl':   { name: 'Night Owl',     desc: 'Submit between 00:00-04:00 HKT',    fa: 'fa-moon',    rarity: 'uncommon' },
        'early-bird':  { name: 'Early Bird',    desc: 'Submit between 05:00-07:00 HKT',    fa: 'fa-dove',    rarity: 'uncommon' },
        'perfect-day': { name: 'Perfect Day',   desc: 'A day with ≥5 submissions, all AC', fa: 'fa-star',    rarity: 'rare' },

          // ═══ F. Hidden ═══
        'curious':       { name: 'Curious',        desc: 'Hidden', fa: 'fa-question',       rarity: 'rare', hidden: true },
        'voyeur':        { name: 'Voyeur',         desc: 'Hidden', fa: 'fa-user-secret',    rarity: 'rare', hidden: true },
        'speed-demon':   { name: 'Speed Demon',    desc: 'Hidden', fa: 'fa-bolt-lightning', rarity: 'rare', hidden: true },
        'never-give-up': { name: 'Never Give Up',  desc: 'Hidden', fa: 'fa-hand-fist',      rarity: 'epic', hidden: true },

        // Accuracy
        'accuracy-30': { name: 'Steady Hand', desc: 'Accuracy ≥ 30% (min 20 subs)', fa: 'fa-chart-simple',  rarity: 'common' },
        'accuracy-40': { name: 'Sharp',       desc: 'Accuracy ≥ 40% (min 20 subs)', fa: 'fa-chart-line',    rarity: 'common' },
        'accuracy-50': { name: 'Accurate',    desc: 'Accuracy ≥ 50% (min 20 subs)', fa: 'fa-chart-column',  rarity: 'uncommon' },
        'accuracy-60': { name: 'Precise',     desc: 'Accuracy ≥ 60% (min 20 subs)', fa: 'fa-palette',       rarity: 'uncommon' },
        'accuracy-70': { name: 'Meticulous',  desc: 'Accuracy ≥ 70% (min 20 subs)', fa: 'fa-gear',          rarity: 'rare' },
        'accuracy-80': { name: 'Surgical',    desc: 'Accuracy ≥ 80% (min 20 subs)', fa: 'fa-microscope',    rarity: 'epic' },
        'accuracy-90': { name: 'Flawless',    desc: 'Accuracy ≥ 90% (min 20 subs)', fa: 'fa-circle-check',  rarity: 'legendary' },
      };

      const RARITY_ORDER = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };
      function fmtDuration(ms) {
        if (!ms || ms < 0) return '0m';
        const s = Math.floor(ms / 1000);
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
      }

      function fmtRelative(ts) {
        if (!ts) return 'never';
        const diff = Date.now() - new Date(ts).getTime();
        if (diff < 60_000) return 'just now';
        if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
        if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
        return `${Math.floor(diff / 86400_000)}d ago`;
      }
      // 拉当前用户的成就
      async function loadAchievements(username) {
        try {
          const data = await apiCall(`/api/users?action=achievements&username=${encodeURIComponent(username)}`);
          return data.success ? data : null;
        } catch (e) {
          console.error('[achievements]', e);
          return null;
        }
      }

      // 渲染成就区域
      function renderAchievements(achData) {
        const unlocked = new Set(achData?.achievements || []);
        const unlockedAt = achData?.unlockedAt || {};
        const streak = achData?.streak || {};

        const allIds = Object.keys(ACHIEVEMENTS);
        // 排序：先按稀有度，再按解锁状态，再按解锁时间倒序
        allIds.sort((a, b) => {
          const ra = RARITY_ORDER[ACHIEVEMENTS[a].rarity] ?? 9;
          const rb = RARITY_ORDER[ACHIEVEMENTS[b].rarity] ?? 9;
          if (ra !== rb) return ra - rb;
          const ua = unlocked.has(a) ? 0 : 1;
          const ub = unlocked.has(b) ? 0 : 1;
          if (ua !== ub) return ua - ub;
          return 0;
        });

        const unlockedCount = unlocked.size;
        const totalCount = allIds.length;

        const cardsHtml = allIds.map(id => {
          const a = ACHIEVEMENTS[id];
          const isUnlocked = unlocked.has(id);
          const date = unlockedAt[id] ? new Date(unlockedAt[id]).toISOString().slice(0, 10) : '';
          const rarity = a.rarity || 'common';

          // 隐藏成就：未解锁时屏蔽名称
          const displayName = (a.hidden && !isUnlocked) ? '???' : a.name;
          const displayDesc = (a.hidden && !isUnlocked) ? 'Hidden achievement' : a.desc;
          const displayFa = (a.hidden && !isUnlocked) ? 'fa-lock' : a.fa;

          return `
            <div class="ach-card ${isUnlocked ? 'unlocked' : 'locked'} rarity-${rarity}"
                 title="${escapeHtml(displayDesc)}">
              <span class="ach-rarity-tag">${rarity}</span>
              <div class="ach-icon-wrap">
                <i class="fa-solid ${displayFa}"></i>
              </div>
              <div class="ach-name">${escapeHtml(displayName)}</div>
              <div class="ach-desc">${escapeHtml(displayDesc)}</div>
              ${isUnlocked && date ? `<div class="ach-date">${date}</div>` : ''}
            </div>
          `;
        }).join('');

        const streakLine = (streak.current || streak.max)
          ? `<span style="margin-left:auto;font-size:.82rem;color:var(--text-secondary);">
               🔥 Streak: <b style="color:var(--accent);">${streak.current || 0}</b> / best ${streak.max || 0}
             </span>`
          : '';

        return `
          <div class="ach-section">
            <div class="ach-header">
              <h2><i class="fa-solid fa-trophy" style="color:#FFAA00;margin-right:.4rem;"></i>Achievements</h2>
              <span class="ach-progress"><b>${unlockedCount}</b> / ${totalCount}</span>
              ${streakLine}
            </div>
            <div class="ach-grid">${cardsHtml}</div>
          </div>
        `;
      }
      
      const profileUsername = decodeURIComponent(pathMatch[1]);
      document.title = `${profileUsername} - WYK Maths Team`;

      const mainContainer = document.getElementById('mainContent');
      const TOGGLE_KEY = 'profileOnlyAttempted';
            // ⭐ Voyeur 计数（localStorage）
      const VIEWED_USERS_KEY = 'viewedUsers';
      const VOYEUR_REPORTED_KEY = 'voyeurReported';
      const VOYEUR_THRESHOLD = 10;

      function recordProfileView(viewedUsername) {
        const me = (typeof getCurrentUser === 'function') ? getCurrentUser()?.username : null;
        if (!me || me === viewedUsername) return;             // 跳过自己
        if (/^\d+$/.test(String(viewedUsername))) return;      // 跳过 team

        try {
          const raw = localStorage.getItem(VIEWED_USERS_KEY);
          const set = new Set(raw ? JSON.parse(raw) : []);
          const before = set.size;
          set.add(viewedUsername);
          if (set.size !== before) {
            localStorage.setItem(VIEWED_USERS_KEY, JSON.stringify(Array.from(set)));
          }

          // 达到阈值 → 上报一次
          if (set.size >= VOYEUR_THRESHOLD && !localStorage.getItem(VOYEUR_REPORTED_KEY)) {
            apiCall('/api/users?action=markAchievement', 'POST', { id: 'voyeur' })
              .then(r => {
                if (r.success) localStorage.setItem(VOYEUR_REPORTED_KEY, '1');
              })
              .catch(() => {});
          }
        } catch (e) {}
      }
      function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

      // 從 localStorage 取題目 id 清單（problems-1.js 寫入的快取）
      function getCachedProblemIds() {
        try {
          const raw = localStorage.getItem('problemListCache_full');
          if (!raw) return null;
          const data = JSON.parse(raw);
          if (!data || !Array.isArray(data.problems) || data.problems.length === 0) return null;
          if (data.timestamp && Date.now() - data.timestamp > 24 * 60 * 60 * 1000) return null;
          return data.problems.map(p => p.id);
        } catch { return null; }
      }

      function buildStateMap(attempted) {
        const m = {};
        for (const it of (attempted || [])) {
          if (it && it.id) m[it.id] = it.state;
        }
        return m;
      }

      function renderGrid(ids, stateMap) {
        if (!ids.length) {
          return '<span style="color:var(--text-secondary);font-style:italic;">No problems.</span>';
        }
        return ids.map(id => {
          const state = stateMap[id] || 'not_started';
          const cls = state === 'passed' ? 'state-passed'
                    : state === 'failed' ? 'state-failed' : '';
          return `<a href="/problems/${encodeURIComponent(id)}" class="${cls}" title="${escapeHtml(id)}">${escapeHtml(id)}</a>`;
        }).join('');
      }

      async function loadProfile() {
        try {
          const data = await apiCall(`/api/users?action=profile&username=${encodeURIComponent(profileUsername)}`);
          return data;
        } catch (err) {
          console.error(err);
          return null;
        }
      }

      function renderProfile(data) {
                const {
          username, displayName, realName, totalPassed, totalProblems,
          attempted, allProblemIds, pfp,
          totalOnlineMs, lastSeenAt
        } = data;

        const currentUser = getCurrentUser() || {};
        const isAdmin = currentUser.role === 'admin' || currentUser.role === 'root';

        // attempted 已按後端排序；用它作為「只顯示 attempted」的權威列表
        const attemptedIds = (attempted || []).map(x => x.id);
        const stateMap = buildStateMap(attempted);

        // 「所有題目」：優先本地快取，否則用 API 回傳
        const cachedIds = getCachedProblemIds();
        const fullIds = cachedIds || (Array.isArray(allProblemIds) ? allProblemIds : []);

        const avatarHtml = pfp
          ? `<img src="${escapeHtml(pfp)}" alt="avatar">`
          : `<div class="placeholder">👤</div>`;

        // ⭐ 增加权限判断：不能操作自己、不能操作同级/上级
        const isSelf = (currentUser.username === username);
        const canFlag = isAdmin && !isSelf && (
          currentUser.role === 'root' ? (data.role !== 'root') : (data.role === 'student')
        );

        const realNameHtml = `
          <div class="profile-realname">
            <span id="realNameText">${realName ? escapeHtml(realName) : '<i style="color:var(--text-secondary);">(no real name)</i>'}</span>
            ${isAdmin ? `<a href="/admin/users/${encodeURIComponent(username)}" class="edit-realname-btn" title="Edit user"><i class="fas fa-pencil-alt"></i></a>` : ''}
          </div>
          ${canFlag ? `
            <div style="margin-top:8px; display:flex; gap:8px;">
              <button class="btn-link" style="background:#d93025; color:#fff; border:none; padding:4px 10px; border-radius:4px; cursor:pointer;" onclick="flagUser('${escapeHtml(username)}', 'red')">Red Flag</button>
              <button class="btn-link" style="background:#e3a008; color:#fff; border:none; padding:4px 10px; border-radius:4px; cursor:pointer;" onclick="flagUser('${escapeHtml(username)}', 'yellow')">Yellow Flag</button>
            </div>
          ` : ''}
        `;

        const percent = totalProblems ? Math.round(totalPassed / totalProblems * 100) : 0;

        mainContainer.innerHTML = `
          <div class="profile-container">
            <div class="profile-header">
              <div class="profile-avatar">${avatarHtml}</div>
              <div class="profile-info">
                <h1>${escapeHtml(displayName || username)}</h1>
                ${realNameHtml}
                Rating: <span class="user-rating" style="color:${data.tierColor}; text-shadow: 0 0 6px ${data.tierGlow};">
                    ${data.rating}
                  </span><br>
                <div class="profile-meta">
                  <span class="meta-badge">Username: ${escapeHtml(username)}</span>
                  <a href="/submissions/user/${encodeURIComponent(username)}" class="btn-link">Submissions</a>
                  <button class="btn-link purple" id="pkInviteBtn">
                    <i class="fas fa-swords"></i>Invite
                  </button>
                </div>
                <div class="profile-stats">
                  <span>Solved: <span class="passed">${totalPassed}</span> / ${totalProblems}</span>
                  <span>Completion: ${percent}%</span>
                </div>
                <div class="profile-online-row">
                <span class="item">
                  <i class="fas fa-clock"></i>
                  <span>Total online</span>
                  <b>${fmtDuration(totalOnlineMs || 0)}</b>
                </span>
                <span class="item">
                  <i class="fas fa-eye"></i>
                  <span>Last seen</span>
                  <b>${fmtRelative(lastSeenAt)}</b>
                </span>
              </div>
              </div>
            </div>

            <div class="section-header-row">
              <h2 class="section-title">Problems (<span id="gridCount">0</span>)</h2>
              <label class="attempted-toggle" title="Only show attempted problems">
                <input type="checkbox" id="onlyAttemptedToggle">
                <span>Only attempted</span>
              </label>
            </div>
            <div class="profile-solved" id="profileGrid"></div>
            <div id="achievementsContainer">
              <div class="ach-section">
                <div class="ach-header">
                  <h2><i class="fa-solid fa-trophy" style="color:#FFAA00;margin-right:.4rem;"></i>Achievements</h2>
                  <span class="ach-progress" style="font-weight:400;color:var(--text-secondary);">Loading…</span>
                </div>
              </div>
            </div>
          </div>
        `;

        // ---- 綁定 toggle ----
        const toggle  = document.getElementById('onlyAttemptedToggle');
        const gridEl  = document.getElementById('profileGrid');
        const countEl = document.getElementById('gridCount');

        function refresh() {
          const onlyAtt = toggle.checked;
          const ids = onlyAtt ? attemptedIds : fullIds;
          countEl.textContent = ids.length;
          gridEl.innerHTML = renderGrid(ids, stateMap);
        }

        try { toggle.checked = localStorage.getItem(TOGGLE_KEY) === 'true'; } catch {}
        toggle.addEventListener('change', () => {
          try { localStorage.setItem(TOGGLE_KEY, toggle.checked ? 'true' : 'false'); } catch {}
          refresh();
        });
        refresh();
        const pkBtn = document.getElementById('pkInviteBtn');
        const myName = (getCurrentUser() || {}).username;

        if (pkBtn && data.username !== myName) {
          // ⭐ 离线时按钮加个提示样式（但仍然可点）
          if (!data.online) {
            pkBtn.title = 'Opponent is offline — invite will still be sent';
            pkBtn.classList.add('offline');
          } else {
            pkBtn.title = 'Invite to PK';
          }

          pkBtn.addEventListener('click', async () => {
            pkBtn.disabled = true;
            const oldHtml = pkBtn.innerHTML;
            pkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';
            try {
              const res = await apiCall('/api/pk?action=invite', 'POST', { to: data.username });
              if (res.success) {
                if (typeof showPKInviteShare === 'function') {
                  showPKInviteShare(res.invite);
                }
                // 分享卡片彈出後，按鈕可以復原（用戶可能想再分享一次）
                pkBtn.disabled = false;
                pkBtn.innerHTML = oldHtml;
              } else {
                (window.DSHUI ? DSHUI.toast(res.message || 'Failed', 'err') : alert(res.message || 'Failed'));
                pkBtn.disabled = false;
                pkBtn.innerHTML = oldHtml;
              }
            } catch {
              (window.DSHUI ? DSHUI.toast('Network error or already invited', 'err') : alert('Network error or already invited'));
              pkBtn.disabled = false;
              pkBtn.innerHTML = oldHtml;
            }
          });
        }
                
        (async () => {
          const achContainer = document.getElementById('achievementsContainer');
          if (!achContainer) return;
          const achData = await loadAchievements(username);
          achContainer.innerHTML = achData
            ? renderAchievements(achData)
            : '<div class="ach-section"><div class="ach-header"><h2><i class="fa-solid fa-trophy" style="color:#FFAA00;margin-right:.4rem;"></i>Achievements</h2></div><div class="ach-empty">Failed to load achievements.</div></div>';
        })();
      }
            window.flagUser = async (username, flagType) => {
        const msg = flagType === 'red' 
          ? `Confirm send ${username} a red card? This will ban every action of the account!` 
          : `Confirm ${username} a yellow card? This will increase the counter by 1`;
        if (!confirm(msg)) return;
        
        try {
          const res = await apiCall('/api/admin?action=flagUser', 'POST', { targetUser: username, flagType });
          if (res.success) {
            (window.DSHUI ? DSHUI.toast(res.message, 'ok') : alert(res.message));
            if (flagType === 'red') {
              setTimeout(() => window.location.reload(), 1000); // 红牌直接刷新页面
            }
          } else {
            throw new Error(res.message || 'Failed');
          }
        } catch (e) {
          (window.DSHUI ? DSHUI.toast(e.message, 'err') : alert(e.message));
        }
      };

      (async function init() {
      const data = await loadProfile();
      if (!data || !data.success) {
        mainContainer.innerHTML = '<div class="error-msg">Failed to load profile.</div>';
        return;
      }
      renderProfile(data);
      recordProfileView(profileUsername);
    })();
  })();
  