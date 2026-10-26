// assets/js/draw.js —— 全屏绘图遮罩（题目页用）
//
// 相比旧版的改动：
//   1. 新增橡皮（destination-out，擦掉的是像素，露出底下的白膜）
//   2. 支持多指同时绘制：每个 pointerId 维护自己的轨迹，
//      互不干扰。旧版只有一个 lastX/lastY，第二根手指会抢走第一根的线。
//
// 存储：整张画布以 dataURL 存在 localStorage，关闭/重开不会丢。
// 对外 API：window.DrawTool = { toggle, open, close, clear, isOpen }

(function () {
  'use strict';

  const STORAGE_KEY = 'drawToolCanvas_v1';
  const ERASER_SCALE = 4;        // 橡皮半径 = 笔宽 × 这个倍数

  let overlay = null;
  let canvas = null;
  let ctx = null;
  let toolbar = null;
  let saveTimer = null;
  let resizeHandler = null;
  let keyHandler = null;

  // 每个按下的手指 / 手写笔，各有独立的上一个坐标
  const pointers = new Map();    // pointerId -> { x, y }

  // 当前工具状态
  let tool = 'pen';              // 'pen' | 'eraser'
  let penColor = '#e74c3c';
  let penWidth = 3;

  // ═══════════════ 畫布工具 ═══════════════
  function isCanvasBlank() {
    if (!canvas || !ctx) return true;
    try {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return true;
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  function save() {
    if (!canvas || !ctx) return;
    try {
      if (isCanvasBlank()) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl && dataUrl.length < 2_000_000) {
        localStorage.setItem(STORAGE_KEY, dataUrl);
      } else {
        console.warn('[draw] canvas too large to save:', dataUrl.length);
      }
    } catch (e) {
      console.warn('[draw] save failed', e);
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(); }, 400);
  }

  function load() {
    if (!canvas || !ctx) return;
    let dataUrl = '';
    try { dataUrl = localStorage.getItem(STORAGE_KEY) || ''; } catch { dataUrl = ''; }
    if (!dataUrl) return;

    const img = new Image();
    img.onload = () => {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    img.src = dataUrl;
  }

  function fitCanvas() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = penWidth;
    ctx.strokeStyle = penColor;
  }

  function clearCanvas() {
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  // ═══════════════ 繪圖 ═══════════════
  function pointerXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // 每次落笔前设置一次样式，避免上一次的 destination-out 影响这一笔
  function applyStyle() {
    const erasing = tool === 'eraser';
    if (erasing) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = penWidth * ERASER_SCALE;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = penColor;
      ctx.fillStyle = penColor;
      ctx.lineWidth = penWidth;
    }
  }

  function drawDot(x, y) {
    applyStyle();
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLine(x1, y1, x2, y2) {
    applyStyle();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function onPointerDown(e) {
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    const { x, y } = pointerXY(e);
    pointers.set(e.pointerId, { x, y });
    drawDot(x, y);
    scheduleSave();
  }

  function onPointerMove(e) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;                       // 这个指针没按在画布上
    const { x, y } = pointerXY(e);
    drawLine(prev.x, prev.y, x, y);
    pointers.set(e.pointerId, { x, y });
  }

  function onPointerEnd(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    if (pointers.size === 0) scheduleSave();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    // P / E 快速切工具
    if (e.key === 'p' || e.key === 'P') setTool('pen');
    if (e.key === 'e' || e.key === 'E') setTool('eraser');
  }

  function setTool(next) {
    tool = next;
    if (!toolbar) return;
    toolbar.querySelectorAll('[data-tool]').forEach(b => {
      const on = b.dataset.tool === next;
      b.classList.toggle('active', on);
      b.style.background = on ? '#fff' : 'none';
      b.style.color = on ? '#111' : '#fff';
    });
  }

  // ═══════════════ 開 / 關 ═══════════════
  function open() {
    if (overlay) return;
    close();

    // ① 全屏白膜（半透明，能看见底下的题目）
    overlay = document.createElement('div');
    overlay.id = 'draw-tool-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 99998;
      background: rgba(255, 255, 255, 0.77);
      pointer-events: auto;
      touch-action: none;
      overscroll-behavior: none;
    `;

    // ② Canvas
    canvas = document.createElement('canvas');
    canvas.style.cssText = `
      display: block;
      width: 100%;
      height: 100%;
      cursor: crosshair;
      touch-action: none;
    `;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    overlay.appendChild(canvas);

    // ③ 工具列
    toolbar = document.createElement('div');
    toolbar.id = 'draw-tool-toolbar';
    toolbar.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100000;
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 8px 14px;
      background: rgba(20, 20, 30, .92);
      color: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 28px rgba(0,0,0,.4);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: .85rem;
      user-select: none;
      pointer-events: auto;
      max-width: calc(100vw - 32px);
      flex-wrap: wrap;
      justify-content: center;
    `;
    toolbar.innerHTML = `
      <span style="font-weight:700;opacity:.85;">Draw</span>
      <button data-tool="pen" title="Pen (P)"
              style="background:#fff;border:1px solid rgba(255,255,255,.4);color:#111;border-radius:6px;padding:3px 10px;cursor:pointer;font-family:inherit;">
        <i class="fas fa-pen"></i>
      </button>
      <button data-tool="eraser" title="Eraser (E)"
              style="background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-family:inherit;">
        <i class="fas fa-eraser"></i>
      </button>
      <input type="color" id="draw-color" value="#e74c3c" title="Color"
             style="width:28px;height:24px;border:none;background:none;cursor:pointer;padding:0;">
      <input type="range" id="draw-width" min="1" max="12" value="3" title="Width"
             style="width:80px;">
      <button id="draw-clear" title="Clear canvas"
              style="background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-family:inherit;">
        Clear
      </button>
      <button id="draw-close" title="Close (Esc)"
              style="background:#e74c3c;border:none;color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-family:inherit;font-weight:700;">
        Close
      </button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(toolbar);

    // ④ 尺寸 + 载入已有内容
    fitCanvas();
    load();
    setTool(tool);

    // ⑤ 事件（多指：每个 pointerId 独立追踪）
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerEnd);
    canvas.addEventListener('pointercancel', onPointerEnd);
    canvas.addEventListener('pointerleave', onPointerEnd);

    toolbar.querySelectorAll('[data-tool]').forEach(b => {
      b.addEventListener('click', () => setTool(b.dataset.tool));
    });
    toolbar.querySelector('#draw-color').addEventListener('input', e => {
      penColor = e.target.value;
      if (tool === 'eraser') setTool('pen');    // 选颜色等于想画
    });
    toolbar.querySelector('#draw-width').addEventListener('input', e => {
      penWidth = Number(e.target.value);
    });
    toolbar.querySelector('#draw-clear').addEventListener('click', clearCanvas);
    toolbar.querySelector('#draw-close').addEventListener('click', close);

    // ⑥ Resize：保留绘图
    resizeHandler = () => {
      if (!canvas || !ctx) return;
      let snapshot = '';
      try { if (!isCanvasBlank()) snapshot = canvas.toDataURL('image/png'); } catch {}

      fitCanvas();

      if (snapshot) {
        const img = new Image();
        img.onload = () => {
          if (!canvas || !ctx) return;
          const dpr = window.devicePixelRatio || 1;
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        };
        img.src = snapshot;
      }
    };
    window.addEventListener('resize', resizeHandler);

    // ⑦ Esc 关闭 / P E 切换
    keyHandler = onKey;
    document.addEventListener('keydown', keyHandler);

    // ⑧ 通知外部（pd-extras 借此锁滚动）
    document.dispatchEvent(new CustomEvent('drawtool:open'));
  }

  function close() {
    if (!overlay) return;

    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    save();

    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }

    overlay.remove();
    toolbar?.remove();
    overlay = null;
    toolbar = null;
    canvas = null;
    ctx = null;
    pointers.clear();

    document.dispatchEvent(new CustomEvent('drawtool:close'));
  }

  // ═══════════════ 對外 API ═══════════════
  window.DrawTool = {
    toggle() { overlay ? close() : open(); },
    open,
    close,
    clear: clearCanvas,
    setTool: (t) => setTool(t === 'eraser' ? 'eraser' : 'pen'),
    isOpen: () => !!overlay,
  };
})();
