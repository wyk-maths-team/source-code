// draw.js — 全屏繪圖工具（白膜 + localStorage 持久化）
// 接口：window.DrawTool.{toggle, open, close, clear, isOpen}
// 事件：'drawtool:open' / 'drawtool:close'（供外部同步 scroll lock）
(function () {
  'use strict';

  const STORAGE_PREFIX = 'draw_';
  const STORAGE_KEY    = STORAGE_PREFIX + location.pathname;
  const MAX_SAVE_BYTES = 4 * 1024 * 1024;   // 4MB 上限（localStorage 約 5MB）
  const SAVE_DEBOUNCE  = 800;

  let overlay = null;
  let canvas = null;
  let ctx = null;
  let toolbar = null;
  let drawing = false;
  let lastX = 0, lastY = 0;
  let saveTimer = null;
  let resizeHandler = null;
  let keyHandler = null;

  // ═══════════════ 儲存 / 載入 ═══════════════
  function isCanvasBlank() {
    if (!canvas || !ctx) return true;
    try {
      const w = canvas.width, h = canvas.height;
      // 只抽樣檢查（避免 4K 畫布每次都跑幾百萬像素）
      const step = 4;
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < data.length; i += 4 * step) {
        if (data[i] !== 0) return false;
      }
      return true;
    } catch {
      return false;   // 抓不到 → 保守回 false，還是存
    }
  }

  function save() {
    if (!canvas || !ctx) return;
    try {
      // 空白畫布不存，省空間
      if (isCanvasBlank()) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length > MAX_SAVE_BYTES) {
        console.warn('[draw] canvas too large to save:', dataUrl.length);
        return;
      }
      localStorage.setItem(STORAGE_KEY, dataUrl);
    } catch (e) {
      console.warn('[draw] save failed:', e.name, e.message);
      if (e.name === 'QuotaExceededError') {
        // 提示用戶，但不彈 alert（可能正在畫）
        console.warn('[draw] localStorage full, drawing not saved');
      }
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE);
  }

  function load() {
    if (!canvas || !ctx) return;
    let dataUrl;
    try { dataUrl = localStorage.getItem(STORAGE_KEY); } catch { return; }
    if (!dataUrl) return;

    const img = new Image();
    img.onload = () => {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);   // 回到物理像素
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    img.onerror = () => {
      console.warn('[draw] failed to load saved drawing');
    };
    img.src = dataUrl;
  }

  // ═══════════════ 尺寸 ═══════════════
  function fitCanvas() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#e74c3c';
  }

  // ═══════════════ 繪圖 ═══════════════
  function pointerXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function handleDown(e) {
    drawing = true;
    const { x, y } = pointerXY(e);
    lastX = x; lastY = y;
    // 單點也畫一顆點
    ctx.beginPath();
    ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    scheduleSave();
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

  function handleUp() {
    if (!drawing) return;
    drawing = false;
    scheduleSave();
  }

  function clearCanvas() {
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  // ═══════════════ 開 / 關 ═══════════════
  function open() {
    if (overlay) return;
    close();   // 保險：先清乾淨

    // ① 全屏白膜
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

    // ③ 工具列（固定頂部中間）
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
      <span style="font-weight:700;opacity:.85;">✏️ Draw</span>
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

    // ④ 尺寸 + 載入已存的
    fitCanvas();
    load();

    // ⑤ 事件綁定
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      handleDown(e);
    });
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('pointerup', handleUp);
    canvas.addEventListener('pointercancel', handleUp);

    toolbar.querySelector('#draw-color').addEventListener('input', e => {
      ctx.strokeStyle = e.target.value;
    });
    toolbar.querySelector('#draw-width').addEventListener('input', e => {
      ctx.lineWidth = Number(e.target.value);
    });
    toolbar.querySelector('#draw-clear').addEventListener('click', () => {
      clearCanvas();
    });
    toolbar.querySelector('#draw-close').addEventListener('click', close);

    // ⑥ Resize：保留繪圖
    resizeHandler = () => {
      if (!canvas || !ctx) return;
      // 先把目前的圖存成 dataURL
      let snapshot = '';
      try {
        if (!isCanvasBlank()) snapshot = canvas.toDataURL('image/png');
      } catch {}

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

    // ⑦ Esc 關閉
    keyHandler = onKey;
    document.addEventListener('keydown', keyHandler);

    // ⑧ 通知外部（給 pd-extras 鎖 scroll）
    document.dispatchEvent(new CustomEvent('drawtool:open'));
  }

  function close() {
    if (!overlay) return;

    // 關閉前先存
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
    drawing = false;

    document.dispatchEvent(new CustomEvent('drawtool:close'));
  }

  // ═══════════════ 對外 API ═══════════════
  window.DrawTool = {
    toggle() { overlay ? close() : open(); },
    open,
    close,
    clear: clearCanvas,
    isOpen: () => !!overlay,
  };
})();
