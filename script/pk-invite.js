// resources/script/pk-invite.js
// 全局 PK 邀请监听 —— 所有登录后页面加载
(function () {
  'use strict';
  if (!localStorage.getItem('auth_token')) return;

  // ⭐ 用戶可在 settings 關閉 PK 邀請通知
  if (localStorage.getItem('pkInviteEnabled') === 'false') return;

  // ⭐ 調參
  const POLL_MS      = 60_000;       // 每 60 秒檢查一次
  const IDLE_MS      = 2 * 60_000;   // 2 分鐘沒任何操作 → 視為空閒
  const FIRST_DELAY  = 2_000;        // 首次延遲，讓頁面先穩下來

  let bannerEl = null;
  let shownInviteId = null;
  let lastActivityAt = Date.now();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  async function fetchPending() {
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch('/api/pk?action=pending', {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.success ? data : null;
    } catch { return null; }
  }

  function removeBanner() {
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
    shownInviteId = null;
  }

function showBanner(invite) {
    if (shownInviteId === invite.id) return;
    shownInviteId = invite.id;
    if (bannerEl) bannerEl.remove();

    const el = document.createElement('div');
    el.id = 'pk-invite-banner';
    el.innerHTML = `
      <style>
        #pk-invite-banner {
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          z-index: 2147483646;
          background: linear-gradient(135deg, #1a1a2e, #16213e);
          border: 2px solid #4a90d9; border-radius: 12px;
          padding: 16px 22px; color: #fff;
          box-shadow: 0 10px 40px rgba(74,144,217,.5);
          display: flex; align-items: center; gap: 16px;
          font-family: system-ui, -apple-system, sans-serif;
          animation: pkInviteIn .3s cubic-bezier(.34,1.56,.64,1);
          max-width: 90vw;
        }
        @keyframes pkInviteIn {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        #pk-invite-banner .pk-ico {
          width: 44px; height: 44px; flex-shrink: 0;
          background: radial-gradient(circle, #4a90d9, #2e5fa0);
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 1.3rem;
        }
        #pk-invite-banner .pk-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        #pk-invite-banner .pk-title { font-weight: 800; font-size: .95rem; }
        #pk-invite-banner .pk-sub { font-size: .82rem; color: rgba(255,255,255,.7); }
        #pk-invite-banner .pk-actions { display: flex; gap: 8px; margin-left: 8px; }
        #pk-invite-banner button {
          padding: 7px 14px; border-radius: 6px; border: none;
          font-weight: 700; font-size: .82rem; cursor: pointer;
          font-family: inherit; transition: filter .12s;
        }
        #pk-invite-banner button:hover { filter: brightness(1.1); }
        #pk-invite-banner .pk-accept { background: #2ecc71; color: #fff; }
        #pk-invite-banner .pk-decline { background: rgba(255,255,255,.15); color: #fff; }
        @media (max-width: 600px) {
          #pk-invite-banner { flex-direction: column; align-items: stretch; padding: 14px; }
          #pk-invite-banner .pk-actions { margin-left: 0; }
          #pk-invite-banner .pk-actions button { flex: 1; }
        }
      </style>
      <div class="pk-ico">⚔️</div>
      <div class="pk-body">
        <div class="pk-title">${esc(invite.fromDisplay || invite.from)} Invited you to PK</div>
        <div class="pk-sub">Click to accept</div>
      </div>
      <div class="pk-actions">
        <button class="pk-accept" id="pkAcceptBtn">Accept</button>
        <button class="pk-decline" id="pkDeclineBtn">Decline</button>
      </div>
    `;
    document.body.appendChild(el);
    bannerEl = el;

    const token = localStorage.getItem('auth_token');

    el.querySelector('#pkAcceptBtn').addEventListener('click', async () => {
      try {
        const res = await fetch('/api/pk?action=accept', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inviteId: invite.id }),
        });
        const data = await res.json();
        if (data.success && data.roomId) {
          removeBanner();
          window.location.href = `/pk/room?id=${encodeURIComponent(data.roomId)}`;
        } else {
          alert(data.message || 'Failed');
          removeBanner();
        }
      } catch { alert('Network error'); }
    });

    el.querySelector('#pkDeclineBtn').addEventListener('click', async () => {
      try {
        await fetch('/api/pk?action=decline', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inviteId: invite.id }),
        });
      } catch {}
      removeBanner();
    });
  }

  // ═══════════════ 活動偵測 ═══════════════
  function isActive() {
    if (document.hidden) return false;
    return (Date.now() - lastActivityAt) < IDLE_MS;
  }

  function bumpActivity() {
    const wasIdle = (Date.now() - lastActivityAt) > IDLE_MS;
    lastActivityAt = Date.now();
    // 剛從空閒恢復 → 立刻檢查一次，不用等下一輪
    if (wasIdle && !document.hidden) tick();
  }

  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'wheel']
    .forEach(ev => window.addEventListener(ev, bumpActivity, { passive: true }));

  // 標籤頁切回來 → 立即檢查
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastActivityAt = Date.now();
      tick();
    }
  });

  // ═══════════════ 主輪詢 ═══════════════
  async function tick() {
    if (!isActive()) return;            // 空閒 / 背景 → 跳過
    const data = await fetchPending();
    if (!data) return;
    if (data.incoming && data.incoming.status === 'pending') {
      showBanner(data.incoming);
    } else if (bannerEl) {
      removeBanner();
    }
  }

  setTimeout(tick, FIRST_DELAY);
  setInterval(tick, POLL_MS);
})();