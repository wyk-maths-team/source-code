// assets/js/pages/pk-bet-room.js —— 下注 PK 比赛房间（色块版）
//
// 页面上不出现任何题目内容，只有三个色块。颜色即状态：
//   灰 todo / 绿 AC / 红 WA / 黄 PS(部分分)
// 块里显示该题当前占的时间分。点块跳到真实题目页去作答。
Page.boot({ title: 'PK Room', requireAuth: true });

Page.ready(async (user) => {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('id') || params.get('roomId');
  const board = document.getElementById('pkbBoard');

  let room = null;
  let attempts = [];
  let me = '';
  let offsetMs = 0;
  let tickTimer = null;
  let pollTimer = null;
  let busy = false;
  let stopped = false;        // 一旦确定房间不再活跃，就停掉所有定时器
  let endTriggered = false;   // 时间到只触发一次结算请求

  function stopAll() {
    stopped = true;
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function esc(s) {
    return (window.DSHUI && DSHUI.esc) ? DSHUI.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  if (!roomId) {
    board.innerHTML = '<div class="pkb-err">Missing room id.</div>';
    return;
  }

  function attemptOf(user, pid) {
    return attempts.find(a => a.username === user && a.problemId === pid) || null;
  }

  function stateOf(a) {
    if (!a) return 'todo';
    if (Number(a.score) >= 100) return 'ac';
    if (Number(a.score) <= 0) return 'wa';
    return 'ps';
  }

  function render() {
    if (!room) return;
    const now = Date.now() + offsetMs;
    const end = new Date(room.endAt).getTime();
    const left = Math.max(0, Math.floor((end - now) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    const cls = left <= 60 ? ' danger' : left <= 300 ? ' warn' : '';

    const ready = room.endRequestedBy || [];
    const iAmReady = ready.includes(me);
    const opp = room.players.find(p => p.username !== me);
    const oppReady = opp && ready.includes(opp.username);

    const blocks = room.problemIds.map((pid, i) => {
      const a = attemptOf(me, pid);
      const st = stateOf(a);
      const value = a ? Number(a.weighted).toLocaleString() : '—';
      const unit = a ? 'time score' : 'not attempted';
      const at = a ? `at ${a.timeSec}s` : '';
      return `
        <a class="pkb-block ${st}" href="/problems/${encodeURIComponent(pid)}" target="_blank" rel="noopener"
           title="Open ${esc(pid)}">
          <div class="qname">Q${i + 1}</div>
          <div class="value">${value}</div>
          <div class="unit">${unit}</div>
          ${at ? `<div class="at">${at}</div>` : ''}
        </a>`;
    }).join('');

    const sides = room.players.map(p => {
      const isMe = p.username === me;
      const submitted = attempts.filter(a => a.username === p.username).length;
      const pips = room.problemIds.map(pid => {
        const st = stateOf(attemptOf(p.username, pid));
        return `<div class="pip ${st === 'todo' ? '' : st}"></div>`;
      }).join('');
      return `
        <div class="pkb-side">
          <div class="who">${esc(p.displayName)}${isMe ? '<span class="me">YOU</span>' : ''}</div>
          <div class="meta">rating ${p.rating} · ${submitted}/3 attempted</div>
          <div class="pips">${pips}</div>
        </div>`;
    }).join('');

    const myStake = room.players.find(p => p.username === me)?.stake ?? 0;

    board.innerHTML = `
      <div class="pkb-head">
        <div class="pkb-timer${cls}">${mm}:${ss}</div>
        <div class="pkb-moneys">
          stake ${Number(myStake).toLocaleString()} each<br>
          prize pool <b>${Number(room.prize).toLocaleString()}</b>
          <span style="opacity:.7">(fee ${Number(room.fee).toLocaleString()})</span>
        </div>
      </div>

      <div class="pkb-blocks">${blocks}</div>

      <div class="pkb-vs">${sides}</div>

      <div class="pkb-footer">
        <button class="pkb-endbtn${iAmReady ? ' armed' : ''}" id="pkbEndBtn">
          ${iAmReady ? 'Ready — waiting for opponent' : 'Announce finish'}
        </button>
        <span class="pkb-endnote ${oppReady ? 'opp' : ''}" id="pkbEndNote">
          ${oppReady ? 'Opponent is ready to finish.' : ''}
        </span>
      </div>

      <div class="pkb-hint">
        Click a block to open that problem in a new tab. Only your <b>last</b> submission per problem
        inside the window counts. Both players pressing <b>Announce finish</b> ends the match early.
      </div>
    `;

    const btn = document.getElementById('pkbEndBtn');
    if (btn) btn.onclick = () => toggleReady(!iAmReady);
  }

  async function toggleReady(arm) {
    if (busy) return;
    busy = true;
    const btn = document.getElementById('pkbEndBtn');
    if (btn) btn.disabled = true;
    try {
      const res = await apiCall('/api/pk-bet?action=ready-end', 'POST', { roomId, cancel: !arm });
      if (res && res.success) {
        if (res.settled && res.result) {
          stopAll();
          location.href = `/pk-bet-result?id=${encodeURIComponent(res.result.id)}`;
          return;
        }
        await refresh();
      } else {
        DSHUI.toast((res && res.message) || 'Failed', 'err');
      }
    } catch (e) {
      DSHUI.toast('Network error', 'err');
    } finally {
      busy = false;
      const b = document.getElementById('pkbEndBtn');
      if (b) b.disabled = false;
    }
  }

  function tick() {
    if (!room) return;
    const now = Date.now() + offsetMs;
    const left = Math.max(0, Math.floor((new Date(room.endAt).getTime() - now) / 1000));
    const el = document.querySelector('.pkb-timer');
    if (el) {
      const mm = String(Math.floor(left / 60)).padStart(2, '0');
      const ss = String(left % 60).padStart(2, '0');
      el.textContent = `${mm}:${ss}`;
      el.className = 'pkb-timer' + (left <= 60 ? ' danger' : left <= 300 ? ' warn' : '');
    }
    // 时间到只触发一次；之前每秒都调 refresh()，房间一关闭就变成无限请求
    if (left <= 0 && !endTriggered && !stopped) {
      endTriggered = true;
      refresh();
    }
  }

  async function refresh() {
    if (stopped) return;
    try {
      const res = await apiCall(`/api/pk-bet?action=room&roomId=${encodeURIComponent(roomId)}`);

      // 业务失败（房间不存在 / 不是参赛者 / 未登录）：重试没有意义，停掉轮询
      if (!res.success) {
        stopAll();
        board.innerHTML = `<div class="pkb-err">${esc(res.message || 'Failed to load')}</div>`;
        return;
      }

      if (res.result) {
        stopAll();
        location.href = `/pk-bet-result?id=${encodeURIComponent(res.result.id)}`;
        return;
      }

      room = res.room;
      attempts = res.attempts || [];
      me = res.you || (getCurrentUser() || {}).username;
      offsetMs = new Date(res.serverNow).getTime() - Date.now();

      // 已结算：直接去结果页，不要停在「房间已关闭」
      if (room.status === 'settled') {
        stopAll();
        if (room.resultId) {
          location.href = `/pk-bet-result?id=${encodeURIComponent(room.resultId)}`;
        } else {
          board.innerHTML = '<div class="pkb-err">Match finished, but the result is missing.</div>';
        }
        return;
      }

      if (room.status !== 'active') {
        stopAll();
        board.innerHTML = '<div class="pkb-err">This room is closed.</div>';
        return;
      }

      render();
    } catch (e) {
      // 网络错误可能只是瞬断，继续轮询等它恢复
      board.innerHTML = '<div class="pkb-err">Network error. Retrying…</div>';
    }
  }

  await refresh();
  // 首次加载就可能已经结束（跳结果页或显示 closed），此时不要再起定时器
  if (!stopped) {
    tickTimer = setInterval(tick, 1000);
    pollTimer = setInterval(() => { if (!document.hidden && !stopped) refresh(); }, 5000);
  }

  window.addEventListener('beforeunload', () => {
    if (tickTimer) clearInterval(tickTimer);
    if (pollTimer) clearInterval(pollTimer);
  });
});
