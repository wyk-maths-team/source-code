
    if (!isLoggedIn()) window.location.href = '/index.html';

    const params = new URLSearchParams(location.search);
    const inviteId = params.get('invite');
        // ⭐ 拉邀请里的 toDisplay 显示对方名字
    
    if (!inviteId) {
      document.getElementById('mainContent').innerHTML =
        '<div style="text-align:center;padding:60px;color:var(--danger)">Invalid</div>';
      throw new Error('No inviteId');
    }
    (async () => {
      try {
        const data = await apiCall(`/api/pk?action=invite-status&inviteId=${encodeURIComponent(inviteId)}`);
        if (data.success && data.invite) {
          const name = data.invite.toDisplay || data.invite.to;
          document.getElementById('pkWaitSub').textContent = `已向 ${name} 发出邀请`;
        }
      } catch {}
    })();
        const countEl  = document.getElementById('pkWaitCount');
    const barEl    = document.getElementById('pkWaitBar');
    const subEl    = document.getElementById('pkWaitSub');
    const cancelBtn = document.getElementById('pkCancelBtn');

    let expiresAt = null;      // ⭐ 由服務端提供
    let createdAt = null;      // ⭐ 用來算進度條
    let ended = false;

    function tick() {
      if (ended) return;
      if (expiresAt === null) {
        countEl.textContent = '10:00';   // 佔位，等 poll 拿到真實值
        return;
      }
      const remaining = Math.max(0, expiresAt - Date.now());
      const sec = Math.ceil(remaining / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      countEl.textContent = `${m}:${String(s).padStart(2, '0')}`;

      if (createdAt !== null) {
        const total   = expiresAt - createdAt;
        const elapsed = Date.now() - createdAt;
        barEl.style.width = Math.min(100, (elapsed / total) * 100) + '%';
      }

      if (remaining <= 0) {
        ended = true;
        countEl.textContent = '0:00';
        subEl.textContent = 'Expired';
        cancelBtn.innerHTML = 'Back';
      }
    }

    async function poll() {
      if (ended) return;
      try {
        const data = await apiCall(`/api/pk?action=invite-status&inviteId=${encodeURIComponent(inviteId)}`);
        if (!data.success) return;
        const inv = data.invite;

        // ⭐ 首次拿到時間戳
        if (expiresAt === null && inv.expiresAt) {
          expiresAt = new Date(inv.expiresAt).getTime();
        }
        if (createdAt === null && inv.createdAt) {
          createdAt = new Date(inv.createdAt).getTime();
        }

        if (inv.status === 'accepted' && inv.roomId) {
          ended = true;
          subEl.textContent = 'Accepted';
          setTimeout(() => {
            window.location.href = `/pk/room?id=${encodeURIComponent(inv.roomId)}`;
          }, 400);
        } else if (inv.status === 'declined') {
          ended = true;
          subEl.textContent = 'Rejected';
          countEl.textContent = '—';
          cancelBtn.innerHTML = 'Back';
        } else if (inv.status === 'expired') {
          ended = true;
          subEl.textContent = 'Expired';
          countEl.textContent = '0:00';
          cancelBtn.innerHTML = 'Back';
        }
      } catch {}
    }
    cancelBtn.addEventListener('click', async () => {
      if (ended) { window.location.href = '/'; return; }
      try { await apiCall('/api/pk?action=cancel', 'POST', { inviteId }); } catch {}
      window.location.href = '/';
    });

    setInterval(tick, 250);
    setInterval(poll, 2000);
    tick();
    poll();
  