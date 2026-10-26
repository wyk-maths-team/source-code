
    if (!isLoggedIn()) window.location.href = '/index.html';

    const pathMatch = window.location.pathname.match(/^\/contest\/(\d+)\/results$/);
    const queryId = new URLSearchParams(location.search).get('id');
    const contestId = pathMatch ? parseInt(pathMatch[1], 10) : (queryId ? parseInt(queryId, 10) : null);

    if (!contestId) {
      document.getElementById('mainContent').innerHTML =
        '<div class="rs-empty"><i class="fas fa-triangle-exclamation"></i>Invalid URL.</div>';
      throw new Error('No ID');
    }
    document.title = `Results for Contest #${contestId} - WYK Maths Team`;

    const mainContainer = document.getElementById('mainContent');
    const currentUsername = (typeof getCurrentUser === 'function' && getCurrentUser()?.username) || '';

    async function loadResults() {
      try {
        const data = await apiCall(`/api/contests?action=results&id=${contestId}`);
        if (data.success) return data.stats;
      } catch (err) { console.error(err); }
      return null;
    }

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    function rankClass(rank) {
      if (rank === 1) return 'gold';
      if (rank === 2) return 'silver';
      if (rank === 3) return 'bronze';
      return '';
    }

    function fmtScore(n) {
      const v = Number(n);
      if (!Number.isFinite(v)) return '0.00';
      return v.toFixed(2);
    }

    // ⭐ 判断是否 team（username 纯数字 = team）
    function isTeamUser(username, meta) {
      if (meta && meta.isTeam) return true;
      return /^\d+$/.test(String(username));
    }

    // ═══════════ Tooltip ═══════════
    const tooltip = document.createElement('div');
    tooltip.id = 'userTooltip';
    document.body.appendChild(tooltip);

    let tooltipTargetEl = null;

    function showTooltip(user) {
      const avatar = user.pfp
        ? `<img class="tip-avatar" src="${escapeHtml(user.pfp)}" alt="">`
        : `<div class="tip-avatar placeholder">${user.isTeam ? '👥' : '👤'}</div>`;

      tooltip.innerHTML = `
        ${avatar}
        <div class="tip-info">
          <div class="tip-display">${escapeHtml(user.displayName || user.username)}</div>
          <div class="tip-username">${user.isTeam ? 'Team #' : '@'}${escapeHtml(user.username)}</div>
          ${user.realName && !user.isTeam ? `<div class="tip-realname">${escapeHtml(user.realName)}</div>` : ''}
          ${user.isTeam && user.captain ? `<div class="tip-realname">Captain: ${escapeHtml(user.captain)}</div>` : ''}
          ${user.isTeam && user.memberCount ? `<div class="tip-realname">${user.memberCount} member${user.memberCount > 1 ? 's' : ''}</div>` : ''}
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

    // ═══════════ Render ═══════════
    function renderResults(stats) {
      if (!stats || !stats.participants || stats.participants.length === 0) {
        mainContainer.innerHTML = `
          <div class="results-wrap">
            <div class="rs-empty">
              <i class="fas fa-inbox"></i>
              <div>No results yet.</div>
              <div style="margin-top:1rem;">
                <a href="/contest/${contestId}" class="rs-back"><i class="fas fa-arrow-left"></i> Back to Contest</a>
              </div>
            </div>
          </div>`;
        return;
      }

      const problemIds = stats.problems || [];
      const participants = stats.participants;
      const maxTotal = problemIds.length * 100;

      const totalParticipants = participants.length;
      const topScore = participants[0]?.total ?? 0;

      const totalAC = participants.reduce((sum, p) => {
        const probs = p.problems || {};
        return sum + problemIds.filter(pid => {
          const info = probs[pid];
          return info && Number(info.score) >= 100;
        }).length;
      }, 0);

      const myIndex = participants.findIndex(p => p.username === currentUsername);
      const myRank = myIndex >= 0 ? myIndex + 1 : null;

      let html = `<div class="results-wrap">`;

      html += `
        <div class="rs-hero">
          <div class="rs-hero-inner">
            <h1 class="rs-hero-name">
              <i class="fas fa-trophy"></i>
              Contest Results
            </h1>
            <p class="rs-hero-sub">Contest #${contestId} · ${totalParticipants} participant${totalParticipants !== 1 ? 's' : ''}</p>
            <div class="rs-hero-actions">
              <a href="/contest/${contestId}" class="rs-hero-btn"><i class="fas fa-arrow-left"></i> Back to Contest</a>
              <a href="/contest" class="rs-hero-btn primary"><i class="fas fa-list"></i> All Contests</a>
            </div>
          </div>
        </div>
      `;

      html += `
        <div class="rs-stats">
          <div class="rs-stat">
            <div class="rs-stat-icon"><i class="fas fa-users"></i></div>
            <div class="rs-stat-info">
              <div class="rs-stat-label">Participants</div>
              <div class="rs-stat-value">${totalParticipants}</div>
            </div>
          </div>
          <div class="rs-stat">
            <div class="rs-stat-icon gold"><i class="fas fa-crown"></i></div>
            <div class="rs-stat-info">
              <div class="rs-stat-label">Top Score</div>
              <div class="rs-stat-value">${fmtScore(topScore)} <span class="max">/ ${maxTotal.toFixed(2)}</span></div>
            </div>
          </div>
          <div class="rs-stat">
            <div class="rs-stat-icon green"><i class="fas fa-circle-check"></i></div>
            <div class="rs-stat-info">
              <div class="rs-stat-label">Total AC</div>
              <div class="rs-stat-value">${totalAC}</div>
            </div>
          </div>
          ${myRank ? `
          <div class="rs-stat">
            <div class="rs-stat-icon purple"><i class="fas fa-user"></i></div>
            <div class="rs-stat-info">
              <div class="rs-stat-label">Your Rank</div>
              <div class="rs-stat-value">#${myRank}</div>
            </div>
          </div>` : ''}
        </div>
      `;

      html += `
        <div class="rs-section">
          <div class="rs-section-header">
            <h3><i class="fas fa-ranking-star"></i> Leaderboard</h3>
          </div>
          <div class="rs-table-scroll">
            <table class="rs-table">
              <thead>
                <tr>
                  <th class="col-rank">Rank</th>
                  <th class="col-user" style="text-align:left;">User</th>
      `;

      problemIds.forEach(pid => {
        html += `<th class="col-prob">${escapeHtml(pid)}</th>`;
      });

      html += `
                  <th class="col-total">Total</th>
                </tr>
              </thead>
              <tbody>
      `;

      participants.forEach((p, idx) => {
        const rank = idx + 1;
        const rClass = rankClass(rank);
        const isMe = p.username === currentUsername;
        const problems = p.problems || {};
        const display = p.displayName || '';
        const team = isTeamUser(p.username, p);

        // 头像内容
        let avatarContent;
        if (team) {
          avatarContent = '<i class="fas fa-users"></i>';
        } else if (p.pfp) {
          avatarContent = `<img src="${escapeHtml(p.pfp)}" alt="" loading="lazy" decoding="async">`;
        } else {
          avatarContent = escapeHtml((p.username[0] || '?').toUpperCase());
        }

        // ⭐ 链接：team 跳 /teams/1，普通用户跳 /users/xxx
        const href = team
          ? `/teams/${encodeURIComponent(p.username)}`
          : `/users/${encodeURIComponent(p.username)}`;

        // 主名称显示
        const mainName = team ? (display || `Team #${p.username}`) : p.username;
        // 副名称（team 显示 members 数，user 显示 realName）
        let subText = '';
        if (team) {
          const mc = p.memberCount || 0;
          subText = `Team #${p.username}${mc ? ' · ' + mc + ' member' + (mc > 1 ? 's' : '') : ''}`;
        } else if (display && display !== p.username) {
          subText = display;
        }

        html += `<tr class="${isMe ? 'me' : ''}">
          <td class="cell-rank">
            <span class="rs-rank ${rClass}">${rank}</span>
          </td>
          <td class="cell-user" style="text-align:left;">
            <a class="rs-user user-link"
               href="${href}"
               data-username="${escapeHtml(p.username)}">
              <span class="rs-user-avatar ${rClass} ${team ? 'team' : ''}">${avatarContent}</span>
              <span class="rs-user-info">
                <span class="rs-user-name">${escapeHtml(mainName)}</span>
                ${subText ? `<span class="rs-user-sub">${escapeHtml(subText)}</span>` : ''}
              </span>
            </a>
          </td>`;

        problemIds.forEach(pid => {
          const info = problems[pid];
          if (!info) {
            html += `<td class="cell cell-empty"><span>—</span></td>`;
            return;
          }
          const score = Number(info.score) || 0;
          const wrongAttempts = Number(info.wrongAttempts) || 0;
          const solved = info.solved === true || score >= 100;
          const locked = info.locked === true;

          // ⭐ WA 锁定：显示红色
          if (locked) {
            html += `<td class="cell cell-wa"><span>${fmtScore(score)}</span></td>`;
            return;
          }

          if (solved && score >= 100) {
            if (wrongAttempts === 0) {
              html += `<td class="cell cell-ac-first"><span>100.00</span></td>`;
            } else {
              html += `<td class="cell cell-ac"><span>${fmtScore(score)}</span></td>`;
            }
          } else if (score > 0) {
            html += `<td class="cell cell-partial"><span>${fmtScore(score)}</span></td>`;
          } else {
            html += `<td class="cell cell-wa"><span>${fmtScore(score)}</span></td>`;
          }
        });

        html += `
          <td class="cell-total">${fmtScore(p.total ?? 0)}</td>
        </tr>`;
      });

      html += `
              </tbody>
            </table>
          </div>
          <div class="rs-legend">
            <span class="rs-legend-item"><span class="rs-legend-swatch ac-first"></span> First-try AC</span>
            <span class="rs-legend-item"><span class="rs-legend-swatch ac"></span> AC (after tries)</span>
            <span class="rs-legend-item"><span class="rs-legend-swatch wa"></span> Wrong Answer</span>
            <span class="rs-legend-item"><span class="rs-legend-swatch partial"></span> Partial</span>
            <span class="rs-legend-item"><span class="rs-legend-swatch empty"></span> Not attempted</span>
          </div>
        </div>
      `;

      html += `
        <div style="padding-top:.5rem;">
          <a href="/contest/${contestId}" class="rs-back"><i class="fas fa-arrow-left"></i> Back to Contest</a>
        </div>
      `;

      html += `</div>`;
      mainContainer.innerHTML = html;

      // Tooltip 绑定
      const userMap = Object.fromEntries(participants.map(p => [p.username, p]));
      mainContainer.querySelectorAll('.user-link').forEach(link => {
        link.addEventListener('mouseenter', (e) => {
          const u = userMap[link.dataset.username];
          if (!u) return;
          // 补充 isTeam 用于 tooltip
          u.isTeam = isTeamUser(u.username, u);
          tooltipTargetEl = link;
          showTooltip(u);
          moveTooltip(e);
        });
        link.addEventListener('mousemove', moveTooltip);
        link.addEventListener('mouseleave', hideTooltip);
      });
    }

    (async function init() {
      const stats = await loadResults();
      renderResults(stats);
    })();
  