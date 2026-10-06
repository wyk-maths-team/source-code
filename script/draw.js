// draw.js — 全屏绘图工具（覆盖指定容器）
// 接口：window.DrawTool.toggle(container) / open(container) / close()
(function () {
  'use strict';

  let overlay = null;
  let toolbar = null;
  let container = null;
  let canvas = null;
  let ctx = null;
  let drawing = false;
  let lastX = 0, lastY = 0;
  let positionHandler = null;

  function fitCanvas() {
    if (!canvas || !container || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width  = Math.floor(rect.width  * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e74c3c';
  }

  function pointerXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function handleDown(e) {
    drawing = true;
    const { x, y } = pointerXY(e);
    lastX = x; lastY = y;
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  function handleMove(e) {
    if (!drawing) return;
    const { x, y } = pointerXY(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    lastX = x; lastY = y;
  }

  function handleUp() { drawing = false; }

  function clearCanvas() {
    if (!canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(target) {
    if (overlay) close();
    container = target;
    if (!container) return;

    overlay = document.createElement('div');
    overlay.id = 'draw-tool-overlay';
    overlay.style.cssText = `position: fixed; z-index: 99999; pointer-events: none;`;

    canvas = document.createElement('canvas');
    canvas.style.cssText = `display:block; cursor: crosshair; pointer-events: auto; background: transparent;`;
    ctx = canvas.getContext('2d'); 
    overlay.appendChild(canvas);

    toolbar = document.createElement('div');
    toolbar.style.cssText = `
      position: fixed; z-index: 100000;
      display: flex; gap: 8px; align-items: center;
      padding: 8px 12px;
      background: rgba(20,20,30,.85); color: #fff;
      border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,.35);
      font-family: system-ui, sans-serif;
      font-size: .85rem;
      pointer-events: auto;
    `;
    toolbar.innerHTML = `
      <span style="font-weight:700;opacity:.85;">✏️ Draw</span>
      <input type="color" id="draw-color" value="#e74c3c" style="width:28px;height:24px;border:none;background:none;cursor:pointer;">
      <input type="range" id="draw-width" min="1" max="12" value="3" style="width:80px;">
      <button id="draw-clear" style="background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-family:inherit;">Clear</button>
      <button id="draw-close" style="background:#e74c3c;border:none;color:#fff;border-radius:6px;padding:3px 10px;cursor:pointer;font-family:inherit;font-weight:700;">Close</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(toolbar);

    positionHandler = () => {
      const r = container.getBoundingClientRect();
      overlay.style.left   = r.left + 'px';
      overlay.style.top    = r.top + 'px';
      overlay.style.width  = r.width + 'px';
      overlay.style.height = r.height + 'px';
      toolbar.style.left = Math.max(8, r.left + 8) + 'px';
      toolbar.style.top  = Math.max(8, r.top - 48) + 'px';
      fitCanvas();
    };
    positionHandler();

    canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); handleDown(e); });
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('pointerup', handleUp);
    canvas.addEventListener('pointercancel', handleUp);

    toolbar.querySelector('#draw-color').addEventListener('input', e => { ctx.strokeStyle = e.target.value; });
    toolbar.querySelector('#draw-width').addEventListener('input', e => { ctx.lineWidth = Number(e.target.value); });
    toolbar.querySelector('#draw-clear').addEventListener('click', clearCanvas);
    toolbar.querySelector('#draw-close').addEventListener('click', close);

    window.addEventListener('resize', positionHandler);
    window.addEventListener('scroll', positionHandler, true);
    document.addEventListener('keydown', onKey);
  }

  function close() {
    if (!overlay) return;
    if (positionHandler) {
      window.removeEventListener('resize', positionHandler);
      window.removeEventListener('scroll', positionHandler, true);
      positionHandler = null;
    }
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    toolbar?.remove();
    overlay = null;
    toolbar = null;
    canvas = null;
    ctx = null;
    container = null;
    drawing = false;
  }

  window.DrawTool = {
    toggle(target) { overlay ? close() : open(target); },
    open,
    close,
    isOpen: () => !!overlay,
  };
})();