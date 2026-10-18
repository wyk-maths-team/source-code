/* WYK OS App: Draw */
(function () {
  window.OSApps = window.OSApps || {};

  window.OSApps.draw = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-draw-style';
      style.textContent = `
.draw{display:flex;flex-direction:column;height:100%;background:#f0f2f5;font-family:'Segoe UI',sans-serif}
.draw-toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border-bottom:1px solid #d0d7e0;flex-wrap:wrap;flex-shrink:0}
.draw-tools{display:flex;gap:2px;background:#f0f2f5;border-radius:8px;padding:3px}
.draw-tool{width:34px;height:34px;border:none;border-radius:6px;background:transparent;color:#4a5568;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.draw-tool:hover{background:#e8f2ff;color:#4a90d9}
.draw-tool.active{background:#4a90d9;color:#fff;box-shadow:0 2px 6px rgba(74,144,217,.35)}
.draw-sep{width:1px;height:24px;background:#d0d7e0;margin:0 4px}
.draw-color{width:36px;height:34px;padding:2px;border:1px solid #d0d7e0;border-radius:6px;cursor:pointer;background:#fff}
.draw-widths{display:flex;gap:2px}
.draw-w{width:26px;height:34px;border:none;border-radius:6px;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s}
.draw-w:hover{background:#e8f2ff}
.draw-w.active{background:#e8f2ff;box-shadow:inset 0 0 0 2px #4a90d9}
.draw-w::before{content:"";display:block;border-radius:50%;background:#4a5568}
.draw-w[data-w="2"]::before{width:4px;height:4px}
.draw-w[data-w="4"]::before{width:8px;height:8px}
.draw-w[data-w="8"]::before{width:14px;height:14px}
.draw-w[data-w="16"]::before{width:22px;height:22px}
.draw-act{padding:7px 14px;border:1px solid #d0d7e0;border-radius:6px;background:#fff;color:#4a5568;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .15s;display:flex;align-items:center;gap:6px}
.draw-act:hover{background:#f0f2f5;border-color:#4a90d9;color:#4a90d9}
.draw-act:disabled{opacity:.4;cursor:not-allowed}
.draw-act.primary{background:#4a90d9;color:#fff;border-color:#4a90d9}
.draw-act.primary:hover{background:#3a7bc8;color:#fff}
.draw-canvas-wrap{flex:1;position:relative;overflow:hidden;background:#fff;min-height:0}
#draw-canvas{display:block;width:100%;height:100%;touch-action:none;cursor:crosshair}
.draw-cursor-text #draw-canvas{cursor:text}
.draw-cursor-pen #draw-canvas{cursor:crosshair}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'draw draw-cursor-pen';
      wrap.innerHTML = `
        <div class="draw-toolbar">
          <div class="draw-tools">
            <button class="draw-tool active" data-tool="pen" title="Pen (P)"><i class="fas fa-pen"></i></button>
            <button class="draw-tool" data-tool="eraser" title="Eraser (E)"><i class="fas fa-eraser"></i></button>
            <button class="draw-tool" data-tool="line" title="Line (L)"><i class="fas fa-slash"></i></button>
            <button class="draw-tool" data-tool="arrow" title="Arrow (A)"><i class="fas fa-arrow-right"></i></button>
            <button class="draw-tool" data-tool="rect" title="Rectangle (R)"><i class="fas fa-square"></i></button>
            <button class="draw-tool" data-tool="circle" title="Circle (C)"><i class="fas fa-circle"></i></button>
            <button class="draw-tool" data-tool="text" title="Text (T)"><i class="fas fa-font"></i></button>
          </div>
          <div class="draw-sep"></div>
          <input type="color" class="draw-color" id="draw-color" value="#4a90d9" title="Color">
          <div class="draw-widths" id="draw-widths">
            <button class="draw-w" data-w="2" title="Thin"></button>
            <button class="draw-w active" data-w="4" title="Medium"></button>
            <button class="draw-w" data-w="8" title="Thick"></button>
            <button class="draw-w" data-w="16" title="Extra Thick"></button>
          </div>
          <div class="draw-sep"></div>
          <button class="draw-act" id="draw-undo" disabled><i class="fas fa-undo"></i> Undo</button>
          <button class="draw-act" id="draw-redo" disabled><i class="fas fa-redo"></i> Redo</button>
          <button class="draw-act" id="draw-clear"><i class="fas fa-trash"></i> Clear</button>
          <button class="draw-act primary" id="draw-save"><i class="fas fa-download"></i> Save PNG</button>
        </div>
        <div class="draw-canvas-wrap">
          <canvas id="draw-canvas"></canvas>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const canvas = $('#draw-canvas');
      const c2d = canvas.getContext('2d');
      const undoBtn = $('#draw-undo');
      const redoBtn = $('#draw-redo');

      // 狀態
      let tool = 'pen';
      let color = '#4a90d9';
      let lineWidth = 4;
      const elements = [];     // 已完成元素列表
      const redoStack = [];    // 重做栈
      let drawing = false;
      let startPt = null;
      let curPt = null;
      let dpr = window.devicePixelRatio || 1;

      // ── 尺寸 ──
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
        redraw();
      }

      // ── 繪製單一元素 ──
      function drawElement(el) {
        if (!el) return;
        c2d.save();
        c2d.strokeStyle = el.color;
        c2d.fillStyle = el.color;
        c2d.lineWidth = el.width;
        c2d.lineCap = 'round';
        c2d.lineJoin = 'round';

        if (el.type === 'pen' || el.type === 'eraser') {
          if (el.type === 'eraser') {
            c2d.strokeStyle = '#ffffff';
            c2d.lineWidth = el.width * 2.5;
          }
          if (el.points.length === 1) {
            c2d.beginPath();
            c2d.arc(el.points[0].x, el.points[0].y, c2d.lineWidth / 2, 0, Math.PI * 2);
            c2d.fill();
          } else {
            c2d.beginPath();
            c2d.moveTo(el.points[0].x, el.points[0].y);
            for (let i = 1; i < el.points.length; i++) {
              c2d.lineTo(el.points[i].x, el.points[i].y);
            }
            c2d.stroke();
          }
        } else if (el.type === 'line') {
          c2d.beginPath();
          c2d.moveTo(el.from.x, el.from.y);
          c2d.lineTo(el.to.x, el.to.y);
          c2d.stroke();
        } else if (el.type === 'arrow') {
          const { x: x1, y: y1 } = el.from;
          const { x: x2, y: y2 } = el.to;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const headLen = Math.max(12, el.width * 3.5);
          // 主線
          c2d.beginPath();
          c2d.moveTo(x1, y1);
          c2d.lineTo(x2, y2);
          c2d.stroke();
          // 箭頭
          c2d.beginPath();
          c2d.moveTo(x2, y2);
          c2d.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 7), y2 - headLen * Math.sin(angle - Math.PI / 7));
          c2d.moveTo(x2, y2);
          c2d.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 7), y2 - headLen * Math.sin(angle + Math.PI / 7));
          c2d.stroke();
        } else if (el.type === 'rect') {
          const x = Math.min(el.from.x, el.to.x);
          const y = Math.min(el.from.y, el.to.y);
          const w = Math.abs(el.to.x - el.from.x);
          const h = Math.abs(el.to.y - el.from.y);
          c2d.strokeRect(x, y, w, h);
        } else if (el.type === 'circle') {
          const dx = el.to.x - el.from.x;
          const dy = el.to.y - el.from.y;
          const r = Math.sqrt(dx * dx + dy * dy);
          c2d.beginPath();
          c2d.arc(el.from.x, el.from.y, r, 0, Math.PI * 2);
          c2d.stroke();
        } else if (el.type === 'text') {
          c2d.font = `600 ${el.size}px 'Segoe UI', sans-serif`;
          c2d.textBaseline = 'top';
          c2d.fillText(el.text, el.x, el.y);
        }
        c2d.restore();
      }

      function redraw() {
        c2d.clearRect(0, 0, canvas.width, canvas.height);
        c2d.fillStyle = '#ffffff';
        c2d.fillRect(0, 0, canvas.width, canvas.height);
        for (const el of elements) drawElement(el);
        if (drawing && startPt && curPt) {
          drawElement(buildPreview());
        }
      }

      function buildPreview() {
        if (tool === 'pen' || tool === 'eraser') {
          return {
            type: tool, color, width: lineWidth,
            points: [startPt, curPt],
          };
        }
        if (tool === 'text') return null;
        return {
          type: tool, color, width: lineWidth,
          from: startPt, to: curPt,
        };
      }

      // ── 坐标 ──
      function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }

      // ── 工具列事件 ──
      wrap.querySelectorAll('.draw-tool').forEach(btn => {
        btn.addEventListener('click', () => {
          wrap.querySelectorAll('.draw-tool').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          tool = btn.dataset.tool;
          wrap.classList.toggle('draw-cursor-text', tool === 'text');
          wrap.classList.toggle('draw-cursor-pen', tool !== 'text');
        });
      });
      $('#draw-color').addEventListener('input', e => { color = e.target.value; });
      $('#draw-widths').addEventListener('click', e => {
        const w = e.target.closest('.draw-w');
        if (!w) return;
        wrap.querySelectorAll('.draw-w').forEach(x => x.classList.remove('active'));
        w.classList.add('active');
        lineWidth = parseInt(w.dataset.w, 10);
      });

      function updateUndoRedo() {
        undoBtn.disabled = elements.length === 0;
        redoBtn.disabled = redoStack.length === 0;
      }

      undoBtn.addEventListener('click', () => {
        if (!elements.length) return;
        redoStack.push(elements.pop());
        redraw();
        updateUndoRedo();
      });
      redoBtn.addEventListener('click', () => {
        if (!redoStack.length) return;
        elements.push(redoStack.pop());
        redraw();
        updateUndoRedo();
      });
      $('#draw-clear').addEventListener('click', () => {
        if (!elements.length) return;
        if (!confirm('Clear the canvas?')) return;
        elements.length = 0;
        redoStack.length = 0;
        redraw();
        updateUndoRedo();
      });
      $('#draw-save').addEventListener('click', () => {
        canvas.toBlob(blob => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'draw-' + Date.now() + '.png';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 3000);
          ctx.flashToast('Saved ✓');
        }, 'image/png');
      });

      // ── 繪製事件 ──
      let currentPenPoints = null;

      canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        canvas.setPointerCapture(e.pointerId);
        const p = getPos(e);

        if (tool === 'text') {
          const txt = prompt('Enter text:');
          if (txt && txt.trim()) {
            elements.push({
              type: 'text', color, width: lineWidth,
              x: p.x, y: p.y, text: txt.trim(), size: Math.max(16, lineWidth * 5),
            });
            redoStack.length = 0;
            redraw();
            updateUndoRedo();
          }
          return;
        }

        drawing = true;
        startPt = p;
        curPt = p;
        if (tool === 'pen' || tool === 'eraser') {
          currentPenPoints = [p];
        }
        redraw();
      });

      canvas.addEventListener('pointermove', e => {
        if (!drawing) return;
        const p = getPos(e);
        curPt = p;

        if (tool === 'pen' || tool === 'eraser') {
          // 對於筆，累積點；直接加到 elements 臨時？我們改用 preview
          // 為了簡單，改為直接 push 到 elements 的臨時元素（在 pointerup 才確定）
        }
        redraw();
      });

      canvas.addEventListener('pointerup', e => {
        if (!drawing) return;
        drawing = false;
        canvas.releasePointerCapture(e.pointerId);
        const p = getPos(e);

        let newEl = null;
        if (tool === 'pen' || tool === 'eraser') {
          newEl = { type: tool, color, width: lineWidth, points: [startPt, p] };
          // 簡化：pen/eraser 使用兩點直線，如果想要曲線效果可以改成收集所有 move 點
        } else if (tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'circle') {
          newEl = { type: tool, color, width: lineWidth, from: startPt, to: p };
        }
        startPt = null;
        curPt = null;

        if (newEl) {
          elements.push(newEl);
          redoStack.length = 0;
          redraw();
          updateUndoRedo();
        }
      });

      canvas.addEventListener('pointercancel', () => {
        drawing = false;
        startPt = null;
        curPt = null;
        redraw();
      });

      // 鍵盤快捷鍵
      const keyHandler = e => {
        if (!container.isConnected) { document.removeEventListener('keydown', keyHandler); return; }
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoBtn.click(); return; }
        if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redoBtn.click(); return; }
        const k = e.key.toLowerCase();
        const map = { p:'pen', e:'eraser', l:'line', a:'arrow', r:'rect', c:'circle', t:'text' };
        if (map[k]) {
          const btn = wrap.querySelector(`.draw-tool[data-tool="${map[k]}"]`);
          if (btn) btn.click();
        }
      };
      document.addEventListener('keydown', keyHandler);

      // 尺寸響應
      const ro = new ResizeObserver(() => fitCanvas());
      ro.observe(canvas.parentElement);

      // 初始化
      setTimeout(fitCanvas, 30);
      updateUndoRedo();

      // 卸載清理
      const origClose = ctx.win.close.bind(ctx.win);
      ctx.win.close = function () {
        try { ro.disconnect(); } catch (e) {}
        document.removeEventListener('keydown', keyHandler);
        origClose();
      };
    },
  };
})();
