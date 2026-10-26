// assets/js/pages/pk-bet-challenges.js —— 我发出的全部 PK 挑战
Page.boot({ title: 'My Challenges', requireAuth: true });

Page.ready(async (user) => {
  const root = document.getElementById('pkcRoot');
  const countEl = document.getElementById('pkcCount');

  function esc(s) {
    return (window.DSHUI && DSHUI.esc) ? DSHUI.esc(s) : String(s == null ? '' : s);
  }

  function relTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function leftTime(iso) {
    const left = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
    if (left <= 0) return 'expired';
    const m = Math.floor(left / 60), s = left % 60;
    return `${m}:${String(s).padStart(2, '0')} left`;
  }

  // 请求失败时把状态码、code、message 都摆出来，方便判断是余额、权限还是过期
  function errorBlock(title, err) {
    const detail = [];
    if (err && err.status) detail.push(`HTTP ${err.status}`);
    if (err && err.code) detail.push(`code: ${err.code}`);
    if (err && err.need != null) detail.push(`need: ${Number(err.need).toLocaleString()}`);
    if (err && err.have != null) detail.push(`have: ${Number(err.have).toLocaleString()}`);
    const msg = (err && err.message) || String(err || 'Unknown error');
    return `<div class="pkc-err">
      <b>${esc(title)}</b>
      <pre>${esc(msg)}${detail.length ? '\n\n' + esc(detail.join(' · ')) : ''}</pre>
    </div>`;
  }

  async function cancel(inviteId) {
    if (!confirm('Cancel this challenge? Your stake will be refunded.')) return;
    try {
      const res = await apiCall('/api/pk-bet?action=cancel', 'POST', { inviteId });
      if (res && res.success) {
        DSHUI.toast('Challenge cancelled — stake refunded', 'ok');
        await load();
      } else {
        root.insertAdjacentHTML('afterbegin', errorBlock('Failed to cancel', res));
      }
    } catch (e) {
      root.insertAdjacentHTML('afterbegin', errorBlock('Failed to cancel', e));
    }
  }

  async function load() {
    root.innerHTML = '<div class="pkc-empty">Loading…</div>';
    let res;
    try {
      res = await apiCall('/api/pk-bet?action=outgoing');
    } catch (e) {
      root.innerHTML = errorBlock('Could not reach the server', e);
      return;
    }

    if (!res || !res.success) {
      root.innerHTML = errorBlock('Could not load your challenges', res);
      return;
    }

    const list = res.invites || [];
    countEl.textContent = list.length ? `${list.length} total` : '';

    // 对手已经接受 → 不停在这个列表，直接进房间；已结算则直接看结果
    const live = list.find(i => i.status === 'accepted' && i.roomId);
    if (live) {
      const target = live.resultId
        ? `/pk-bet-result?id=${encodeURIComponent(live.resultId)}`
        : `/pk-bet-room?id=${encodeURIComponent(live.roomId)}`;
      location.href = target;
      return;
    }

    if (list.length === 0) {
      root.innerHTML = `<div class="pkc-empty">
        You have not sent any challenges yet.<br>
        <span style="font-size:.85rem;">Open someone's profile and press <b>Invite</b> to start one.</span>
      </div>`;
      return;
    }

    const now = res.serverNow ? new Date(res.serverNow).getTime() : Date.now();

    root.innerHTML = `<div class="pkc-list">${list.map(i => {
      const expired = i.status === 'pending' && new Date(i.expiresAt).getTime() <= now;
      const status = expired ? 'expired' : i.status;
      const actions = [];

      if (i.canCancel && !expired) {
        actions.push(`<button class="btn btn-warning" data-cancel="${esc(i.id)}">Cancel &amp; refund</button>`);
      }
      if (i.status === 'accepted' && i.roomId) {
        actions.push(`<a class="btn btn-primary" href="/pk-bet-room?id=${encodeURIComponent(i.roomId)}">Open room</a>`);
        if (i.resultId) {
          actions.push(`<a class="btn" href="/pk-bet-result?id=${encodeURIComponent(i.resultId)}">View result</a>`);
        }
      }

      return `
        <div class="pkc-item ${status}">
          <div class="pkc-main">
            <div class="pkc-opp">
              <a class="pkc-link" href="/users/${encodeURIComponent(i.to)}">${esc(i.toDisplay || i.to)}</a>
            </div>
            <div class="pkc-sub">
              sent ${relTime(i.createdAt)}
              ${status === 'pending' ? ' · ' + leftTime(i.expiresAt) : ''}
            </div>
          </div>
          <div class="pkc-stake">${Number(i.stake).toLocaleString()}</div>
          <span class="pkc-badge ${esc(status)}">${esc(status)}</span>
          <div class="pkc-actions">${actions.join('')}</div>
        </div>`;
    }).join('')}</div>`;

    root.querySelectorAll('[data-cancel]').forEach(b => {
      b.onclick = () => cancel(b.dataset.cancel);
    });
  }

  await load();

  // 每 20 秒刷新一次，倒计时和对手接受与否都能及时反映
  setInterval(() => {
    if (!document.hidden) load();
  }, 20000);
});
