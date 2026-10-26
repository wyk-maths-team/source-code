
    if (!isLoggedIn()) window.location.href = '/index.html';

    const pathMatch = window.location.pathname.match(/^\/contest\/(\d+)$/);
    if (!pathMatch) {
      document.getElementById('mainContent').innerHTML =
        '<div class="cd-empty"><i class="fas fa-triangle-exclamation"></i>Invalid contest ID.</div>';
      throw new Error('No ID');
    }
    const contestId = parseInt(pathMatch[1], 10);
    document.title = `Contest #${contestId} - WYK Maths Team`;

    const mainContainer = document.getElementById('mainContent');

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }
        // ═══════════ Difficulty 渲染（移植自 problems-1.js）═══════════
    function computeDifficulty(difficulty) {
      const diff = Number(difficulty) || 0;

      if (diff === 0) {
        return { display: '∞', style: '', extraClass: '' };
      }

      const display = diff.toFixed(2);
      let style = '';
      let extraClass = '';

      if (diff >= 1 && diff < 2) {
        const lightness = 85;
        style = `background-color:hsl(0,0%,${lightness}%)!important;color:#000000!important;`;
      } else if (diff >= 2 && diff < 3) {
        const t = (diff - 2) / 1;
        const lightness = 70 - t * 35;
        style = `background-color:hsl(120,60%,${lightness}%)!important;color:#ffffff!important;`;
      } else if (diff >= 3 && diff < 4) {
        const t = (diff - 3) / 1;
        const lightness = 65 - t * 30;
        style = `background-color:hsl(210,70%,${lightness}%)!important;color:#ffffff!important;`;
      } else if (diff >= 4 && diff < 5) {
        const t = (diff - 4) / 1;
        const lightness = 65 - t * 30;
        style = `background-color:hsl(280,60%,${lightness}%)!important;color:#ffffff!important;`;
      } else if (diff >= 5 && diff < 6) {
        const t = (diff - 5) / 1;
        const lightness = 70 - t * 30;
        style = `background-color:hsl(45,80%,${lightness}%)!important;color:#000000!important;`;
      } else if (diff >= 6 && diff < 7) {
        const t = (diff - 6) / 1;
        const lightness = 60 - t * 25;
        style = `background-color:hsl(0,70%,${lightness}%)!important;color:#ffffff!important;`;
      } else if (diff >= 7 && diff < 8) {
        extraClass = 'rainbow-bg';
        style = `color:#000000!important;`;
      } else if (diff >= 8 && diff < 9) {
        extraClass = 'star-shine';
        style = `color:#000000!important;`;
      } else {
        // diff >= 9；順帶涵蓋 0 < diff < 1 的極端邊界（原邏輯同樣落入 chaos）
        extraClass = 'chaos';
        style = `color:#ffffff!important;`;
      }

      return { display, style, extraClass };
    }
    let _countdownTimer = null;
    function clearCountdown() {
      if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
    }

    function fmtDuration(ms) {
      if (ms <= 0) return '00:00:00';
      const totalSec = Math.floor(ms / 1000);
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const pad = n => String(n).padStart(2, '0');
      if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }

    function fmtScore(n) {
      const v = Number(n);
      if (!Number.isFinite(v)) return '0.00';
      return v.toFixed(2);
    }

    function setupCountdown(contest) {
      clearCountdown();
      const start = new Date(contest.startTime).getTime();
      const durMs = (Number(contest.duration) || 0) * 60_000;
      const end = start + durMs;

      const tick = () => {
        const now = Date.now();
        const valEl = document.getElementById('cdCountdownVal');
        const labelEl = document.getElementById('cdCountdownLabel');
        const fillEl = document.getElementById('cdProgressFill');
        if (!valEl || !labelEl || !fillEl) return;

        if (now < start) {
          labelEl.textContent = 'Starts in';
          valEl.textContent = fmtDuration(start - now);
          fillEl.style.width = '0%';
          fillEl.classList.remove('done');
        } else if (now < end) {
          labelEl.textContent = 'Ends in';
          valEl.textContent = fmtDuration(end - now);
          const pct = durMs > 0 ? ((now - start) / durMs) * 100 : 100;
          fillEl.style.width = Math.min(100, Math.max(0, pct)) + '%';
          fillEl.classList.remove('done');
        } else {
          labelEl.textContent = 'Contest ended';
          valEl.textContent = '—';
          fillEl.style.width = '100%';
          fillEl.classList.add('done');
          clearCountdown();
        }
      };
      tick();
      _countdownTimer = setInterval(tick, 1000);
    }

    async function loadPage() {
      try {
        const data = await apiCall(`/api/contests?action=page&id=${contestId}`);
        if (data.success && data.contest) {
          // ⭐ 特殊竞赛 → 重定向
          if (data.contest.special === true) {
            location.replace(`/tcontest/${contestId}`);
            return null;
          }
          return data.contest;
        }
      } catch (err) { console.error(err); }
      return null;
    }

    function renderContest(contest) {
      clearCountdown();

      if (!contest) {
        mainContainer.innerHTML =
          '<div class="cd-empty"><i class="fas fa-circle-question"></i>Contest not found.</div>';
        return;
      }

      const status = contest.status;
      const isParticipant = contest.isParticipant;
      const userStates = contest.userContestStates || {};
      const userScores = contest.userScores || {};
      const userAttempts = contest.userWrongAttempts || {};
      const globalStates = contest.globalStates || {};

      const startDate = new Date(contest.startTime);
      const startStr = startDate.toLocaleString('zh-HK', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });

      const durMin = Number(contest.duration) || 0;
      const durH = Math.floor(durMin / 60);
      const durM = durMin % 60;
      const durStr = durH > 0 ? `${durH}h ${durM}m` : `${durM}m`;

      const endDate = new Date(startDate.getTime() + durMin * 60_000);
      const endStr = endDate.toLocaleString('zh-HK', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
      });

      const statusLabel = { upcoming: 'Upcoming', ongoing: 'Live', ended: 'Ended' }[status] || status;
      const statusIcon = { upcoming: 'fa-clock', ongoing: 'fa-circle-play', ended: 'fa-flag-checkered' }[status] || 'fa-circle';

      let html = `
        <div class="contest-detail">
          <div class="cd-hero">
            <div class="cd-hero-inner">
              <div class="cd-hero-top">
                <h1 class="cd-hero-name">${escapeHtml(contest.name)}</h1>
                <span class="cd-status ${status}">
                  <span class="dot"></span>
                  <i class="fas ${statusIcon}"></i>
                  ${statusLabel}
                </span>
              </div>
              <div class="cd-hero-meta">
                <span class="item"><i class="fas fa-play"></i> ${escapeHtml(startStr)}</span>
                <span class="item"><i class="fas fa-stopwatch"></i> ${escapeHtml(durStr)}</span>
                <span class="item"><i class="fas fa-users"></i> ${contest.participantCount} participant${contest.participantCount !== 1 ? 's' : ''}</span>
              </div>
              <div class="cd-countdown">
                <div class="cd-countdown-row">
                  <span class="cd-countdown-label" id="cdCountdownLabel">—</span>
                  <span class="cd-countdown-val" id="cdCountdownVal">--:--:--</span>
                </div>
                <div class="cd-progress">
                  <div class="cd-progress-fill" id="cdProgressFill" style="width:0%"></div>
                </div>
              </div>
            </div>
          </div>
      `;

      let actionHtml = '';
      if (status === 'upcoming') {
        actionHtml = isParticipant
          ? `<button id="quitBtn" class="cd-btn danger"><i class="fas fa-right-from-bracket"></i> Quit Contest</button>`
          : `<button id="joinBtn" class="cd-btn success"><i class="fas fa-right-to-bracket"></i> Join Contest</button>`;
      } else if (status === 'ongoing') {
        if (isParticipant) {
          actionHtml = `<button id="quitBtn" class="cd-btn danger" disabled title="Cannot quit after contest started"><i class="fas fa-lock"></i> In Progress</button>`;
        } else {
          actionHtml = `<button id="joinBtn" class="cd-btn success"><i class="fas fa-right-to-bracket"></i> Join Live Contest</button>`;
        }
      }
      if (status !== 'upcoming') {
        actionHtml += `<a href="/contest/${contestId}/results" class="cd-btn primary"><i class="fas fa-trophy"></i> ${status === 'ended' ? 'Final Results' : 'Live Results'}</a>`;
      }
      if (actionHtml) html += `<div class="cd-actions">${actionHtml}</div>`;

      const shownProblems = (contest.problems || []).length;
      html += `
        <div class="cd-stats">
          <div class="cd-stat">
            <div class="cd-stat-icon"><i class="fas fa-list-ol"></i></div>
            <div class="cd-stat-info">
              <div class="cd-stat-label">Problems</div>
              <div class="cd-stat-value">${shownProblems || contest.problems?.length || '—'}</div>
            </div>
          </div>
          <div class="cd-stat">
            <div class="cd-stat-icon green"><i class="fas fa-users"></i></div>
            <div class="cd-stat-info">
              <div class="cd-stat-label">Participants</div>
              <div class="cd-stat-value">${contest.participantCount}</div>
            </div>
          </div>
          <div class="cd-stat">
            <div class="cd-stat-icon amber"><i class="fas fa-hourglass-half"></i></div>
            <div class="cd-stat-info">
              <div class="cd-stat-label">Duration</div>
              <div class="cd-stat-value">${escapeHtml(durStr)}</div>
            </div>
          </div>
          <div class="cd-stat">
            <div class="cd-stat-icon purple"><i class="fas fa-flag-checkered"></i></div>
            <div class="cd-stat-info">
              <div class="cd-stat-label">Ends</div>
              <div class="cd-stat-value" style="font-size:.9rem;">${escapeHtml(endStr)}</div>
            </div>
          </div>
        </div>
      `;

      const parts = contest.participants || [];
      html += `
        <div class="cd-section">
          <div class="cd-section-header">
            <h3><i class="fas fa-users"></i> Participants</h3>
            <span class="count">${parts.length}</span>
          </div>
          <div class="cd-section-body">
            ${
              parts.length === 0
                ? '<div style="color:var(--text-secondary);font-size:.9rem;">No participants yet.</div>'
                : `<div class="cd-participants">${parts.map(p => `
                    <a class="cd-ptag" href="/users/${encodeURIComponent(p)}" title="@${escapeHtml(p)}">
                      <span class="avatar">${escapeHtml((p[0] || '?').toUpperCase())}</span>
                      <span>${escapeHtml(p)}</span>
                    </a>`).join('')}</div>`
            }
          </div>
        </div>
      `;

      const canSeeProblems =
        (status === 'ongoing' || status === 'ended') &&
        isParticipant &&
        Array.isArray(contest.problems) &&
        contest.problems.length > 0;

      if (canSeeProblems) {
        html += `
          <div class="cd-section">
            <div class="cd-section-header">
              <h3><i class="fas fa-list-check"></i> Problems</h3>
              <span class="count">${contest.problems.length}</span>
            </div>
            <div style="overflow-x:auto;">
              <table class="cd-problem-table">
                <thead>
                  <tr>
                    <th style="width:80px;">ID</th>
                    <th>Name</th>
                    <th class="hide-xs" style="width:100px;">Type</th>
                    <th class="hide-xs" style="width:90px;">Diff</th>
                    <th style="width:170px;">Status</th>
                  </tr>
                </thead>
                <tbody>
        `;

          contest.problems.forEach(prob => {
          const state = userStates[prob.id] || 'not_started';
          const rawScore = userScores[prob.id];
          const hasContestRecord = rawScore !== undefined && rawScore !== null;
          const score = Number(rawScore) || 0;
          const attempts = userAttempts[prob.id] || 0;
          const solved = state === 'passed';
          const globalPassed = globalStates[prob.id] === 'passed';

          let rowClass = '';
          let badgeClass = 'none';
          let badgeIcon = 'fa-minus';
          let statusDisplay = 'Not attempted';

          if (!hasContestRecord && globalPassed) {
            rowClass = 'finished-before';
            badgeClass = 'finished-before';
            badgeIcon = 'fa-circle-check';
            statusDisplay = 'Finished before';
          } else if (solved) {
            if (attempts === 0) {
              rowClass = 'ac-first';
              badgeClass = 'ac-first';
              badgeIcon = 'fa-star';
              statusDisplay = `${fmtScore(score)}`;
            } else {
              rowClass = 'ac';
              badgeClass = 'ac';
              badgeIcon = 'fa-circle-check';
              statusDisplay = `${fmtScore(score)}`;
            }
          } else if (score > 0) {
            rowClass = 'partial';
            badgeClass = 'partial';
            badgeIcon = 'fa-circle-half-stroke';
            statusDisplay = `${fmtScore(score)}`;
          } else if (hasContestRecord) {
            rowClass = 'failed';
            badgeClass = 'failed';
            badgeIcon = 'fa-circle-xmark';
            statusDisplay = `${fmtScore(score)}`;
          }

          const typeBadge = prob.evalType === 'image_model'
            ? '<span class="cd-ptype photo">Photo</span>'
            : '<span class="cd-ptype numeric">Numeric</span>';
          const diffInfo = computeDifficulty(prob.difficulty);
                    html += `
            <tr class="${rowClass}" onclick="window.location.href='/problems/${encodeURIComponent(prob.id)}'">
              <td><span class="cd-pid">${escapeHtml(prob.id)}</span></td>
              <td><span class="cd-pname">${escapeHtml(prob.name)}</span></td>
              <td class="hide-xs">${typeBadge}</td>
              <td class="hide-xs">
                <span class="cd-diff ${diffInfo.extraClass}" style="${diffInfo.style}">${diffInfo.display}</span>
              </td>
              <td>
                <span class="cd-status-badge ${badgeClass}">
                  <i class="fas ${badgeIcon}"></i> ${escapeHtml(statusDisplay)}
                </span>
              </td>
            </tr>
          `;
        });

        html += `</tbody></table></div></div>`;
      } else if (!isParticipant && status === 'ended') {
        html += `
          <div class="cd-section">
            <div class="cd-section-body">
              <div style="color:var(--text-secondary);text-align:center;padding:1.5rem 0;">
                <i class="fas fa-user-slash" style="font-size:1.8rem;opacity:.5;display:block;margin-bottom:.6rem;"></i>
                You were not a participant of this contest.
              </div>
            </div>
          </div>
        `;
      } else if (status === 'upcoming') {
        html += `
          <div class="cd-section">
            <div class="cd-section-body">
              <div style="color:var(--text-secondary);text-align:center;padding:1.5rem 0;">
                <i class="fas fa-hourglass-start" style="font-size:1.8rem;opacity:.5;display:block;margin-bottom:.6rem;"></i>
                Problems will be revealed when the contest starts.
              </div>
            </div>
          </div>
        `;
      }

      html += `
        <div style="padding-top:.5rem;">
          <a href="/contest" class="cd-back"><i class="fas fa-arrow-left"></i> Back to Contest List</a>
        </div>
        </div>
      `;

      mainContainer.innerHTML = html;

      setupCountdown(contest);

      const joinBtn = document.getElementById('joinBtn');
      if (joinBtn) joinBtn.addEventListener('click', () => joinContest(joinBtn));
      const quitBtn = document.getElementById('quitBtn');
      if (quitBtn && !quitBtn.disabled) quitBtn.addEventListener('click', () => quitContest(quitBtn));
    }

    async function reload() {
      const fresh = await loadPage();
      renderContest(fresh);
    }

    async function joinContest(btn) {
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining…'; }
      try {
        const res = await apiCall('/api/contests?action=join', 'POST', { contestId });
        if (res.success) {
          await reload();
        } else {
          (window.DSHUI ? DSHUI.toast(res.message || 'Failed to join contest', 'err') : alert(res.message || 'Failed to join contest'));
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Join Contest'; }
        }
      } catch (err) {
        (window.DSHUI ? DSHUI.toast('Network error: ' + err.message, 'err') : alert('Network error: ' + err.message));
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Join Contest'; }
      }
    }

    async function quitContest(btn) {
      if (!confirm('Confirm quit? You cannot rejoin after the contest starts.')) return;
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Quitting…'; }
      try {
        const res = await apiCall('/api/contests?action=quit', 'POST', { contestId });
        if (res.success) {
          await reload();
        } else {
          (window.DSHUI ? DSHUI.toast(res.message || 'Failed to quit contest', 'err') : alert(res.message || 'Failed to quit contest'));
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-from-bracket"></i> Quit Contest'; }
        }
      } catch (err) {
        (window.DSHUI ? DSHUI.toast('Network error: ' + err.message, 'err') : alert('Network error: ' + err.message));
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-right-from-bracket"></i> Quit Contest'; }
      }
    }

    window.addEventListener('beforeunload', clearCountdown);

    (async function init() {
      const contest = await loadPage();
      renderContest(contest);
    })();
  