/* WYK OS App: Graph */
(function () {
  window.OSApps = window.OSApps || {};

  const MATHJS_URL = 'https://cdn.jsdelivr.net/npm/mathjs@11.8.0/lib/browser/math.js';
  let mathjsPromise = null;
  function loadMathjs() {
    if (window.math) return Promise.resolve(window.math);
    if (mathjsPromise) return mathjsPromise;
    mathjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = MATHJS_URL;
      s.onload = () => window.math ? resolve(window.math) : reject(new Error('mathjs not loaded'));
      s.onerror = () => reject(new Error('Failed to load mathjs'));
      document.head.appendChild(s);
    });
    return mathjsPromise;
  }

  const COLORS = ['#4a90d9', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22'];

  window.OSApps.graph = {
    async mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-graph-style';
      style.textContent = `
.graph{display:flex;height:100%;background:#fff;font-family:'Segoe UI',sans-serif}
.graph-side{width:260px;flex-shrink:0;background:#f5f7fb;border-right:1px solid #d0d7e0;display:flex;flex-direction:column}
.graph-side-head{padding:12px;border-bottom:1px solid #d0d7e0;background:#fff}
.graph-side-title{font-size:12px;font-weight:700;color:#4a5568;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px}
.graph-fn-list{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:8px}
.graph-fn{background:#fff;border:1px solid #d0d7e0;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:6px;transition:border-color .15s}
.graph-fn:hover{border-color:#4a90d9}
.graph-fn-row{display:flex;align-items:center;gap:6px}
.graph-fn-color{width:22px;height:22px;border-radius:50%;border:2px solid rgba(0,0,0,.1);cursor:pointer;flex-shrink:0}
.graph-fn-label{font-size:14px;font-family:'Consolas',monospace;color:#4a5568;font-weight:600}
.graph-fn-input{flex:1;padding:6px 10px;border:1px solid #d0d7e0;border-radius:6px;font-size:13px;font-family:'Consolas',monospace;outline:none;color:#2c3e50;min-width:0}
.graph-fn-input:focus{border-color:#4a90d9;box-shadow:0 0 0 3px rgba(74,144,217,.12)}
.graph-fn-del{background:none;border:none;color:#c0c8d4;cursor:pointer;padding:2px 6px;border-radius:4px;font-size:13px;transition:all .15s}
.graph-fn-del:hover{background:#fef2f2;color:#e74c3c}
.graph-fn-err{font-size:11px;color:#e74c3c;padding:0 4px;min-height:0;font-family:'Consolas',monospace}
.graph-add{background:#fff;border:1px dashed #d0d7e0;color:#4a90d9;padding:10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;transition:all .15s;margin:0 8px 8px}
.graph-add:hover{background:#e8f2ff;border-color:#4a90d9}
.graph-hint{padding:8px 12px;font-size:11px;color:#8b9bc0;line-height:1.5;border-top:1px solid #d0d7e0;background:#fff}
.graph-hint code{background:#f0f2f5;padding:1px 4px;border-radius:3px;font-family:Consolas,monospace;color:#c7254e}
.graph-canvas-wrap{flex:1;position:relative;min-width:0}
#graph-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:grab}
#graph-canvas.dragging{cursor:grabbing}
.graph-coords{position:absolute;bottom:10px;right:12px;background:rgba(20,30,55,.85);color:#d6e4ff;font-family:'Consolas',monospace;font-size:11px;padding:4px 10px;border-radius:6px;pointer-events:none;backdrop-filter:blur(4px)}
.graph-zoom{position:absolute;top:12px;right:12px;display:flex;flex-direction:column;gap:4px}
.graph-zoom-btn{width:32px;height:32px;border:1px solid #d0d7e0;background:#fff;color:#4a5568;border-radius:6px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.06);transition:all .15s}
.graph-zoom-btn:hover{background:#f0f2f5;color:#4a90d9;border-color:#4a90d9}
.graph-loading{position:absolute;inset:0;background:rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center;color:#4a90d9;font-size:14px;gap:10px;z-index:5}
.graph-loading i{font-size:20px}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'graph';
      wrap.innerHTML = `
        <div class="graph-side">
          <div class="graph-side-head">
            <div class="graph-side-title">Functions</div>
          </div>
          <div class="graph-fn-list" id="graph-fn-list"></div>
          <button class="graph-add" id="graph-add"><i class="fas fa-plus"></i> Add Function</button>
          <div class="graph-hint">
            Use <code>x</code> as variable.<br>
            Supported: <code>sin cos tan sqrt log exp abs floor ceil round pow</code> and <code>PI E</code>.<br>
            Try: <code>x^2</code>, <code>sin(x)</code>, <code>1/x</code>, <code>sqrt(abs(x))</code>
          </div>
        </div>
        <div class="graph-canvas-wrap">
          <canvas id="graph-canvas"></canvas>
          <div class="graph-coords" id="graph-coords">x: 0.00, y: 0.00</div>
          <div class="graph-zoom">
            <button class="graph-zoom-btn" id="graph-zoom-in" title="Zoom In"><i class="fas fa-plus"></i></button>
            <button class="graph-zoom-btn" id="graph-zoom-out" title="Zoom Out"><i class="fas fa-minus"></i></button>
            <button class="graph-zoom-btn" id="graph-zoom-reset" title="Reset View"><i class="fas fa-house"></i></button>
          </div>
          <div class="graph-loading" id="graph-loading">
            <i class="fas fa-spinner fa-spin"></i> Loading math engine...
          </div>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const canvas = $('#graph-canvas');
      const c2d = canvas.getContext('2d');
      const coordsEl = $('#graph-coords');
      const fnListEl = $('#graph-fn-list');
      const loadingEl = $('#graph-loading');

      // 加載 mathjs
      let math = null;
      try {
        math = await loadMathjs();
        loadingEl.style.display = 'none';
      } catch (e) {
        loadingEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed to load math engine';
        return;
      }

      // 函數列表
      let functions = [
        { id: 'f1', expr: 'x^2', color: COLORS[0], compiled: null, error: null },
      ];

      function compileFn(fn) {
        if (!fn.expr.trim()) { fn.compiled = null; fn.error = null; return; }
        try {
          fn.compiled = math.compile(fn.expr);
          fn.error = null;
        } catch (e) {
          fn.compiled = null;
          fn.error = e.message || 'Syntax error';
        }
      }
      functions.forEach(compileFn);

      // Viewport
      let originX = 0, originY = 0;   // 世界原點在螢幕的位置
      let scale = 40;                 // 每單位多少 px
      let dpr = window.devicePixelRatio || 1;

      function fitCanvas() {
        const parent = canvas.parentElement;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (!w || !h) return;
        dpr = window.devicePixelRatio || 1;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        // 首次：原點在中心
        if (originX === 0 && originY === 0) {
          originX = w / 2;
          originY = h / 2;
        }
        draw();
      }

      // 世界坐標 ↔ 螢幕坐標
      const toScreenX = wx => originX + wx * scale;
      const toScreenY = wy => originY - wy * scale;
      const toWorldX = sx => (sx - originX) / scale;
      const toWorldY = sy => (originY - sy) / scale;

      // 選擇合適的網格步長
      function gridStep() {
        const targetPx = 70;
        const raw = targetPx / scale;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / mag;
        let step;
        if (norm < 2) step = 2;
        else if (norm < 5) step = 5;
        else step = 10;
        return step * mag;
      }

      function draw() {
        const W = canvas.clientWidth;
        const H = canvas.clientHeight;
        if (!W || !H) return;

        c2d.clearRect(0, 0, W, H);
        c2d.fillStyle = '#ffffff';
        c2d.fillRect(0, 0, W, H);

        const step = gridStep();
        const stepPx = step * scale;

        // 網格
        c2d.strokeStyle = '#e8ecf2';
        c2d.lineWidth = 1;
        c2d.beginPath();
        const x0 = originX % stepPx;
        for (let x = x0; x < W; x += stepPx) {
          c2d.moveTo(Math.round(x) + 0.5, 0);
          c2d.lineTo(Math.round(x) + 0.5, H);
        }
        const y0 = originY % stepPx;
        for (let y = y0; y < H; y += stepPx) {
          c2d.moveTo(0, Math.round(y) + 0.5);
          c2d.lineTo(W, Math.round(y) + 0.5);
        }
        c2d.stroke();

        // 坐標軸
        c2d.strokeStyle = '#4a5568';
        c2d.lineWidth = 1.5;
        c2d.beginPath();
        if (originY >= 0 && originY <= H) {
          c2d.moveTo(0, Math.round(originY) + 0.5);
          c2d.lineTo(W, Math.round(originY) + 0.5);
        }
        if (originX >= 0 && originX <= W) {
          c2d.moveTo(Math.round(originX) + 0.5, 0);
          c2d.lineTo(Math.round(originX) + 0.5, H);
        }
        c2d.stroke();

        // 刻度標籤
        c2d.fillStyle = '#6b7d8e';
        c2d.font = '11px Consolas, monospace';
        c2d.textAlign = 'center';
        c2d.textBaseline = 'top';
        for (let x = originX % stepPx; x < W; x += stepPx) {
          const wx = toWorldX(x);
          if (Math.abs(wx) < step / 1000) continue;
          const label = formatNum(wx);
          c2d.fillText(label, x, Math.min(Math.max(originY + 4, 4), H - 16));
        }
        c2d.textAlign = 'right';
        c2d.textBaseline = 'middle';
        for (let y = originY % stepPx; y < H; y += stepPx) {
          const wy = toWorldY(y);
          if (Math.abs(wy) < step / 1000) continue;
          const label = formatNum(wy);
          c2d.fillText(label, Math.min(Math.max(originX - 6, 40), W - 4), y);
        }

        // 畫函數
        for (const fn of functions) {
          if (!fn.compiled) continue;
          c2d.strokeStyle = fn.color;
          c2d.lineWidth = 2;
          c2d.lineCap = 'round';
          c2d.lineJoin = 'round';
          c2d.beginPath();

          let prevValid = false;
          let prevY = 0;
          for (let sx = 0; sx <= W; sx += 1) {
            const wx = toWorldX(sx);
            let wy;
            try {
              wy = fn.compiled.evaluate({ x: wx });
              if (typeof wy !== 'number' || !isFinite(wy)) wy = NaN;
            } catch (e) { wy = NaN; }

            if (isNaN(wy)) {
              prevValid = false;
              continue;
            }
            const sy = toScreenY(wy);
            // 超出螢幕太遠則跳過
            if (sy < -H * 10 || sy > H * 11) {
              prevValid = false;
              continue;
            }
            if (!prevValid) {
              c2d.moveTo(sx, sy);
              prevValid = true;
            } else {
              c2d.lineTo(sx, sy);
            }
            prevY = sy;
          }
          c2d.stroke();
        }
      }

      function formatNum(n) {
        if (Math.abs(n) < 1e-9) return '0';
        if (Math.abs(n) >= 1e5 || Math.abs(n) < 1e-3) return n.toExponential(1);
        return Number(n.toFixed(3)).toString();
      }

      // ── 事件：平移 / 縮放 ──
      let dragging = false;
      let lastX = 0, lastY = 0;
      canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.classList.add('dragging');
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', e => {
        if (dragging) {
          originX += e.clientX - lastX;
          originY += e.clientY - lastY;
          lastX = e.clientX;
          lastY = e.clientY;
          draw();
        }
        // 坐標顯示
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        coordsEl.textContent = `x: ${toWorldX(sx).toFixed(2)}, y: ${toWorldY(sy).toFixed(2)}`;
      });
      canvas.addEventListener('pointerup', e => {
        dragging = false;
        canvas.classList.remove('dragging');
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      });
      canvas.addEventListener('pointercancel', () => {
        dragging = false;
        canvas.classList.remove('dragging');
      });

      canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const factor = e.deltaY > 0 ? 0.88 : 1.14;
        zoomAt(mx, my, factor);
      }, { passive: false });

      function zoomAt(mx, my, factor) {
        const wx = toWorldX(mx);
        const wy = toWorldY(my);
        scale = Math.max(4, Math.min(400, scale * factor));
        originX = mx - wx * scale;
        originY = my + wy * scale;
        draw();
      }

      $('#graph-zoom-in').addEventListener('click', () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.25));
      $('#graph-zoom-out').addEventListener('click', () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.8));
      $('#graph-zoom-reset').addEventListener('click', () => {
        originX = canvas.clientWidth / 2;
        originY = canvas.clientHeight / 2;
        scale = 40;
        draw();
      });

      // ── 渲染函數列表 ──
      function renderFns() {
        fnListEl.innerHTML = functions.map((fn, i) => `
          <div class="graph-fn" data-id="${fn.id}">
            <div class="graph-fn-row">
              <div class="graph-fn-color" style="background:${fn.color}" data-idx="${i}" title="Click to change color"></div>
              <span class="graph-fn-label">y =</span>
              <input type="text" class="graph-fn-input" value="${ctx.escapeHtml(fn.expr)}" data-idx="${i}" placeholder="e.g. sin(x)" spellcheck="false">
              <button class="graph-fn-del" data-idx="${i}" title="Delete"><i class="fas fa-times"></i></button>
            </div>
            ${fn.error ? `<div class="graph-fn-err">⚠ ${ctx.escapeHtml(fn.error)}</div>` : ''}
          </div>
        `).join('');
      }

      fnListEl.addEventListener('input', e => {
        const inp = e.target.closest('.graph-fn-input');
        if (!inp) return;
        const i = parseInt(inp.dataset.idx, 10);
        if (isNaN(i)) return;
        functions[i].expr = inp.value;
        compileFn(functions[i]);
        // 更新錯誤顯示（簡化：重繪列表）
        const errEl = inp.closest('.graph-fn').querySelector('.graph-fn-err');
        if (errEl) errEl.remove();
        if (functions[i].error) {
          const d = document.createElement('div');
          d.className = 'graph-fn-err';
          d.textContent = '⚠ ' + functions[i].error;
          inp.closest('.graph-fn').appendChild(d);
        }
        draw();
      });

      fnListEl.addEventListener('click', e => {
        const delBtn = e.target.closest('.graph-fn-del');
        if (delBtn) {
          const i = parseInt(delBtn.dataset.idx, 10);
          functions.splice(i, 1);
          renderFns();
          draw();
          return;
        }
        const colEl = e.target.closest('.graph-fn-color');
        if (colEl) {
          const i = parseInt(colEl.dataset.idx, 10);
          const next = COLORS[(COLORS.indexOf(functions[i].color) + 1) % COLORS.length];
          functions[i].color = next;
          renderFns();
          draw();
        }
      });

      $('#graph-add').addEventListener('click', () => {
        const idx = functions.length;
        functions.push({
          id: 'f' + Date.now().toString(36),
          expr: '',
          color: COLORS[idx % COLORS.length],
          compiled: null,
          error: null,
        });
        renderFns();
      });

      // 尺寸響應
      const ro = new ResizeObserver(() => {
        const W = canvas.parentElement.clientWidth;
        const H = canvas.parentElement.clientHeight;
        if (!W || !H) return;
        // 保留相對中心點
        const oldW = canvas.clientWidth, oldH = canvas.clientHeight;
        const dx = (W - oldW) / 2;
        const dy = (H - oldH) / 2;
        originX += dx;
        originY += dy;
        fitCanvas();
      });
      ro.observe(canvas.parentElement);

      const origClose = ctx.win.close.bind(ctx.win);
      ctx.win.close = function () {
        try { ro.disconnect(); } catch (e) {}
        origClose();
      };

      renderFns();
      setTimeout(fitCanvas, 30);
    },
  };
})();
