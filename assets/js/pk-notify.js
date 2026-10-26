// assets/js/pk-notify.js
//
// 全局 PK 邀请通知。
//
// 背景：原先只有「邀请详情页」(pk-invite.html) 能接受邀请 —— 必须由发起方
// 把链接分享给你，你点进去才看得到。没有任何地方在你已经打开的页面上提醒
// 有人邀请你，所以从被邀请者的视角，PK 邀请几乎是「不存在」的。
//
// 这个脚本做三件事：
//   1. 每 20 秒问一次 /api/pk?action=pending
//   2. 收到 incoming 邀请时弹出卡片，可当场接受/拒绝
//   3. 接受后直接跳到 PK 房间
//
// 刻意保持克制：无邀请时完全不渲染任何 DOM；同一条邀请只弹一次（关闭后不会
// 因为下一轮轮询又弹）；在 /pk/ 相关页面与邀请详情页不启动，避免重复与干扰。

(function () {
  'use strict';

  if (window.__pkNotifyLoaded) return;
  window.__pkNotifyLoaded = true;

  var POLL_MS = 20000;
  var FIRST_DELAY_MS = 3000;
  var DISMISS_KEY = 'pk_notify_dismissed';   // 记住被关掉的邀请 id

  var pollTimer = null;
  var currentInvite = null;
  var overlayEl = null;
  var dismissedId = null;

  function path() {
    return location.pathname.replace(/\/+$/, '') || '/';
  }

  // 这些页面自己就在处理邀请/房间，全局提醒只会添乱
  function shouldSkip() {
    var p = path();
    if (p.indexOf('/pk/') === 0 && p !== '/pk') return true;
    if (p.indexOf('pk-') === 0) return true;          // pk-room / pk-waiting / pk-invite
    if (p.indexOf('/pk-') >= 0) return true;
    if (localStorage.getItem('pkInviteEnabled')==='true')return true;
    if (localStorage.getItem('pkInviteEnabled')==='false'||!localStorage.getItem('pkInviteEnabled'))return false;
    return false;
  }

  function esc(s) {
    if (window.DSHUI && window.DSHUI.esc) return window.DSHUI.esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function api(url, method, body) {
    if (typeof window.apiCall === 'function') return window.apiCall(url, method, body);
    return fetch(url, {
      method: method || 'GET',
      headers: (function () {
        var h = { 'Content-Type': 'application/json' };
        var t = localStorage.getItem('auth_token');
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
      })(),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json(); });
  }

  function tryRestoreDismissed() {
    try { dismissedId = localStorage.getItem(DISMISS_KEY); } catch (e) { dismissedId = null; }
  }

  function rememberDismissed(id) {
    dismissedId = id;
    try { localStorage.setItem(DISMISS_KEY, id || ''); } catch (e) {}
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
    overlayEl = null;
  }

  function render(invite) {
    removeOverlay();
    currentInvite = invite;

    var from = invite.fromDisplay || invite.from || 'Someone';
    var stake = Number(invite.stake) || 0;
    var secLeft = Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 1000));

    var wrap = document.createElement('div');
    wrap.id = 'pkNotifyOverlay';
    wrap.style.cssText = [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:99999',
      'width:320px', 'max-width:calc(100vw - 36px)',
      'background:var(--card-bg,#fff)',
      'color:var(--text-primary,#222)',
      'border:1px solid var(--border-color,#ddd)',
      'border-radius:10px',
      'box-shadow:0 10px 30px rgba(0,0,0,.28)',
      'padding:14px 14px 12px',
      'font-size:14px',
      'animation:pkNotifyIn .18s ease-out'
    ].join(';');

    wrap.innerHTML =
      '<div style="display:flex;align-items:flex-start;gap:10px;">' +
        '<div style="font-size:20px;line-height:1;color:#7d5bb0;"><i class="fas fa-swords"></i></div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:700;margin-bottom:2px;">PK invitation</div>' +
          '<div style="font-size:13px;color:var(--text-secondary,#666);word-break:break-word;">' +
            esc(from) + ' wants to challenge you' +
          '</div>' +
          (stake ? '<div style="font-size:13px;margin-top:3px;">Stake: <b>' + stake.toLocaleString() + '</b> tokens</div>' : '') +
          '<div id="pkNotifyTtl" style="font-size:12px;color:var(--text-secondary,#666);margin-top:4px;">' +
            (secLeft > 0 ? ('expires in ' + secLeft + 's') : 'expired') +
          '</div>' +
        '</div>' +
        '<button id="pkNotifyClose" type="button" title="Dismiss" ' +
          'style="background:none;border:none;color:var(--text-secondary,#888);cursor:pointer;font-size:16px;line-height:1;padding:0 2px;">×</button>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button id="pkNotifyAccept" class="btn btn-primary" type="button" style="flex:1;padding:7px 0;">Accept</button>' +
        '<button id="pkNotifyDecline" class="btn" type="button" style="flex:1;padding:7px 0;">Decline</button>' +
      '</div>';

    if (!document.getElementById('pkNotifyStyle')) {
      var st = document.createElement('style');
      st.id = 'pkNotifyStyle';
      st.textContent = '@keyframes pkNotifyIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(st);
    }

    document.body.appendChild(wrap);
    overlayEl = wrap;

    document.getElementById('pkNotifyClose').onclick = function () {
      rememberDismissed(invite.id);
      removeOverlay();
    };

    document.getElementById('pkNotifyAccept').onclick = function () {
      acceptInvite(invite, this, document.getElementById('pkNotifyDecline'));
    };

    document.getElementById('pkNotifyDecline').onclick = function () {
      declineInvite(invite, document.getElementById('pkNotifyAccept'), this);
    };

    // 本地倒计时，到期自动收起（不用等下一轮轮询）
    var ttlEl = document.getElementById('pkNotifyTtl');
    var tick = setInterval(function () {
      if (!document.body.contains(wrap)) { clearInterval(tick); return; }
      var left = Math.max(0, Math.ceil((new Date(invite.expiresAt).getTime() - Date.now()) / 1000));
      if (left <= 0) {
        clearInterval(tick);
        if (ttlEl) ttlEl.textContent = 'expired';
        removeOverlay();
        return;
      }
      if (ttlEl) ttlEl.textContent = 'expires in ' + left + 's';
    }, 1000);
  }

  function acceptInvite(invite, btnA, btnD) {
    btnA.disabled = btnD.disabled = true;
    btnA.textContent = 'Accepting…';
    api('/api/pk-bet?action=accept', 'POST', { inviteId: invite.id })
      .then(function (res) {
        if (res && res.success && res.roomId) {
          rememberDismissed('');
          location.href = '/pk-bet-room?id=' + encodeURIComponent(res.roomId);
        } else {
          btnA.disabled = btnD.disabled = false;
          btnA.textContent = 'Accept';
          if (window.DSHUI && DSHUI.toast) DSHUI.toast((res && res.message) || 'Failed to accept', 'err');
        }
      })
      .catch(function () {
        btnA.disabled = btnD.disabled = false;
        btnA.textContent = 'Accept';
        if (window.DSHUI && DSHUI.toast) DSHUI.toast('Network error', 'err');
      });
  }

  function declineInvite(invite, btnA, btnD) {
    btnA.disabled = btnD.disabled = true;
    api('/api/pk-bet?action=decline', 'POST', { inviteId: invite.id })
      .catch(function () {})
      .then(function () {
        rememberDismissed(invite.id);
        removeOverlay();
      });
  }

  function poll() {
    if (shouldSkip()) return;
    if (!localStorage.getItem('auth_token')) return;

    api('/api/pk-bet?action=pending').then(function (res) {
      if (!res || !res.success) return;
      var inv = res.incoming;

      if (!inv) {
        if (overlayEl) removeOverlay();
        currentInvite = null;
        return;
      }

      // 已经因为关闭而记住这条邀请，就别再弹
      if (inv.id === dismissedId) return;
      // 同一条已经在显示
      if (overlayEl && currentInvite && currentInvite.id === inv.id) return;

      render(inv);
    }).catch(function () {});
  }

  function start() {
    tryRestoreDismissed();
    if (shouldSkip()) return;
    if (!localStorage.getItem('auth_token')) return;

    setTimeout(function () {
      poll();
      pollTimer = setInterval(poll, POLL_MS);
    }, FIRST_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
