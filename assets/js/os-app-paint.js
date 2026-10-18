/* WYK OS App: Paint */
(function () {
  window.OSApps = window.OSApps || {};
  window.OSApps.paint = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.textContent = `
.paint{display:flex;flex-direction:column;height:100%;background:#f0f2f5}
.paint-toolbar{display:flex;gap:12px;padding:10px 12px;background:#fff;border-bottom:1px solid #d0d7e0;align-items:center;flex-wrap:wrap;flex-shrink:0;font-size:13px;color:#333}
.paint-toolbar label{display:flex;align-items:center;gap:6px;font-weight:600}
.paint-btn{padding:6px 14px;border:1px solid #d0d7e0;background:#fff;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;color:#333}
.paint-btn:hover{background:#f0f2f5}
.paint-btn.active{background:#4a90d9;color:#fff;border-color:#4a90d9}
.paint-btn-primary{background:#4a90d9;color:#fff;border-color:#4a90d9}
.paint-canvas-wrap{flex:1;overflow:auto;background:#e0e0e0;display:flex;align-items:flex-start;justify-content:center;padding:12px}
#paint-canvas{background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.15);cursor:crosshair;touch-action:none;border-radius:2px}`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'paint';
      wrap.innerHTML = `
        <div class="paint-toolbar">
          <label>Color <input type="color" id="paint-color" value="#4a90d9"></label>
          <label>Size <input type="range" id="paint-size" min="1" max="50" value="3"></label>
          <button id="paint-eraser" class="paint-btn"><i class="fas fa-eraser"></i> Eraser</button>
          <button id="paint-clear" class="paint-btn">Clear</button>
          <button id="paint-save" class="paint-btn paint-btn-primary"><i class="fas fa-download"></i> Save PNG</button>
        </div>
        <div class="paint-canvas-wrap">
          <canvas id="paint-canvas"></canvas>
        </div>`;
      container.appendChild(wrap);

      const canvas = wrap.querySelector('#paint-canvas');
      const colorInput = wrap.querySelector('#paint-color');
      const sizeInput = wrap.querySelector('#paint-size');
      const eraserBtn = wrap.querySelector('#paint-eraser');
      const ctx2d = canvas.getContext('2d');

      function resize() {
        const cw = canvas.parentElement.clientWidth - 24;
        const ch = canvas.parentElement.clientHeight - 24;
        const w = Math.max(400, cw), h = Math.max(300, ch);
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        if (canvas.width && canvas.height) tmp.getContext('2d').drawImage(canvas, 0, 0);
        canvas.width = w; canvas.height = h;
        ctx2d.fillStyle = '#fff';
        ctx2d.fillRect(0, 0, w, h);
        if (tmp.width && tmp.height) ctx2d.drawImage(tmp, 0, 0);
      }
      setTimeout(resize, 60);

      let drawing = false, lastX = 0, lastY = 0, erasing = false;
      function getPos(e) {
        const r = canvas.getBoundingClientRect();
        return {
          x: (e.clientX - r.left) * (canvas.width / r.width),
          y: (e.clientY - r.top)  * (canvas.height / r.height),
        };
      }
      canvas.addEventListener('pointerdown', (e) => {
        drawing = true;
        const p = getPos(e);
        lastX = p.x; lastY = p.y;
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = getPos(e);
        ctx2d.strokeStyle = erasing ? '#fff' : colorInput.value;
        ctx2d.lineWidth = parseInt(sizeInput.value, 10);
        ctx2d.lineCap = 'round'; ctx2d.lineJoin = 'round';
        ctx2d.beginPath();
        ctx2d.moveTo(lastX, lastY);
        ctx2d.lineTo(p.x, p.y);
        ctx2d.stroke();
        lastX = p.x; lastY = p.y;
      });
      const end = (e) => { drawing = false; try { canvas.releasePointerCapture(e.pointerId); } catch(_){} };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', () => { drawing = false; });

      eraserBtn.addEventListener('click', () => {
        erasing = !erasing;
        eraserBtn.classList.toggle('active', erasing);
      });
      wrap.querySelector('#paint-clear').addEventListener('click', () => {
        if (!confirm('Clear canvas?')) return;
        ctx2d.fillStyle = '#fff';
        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      });
      wrap.querySelector('#paint-save').addEventListener('click', () => {
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'paint-' + Date.now() + '.png';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 3000);
        }, 'image/png');
      });
    },
  };
})();
