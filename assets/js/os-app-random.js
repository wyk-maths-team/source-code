/* WYK OS App: Random Tools */
(function () {
  window.OSApps = window.OSApps || {};

  window.OSApps.random = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-random-style';
      style.textContent = `
.rnd{display:flex;flex-direction:column;height:100%;background:#f5f7fb;font-family:'Segoe UI',sans-serif;color:#2c3e50;padding:18px;overflow:auto;gap:16px}
.rnd-tabs{display:flex;gap:4px;background:#fff;padding:5px;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.05);border:1px solid #e1e5eb}
.rnd-tab{flex:1;padding:9px;border:none;background:transparent;color:#6b7d8e;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;border-radius:6px;transition:all .15s}
.rnd-tab:hover{background:#f0f2f5;color:#4a90d9}
.rnd-tab.active{background:#4a90d9;color:#fff;box-shadow:0 2px 6px rgba(74,144,217,.3)}
.rnd-panel{display:none;flex-direction:column;gap:14px;background:#fff;border:1px solid #e1e5eb;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.rnd-panel.active{display:flex}
.rnd-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.rnd-row label{font-size:13px;font-weight:600;color:#4a5568;min-width:60px}
.rnd-input{flex:1;min-width:80px;padding:9px 12px;border:1px solid #d0d7e0;border-radius:8px;font-size:14px;font-family:inherit;outline:none;color:#2c3e50}
.rnd-input:focus{border-color:#4a90d9;box-shadow:0 0 0 3px rgba(74,144,217,.15)}
.rnd-btn{padding:10px 22px;border:none;border-radius:8px;background:#4a90d9;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s}
.rnd-btn:hover{background:#3a7bc8;transform:translateY(-1px)}
.rnd-btn:active{transform:translateY(0)}
.rnd-btn.lg{padding:14px 36px;font-size:15px;letter-spacing:1px}
.rnd-output{background:#1a1a2e;color:#e0e6f0;padding:22px;border-radius:10px;text-align:center;font-family:'Consolas',monospace;font-size:32px;font-weight:700;color:#8bb4ff;min-height:80px;display:flex;align-items:center;justify-content:center;word-break:break-all;box-shadow:inset 0 2px 8px rgba(0,0,0,.3)}
.rnd-output.small{font-size:18px;padding:16px}
.rnd-dice{font-size:64px;line-height:1}
.rnd-hint{font-size:12px;color:#8b9bc0;text-align:center}
.rnd-choices{display:flex;flex-direction:column;gap:8px}
.rnd-choice{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f5f7fb;border:1px solid #e1e5eb;border-radius:8px;font-size:14px;color:#2c3e50}
.rnd-choice input{flex:1;background:transparent;border:none;outline:none;font-size:14px;font-family:inherit;color:#2c3e50}
.rnd-choice-del{background:none;border:none;color:#c0c8d4;cursor:pointer;padding:2px 6px;border-radius:4px;transition:all .15s}
.rnd-choice-del:hover{background:#fef2f2;color:#e74c3c}
.rnd-add{background:#f0f2f5;color:#4a90d9;border:1px dashed #d0d7e0;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;transition:all .15s}
.rnd-add:hover{background:#e8f2ff;border-color:#4a90d9}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'rnd';
      wrap.innerHTML = `
        <div class="rnd-tabs">
          <button class="rnd-tab active" data-tab="num">Number</button>
          <button class="rnd-tab" data-tab="dice">Dice</button>
          <button class="rnd-tab" data-tab="coin">Coin</button>
          <button class="rnd-tab" data-tab="pick">Pick</button>
        </div>

        <!-- 隨機數 -->
        <div class="rnd-panel active" data-panel="num">
          <div class="rnd-row">
            <label>Min</label>
            <input type="number" class="rnd-input" id="rnd-min" value="1">
          </div>
          <div class="rnd-row">
            <label>Max</label>
            <input type="number" class="rnd-input" id="rnd-max" value="100">
          </div>
          <div class="rnd-row">
            <label>Count</label>
            <input type="number" class="rnd-input" id="rnd-count" value="1" min="1" max="20">
          </div>
          <div class="rnd-row">
            <button class="rnd-btn lg" id="rnd-num-go" style="flex:1">🎲 Generate</button>
          </div>
          <div class="rnd-output" id="rnd-num-out">—</div>
        </div>

        <!-- 骰子 -->
        <div class="rnd-panel" data-panel="dice">
          <div class="rnd-row">
            <label>Dice</label>
            <input type="text" class="rnd-input" id="rnd-dice-spec" value="2d6" placeholder="e.g. 2d6, 1d20, 3d8">
          </div>
          <div class="rnd-row">
            <button class="rnd-btn lg" id="rnd-dice-go" style="flex:1">🎲 Roll</button>
          </div>
          <div class="rnd-output" id="rnd-dice-out"><span class="rnd-dice">🎲</span></div>
          <div class="rnd-hint">Format: NdS (N dice with S sides) — e.g. 2d6 rolls 2 six-sided dice</div>
        </div>

        <!-- 硬幣 -->
        <div class="rnd-panel" data-panel="coin">
          <div class="rnd-row">
            <label>Flips</label>
            <input type="number" class="rnd-input" id="rnd-coin-count" value="1" min="1" max="100">
          </div>
          <div class="rnd-row">
            <button class="rnd-btn lg" id="rnd-coin-go" style="flex:1">🪙 Flip</button>
          </div>
          <div class="rnd-output" id="rnd-coin-out">—</div>
        </div>

        <!-- 抽籤 -->
        <div class="rnd-panel" data-panel="pick">
          <div class="rnd-choices" id="rnd-pick-choices"></div>
          <button class="rnd-add" id="rnd-pick-add">+ Add Option</button>
          <div class="rnd-row" style="margin-top:8px">
            <label>Count</label>
            <input type="number" class="rnd-input" id="rnd-pick-count" value="1" min="1" max="10">
            <button class="rnd-btn lg" id="rnd-pick-go" style="flex:1">🎯 Pick</button>
          </div>
          <div class="rnd-output small" id="rnd-pick-out">—</div>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);

      // Tabs
      wrap.querySelectorAll('.rnd-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          wrap.querySelectorAll('.rnd-tab').forEach(t => t.classList.remove('active'));
          wrap.querySelectorAll('.rnd-panel').forEach(p => p.classList.remove('active'));
          tab.classList.add('active');
          wrap.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add('active');
        });
      });

      // 隨機數
      $('#rnd-num-go').addEventListener('click', () => {
        const min = Math.ceil(parseFloat($('#rnd-min').value) || 0);
        const max = Math.floor(parseFloat($('#rnd-max').value) || 100);
        const count = Math.max(1, Math.min(20, parseInt($('#rnd-count').value, 10) || 1));
        if (min > max) { $('#rnd-num-out').textContent = '⚠️ Min > Max'; return; }
        const results = [];
        for (let i = 0; i < count; i++) {
          results.push(Math.floor(Math.random() * (max - min + 1)) + min);
        }
        $('#rnd-num-out').textContent = results.join(' · ');
      });

      // 骰子
      $('#rnd-dice-go').addEventListener('click', () => {
        const spec = ($('#rnd-dice-spec').value || '').trim().toLowerCase();
        const m = spec.match(/^(\d+)?d(\d+)$/);
        if (!m) { $('#rnd-dice-out').textContent = '⚠️ Use NdS format'; return; }
        const n = Math.max(1, Math.min(50, parseInt(m[1] || '1', 10)));
        const s = Math.max(2, Math.min(1000, parseInt(m[2], 10)));
        const rolls = [];
        let total = 0;
        for (let i = 0; i < n; i++) {
          const r = Math.floor(Math.random() * s) + 1;
          rolls.push(r);
          total += r;
        }
        $('#rnd-dice-out').innerHTML = n === 1
          ? `<span class="rnd-dice">${rolls[0]}</span>`
          : `<div style="font-size:18px">Total: <b style="font-size:28px;color:#8bb4ff">${total}</b><br><span style="color:#7a8aa8;font-size:13px;font-family:Consolas">[${rolls.join(', ')}]</span></div>`;
      });

      // 硬幣
      $('#rnd-coin-go').addEventListener('click', () => {
        const count = Math.max(1, Math.min(100, parseInt($('#rnd-coin-count').value, 10) || 1));
        if (count === 1) {
          $('#rnd-coin-out').textContent = Math.random() < 0.5 ? '🪙 HEADS' : '🪙 TAILS';
        } else {
          let heads = 0;
          for (let i = 0; i < count; i++) if (Math.random() < 0.5) heads++;
          $('#rnd-coin-out').textContent = `Heads: ${heads}  ·  Tails: ${count - heads}`;
        }
      });

      // 抽籤
      const PICK_STORAGE = 'os_random_pick_options';
      let choices = [];
      try { choices = JSON.parse(localStorage.getItem(PICK_STORAGE) || '[]'); } catch (e) {}
      if (!Array.isArray(choices) || choices.length === 0) choices = ['Option A', 'Option B', 'Option C'];

      const choicesEl = $('#rnd-pick-choices');

      function renderChoices() {
        choicesEl.innerHTML = choices.map((c, i) => `
          <div class="rnd-choice">
            <input type="text" data-idx="${i}" value="${ctx.escapeHtml(c)}" maxlength="100">
            <button class="rnd-choice-del" data-idx="${i}"><i class="fas fa-times"></i></button>
          </div>
        `).join('');
      }

      choicesEl.addEventListener('input', e => {
        const inp = e.target.closest('input[data-idx]');
        if (!inp) return;
        const i = parseInt(inp.dataset.idx, 10);
        choices[i] = inp.value;
        try { localStorage.setItem(PICK_STORAGE, JSON.stringify(choices)); } catch (e) {}
      });
      choicesEl.addEventListener('click', e => {
        const btn = e.target.closest('.rnd-choice-del');
        if (!btn) return;
        const i = parseInt(btn.dataset.idx, 10);
        choices.splice(i, 1);
        try { localStorage.setItem(PICK_STORAGE, JSON.stringify(choices)); } catch (e) {}
        renderChoices();
      });

      $('#rnd-pick-add').addEventListener('click', () => {
        choices.push('New option');
        try { localStorage.setItem(PICK_STORAGE, JSON.stringify(choices)); } catch (e) {}
        renderChoices();
      });

      $('#rnd-pick-go').addEventListener('click', () => {
        const valid = choices.map(c => c.trim()).filter(Boolean);
        if (!valid.length) { $('#rnd-pick-out').textContent = '⚠️ No options'; return; }
        const count = Math.max(1, Math.min(10, parseInt($('#rnd-pick-count').value, 10) || 1));
        const picked = [];
        const pool = [...valid];
        for (let i = 0; i < count && pool.length; i++) {
          const idx = Math.floor(Math.random() * pool.length);
          picked.push(pool.splice(idx, 1)[0]);
        }
        $('#rnd-pick-out').textContent = picked.join(' · ');
      });

      renderChoices();
    },
  };
})();
