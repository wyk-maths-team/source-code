
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
              // 成就定义改为从 /api/users?action=achievements 拿（含进度），
      // 这里不再维护第二份 —— 以前前后端各一份，字段名还不一样（icon vs fa），
      // 加一个新成就漏改一边就是图标丢失。
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
      //
      // 定义、图标、描述、进度全部来自后端 /api/users?action=achievements，
      // 前端只负责排版。没有 progress 的成就（hidden / 事件触发）不画进度条。
      function renderAchievements(achData) {
        const defs = achData?.definitions || {};
        const prog = achData?.progress || {};
        const unlocked = new Set(achData?.achievements || []);
        const unlockedAt = achData?.unlockedAt || {};
        const streak = achData?.streak || {};
        const rewardsEarned = achData?.rewardsEarned || 0;

        const allIds = Object.keys(defs);
        if (!allIds.length) {
          return '<div class="ach-section"><div class="ach-header"><h2><i class="fa-solid fa-trophy" style="color:#FFAA00;margin-right:.4rem;"></i>Achievements</h2></div><div class="ach-empty">Achievement definitions unavailable.</div></div>';
        }

        // 排序：稀有度 → 未解锁优先 → 进度高者优先
        allIds.sort((a, b) => {
          const ra = RARITY_ORDER[defs[a].rarity] ?? 9;
          const rb = RARITY_ORDER[defs[b].rarity] ?? 9;
          if (ra !== rb) return ra - rb;
          const ua = unlocked.has(a) ? 1 : 0;
          const ub = unlocked.has(b) ? 1 : 0;
          if (ua !== ub) return ua - ub;
          return (prog[b]?.pct ?? 0) - (prog[a]?.pct ?? 0);
        });

        const unlockedCount = unlocked.size;
        const totalCount = allIds.length;

        function progressBar(id, isUnlocked) {
          const p = prog[id];
          if (!p || isUnlocked) return '';
          const pct = Math.max(0, Math.min(100, Math.round((p.pct || 0) * 100)));
          const label = p.gated
            ? `${p.label || `${p.current}/${p.target}`} to unlock`
            : `${p.current} / ${p.target}`;
          return `
            <div class="ach-bar-wrap" title="${escapeHtml(label)}">
              <div class="ach-bar"><div class="ach-bar-fill" style="width:${pct}%"></div></div>
              <div class="ach-bar-label">${escapeHtml(label)}</div>
            </div>`;
        }

        const cardsHtml = allIds.map(id => {
          const a = defs[id];
          const isUnlocked = unlocked.has(id);
          const date = unlockedAt[id] ? new Date(unlockedAt[id]).toISOString().slice(0, 10) : '';
          const rarity = a.rarity || 'common';

          // 隐藏成就：未解锁时屏蔽名称
          const displayName = (a.hidden && !isUnlocked) ? '???' : a.name;
          const displayDesc = (a.hidden && !isUnlocked) ? 'Hidden achievement' : a.desc;
          const displayIcon = (a.hidden && !isUnlocked) ? 'fa-lock' : (a.icon || 'fa-trophy');
          const reward = Number(a.reward) || 0;

          return `
            <div class="ach-card ${isUnlocked ? 'unlocked' : 'locked'} rarity-${rarity}"
                 title="${escapeHtml(displayDesc)}">
              <span class="ach-rarity-tag">${rarity}</span>
              <div class="ach-icon-wrap">
                <i class="fa-solid ${displayIcon}"></i>
              </div>
              <div class="ach-name">${escapeHtml(displayName)}</div>
              <div class="ach-desc">${escapeHtml(displayDesc)}</div>
              ${isUnlocked && date ? `<div class="ach-date">${date}</div>` : ''}
              ${!isUnlocked && reward ? `<div class="ach-reward">+${reward.toLocaleString()}</div>` : ''}
              ${progressBar(id, isUnlocked)}
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
              ${rewardsEarned ? `<span class="ach-earned" title="Tokens earned from achievements">💰 ${Number(rewardsEarned).toLocaleString()}</span>` : ''}
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
      // voyeur 成就已删除（它从未在 ACHIEVEMENTS 里定义过，上报只会静默失败），
      // 连同这里的 localStorage 计数一起移除。
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
          totalOnlineMs, lastSeenAt,theme
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
          <div class="profile-container theme-${theme || 'default'}">
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
                  ${(getCurrentUser() || {}).username === data.username
                    ? '<a href="/pk-bet-challenges" class="btn-link" title="Challenges you have sent">My Challenges</a>'
                    : ''}
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
            // 下注模式：先问金额，最低 10000
            const raw = prompt(
              `Challenge ${data.displayName || data.username} to a PK.\n\n` +
              `Stake (min 10,000 tokens). The stake is deducted immediately and goes into the pool.\n` +
              `If they decline or it expires, it is refunded.`,
              '10000'
            );
            if (raw === null) return;
            const stake = Math.round(Number(raw));
            if (!Number.isFinite(stake) || stake < 10000) {
              DSHUI.toast('Minimum stake is 10,000 tokens', 'warn');
              return;
            }

            pkBtn.disabled = true;
            const oldHtml = pkBtn.innerHTML;
            pkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending…';
            try {
              const res = await apiCall('/api/pk-bet?action=invite', 'POST', { to: data.username, stake });
              if (res.success) {
                if (typeof showPKInviteShare === 'function') {
                  showPKInviteShare(res.invite);
                }
                DSHUI.toast(`Invited — ${stake.toLocaleString()} tokens staked`, 'ok');
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
    })();
  })();
  