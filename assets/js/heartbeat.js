// resources/script/heartbeat.js
// 实时在线状态上报：用户有活动时，每 N 分钟向服务器打一次卡
(function () {
  'use strict';

  // 间隔来自 core/polling.js（全站唯一来源）；__HB_CONFIG__ 仍可覆盖
  const POLL = window.__POLL__ || {};
  const CFG = Object.assign({
    intervalMs:   POLL.heartbeat || 180_000,          // 每 3 分钟 tick 一次
    activityMs:   POLL.heartbeatActivity || 180_000,  // 3 分钟内还有活动才算
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
      const data = await res.json();
      updateMessageDot(Number(data.unreadMessages) || 0);
      updateQuestDot(Number(data.questsPending) || 0);
    } catch (e) { /* 静默 */ }
  }

  // 未读数点亮侧栏 Messages 的红点。
  //
  // 这里原本弹一个右下角的「System Alert」浮窗，每次心跳都检查一遍、
  // 关掉之后下一轮又弹。学生的反应是不看，210 条系统通知就这么积着。
  // 改成安静的红点：不打断、不重复弹，想点的时候点。
  function updateMessageDot(count) {
    var el = document.getElementById('navMsgDot');
    if (!el) return;
    if (count > 0) {
      el.textContent = count > 99 ? '99+' : String(count);
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  // Token Hub 那个红点：今天还有没领的任务。只反映登录奖励，够当入口提示，
  // 不值得为它每 30 秒跑一次完整的 computeQuests。
  function updateQuestDot(count) {
    var el = document.getElementById('navQuestDot');
    if (!el) return;
    if (count > 0) {
      el.textContent = String(count);
      el.hidden = false;
    } else {
      el.hidden = true;
      el.textContent = '';
    }
  }

  // 进过 messages 页就立刻清掉，不等下一次心跳
  function clearMessageDot() { updateMessageDot(0); }
  window.__clearMessageDot = clearMessageDot;

  // 启动
  setTimeout(tick, CFG.initialDelay);
  setInterval(tick, CFG.intervalMs);

  // 对外暴露（调试用）
  window.__heartbeat = { tick, markActivity, getLastActivity: () => lastActivityAt };
})();