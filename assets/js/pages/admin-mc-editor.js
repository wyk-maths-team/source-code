// assets/js/pages/admin-mc-editor.js —— 选择题作答框，极简版
//
// 不再有拖拽调形、不再有模板。就是：
//   - 左边一个悬浮栏，上面一个 + 按钮
//   - 按一下，在「当前滚动到屏幕中央的那一页」的中心放一个竖长方形，
//     里面竖着排 A B C D 四个圆圈
//   - 放好之后可以整体拖着走，可以按 × 删掉
//
// 尺寸和间距都是固定的，所有题长一样，学生端渲染时用同一套比例。

(function () {
  'use strict';
  if (window.McEditor) return;

  // 固定形状：相对一页宽高
  const SHAPE = {
    w: 0.16,          // 长方形宽
    h: 0.30,          // 长方形高
    r: 0.010,         // 圆圈半径（相对页宽）
    padTop: 0.045,    // 第一个圈距顶
    gap: 0.070,       // 圈与圈的间距
  };

  let state = null;

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function clamp01(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  /** 从中心点生成一份完整版式（框 + 四个圈） */
  function layoutAt(cx, cy, page) {
    const x = clamp01(cx - SHAPE.w / 2);
    const y = clamp01(cy - SHAPE.h / 2);
    return {
      page: Math.max(1, Math.round(Number(page) || 1)),
      box: { x, y, w: SHAPE.w, h: SHAPE.h },
      options: ['A', 'B', 'C', 'D'].map((key, i) => ({
        key,
        x: clamp01(x + SHAPE.w / 2),
        y: clamp01(y + SHAPE.padTop + i * SHAPE.gap),
        r: SHAPE.r,
      })),
    };
  }

  function mount(host, opts) {
    const { pdfUrl: initialUrl = '', layout: initialLayout = null, onChange } = opts || {};
    state = {
      pdfUrl: initialUrl,
      layout: initialLayout && initialLayout.box ? initialLayout : null,
      onChange: onChange || function () {},
      pages: [],
    };

    host.innerHTML = '';
    host.className = 'mce';

    // ── 顶部：PDF 地址 ──
    const bar = el('div', 'mce-bar');
    bar.innerHTML =
      '<label class="mce-url-label">Paper PDF</label>' +
      '<input type="url" class="mce-url" id="mceUrl" placeholder="https://raw.githubusercontent.com/.../paper.pdf" value="' +
        String(initialUrl).replace(/"/g, '&quot;') + '">' +
      '<button type="button" class="mce-btn" id="mceLoad"><i class="fas fa-rotate"></i> Load</button>';
    host.appendChild(bar);

    // ── 左侧悬浮栏 ──
    const dock = el('div', 'mce-dock');
    dock.innerHTML =
      '<button type="button" class="mce-plus" id="mcePlus" title="Drop an answer box on the page in view"><i class="fas fa-plus"></i></button>' +
      '<button type="button" class="mce-mini" id="mceRemove" title="Remove the answer box"><i class="fas fa-xmark"></i></button>' +
      '<div class="mce-dock-note" id="mceDockNote">Scroll to a page, then press +</div>';
    host.appendChild(dock);

    const stage = el('div', 'mce-stage');
    host.appendChild(stage);
    const placeholder = el('div', 'mce-placeholder', 'Paste a PDF URL and press Load.');
    stage.appendChild(placeholder);

    const urlInput = bar.querySelector('#mceUrl');
    urlInput.addEventListener('input', () => { state.pdfUrl = urlInput.value.trim(); });

    bar.querySelector('#mceLoad').addEventListener('click', () => loadPdf(stage, placeholder));

    dock.querySelector('#mcePlus').addEventListener('click', addBox);
    dock.querySelector('#mceRemove').addEventListener('click', removeBox);

    function emit() {
      try { state.onChange(state.layout); } catch (e) { console.error('[mc-editor]', e); }
    }

    /** 找出当前滚动到视口中央的那一页 */
    function pageInView() {
      if (!state.pages.length) return { page: 1, overlay: null };
      const mid = window.innerHeight / 2;
      let best = state.pages[0];
      let bestDist = Infinity;
      for (const p of state.pages) {
        const r = p.wrap.getBoundingClientRect();
        const center = r.top + r.height / 2;
        const d = Math.abs(center - mid);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      const idx = state.pages.indexOf(best);
      return { page: idx + 1, overlay: best.overlay, wrap: best.wrap };
    }

    async function loadPdf(stageEl, ph) {
      if (!state.pdfUrl) return;
      if (!window.MCSHEET) { ph.textContent = 'PDF viewer is still loading, try again in a moment.'; return; }
      ph.textContent = 'Loading…';
      try {
        stageEl.innerHTML = '';
        const scroll = el('div', 'mce-scroll');
        stageEl.appendChild(scroll);
        state.pages = await window.MCSHEET.renderPdf(scroll, state.pdfUrl);

        state.pages.forEach((p) => {
          const canvas = p.wrap.querySelector('.mcs-canvas');
          if (!canvas) return;
          p.overlay.style.position = 'absolute';
          p.overlay.style.left = '0';
          p.overlay.style.top = '0';
          p.overlay.style.inset = 'auto';
          p.overlay.style.width = canvas.style.width || (canvas.width + 'px');
          p.overlay.style.height = canvas.style.height || (canvas.height + 'px');
        });

        dock.querySelector('#mceDockNote').textContent = 'Scroll to a page, then press +';
        redraw();
      } catch (e) {
        stageEl.innerHTML = '';
        const err = el('div', 'mce-placeholder');
        err.textContent = 'Could not load that PDF: ' + (e && e.message ? e.message : 'unknown error');
        stageEl.appendChild(err);
      }
    }

    /** 在当前页中心放一个框 */
    function addBox() {
      const { page, overlay, wrap } = pageInView();
      if (!overlay) {
        // 没加载 PDF 时用一个占位页，仍然允许先摆好
        const fake = document.querySelector('.mce-fakepage');
        if (fake) {
          const ov = fake.querySelector('.mce-overlay');
          const rect = ov.getBoundingClientRect();
          state.layout = layoutAt(0.5, 0.5, 1);
          // 用占位页尺寸反推，保持视觉在中心
          void rect;
        } else {
          state.layout = layoutAt(0.5, 0.5, 1);
        }
      } else {
        // 放到这一页的正中央
        state.layout = layoutAt(0.5, 0.5, page);
      }
      emit();
      redraw();
      const note = dock.querySelector('#mceDockNote');
      note.textContent = 'Question ' + (state.layout ? state.layout.page : 1) + ' · page ' + state.layout.page;
      if (wrap && wrap.scrollIntoView) {
        wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }

    function removeBox() {
      state.layout = null;
      emit();
      redraw();
      dock.querySelector('#mceDockNote').textContent = 'Scroll to a page, then press +';
    }

    function redraw() {
      state.pages.forEach((p, i) => {
        p.overlay.innerHTML = '';
        const isTarget = state.layout && (i + 1) === state.layout.page;
        if (!isTarget) return;

        const b = state.layout.box;

        const boxEl = el('div', 'mce-box');
        boxEl.style.left = (b.x * 100) + '%';
        boxEl.style.top = (b.y * 100) + '%';
        boxEl.style.width = (b.w * 100) + '%';
        boxEl.style.height = (b.h * 100) + '%';
        p.overlay.appendChild(boxEl);

        for (const o of state.layout.options) {
          const c = el('div', 'mce-opt');
          c.textContent = o.key;
          c.style.left = (o.x * 100) + '%';
          c.style.top = (o.y * 100) + '%';
          c.style.width = (o.r * 200) + '%';
          boxEl.appendChild(c);
        }

        // 整体拖动
        dragWhole(boxEl, p.overlay, (dx, dy, rect) => {
          const bx = clamp01(state.layout.box.x + dx / rect.width);
          const by = clamp01(state.layout.box.y + dy / rect.height);
          const shiftX = bx - state.layout.box.x;
          const shiftY = by - state.layout.box.y;
          state.layout.box.x = bx;
          state.layout.box.y = by;
          for (const o of state.layout.options) {
            o.x = clamp01(o.x + shiftX);
            o.y = clamp01(o.y + shiftY);
          }
          redraw();
          emit();
        });
      });
    }

    function dragWhole(node, parent, onMove) {
      node.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        let px = e.clientX, py = e.clientY;
        const move = (ev) => {
          const rect = parent.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          onMove(ev.clientX - px, ev.clientY - py, rect);
          px = ev.clientX; py = ev.clientY;
        };
        const up = () => {
          window.removeEventListener('pointermove', move, true);
          window.removeEventListener('pointerup', up, true);
          window.removeEventListener('pointercancel', up, true);
        };
        window.addEventListener('pointermove', move, true);
        window.addEventListener('pointerup', up, true);
        window.addEventListener('pointercancel', up, true);
      });
    }

    // 没有 PDF 时给一张占位页，方便先把框摆好
    if (initialUrl) loadPdf(stage, placeholder);
    else {
      stage.innerHTML = '';
      const scroll = el('div', 'mce-scroll');
      const page = el('div', 'mcs-page mce-fakepage');
      const canvas = el('div', 'mce-fakecanvas');
      const overlay = el('div', 'mcs-overlay mce-overlay');
      page.appendChild(canvas);
      page.appendChild(overlay);
      scroll.appendChild(page);
      stage.appendChild(scroll);
      state.pages = [{ wrap: page, overlay }];
      redraw();
    }

    return {
      getLayout: () => state.layout,
      getPdfUrl: () => state.pdfUrl,
      clear: removeBox,
    };
  }

  window.McEditor = { mount, SHAPE, layoutAt };
})();
