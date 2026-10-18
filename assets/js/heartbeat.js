// resources/script/heartbeat.js
// 实时在线状态上报：用户有活动时，每 N 分钟向服务器打一次卡
(function () {
  'use strict';

  const CFG = Object.assign({
    intervalMs:   180_000,   // 每 3 分钟 tick 一次
    activityMs:   180_000,   // 3 分钟内有活动才算「活跃」
    minMovePx:    5,
    initialDelay: 5_000,
  }, window.__HB_CONFIG__ || {});

  let lastActivityAt = Date.now();
  let lastMouseX = null, lastMouseY = null;

  function markActivity() { lastActivityAt = Date.now(); }
  function hasRecentActivity() { return Date.now() - lastActivityAt < CFG.activityMs; }

  // 鼠标移动（带阈值）
  document.addEventListener('mousemove', (e) => {
    if (lastMouseX === null) {
      lastMouseX = e.clientX; lastMouseY = e.clientY;
      markActivity();
      return;
    }
    if (Math.abs(e.clientX - lastMouseX) > CFG.minMovePx ||
        Math.abs(e.clientY - lastMouseY) > CFG.minMovePx) {
      lastMouseX = e.clientX; lastMouseY = e.clientY;
      markActivity();
    }
  }, { passive: true });

  // 其他活动
  ['keydown', 'click', 'touchstart', 'scroll', 'wheel'].forEach(evt =>
    document.addEventListener(evt, markActivity, { passive: true }));

  // 从后台切回前台
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') markActivity();
  });

  async function tick() {
    if (!hasRecentActivity()) return;
    const token = localStorage.getItem('auth_token');
    if (!token) return;
    
    try {
      const res = await fetch('/api/heartbeat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
      });
      const data = await res.json(); // ⭐ 修复：提取数据
      
      if (data.unreadMessages > 0) {
        showSystemMessageModal(data.unreadMessages);
      }
    } catch (e) { /* 静默 */ }
  }

  // ⭐ 补全：弹窗函数
  function showSystemMessageModal(count) {
    if (document.getElementById('sys-msg-global-modal')) return;
    
    const modal = document.createElement('div');
    modal.id = 'sys-msg-global-modal';
    modal.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;background:var(--card-bg,#fff);border:2px solid #d93025;padding:20px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.3);max-width:340px;color:var(--text-primary,#222);';
    
    modal.innerHTML = `
      <h3 style="margin:0 0 10px;font-size:16px;color:#d93025;display:flex;align-items:center;gap:8px;">
        <i class="fas fa-bell"></i> System Alert
      </h3>
      <p style="font-size:14px;line-height:1.5;margin-bottom:16px;">
        You have <b>${count}</b> unread message(s). Please check your inbox.
      </p>
      <button onclick="location.href='/messages'" style="width:100%;padding:10px;background:var(--accent,#337ab7);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-family:inherit;">
        Go to Messages
      </button>
      <button onclick="this.parentElement.remove()" style="width:100%;padding:10px;background:transparent;color:var(--text-secondary,#666);border:none;border-radius:6px;cursor:pointer;margin-top:8px;font-family:inherit;">
        Dismiss
      </button>
    `;
    document.body.appendChild(modal);
  }

  // 启动
  setTimeout(tick, CFG.initialDelay);
  setInterval(tick, CFG.intervalMs);

  // 对外暴露（调试用）
  window.__heartbeat = { tick, markActivity, getLastActivity: () => lastActivityAt };
})();