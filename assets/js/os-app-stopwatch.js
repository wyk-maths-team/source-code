/* WYK OS App: Stopwatch */
(function () {
  window.OSApps = window.OSApps || {};

  function fmt(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
  }

  window.OSApps.stopwatch = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-stopwatch-style';
      style.textContent = `
.sw{display:flex;flex-direction:column;height:100%;background:#1a1a2e;color:#e0e6f0;font-family:'Segoe UI',sans-serif;padding:24px;gap:20px}
.sw-time{font-family:'Consolas','Monaco',monospace;font-size:64px;font-weight:200;letter-spacing:2px;text-align:center;color:#fff;text-shadow:0 2px 20px rgba(74,144,217,.4);padding:20px 0;user-select:text}
.sw-time.small{font-size:44px}
.sw-controls{display:flex;gap:10px;justify-content:center}
.sw-btn{padding:12px 30px;border:none;border-radius:24px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;letter-spacing:1px;transition:all .15s;min-width:120px}
.sw-btn.primary{background:linear-gradient(135deg,#4a90d9 0%,#2e5fa0 100%);color:#fff;box-shadow:0 4px 12px rgba(74,144,217,.3)}
.sw-btn.primary:hover{filter:brightness(1.15);transform:translateY(-1px)}
.sw-btn.primary.running{background:linear-gradient(135deg,#f39c12 0%,#c87f0a 100%);box-shadow:0 4px 12px rgba(243,156,18,.3)}
.sw-btn.secondary{background:rgba(255,255,255,.08);color:#d6e4ff;border:1px solid rgba(100,150,220,.3)}
.sw-btn.secondary:hover{background:rgba(255,255,255,.16)}
.sw-btn:disabled{opacity:.35;cursor:not-allowed;transform:none}
.sw-laps{flex:1;overflow-y:auto;background:rgba(0,0,0,.2);border-radius:10px;padding:8px;min-height:0}
.sw-laps::-webkit-scrollbar{width:6px}
.sw-laps::-webkit-scrollbar-thumb{background:rgba(100,150,220,.3);border-radius:3px}
.sw-lap{display:flex;justify-content:space-between;padding:10px 14px;border-radius:6px;font-family:'Consolas',monospace;font-size:14px;transition:background .15s;align-items:center}
.sw-lap:nth-child(odd){background:rgba(255,255,255,.03)}
.sw-lap:hover{background:rgba(74,144,217,.15)}
.sw-lap.best{background:rgba(46,204,113,.15)}
.sw-lap.worst{background:rgba(231,76,60,.15)}
.sw-lap-num{color:#8bb4ff;font-weight:700;min-width:60px}
.sw-lap-diff{color:#a8b8d8;font-size:12.5px;margin-left:10px;font-family:Consolas,monospace}
.sw-lap-time{font-weight:700;color:#fff}
.sw-empty{text-align:center;padding:60px 20px;color:#7a8aa8;font-size:13px}
.sw-empty i{font-size:48px;opacity:.35;display:block;margin-bottom:12px}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'sw';
      wrap.innerHTML = `
        <div class="sw-time" id="sw-time">00:00:00.00</div>
        <div class="sw-controls">
          <button class="sw-btn secondary" id="sw-lap" disabled><i class="fas fa-flag"></i> Lap</button>
          <button class="sw-btn primary" id="sw-toggle"><i class="fas fa-play"></i> Start</button>
          <button class="sw-btn secondary" id="sw-reset" disabled><i class="fas fa-rotate-left"></i> Reset</button>
        </div>
        <div class="sw-laps" id="sw-laps">
          <div class="sw-empty">
            <i class="fas fa-stopwatch"></i>
            Press Start to begin.<br>
            Click Lap to record split times.
          </div>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const timeEl = $('#sw-time');
      const lapsEl = $('#sw-laps');
      const toggleBtn = $('#sw-toggle');
      const lapBtn = $('#sw-lap');
      const resetBtn = $('#sw-reset');

      let running = false;
      let startTimestamp = 0;   // performance.now() 基準
      let elapsedBefore = 0;    // 累積時間
      let currentElapsed = 0;
      let rafId = null;
      let laps = [];            // [{ total: ms }]

      function getElapsed() {
        if (running) return elapsedBefore + (performance.now() - startTimestamp);
        return elapsedBefore;
      }

      function render() {
        currentElapsed = getElapsed();
        timeEl.textContent = fmt(currentElapsed);
      }

      function tick() {
        if (!container.isConnected) { stop(); return; }
        if (!running) return;
        render();
        rafId = requestAnimationFrame(tick);
      }

      function start() {
        if (running) return;
        running = true;
        startTimestamp = performance.now();
        toggleBtn.classList.add('running');
        toggleBtn.innerHTML = '<i class="fas fa-pause"></i> Pause';
        lapBtn.disabled = false;
        resetBtn.disabled = false;
        rafId = requestAnimationFrame(tick);
      }

      function stop() {
        if (!running) return;
        running = false;
        elapsedBefore = getElapsed();
        toggleBtn.classList.remove('running');
        toggleBtn.innerHTML = '<i class="fas fa-play"></i> Resume';
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        render();
      }

      function reset() {
        if (running || elapsedBefore > 0) {
          if (!confirm('Reset stopwatch and clear all laps?')) return;
        }
        running = false;
        elapsedBefore = 0;
        laps = [];
        toggleBtn.classList.remove('running');
        toggleBtn.innerHTML = '<i class="fas fa-play"></i> Start';
        lapBtn.disabled = true;
        resetBtn.disabled = true;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        render();
        renderLaps();
      }

      function addLap() {
        if (!running) return;
        const total = getElapsed();
        laps.push({ total });
        renderLaps();
      }

      function renderLaps() {
        if (!laps.length) {
          lapsEl.innerHTML = `<div class="sw-empty">
            <i class="fas fa-stopwatch"></i>
            Press Start to begin.<br>
            Click Lap to record split times.
          </div>`;
          return;
        }
        // 計算每個 lap 的分段
        const diffs = laps.map((l, i) => i === 0 ? l.total : l.total - laps[i - 1].total);
        // 找出最慢 / 最快（如果有 2+ 圈）
        let fastestIdx = -1, slowestIdx = -1;
        if (diffs.length >= 2) {
          fastestIdx = 0; slowestIdx = 0;
          for (let i = 1; i < diffs.length; i++) {
            if (diffs[i] < diffs[fastestIdx]) fastestIdx = i;
            if (diffs[i] > diffs[slowestIdx]) slowestIdx = i;
          }
        }

        lapsEl.innerHTML = laps.map((l, i) => {
          const diff = diffs[i];
          const cls = i === fastestIdx && diffs.length >= 2 ? ' best'
                    : i === slowestIdx && diffs.length >= 2 ? ' worst'
                    : '';
          const badge = i === fastestIdx && diffs.length >= 2 ? ' <i class="fas fa-bolt" style="color:#2ecc71"></i>'
                      : i === slowestIdx && diffs.length >= 2 ? ' <i class="fas fa-hourglass-end" style="color:#e74c3c"></i>'
                      : '';
          return `
            <div class="sw-lap${cls}">
              <span class="sw-lap-num">LAP ${i + 1}</span>
              <span class="sw-lap-time">${fmt(l.total)}</span>
              <span class="sw-lap-diff">+${fmt(diff)}${badge}</span>
            </div>`;
        }).join('');
      }

      toggleBtn.addEventListener('click', () => running ? stop() : start());
      lapBtn.addEventListener('click', addLap);
      resetBtn.addEventListener('click', reset);

      // 快捷鍵
      const keyHandler = e => {
        if (!container.isConnected) { document.removeEventListener('keydown', keyHandler); return; }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.code === 'Space') { e.preventDefault(); toggleBtn.click(); }
        else if (e.key.toLowerCase() === 'l') { e.preventDefault(); lapBtn.click(); }
        else if (e.key.toLowerCase() === 'r') { e.preventDefault(); resetBtn.click(); }
      };
      document.addEventListener('keydown', keyHandler);

      // 卸載清理
      const origClose = ctx.win.close.bind(ctx.win);
      ctx.win.close = function () {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        document.removeEventListener('keydown', keyHandler);
        origClose();
      };

      render();
    },
  };
})();
