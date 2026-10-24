
    // ── 未登入 → 記住返回位址，登入後自動跳回
    if (!isLoggedIn()) {
      sessionStorage.setItem('pk_login_redirect', location.href);
      window.location.href = '/index.html';
      throw new Error('Not logged in');
    }

    const params = new URLSearchParams(location.search);
    // 兼容两种参数名：分享卡片用 ?id=，旧等待页用 ?invite=
    const inviteId = params.get('id') || params.get('invite');
    const cardEl = document.getElementById('pkInvCard');

    let invite = null;
    let ttlTimer = null;

    function esc(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    function renderError(msg) {
      cardEl.innerHTML = `
        <div class="pk-inv-icon danger"><i class="fas fa-times"></i></div>
        <div class="pk-inv-title">Invitation unavailable</div>
        <div class="pk-inv-sub">${esc(msg)}</div>
      `;
    }

    function renderStatus(msg, color) {
      let el = cardEl.querySelector('.pk-inv-status');
      if (!el) {
        el = document.createElement('div');
        el.className = 'pk-inv-status';
        cardEl.appendChild(el);
      }
      el.textContent = msg;
      el.style.color = color || 'var(--text-secondary)';
    }

    function renderInvite() {
      const statusMap = {
        pending:   'Pending',
        accepted:  'Accepted',
        declined:  'Declined',
        cancelled: 'Cancelled',
        expired:   'Expired',
      };

      if (!invite) { renderError('Invitation not found.'); return; }

      // 已被接受 → 直接進房間。
      // 下注模式的房间 id 以 PKB 开头、房间页是 /pk-bet-room；旧房间模式是 /pk/room。
      if (invite.status === 'accepted') {
        if (invite.roomId) {
          const isBet = invite.stake !== undefined || String(invite.roomId).indexOf('PKB') === 0;
          window.location.href = isBet
            ? `/pk-bet-room?id=${encodeURIComponent(invite.roomId)}`
            : `/pk/room?id=${encodeURIComponent(invite.roomId)}`;
          return;
        }
        renderError('This invitation was already accepted.');
        return;
      }

      if (invite.status !== 'pending') {
        renderError(`This invitation is ${statusMap[invite.status] || invite.status}.`);
        return;
      }

      if (new Date(invite.expiresAt).getTime() < Date.now()) {
        renderError('This invitation has expired.');
        return;
      }

      // 身份檢查
      const me = getCurrentUser();
      if (invite.from === me.username) {
        renderError("This is your own invitation — you can't accept it.");
        return;
      }
      if (invite.to !== me.username) {
        renderError('This invitation was sent to someone else.');
        return;
      }

      const fromName = invite.fromDisplay || invite.from;
      const stakeLine = invite.stake !== undefined
        ? `<div class="pk-inv-sub" style="margin-top:6px;">Stake: <b>${Number(invite.stake).toLocaleString()}</b> tokens each
             · prize pool ${Number(invite.stake * 1.6).toLocaleString()} after 20% fee</div>`
        : '';
      cardEl.innerHTML = `
        <div class="pk-inv-icon"><i class="fas fa-swords"></i></div>
        <div class="pk-inv-title">${esc(fromName)} invited you to PK</div>
        <div class="pk-inv-sub">Accept to enter the arena</div>
        ${stakeLine}
        <div class="pk-inv-ttl" id="pkInvTtl"></div>
        <div class="pk-inv-actions">
          <button class="pk-accept"  id="pkInvAccept">Accept</button>
          <button class="pk-decline" id="pkInvDecline">Decline</button>
        </div>
        <div class="pk-inv-status"></div>
      `;
      document.getElementById('pkInvAccept').addEventListener('click', onAccept);
      document.getElementById('pkInvDecline').addEventListener('click', onDecline);
      startTtl();
    }

    function startTtl() {
      const el = document.getElementById('pkInvTtl');
      if (!el) return;
      if (ttlTimer) clearInterval(ttlTimer);

      const update = () => {
        const remain = new Date(invite.expiresAt).getTime() - Date.now();
        if (remain <= 0) {
          el.textContent = 'Expired';
          el.className = 'pk-inv-ttl danger';
          clearInterval(ttlTimer);
          setTimeout(() => renderError('This invitation has expired.'), 800);
          return;
        }
        const sec = Math.ceil(remain / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        el.textContent = `Expires in ${m}:${String(s).padStart(2, '0')}`;
        el.className = 'pk-inv-ttl' + (sec <= 30 ? ' danger' : sec <= 60 ? ' warn' : '');
      };
      update();
      ttlTimer = setInterval(update, 500);
    }

    async function onAccept() {
      const a = document.getElementById('pkInvAccept');
      const d = document.getElementById('pkInvDecline');
      a.disabled = d.disabled = true;
      a.textContent = 'Accepting…';

      // 下注模式的邀请带 stake 字段，走 /api/pk-bet，成功后进 /pk-bet-room
      const isBet = invite && invite.stake !== undefined;
      const acceptUrl = isBet ? '/api/pk-bet?action=accept' : '/api/pk?action=accept';

      try {
        const res = await apiCall(acceptUrl, 'POST', { inviteId });
        if (res.success && res.roomId) {
          if (ttlTimer) clearInterval(ttlTimer);
          window.location.href = isBet
            ? `/pk-bet-room?id=${encodeURIComponent(res.roomId)}`
            : `/pk/room?id=${encodeURIComponent(res.roomId)}`;
        } else {
          renderStatus(res.message || 'Failed', 'var(--danger)');
          a.disabled = d.disabled = false;
          a.textContent = 'Accept';
        }
      } catch (err) {
        const detail = (err && err.code ? ` [${err.code}]` : '') +
          (err && err.need != null ? ` need ${Number(err.need).toLocaleString()}, have ${Number(err.have).toLocaleString()}` : '');
        renderStatus(((err && err.message) || 'Network error') + detail, 'var(--danger)');
        a.disabled = d.disabled = false;
        a.textContent = 'Accept';
      }
    }

    async function onDecline() {
      const a = document.getElementById('pkInvAccept');
      const d = document.getElementById('pkInvDecline');
      a.disabled = d.disabled = true;
      const isBet = invite && invite.stake !== undefined;
      const declineUrl = isBet ? '/api/pk-bet?action=decline' : '/api/pk?action=decline';
      try { await apiCall(declineUrl, 'POST', { inviteId }); } catch {}
      if (ttlTimer) clearInterval(ttlTimer);
      cardEl.innerHTML = `
        <div class="pk-inv-icon danger"><i class="fas fa-ban"></i></div>
        <div class="pk-inv-title">Invitation declined</div>
        <div class="pk-inv-sub">You can close this page now.</div>
      `;
    }

    // ── 載入
    (async () => {
      if (!inviteId) { renderError('Missing invite ID.'); return; }

      // 两套邀请并存：先问下注模式，再退回旧的房间模式。
      // 旧代码只查 /api/pk，下注邀请永远查不到，页面就一直是「Invitation unavailable」。
      let data = null;
      try {
        data = await apiCall(`/api/pk-bet?action=invite-status&inviteId=${encodeURIComponent(inviteId)}`);
      } catch (e) {
        data = null;
      }
      if (!data || !data.success) {
        try {
          data = await apiCall(`/api/pk?action=invite-status&inviteId=${encodeURIComponent(inviteId)}`);
        } catch (e) {
          data = null;
        }
      }

      if (!data || !data.success || !data.invite) {
        renderError((data && data.message) || 'Invitation not found.');
        return;
      }
      invite = data.invite;
      renderInvite();
    })();
  