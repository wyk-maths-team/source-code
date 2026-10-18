/* WYK OS App: Pomodoro */
(function () {
  window.OSApps = window.OSApps || {};

  const CFG_KEY   = 'os_pomodoro_cfg';
  const STATS_KEY = 'os_pomodoro_stats';
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  function beep(freq = 880, duration = 0.18) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.02);
      setTimeout(() => ctx.close().catch(()=>{}), (duration + 0.3) * 1000);
    } catch (e) {}
  }

  window.OSApps.pomodoro = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-pomodoro-style';
      style.textContent = `
.pomo{display:flex;flex-direction:column;height:100%;background:#1a1a2e;color:#e0e6f0;font-family:'Segoe UI',sans-serif;align-items:center;justify-content:center;padding:24px;gap:18px;overflow:auto}
.pomo-modes{display:flex;gap:6px;background:rgba(0,0,0,.3);padding:4px;border-radius:8px}
.pomo-mode{padding:7px 16px;border-radius:6px;border:none;background:transparent;color:#8b9bc0;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s}
.pomo-mode:hover{background:rgba(74,144,217,.2);color:#d6e4ff}
.pomo-mode.active{background:#4a90d9;color:#fff;box-shadow:0 2px 8px rgba(74,144,217,.4)}
.pomo-circle{position:relative;width:240px;height:240px;display:flex;align-items:center;justify-content:center}
.pomo-circle svg{position:absolute;inset:0;transform:rotate(-90deg)}
.pomo-circle circle{fill:none;stroke-width:8;stroke-linecap:round}
.pomo-track{stroke:rgba(74,144,217,.15)}
.pomo-progress{stroke:#4a90d9;transition:stroke-dashoffset .5s linear}
.pomo-time{font-size:52px;font-weight:200;font-family:'Consolas',monospace;letter-spacing:2px;color:#fff;z-index:1}
.pomo-label{font-size:11px;color:#7a8aa8;letter-spacing:3px;text-transform:uppercase;margin-top:6px;z-index:1}
.pomo-controls{display:flex;gap:10px}
.pomo-btn{padding:11px 26px;border:none;border-radius:22px;background:linear-gradient(135deg,#4a90d9 0%,#2e5fa0 100%);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:1px;transition:all .15s;box-shadow:0 4px 12px rgba(74,144,217,.3)}
.pomo-btn:hover{filter:brightness(1.15);transform:translateY(-1px)}
.pomo-btn:active{transform:translateY(0)}
.pomo-btn.secondary{background:rgba(255,255,255,.08);color:#d6e4ff;box-shadow:none;border:1px solid rgba(100,150,220,.3)}
.pomo-btn.secondary:hover{background:rgba(255,255,255,.16)}
.pomo-stats{display:flex;gap:22px;margin-top:6px;padding-top:14px;border-top:1px solid rgba(100,150,220,.2);width:100%;justify-content:center}
.pomo-stat{text-align:center}
.pomo-stat .num{font-size:24px;font-weight:700;color:#8bb4ff;font-family:'Consolas',monospace}
.pomo-stat .lbl{font-size:10.5px;color:#7a8aa8;text-transform:uppercase;letter-spacing:1px;margin-top:2px}
.pomo-cfg{display:flex;gap:14px;font-size:11px;color:#7a8aa8;align-items:center;margin-top:4px}
.pomo-cfg input{width:48px;padding:4px 6px;background:rgba(0,0,0,.3);border:1px solid rgba(100,150,220,.3);border-radius:4px;color:#d6e4ff;font-family:'Consolas',monospace;font-size:11px;text-align:center;outline:none}
.pomo-cfg input:focus{border-color:#4a90d9}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'pomo';
      wrap.innerHTML = `
        <div class="pomo-modes">
          <button class="pomo-mode active" data-mode="work">Focus</button>
          <button class="pomo-mode" data-mode="short">Short Break</button>
          <button class="pomo-mode" data-mode="long">Long Break</button>
        </div>
        <div class="pomo-circle">
          <svg viewBox="0 0 240 240">
            <circle class="pomo-track" cx="120" cy="120" r="110"></circle>
            <circle class="pomo-progress" id="pomo-progress" cx="120" cy="120" r="110"></circle>
          </svg>
          <div>
            <div class="pomo-time" id="pomo-time">25:00</div>
            <div class="pomo-label" id="pomo-label">FOCUS</div>
          </div>
        </div>
        <div class="pomo-controls">
          <button class="pomo-btn" id="pomo-toggle">START</button>
          <button class="pomo-btn secondary" id="pomo-reset">Reset</button>
        </div>
        <div class="pomo-cfg">
          <label>Focus <input type="number" id="pomo-cfg-work" min="1" max="120" value="25"></label>
          <label>Short <input type="number" id="pomo-cfg-short" min="1" max="60" value="5"></label>
          <label>Long <input type="number" id="pomo-cfg-long" min="1" max="60" value="15"></label>
        </div>
        <div class="pomo-stats">
          <div class="pomo-stat"><div class="num" id="pomo-stat-today">0</div><div class="lbl">Today</div></div>
          <div class="pomo-stat"><div class="num" id="pomo-stat-total">0</div><div class="lbl">Total</div></div>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const progressEl = $('#pomo-progress');
      const timeEl = $('#pomo-time');
      const labelEl = $('#pomo-label');
      const toggleBtn = $('#pomo-toggle');
      const resetBtn = $('#pomo-reset');

      // 設定
      let cfg = { work: 25, short: 5, long: 15 };
      try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) {}
      $('#pomo-cfg-work').value = cfg.work;
      $('#pomo-cfg-short').value = cfg.short;
      $('#pomo-cfg-long').value = cfg.long;

      // 統計
      let stats = { date: todayStr(), today: 0, total: 0 };
      try { Object.assign(stats, JSON.parse(localStorage.getItem(STATS_KEY) || '{}')); } catch (e) {}
      if (stats.date !== todayStr()) { stats.date = todayStr(); stats.today = 0; }
      const renderStats = () => {
        $('#pomo-stat-today').textContent = stats.today;
        $('#pomo-stat-total').textContent = stats.total;
      };
      const saveStats = () => { try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {} };
      renderStats();

      // 狀態
      let mode = 'work';
      let totalSec = cfg.work * 60;
      let remainSec = totalSec;
      let running = false;
      let timerId = null;

      const CIRC = 2 * Math.PI * 110;

      function render() {
        const m = Math.floor(remainSec / 60);
        const s = remainSec % 60;
        timeEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        labelEl.textContent = mode === 'work' ? 'FOCUS' : (mode === 'short' ? 'SHORT BREAK' : 'LONG BREAK');
        const progress = 1 - remainSec / totalSec;
        progressEl.style.strokeDasharray = CIRC;
        progressEl.style.strokeDashoffset = CIRC * (1 - progress);
        progressEl.style.stroke = mode === 'work' ? '#4a90d9' : '#2ecc71';
        toggleBtn.textContent = running ? 'PAUSE' : (remainSec === totalSec ? 'START' : 'RESUME');
      }

      function setMode(newMode) {
        mode = newMode;
        const mins = newMode === 'work' ? cfg.work : (newMode === 'short' ? cfg.short : cfg.long);
        totalSec = mins * 60;
        remainSec = totalSec;
        wrap.querySelectorAll('.pomo-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === newMode));
        render();
      }

      function tick() {
        if (!container.isConnected) { stopTimer(); return; }
        remainSec--;
        if (remainSec <= 0) {
          stopTimer();
          if (mode === 'work') {
            stats.today++; stats.total++;
            saveStats(); renderStats();
            beep(880, 0.2);
            setTimeout(() => beep(1100, 0.3), 250);
          } else {
            beep(660, 0.2);
          }
          remainSec = 0;
          render();
          return;
        }
        render();
      }

      function startTimer() {
        if (running) return;
        running = true;
        timerId = setInterval(tick, 1000);
        render();
      }
      function stopTimer() {
        running = false;
        if (timerId) { clearInterval(timerId); timerId = null; }
        render();
      }

      // 事件
      wrap.querySelectorAll('.pomo-mode').forEach(b => {
        b.addEventListener('click', () => {
          if (running && !confirm('Timer is running. Switch mode?')) return;
          stopTimer();
          setMode(b.dataset.mode);
        });
      });
      toggleBtn.addEventListener('click', () => running ? stopTimer() : startTimer());
      resetBtn.addEventListener('click', () => { stopTimer(); remainSec = totalSec; render(); });

      ['work','short','long'].forEach(k => {
        const input = $('#pomo-cfg-' + k);
        input.addEventListener('change', () => {
          const v = Math.max(1, Math.min(120, parseInt(input.value, 10) || 1));
          cfg[k] = v;
          input.value = v;
          try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
          if (mode === k) { stopTimer(); totalSec = v * 60; remainSec = totalSec; render(); }
        });
      });

      // 卸載清理
      const origClose = ctx.win.close.bind(ctx.win);
      ctx.win.close = function () { stopTimer(); origClose(); };

      setMode('work');
    },
  };
})();
