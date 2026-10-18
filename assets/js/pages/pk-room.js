
    if (!isLoggedIn()) window.location.href = '/index.html';

    const params = new URLSearchParams(location.search);
    const roomId = params.get('id');
    const isSpectatorMode = params.get('spectate') === '1'; 
    if (!roomId) {
      document.getElementById('mainContent').innerHTML =
        '<div style="text-align:center;padding:60px;color:var(--danger)">Invalid room</div>';
      throw new Error('No roomId');
    }

    // ═══════════════ 布局坐标 (% of container) ═══════════════
    // 六边形环 A（1-2-3-4-5-6）+ 三角环 B（7-8-9）
    const ISLAND_POS = {
      1: { x: 12, y: 38 },
      2: { x: 30, y: 12 },
      3: { x: 70, y: 12 },
      4: { x: 88, y: 38 },
      5: { x: 70, y: 62 },
      6: { x: 30, y: 62 },
      7: { x: 32, y: 84 },
      8: { x: 68, y: 84 },
      9: { x: 50, y: 96 },
    };

    const state = {
      me: null,
      other: null,
      regions: [],
      adjacency: {},
      startAt: null,
      openPanelIndex: null,
      isSpectator: false,   // ⭐ 观众标志
    };
        // ═══════════════ 答题弹窗 ═══════════════
    const pkModal = document.getElementById('pkProblemModal');
    const pkpId   = document.getElementById('pkpId');
    const pkpTimer = document.getElementById('pkpTimer');
    const pkpStatement = document.getElementById('pkpStatement');
    const pkpChoices = document.getElementById('pkpChoices');
    const pkpSubmit = document.getElementById('pkpSubmit');
    const pkpCancel = document.getElementById('pkpCancel');
    const pkpMsg = document.getElementById('pkpMsg');

    let currentProblem = null;   // { id, choice }
    let selectedAns = null;
    let lockExpiresAt = 0;
    let timerHandle = null;
    let modalState = 'idle';     // ⭐ 'idle' | 'opening' | 'opened' | 'closing'

    function sleep(ms) {
      return new Promise(r => setTimeout(r, ms));
    }

    function esc2(s) {
      return String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
    }
    function renderProblemStatement(html) {
      pkpStatement.innerHTML = html || '(no statement)';

      const imgs = Array.from(pkpStatement.querySelectorAll('img'));

      if (imgs.length > 0) {
        // 1) 圖片全搬到 imgCol，並清掉原本的 inline style（那是 editor 的居中樣式）
        const imgCol = document.createElement('div');
        imgCol.className = 'pkp-img-col';
        for (const img of imgs) {
          img.removeAttribute('style');
          imgCol.appendChild(img);
        }

        // 2) 剩下的所有節點搬到 textCol
        const textCol = document.createElement('div');
        textCol.className = 'pkp-text-col';
        while (pkpStatement.firstChild) {
          textCol.appendChild(pkpStatement.firstChild);
        }
        // 清掉「本來只裝圖片」的空 <p>
        textCol.querySelectorAll('p').forEach(p => {
          if (!p.textContent.trim() && !p.querySelector('img, svg, canvas')) {
            p.remove();
          }
        });

        // 3) 組裝
        pkpStatement.innerHTML = '';
        pkpStatement.appendChild(textCol);
        pkpStatement.appendChild(imgCol);
        pkpStatement.classList.add('has-image');
      } else {
        pkpStatement.classList.remove('has-image');
      }

      // 4) KaTeX：支援 $...$ / $$...$$ / \(...\) / \[...\]
      if (typeof renderMathInElement === 'function') {
        try {
          renderMathInElement(pkpStatement, {
            delimiters: [
              { left: '$$',  right: '$$',  display: true  },
              { left: '\\[', right: '\\]', display: true  },
              { left: '\\(', right: '\\)', display: false },
              { left: '$',   right: '$',   display: false },
            ],
            throwOnError: false,
            ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
          });
        } catch (e) {
          console.warn('[pk] KaTeX render failed:', e);
        }
      }
    }
    async function openProblem(problemId) {
      // ⭐ 防刷屏：動畫或請求出發中，直接忽略
      if (modalState !== 'idle') return;
      modalState = 'opening';

      // 準備 Loading 內容
      pkpMsg.textContent = '';
      pkpStatement.innerHTML = 'Loading…';
      pkpChoices.innerHTML = '';
      pkpSubmit.disabled = true;
      pkpSubmit.textContent = 'Submit';
      pkpId.textContent = '—';
      selectedAns = null;

      // 顯示彈窗 + 觸發進入動畫
      pkModal.style.display = 'flex';
      void pkModal.offsetHeight;          // 強制 reflow，讓 transition 生效
      pkModal.classList.remove('closing');
      pkModal.classList.add('opened');

      const animDone = sleep(500);

      try {
        const data = await apiCall('/api/pk?action=open', 'POST', { roomId, problemId });
        await animDone;

        if (!data.success) {
          pkpStatement.innerHTML = `<span style="color:var(--danger)">${esc2(data.message || 'Failed to open')}</span>`;
          pkpSubmit.disabled = true;
          // 顯示錯誤訊息 1.8 秒後自動關閉
          setTimeout(() => {
            if (modalState === 'opening') closeProblem();
          }, 1800);
          return;
        }

        currentProblem = data.problem;
        lockExpiresAt = data.lockExpiresAt;

        pkpId.textContent = currentProblem.id;
        renderProblemStatement(currentProblem.statement);

        const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        pkpChoices.innerHTML = (currentProblem.choice || []).map((text, i) => `
          <div class="pk-choice" data-letter="${LETTERS[i]}">
            <span class="pk-choice-letter">${LETTERS[i]}</span>
            <span class="pk-choice-text">${esc2(text)}</span>
          </div>
        `).join('');
        if (typeof renderMathInElement === 'function') {
          try {
            renderMathInElement(pkpChoices, {
              delimiters: [
                { left: '$$',  right: '$$',  display: true  },
                { left: '\\[', right: '\\]', display: true  },
                { left: '\\(', right: '\\)', display: false },
                { left: '$',   right: '$',   display: false },
              ],
              throwOnError: false,
              ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
            });
          } catch (e) {
            console.warn('[pk] KaTeX (choices) failed:', e);
          }
        }
        pkpChoices.querySelectorAll('.pk-choice').forEach(el => {
          el.addEventListener('click', () => {
            pkpChoices.querySelectorAll('.pk-choice').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
            selectedAns = el.dataset.letter;
            pkpSubmit.disabled = false;
          });
        });

        modalState = 'opened';
        startProblemTimer();
      } catch (err) {
        await animDone;
        pkpStatement.innerHTML = `<span style="color:var(--danger)">${esc2(err.message)}</span>`;
        setTimeout(() => {
          if (modalState === 'opening') closeProblem();
        }, 1800);
      }
    }
    function startProblemTimer() {
      stopProblemTimer();
      timerHandle = setInterval(() => {
        const remain = Math.max(0, lockExpiresAt - Date.now());
        const sec = Math.ceil(remain / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        pkpTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
        pkpTimer.className = 'pk-problem-timer';
        if (sec <= 30) pkpTimer.classList.add('danger');
        else if (sec <= 120) pkpTimer.classList.add('warn');

        if (remain <= 0) {
          stopProblemTimer();
          pkpMsg.textContent = '⏱ Time up — problem locked for 1 minute';
          pkpMsg.style.color = '#e74c3c';
          setTimeout(() => {
            if (modalState === 'opened' || modalState === 'opening') {
              closeProblem();
            }
          }, 1000);
        }
      }, 250);
    }
    function stopProblemTimer() {
      if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    }

    function closeProblem(noReload) {
      if (modalState === 'idle' || modalState === 'closing') return;
      modalState = 'closing';

      stopProblemTimer();
      pkModal.classList.add('closing');

      setTimeout(() => {
        pkModal.classList.remove('opened', 'closing');
        pkModal.style.display = 'none';

        currentProblem = null;
        selectedAns = null;
        pkpSubmit.textContent = 'Submit';
        pkpSubmit.disabled = true;
        pkpMsg.textContent = '';

        modalState = 'idle';

        if (!noReload) loadRoom();
      }, 300);
    }

    pkpCancel.addEventListener('click', () => {
      if (modalState !== 'opened') return;
      closeProblem();
    });

    pkpSubmit.addEventListener('click', async () => {
      if (!currentProblem || !selectedAns) return;
      pkpSubmit.disabled = true;
      pkpSubmit.textContent = 'Submitting…';
      pkpMsg.textContent = '';

      try {
        const res = await apiCall('/api/pk?action=submit', 'POST', {
          roomId,
          problemId: currentProblem.id,
          ans: selectedAns,
        });
        if (res.success) {
          if (res.status === 'AC') {
            pkpMsg.textContent = '✓ Correct!';
            pkpMsg.style.color = '#2e7d32';
            setTimeout(() => closeProblem(), 1000);
          } else {
            const mins = Math.ceil((res.cooldownSec || 600) / 60);
            pkpMsg.textContent = `✗ Wrong — this problem is locked for ${mins} min`;
            pkpMsg.style.color = '#e74c3c';
            setTimeout(() => closeProblem(), 1800);
          }
        } else {
          pkpMsg.textContent = res.message || 'Failed';
          pkpMsg.style.color = 'var(--danger)';
          pkpSubmit.disabled = false;
          pkpSubmit.textContent = 'Submit';
        }
      } catch (err) {
        pkpMsg.textContent = 'Error: ' + err.message;
        pkpMsg.style.color = 'var(--danger)';
        pkpSubmit.disabled = false;
        pkpSubmit.textContent = 'Submit';
      }
    });
    // ═══════════════ 倒计时 ═══════════════
    const TOTAL_MS = 30 * 60 * 1000;
    const timerEl = document.getElementById('pkRoomTimer');

    function updateTimer() {
      if (state.startAt === null) {
        timerEl.textContent = '30:00';
        return;
      }
      const elapsed = Date.now() - state.startAt;
      const remain = Math.max(0, TOTAL_MS - elapsed);
      const sec = Math.ceil(remain / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (sec <= 60)      timerEl.style.color = '#e74c3c';
      else if (sec <= 300) timerEl.style.color = '#f0ad4e';
      else                 timerEl.style.color = 'var(--accent)';
    }
    setInterval(updateTimer, 250);

    // ═══════════════ SVG 连线 ═══════════════
    function renderConnections() {
      const svg = document.getElementById('pkMapSvg');
      const map = document.getElementById('pkMap');
      const W = map.clientWidth;
      const H = map.clientHeight;

      const edges = new Set();
      for (const [from, tos] of Object.entries(state.adjacency)) {
        for (const to of tos) {
          const key = [Math.min(+from, +to), Math.max(+from, +to)].join('-');
          edges.add(key);
        }
      }

      let html = '';
      for (const key of edges) {
        const [a, b] = key.split('-').map(Number);
        const pa = ISLAND_POS[a], pb = ISLAND_POS[b];
        if (!pa || !pb) continue;
        const x1 = (pa.x / 100) * W, y1 = (pa.y / 100) * H;
        const x2 = (pb.x / 100) * W, y2 = (pb.y / 100) * H;
        html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
      }
      svg.innerHTML = html;
    }

    // ═══════════════ 岛屿渲染 ═══════════════
    function renderIslands() {
      const map = document.getElementById('pkMap');
      map.querySelectorAll('.island').forEach(el => el.remove());

      const meIsHost = state.meIsHost;

      for (const reg of state.regions) {
        const pos = ISLAND_POS[reg.index];
        if (!pos) continue;

        const el = document.createElement('div');
        el.className = 'island';
        el.dataset.index = reg.index;
        el.style.left = pos.x + '%';
        el.style.top  = pos.y + '%';

        if (!reg.unlocked) el.classList.add('locked');

        // ⭐ 歸屬判定：統一以「我=紅 / 對手=藍」為準
        const c = reg.counts;
        const myCount    = meIsHost ? c.host : c.guest;
        const otherCount = meIsHost ? c.guest : c.host;

        if (myCount + otherCount > 0) el.classList.add('has-claims');
        if (myCount > otherCount && myCount >= 3)         el.classList.add('owned-host');
        else if (otherCount > myCount && otherCount >= 3) el.classList.add('owned-guest');
        else if (myCount > 0 && otherCount > 0)           el.classList.add('contested');

        // 5 格狀態點（本來就是「我/對手」判定，不動）
        const slotsHtml = reg.problems.map(p => {
          let cls = '';
          if (p.owner === state.me.username)         cls = 'host';
          else if (p.owner === state.other.username) cls = 'guest';
          return `<span class="s ${cls}"></span>`;
        }).join('');

        const lockHtml = reg.unlocked ? '' :
          `<div class="island-lock"><i class="fas fa-lock"></i></div>`;

        el.innerHTML = `
          ${lockHtml}
          <div class="island-circle">
            <div class="island-num">${reg.index}</div>
            <div class="island-part">${reg.part}</div>
            <div class="island-slots">${slotsHtml}</div>
          </div>
          <div class="island-count">
            <span class="c-me">●${myCount}</span>
            &nbsp;
            <span class="c-other">●${otherCount}</span>
          </div>
        `;

        if (reg.unlocked) {
          el.addEventListener('click', () => openIslandPanel(reg.index));
        }
        map.appendChild(el);
      }
    }
    // ═══════════════ 岛屿展开面板 ═══════════════
    const panel = document.getElementById('islandPanel');
    const panelTitle = document.getElementById('panelTitle');
    const panelBadge = document.getElementById('panelBadge');
    const slotGrid = document.getElementById('slotGrid');

    function openIslandPanel(index) {
      const reg = state.regions.find(r => r.index === index);
      if (!reg) return;

      panelTitle.textContent = `Island ${index}`;
      panelBadge.textContent = `PART ${reg.part}`;
      state.openPanelIndex = index;   // ⭐ 记录

      slotGrid.innerHTML = reg.problems.map(p => {
        let cls = 'slot';
        let label = 'Empty';
        let icon  = 'fa-circle';
        if (p.owner === state.me.username) {
          cls += ' owned owned-host';
          label = 'You';
          icon = 'fa-flag';
        } else if (p.owner === state.other.username) {
          cls += ' owned owned-guest';
          label = state.other.displayName || state.other.username;
          icon = 'fa-flag';
        } else {
          icon = 'fa-question';
          label = 'Open';
        }
        const pid = p.problemId || '????';
        return `
          <div class="${cls}" data-slot="${p.slot}">
            <div class="slot-icon"><i class="fas ${icon}"></i></div>
            <div class="slot-problem">${pid}</div>
            <div class="slot-label">${label}</div>
          </div>
        `;
      }).join('');

      // 未占的格子点击 → 下一轮做题目弹窗，现在只提示
      slotGrid.querySelectorAll('.slot:not(.owned)').forEach(el => {
        el.addEventListener('click', () => {
          // ⭐ 观众不能打开题目
          if (state.isSpectator) {
            return;
          }
          const pid = el.querySelector('.slot-problem').textContent;
          openProblem(pid);
        });
      });

      panel.classList.add('show');
    }

    function closeIslandPanel() {
      panel.classList.remove('show');
      state.openPanelIndex = null;    // ⭐
    }
    document.getElementById('panelClose').addEventListener('click', closeIslandPanel);
    panel.addEventListener('click', e => {
      if (e.target === panel) closeIslandPanel();
    });
    // ⭐ 分享觀戰連結
    (function () {
      const btn = document.getElementById('shareWatchBtn');
      if (!btn) return;
      btn.addEventListener('click', async () => {
        const url = `${location.origin}/pk/room?id=${encodeURIComponent(roomId)}&spectate=1`;
        try {
          await navigator.clipboard.writeText(url);
          const orig = btn.innerHTML;
          btn.classList.add('copied');
          btn.innerHTML = '<i class="fas fa-check"></i>';
          setTimeout(() => {
            btn.classList.remove('copied');
            btn.innerHTML = orig;
          }, 1400);
        } catch {
          // fallback
          prompt('Copy the following link：', url);
        }
      });
    })();
    // ═══════════════ 主加载 ═══════════════
    let isPolling = false;

    async function loadRoom() {
      if (isPolling) return;
      isPolling = true;
      try {
        const data = await apiCall(`/api/pk?action=room-info&roomId=${encodeURIComponent(roomId)}`);
        if (!data.success) throw new Error(data.message);

        const r = data.room;
        const isSpectator = r.me === 'spectator';

        state.isSpectator = isSpectator;

        if (isSpectator) {
          // ⭐ 观众：host 永远是红方，guest 永远是蓝方
          state.me    = r.host;    // 红
          state.other = r.guest;   // 蓝
          state.meIsHost = true;
        } else {
          const meInfo    = r.me === 'host' ? r.host : r.guest;
          const otherInfo = r.me === 'host' ? r.guest : r.host;
          state.me    = meInfo;
          state.other = otherInfo;
          state.meIsHost = (r.me === 'host');
        }

        state.regions = r.regions || [];
        state.adjacency = r.adjacency || {};

        // ⭐ 显示/隐藏观众横幅
        const specBanner = document.getElementById('spectatorBanner');
        if (specBanner) specBanner.hidden = !isSpectator;

        // ⭐ 观众隐藏「随机/等待对手」等元素（如果你有的话）
        // 目前 header 元素通用，不额外处理

        // Header（統一用 state.me / state.other，觀眾也適用）
        document.getElementById('pkMeName').textContent =
          state.me.displayName || state.me.username;
        document.getElementById('pkOtherName').textContent =
          state.other.displayName || state.other.username;

        let myCount = 0, otherCount = 0;
        for (const reg of state.regions) {
          for (const p of reg.problems) {
            if (p.owner === state.me.username) myCount++;
            else if (p.owner === state.other.username) otherCount++;
          }
        }
        document.getElementById('pkMeCount').textContent = myCount;
        document.getElementById('pkOtherCount').textContent = otherCount;

        if (r.year) document.getElementById('pkYear').textContent = `DSE 20${r.year}`;

        // 时间基准（仅首次）
        if (state.startAt === null && r.createdAt && data.serverNow) {
          const serverStartMs = new Date(r.createdAt).getTime();
          const offset = data.serverNow - Date.now();
          state.startAt = serverStartMs - offset;
        }

        renderConnections();
        renderIslands();

        // ⭐ 面板开着 → 用最新 state 重新渲染
        if (state.openPanelIndex !== null) {
          openIslandPanel(state.openPanelIndex);
        }
      } catch (err) {
        console.error('[room]', err);
      } finally {
        isPolling = false;
      }
    }

    // resize → 重画连线
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        renderConnections();
        renderIslands();
      }, 200);
    });

    // ═══════════════ 智能轮询 ═══════════════
    // 鼠标移动中 → 5 秒一次
    // 鼠标静止   → 15 秒一次
    // 2 分钟无任何活动 / 标签页隐藏 → 暂停
    const POLL_MOVING_MS   = 5_000;      // 移動中
    const POLL_STILL_MS    = 15_000;     // 靜止
    const MOVING_WINDOW_MS = 3_000;      // 3 秒內有 mousemove 就算「移動中」
    const IDLE_MS          = 2 * 60_000; // 2 分鐘無活動 → 休眠

    let lastMoveAt     = Date.now();
    let lastActivityAt = Date.now();
    let pollTimer      = null;

    function noteActivity(e) {
      const now = Date.now();
      const wasIdle = (now - lastActivityAt) > IDLE_MS;
      lastActivityAt = now;
      if (e && (e.type === 'mousemove' || e.type === 'touchmove')) {
        lastMoveAt = now;
      }
      // 剛從休眠醒來 → 立即刷新，然後重新調度
      if (wasIdle) restartPoll(0);
    }

    ['mousemove', 'mousedown', 'touchstart', 'touchmove', 'wheel', 'scroll', 'keydown']
      .forEach(ev => window.addEventListener(ev, noteActivity, { passive: true }));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      lastMoveAt = lastActivityAt = Date.now();
      restartPoll(0);   // 切回前景 → 立即刷新
    });

    function nextInterval() {
      if (document.hidden) return null;
      const now = Date.now();
      if (now - lastActivityAt > IDLE_MS) return null;              // 休眠
      if (now - lastMoveAt < MOVING_WINDOW_MS) return POLL_MOVING_MS; // 鼠標在動
      return POLL_STILL_MS;                                          // 靜止
    }

    function restartPoll(delay) {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      const wait = (delay === undefined) ? nextInterval() : delay;
      if (wait === null) return;   // 休眠中，不排程
      pollTimer = setTimeout(() => {
        pollTimer = null;
        if (document.hidden) return;
        loadRoom().finally(() => restartPoll());
      }, wait);
    }

    loadRoom();
    restartPoll();
  