// lib/achievement-toast.js
// 全局成就通知 —— 右上角滑入
(function () {
  'use strict';

  if (document.getElementById('ach-toast-style')) return;

  const style = document.createElement('style');
  style.id = 'ach-toast-style';
  style.textContent = `
    #ach-toast-container{
      position:fixed;top:20px;right:20px;z-index:2147483647;
      display:flex;flex-direction:column;gap:12px;pointer-events:none;
    }
    .ach-toast{
      display:flex;align-items:center;gap:14px;
      padding:14px 18px;min-width:280px;max-width:380px;
      background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
      border:2px solid #ffd700;border-radius:12px;color:#fff;
      box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 30px rgba(255,215,0,.35);
      transform:translateX(140%);opacity:0;
      transition:transform .5s cubic-bezier(.34,1.56,.64,1),opacity .3s;
      pointer-events:auto;
      font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    }
    .ach-toast.show{transform:translateX(0);opacity:1}
    .ach-toast-icon{
      width:52px;height:52px;flex-shrink:0;
      display:flex;align-items:center;justify-content:center;
      border-radius:50%;font-size:1.5rem;color:#1a1a2e;
      background:radial-gradient(circle,#ffd700 0%,#ff8c00 100%);
      box-shadow:0 0 20px rgba(255,215,0,.6);
      animation:achPulse 1.8s ease-in-out infinite;
    }
    @keyframes achPulse{
      0%,100%{transform:scale(1)}
      50%{transform:scale(1.1)}
    }
    .ach-toast-body{flex:1;min-width:0}
    .ach-toast-label{
      font-size:10px;text-transform:uppercase;letter-spacing:1.5px;
      color:#ffd700;font-weight:800;margin-bottom:3px;
    }
    .ach-toast-name{font-size:15px;font-weight:800;margin-bottom:2px;letter-spacing:-.2px}
    .ach-toast-desc{font-size:12px;color:rgba(255,255,255,.7);line-height:1.3}
    /* 稀有度 */
    .ach-toast.r-common{border-color:#9ca3af}
    .ach-toast.r-common .ach-toast-icon{background:radial-gradient(circle,#d1d5db,#6b7280)}
    .ach-toast.r-common .ach-toast-label{color:#d1d5db}
    .ach-toast.r-uncommon{border-color:#22c55e;box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 30px rgba(34,197,94,.35)}
    .ach-toast.r-uncommon .ach-toast-icon{background:radial-gradient(circle,#4ade80,#15803d)}
    .ach-toast.r-uncommon .ach-toast-label{color:#4ade80}
    .ach-toast.r-rare{border-color:#3b82f6;box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 30px rgba(59,130,246,.4)}
    .ach-toast.r-rare .ach-toast-icon{background:radial-gradient(circle,#60a5fa,#1d4ed8)}
    .ach-toast.r-rare .ach-toast-label{color:#60a5fa}
    .ach-toast.r-epic{border-color:#a855f7;box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 30px rgba(168,85,247,.4)}
    .ach-toast.r-epic .ach-toast-icon{background:radial-gradient(circle,#c084fc,#7e22ce)}
    .ach-toast.r-epic .ach-toast-label{color:#c084fc}
    .ach-toast.r-legendary{border-color:#f59e0b;box-shadow:0 10px 40px rgba(0,0,0,.4),0 0 40px rgba(245,158,11,.6)}
    .ach-toast.r-legendary .ach-toast-icon{background:radial-gradient(circle,#fbbf24,#d97706)}
    .ach-toast.r-legendary .ach-toast-label{color:#fbbf24}
    @media (max-width:600px){
      #ach-toast-container{top:12px;left:12px;right:12px;align-items:stretch}
      .ach-toast{min-width:0;max-width:100%}
    }
  `;
  document.head.appendChild(style);

  const queue = [];
  let showing = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function getContainer() {
    let c = document.getElementById('ach-toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'ach-toast-container';
      document.body.appendChild(c);
    }
    return c;
  }

  function processQueue() {
    if (showing || !queue.length) return;
    const a = queue.shift();
    showing = true;

    const el = document.createElement('div');
    el.className = 'ach-toast r-' + (a.rarity || 'common');
    el.innerHTML = `
      <div class="ach-toast-icon"><i class="${esc(a.icon || 'fa-solid fa-trophy')}"></i></div>
      <div class="ach-toast-body">
        <div class="ach-toast-label">Achievement Unlocked</div>
        <div class="ach-toast-name">${esc(a.name || a.id)}</div>
        <div class="ach-toast-desc">${esc(a.desc || '')}</div>
      </div>
    `;
    getContainer().appendChild(el);

    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => {
        el.remove();
        showing = false;
        processQueue();
      }, 500);
    }, 4000);
  }

  window.showAchievementToast = function (a) {
    if (!a || !a.id) return;
    queue.push(a);
    processQueue();
  };
  window.showAchievementToasts = function (arr) {
    if (!Array.isArray(arr)) return;
    for (const a of arr) window.showAchievementToast(a);
  };
})();
