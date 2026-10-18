/* WYK OS App: Calculator */
(function () {
  window.OSApps = window.OSApps || {};
  window.OSApps.calculator = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.textContent = `
.calc{display:flex;flex-direction:column;height:100%;background:#1a1a2e;color:#e0e6f0;font-family:'Segoe UI',sans-serif}
.calc-display{padding:20px 16px;text-align:right;background:rgba(0,0,0,.3);border-bottom:1px solid rgba(100,150,220,.3);min-height:110px;display:flex;flex-direction:column;justify-content:flex-end;gap:4px;overflow:hidden}
.calc-expr{font-size:12px;color:#7a8aa8;font-family:Consolas,monospace;min-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.calc-value{font-size:34px;font-weight:700;font-family:Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.calc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:rgba(0,0,0,.3);flex:1;padding:1px}
.calc-btn{border:none;background:#232940;color:#e0e6f0;font-size:18px;font-weight:600;cursor:pointer;transition:background .1s;font-family:inherit}
.calc-btn:hover{background:#2e3651}.calc-btn:active{background:#3a4468}
.calc-op{background:#2a3147;color:#8bb4ff}.calc-op:hover{background:#333d5c}
.calc-eq{background:#4a90d9;color:#fff}.calc-eq:hover{background:#3a7bc8}`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'calc';
      wrap.innerHTML = `
        <div class="calc-display">
          <div class="calc-expr" id="calc-expr"></div>
          <div class="calc-value" id="calc-value">0</div>
        </div>
        <div class="calc-grid">
          <button class="calc-btn calc-op" data-key="C">C</button>
          <button class="calc-btn calc-op" data-key="⌫">⌫</button>
          <button class="calc-btn calc-op" data-key="%">%</button>
          <button class="calc-btn calc-op" data-key="/">÷</button>
          <button class="calc-btn" data-key="7">7</button>
          <button class="calc-btn" data-key="8">8</button>
          <button class="calc-btn" data-key="9">9</button>
          <button class="calc-btn calc-op" data-key="*">×</button>
          <button class="calc-btn" data-key="4">4</button>
          <button class="calc-btn" data-key="5">5</button>
          <button class="calc-btn" data-key="6">6</button>
          <button class="calc-btn calc-op" data-key="-">−</button>
          <button class="calc-btn" data-key="1">1</button>
          <button class="calc-btn" data-key="2">2</button>
          <button class="calc-btn" data-key="3">3</button>
          <button class="calc-btn calc-op" data-key="+">+</button>
          <button class="calc-btn" data-key="±">±</button>
          <button class="calc-btn" data-key="0">0</button>
          <button class="calc-btn" data-key=".">.</button>
          <button class="calc-btn calc-eq" data-key="=">=</button>
        </div>`;
      container.appendChild(wrap);

      const exprEl = wrap.querySelector('#calc-expr');
      const valEl = wrap.querySelector('#calc-value');
      let expr = '';

      function safeEval(str) {
        if (!/^[\d+\-*/().\s%]+$/.test(str)) throw new Error('Invalid');
        // eslint-disable-next-line no-new-func
        return Function('"use strict";return (' + str + ')')();
      }
      function fmt(n) {
        if (!isFinite(n)) return 'Error';
        if (Math.abs(n) > 1e15) return n.toExponential(6);
        return Number(n.toPrecision(12)).toString();
      }
      function update() {
        exprEl.textContent = expr;
        if (!expr) { valEl.textContent = '0'; return; }
        try {
          valEl.textContent = fmt(safeEval(expr));
        } catch (e) {
          valEl.textContent = expr.split(/[\+\-*/%]/).pop() || '0';
        }
      }
      function press(key) {
        if (key === 'C') expr = '';
        else if (key === '⌫') expr = expr.slice(0, -1);
        else if (key === '=') {
          try { expr = fmt(safeEval(expr)); }
          catch (e) { valEl.textContent = 'Error'; return; }
        } else if (key === '±') {
          const m = expr.match(/(\d+\.?\d*)$/);
          if (m) {
            const idx = expr.lastIndexOf(m[1]);
            const cur = m[1];
            expr = expr[idx - 1] === '-'
              ? expr.slice(0, idx - 1) + cur
              : expr.slice(0, idx) + '-' + cur;
          }
        } else expr += key;
        update();
      }

      wrap.querySelectorAll('.calc-btn').forEach(b => {
        b.addEventListener('click', () => press(b.dataset.key));
      });

      const keyHandler = (e) => {
        if (!container.isConnected) { document.removeEventListener('keydown', keyHandler); return; }
        const k = e.key;
        if (/^[0-9.]$/.test(k) || ['+','-','*','/','%','(',')'].includes(k)) { e.preventDefault(); press(k); }
        else if (k === 'Enter' || k === '=') { e.preventDefault(); press('='); }
        else if (k === 'Backspace') { e.preventDefault(); press('⌫'); }
        else if (k === 'Escape' || k.toLowerCase() === 'c') { e.preventDefault(); press('C'); }
      };
      document.addEventListener('keydown', keyHandler);

      update();
    },
  };
})();
