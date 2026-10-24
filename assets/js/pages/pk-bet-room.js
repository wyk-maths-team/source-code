// assets/js/pages/pk-bet-room.js —— 下注 PK 比赛房间
Page.boot({ title: 'PK Room', requireAuth: true });

Page.ready(async (user) => {
  const params = new URLSearchParams(location.search);
  const roomId = params.get('id') || params.get('roomId');

  const elTimer = document.getElementById('pkbTimer');
  const elPool = document.getElementById('pkbPool');
  const elPlayers = document.getElementById('pkbPlayers');
  const elTabs = document.getElementById('pkbTabs');
  const elPanel = document.getElementById('pkbPanel');

  let room = null;
  let problems = [];
  let attempts = [];
  let me = '';
  let activeIdx = 0;
  let tickTimer = null;
  let pollTimer = null;
  let offsetMs = 0;          // 服务端时间 - 本地时间
  let finished = false;

  function esc(s) {
    return (window.DSHUI && DSHUI.esc) ? DSHUI.esc(s) : String(s == null ? '' : s);
  }

  if (!roomId) {
    elPanel.innerHTML = '<div style="color:#e74c3c;">Missing room id.</div>';
    return;
  }

  function myAttempt(problemId) {
    return attempts.find(a => a.username === me && a.problemId === problemId) || null;
  }

  function opponent() {
    if (!room) return null;
    return room.players.find(p => p.username !== me) || null;
  }

  function renderHead() {
    if (!room) return;
    elPool.innerHTML = `Pool <b>${room.pool.toLocaleString()}</b> · fee ${room.fee.toLocaleString()} · prize <b>${room.prize.toLocaleString()}</b>`;
    elPlayers.innerHTML = room.players.map(p => {
      const isMe = p.username === me;
      const n = attempts.filter(a => a.username === p.username).length;
      return `
        <div class="pkb-pcard ${isMe ? 'me' : ''}">
          <div class="nm">${esc(p.displayName)}${isMe ? ' (you)' : ''}</div>
          <div class="sub">rating ${p.rating} · stake ${p.stake.toLocaleString()}</div>
          <div class="sub">submitted ${n}/3</div>
        </div>`;
    }).join('');
  }

  function renderTabs() {
    elTabs.innerHTML = problems.map((p, i) => {
      const a = myAttempt(p.id);
      const mark = a ? (a.score > 0 ? '✓' : '✗') : '';
      return `<div class="pkb-tab ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
        Q${i + 1} <span class="dot">${mark}</span>
      </div>`;
    }).join('');

    elTabs.querySelectorAll('.pkb-tab').forEach(el => {
      el.onclick = () => {
        activeIdx = Number(el.dataset.idx);
        renderTabs();
        renderPanel();
      };
    });
  }

  function renderPanel() {
    const p = problems[activeIdx];
    if (!p) { elPanel.innerHTML = ''; return; }
    const a = myAttempt(p.id);
    const prev = a ? String(a.score) : '';

    elPanel.innerHTML = `
      <div class="pkb-meta">Difficulty ${p.difficulty != null ? p.difficulty : '—'} · problem ${esc(p.id)}</div>
      <div class="pkb-stmt" id="pkbStmt">${p.statement || ''}</div>
      <div class="pkb-answer-row">
        <input id="pkbAns" type="text" placeholder="Your answer" autocomplete="off"
               value="${a ? 'submitted (score ' + a.score + ')' : ''}" ${a && a.score > 0 ? 'disabled' : ''} />
        <button class="btn btn-primary" id="pkbSubmit" ${finished ? 'disabled' : ''}>Submit</button>
      </div>
      <div class="pkb-status ${a ? (a.score > 0 ? 'ok' : 'err') : ''}" id="pkbStatus">
        ${a ? (a.score > 0 ? `Accepted at ${a.timeSec}s — weighted ${a.weighted.toLocaleString()}` : `Wrong answer at ${a.timeSec}s — you may retry`) : ''}
      </div>
      <div class="pkb-note">
        Score per problem = (1800 − T) × 100, where T is the second (1–1800) you last submitted.
        Submitting again replaces your previous attempt, so a later wrong answer loses the earlier one.
      </div>
    `;

    if (window.renderMathInElement) {
      try {
        renderMathInElement(elPanel, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
      } catch (e) {}
    }

    const btn = document.getElementById('pkbSubmit');
    const input = document.getElementById('pkbAns');
    if (btn) btn.onclick = () => doSubmit(input);
  }

  async function doSubmit(input) {
    const p = problems[activeIdx];
    if (!p || !input) return;
    const val = input.value.trim();
    if (!val) { DSHUI.toast('Write something first', 'warn'); return; }

    const btn = document.getElementById('pkbSubmit');
    btn.disabled = true;
    btn.textContent = 'Checking…';

    try {
      const res = await apiCall('/api/pk-bet?action=submit', 'POST', {
        roomId, problemId: p.id, answer: val,
      });
      if (res.success) {
        DSHUI.toast(res.correct ? 'Correct!' : 'Wrong answer', res.correct ? 'ok' : 'err');
        await refresh();
      } else {
        DSHUI.toast(res.message || 'Failed', 'err');
        btn.disabled = false;
        btn.textContent = 'Submit';
      }
    } catch (e) {
      DSHUI.toast('Network error', 'err');
      btn.disabled = false;
      btn.textContent = 'Submit';
    }
  }

  function tick() {
    if (!room || finished) return;
    const now = Date.now() + offsetMs;
    const end = new Date(room.endAt).getTime();
    const left = Math.max(0, Math.floor((end - now) / 1000));
    const m = Math.floor(left / 60);
    const s = left % 60;
    elTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    elTimer.className = 'pkb-timer' + (left <= 60 ? ' danger' : left <= 300 ? ' warn' : '');

    if (left <= 0) {
      clearInterval(tickTimer);
      onTimeUp();
    }
  }

  async function onTimeUp() {
    finished = true;
    elTimer.textContent = '0:00';
    elPanel.innerHTML = '<div style="padding:1.5rem;text-align:center;">Time is up — settling…</div>';
    await refresh();
  }

  async function refresh() {
    try {
      const res = await apiCall(`/api/pk-bet?action=room&roomId=${encodeURIComponent(roomId)}`);
      if (!res.success) {
        elPanel.innerHTML = `<div style="color:#e74c3c;">${esc(res.message || 'Failed to load')}</div>`;
        return;
      }

      if (res.result) {
        location.href = `/pk-bet-result?id=${encodeURIComponent(res.result.id)}`;
        return;
      }

      room = res.room;
      problems = res.problems || [];
      attempts = res.attempts || [];
      me = res.you || (getCurrentUser() || {}).username;
      offsetMs = new Date(res.serverNow).getTime() - Date.now();

      if (room.status !== 'active') {
        finished = true;
        elPanel.innerHTML = '<div style="padding:1.5rem;text-align:center;">This room is closed.</div>';
        return;
      }

      renderHead();
      renderTabs();
      renderPanel();
      tick();
    } catch (e) {
      elPanel.innerHTML = '<div style="color:#e74c3c;">Network error.</div>';
    }
  }

  await refresh();
  tickTimer = setInterval(tick, 1000);
  // 每 10 秒同步一次（拿对手提交状态、发现结算）
  pollTimer = setInterval(() => { if (!finished) refresh(); }, 10000);

  window.addEventListener('beforeunload', () => {
    clearInterval(tickTimer);
    clearInterval(pollTimer);
  });
});
