// assets/js/pages/admin-mc-editor.js —— 选择题作答框，极简版
//
// 左边一个悬浮栏，一个 + 按钮。按一下，在「当前滚动到屏幕中央的那一页」
// 的正中心放一个竖长方形，里面竖排 A B C D 四个圆圈。
//
// 一页可以放多个框；第一个是第 1 题，第二个是第 2 题，依此类推。
// 每个框右上角有自己的小 × 可以单独删掉。
//
// 尺寸固定，所有题长一样。

(function () {
  'use strict';
  if (window.McEditor) return;

  const SHAPE = {
    w: 0.16,
    h: 0.30,
    r: 0.010,
    padTop: 0.045,
    gap: 0.070,
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
    const { pdfUrl: initialUrl = '', layout: initialLayout = null, slots: initialSlots = null, onChange } = opts || {};

    // 兼容旧字段：mcq 是单条，mcSlots 是多条
    let store = [];
    if (Array.isArray(initialSlots) && initialSlots.length) store = initialSlots.filter((s) => s && s.box);
    else if (initialLayout && initialLayout.box) store = [initialLayout];

    state = {
      pdfUrl: initialUrl,
      slots: store,
      onChange: onChange || function () {},
      pages: [],
    };

    host.innerHTML = '';
    host.className = 'mce';

    const bar = el('div', 'mce-bar');
    bar.innerHTML =
      '<label class="mce-url-label">Paper PDF</label>' +
      '<input type="url" class="mce-url" id="mceUrl" placeholder="https://raw.githubusercontent.com/.../paper.pdf" value="' +
        String(initialUrl).replace(/"/g, '&quot;') + '">' +
      '<button type="button" class="mce-btn" id="mceLoad"><i class="fas fa-rotate"></i> Load</button>';
    host.appendChild(bar);

    const dock = el('div', 'mce-dock');
    dock.innerHTML =
      '<button type="button" class="mce-plus" id="mcePlus" title="Add an answer box to the page in view"><i class="fas fa-plus"></i></button>' +
      '<div class="mce-count" id="mceCount">0 boxes</div>' +
      '<div class="mce-dock-note" id="mceDockNote">Scroll to a page, then press +</div>';
    host.appendChild(dock);

    const stage = el('div', 'mce-stage');
    host.appendChild(stage);
    const placeholder = el('div', 'mce-placeholder', 'Paste a PDF URL and press Load.');
    stage.appendChild(placeholder);

    const urlInput = bar.querySelector('#mceUrl');
    urlInput.addEventListener('input', () => { state.pdfUrl = urlInput.value.trim(); });
    bar.querySelector('#mceLoad').addEventListener('click', () => loadPdf(stage, placeholder));
    dock.querySelector('#mcePlus').addEventListener('click', addSlot);

    function emit() {
      try { state.onChange(state.slots); } catch (e) { console.error('[mc-editor]', e); }
    }

    function updateCount() {
      const n = state.slots.length;
      const c = dock.querySelector('#mceCount');
      if (c) c.textContent = n + (n === 1 ? ' box' : ' boxes');
      const note = dock.querySelector('#mceDockNote');
      if (note) {
        note.textContent = n
          ? 'Q' + n + ' just added · all ' + n + ' shown'
          : 'Scroll to a page, then press +';
      }
    }

    function pageInView() {
      if (!state.pages.length) return { page: 1, overlay: null, wrap: null };
      const mid = window.innerHeight / 2;
      let best = state.pages[0];
      let bestDist = Infinity;
      for (const p of state.pages) {
        const r = p.wrap.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestDist) { bestDist = d; best = p; }
      }
      return { page: state.pages.indexOf(best) + 1, overlay: best.overlay, wrap: best.wrap };
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

        redraw();
        updateCount();
      } catch (e) {
        stageEl.innerHTML = '';
        const err = el('div', 'mce-placeholder');
        err.textContent = 'Could not load that PDF: ' + (e && e.message ? e.message : 'unknown error');
        stageEl.appendChild(err);
      }
    }

    /** 在当前页中心追加一个框；同页已有框就依次错开，免得叠成一坨 */
    function addSlot() {
      const { page, wrap } = pageInView();
      const samePage = state.slots.filter((s) => s.page === page).length;
      const step = 0.035 * SHAPE.h / 0.30;      // 每多一个往下挪一点
      const cx = 0.5 + Math.min(3, samePage) * 0.02;
      const cy = 0.5 + Math.min(6, samePage) * step;
      state.slots.push(layoutAt(cx, cy, page));
      redraw();
      updateCount();
      emit();
      if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    function removeSlot(idx) {
      state.slots.splice(idx, 1);
      redraw();
      updateCount();
      emit();
    }

    function redraw() {
      state.pages.forEach((p, i) => {
        p.overlay.innerHTML = '';
        const pageNo = i + 1;

        state.slots.forEach((slot, idx) => {
          if (slot.page !== pageNo) return;

          const b = slot.box;
          const boxEl = el('div', 'mce-box');
          boxEl.style.left = (b.x * 100) + '%';
          boxEl.style.top = (b.y * 100) + '%';
          boxEl.style.width = (b.w * 100) + '%';
          boxEl.style.height = (b.h * 100) + '%';

          // 序号 + 删除
          const badge = el('div', 'mce-badge', 'Q' + (idx + 1));
          boxEl.appendChild(badge);

          const del = el('button', 'mce-del');
          del.type = 'button';
          del.title = 'Remove this box';
          del.innerHTML = '<i class="fas fa-xmark"></i>';
          del.addEventListener('pointerdown', (e) => e.stopPropagation());
          del.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeSlot(idx);
          });
          boxEl.appendChild(del);

          for (const o of slot.options) {
            const c = el('div', 'mce-opt');
            c.textContent = o.key;
            c.style.left = (o.x * 100) + '%';
            c.style.top = (o.y * 100) + '%';
            c.style.width = (o.r * 200) + '%';
            boxEl.appendChild(c);
          }

          p.overlay.appendChild(boxEl);

          dragWhole(boxEl, p.overlay, (dx, dy, rect) => {
            const nx = clamp01(slot.box.x + dx / rect.width);
            const ny = clamp01(slot.box.y + dy / rect.height);
            const shiftX = nx - slot.box.x;
            const shiftY = ny - slot.box.y;
            slot.box.x = nx;
            slot.box.y = ny;
            for (const o of slot.options) {
              o.x = clamp01(o.x + shiftX);
              o.y = clamp01(o.y + shiftY);
            }
            redraw();
            emit();
          });
        });
      });
    }

    function dragWhole(node, parent, onMove) {
      node.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest('.mce-del')) return;
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

    updateCount();

    return {
      getLayout: () => state.slots[0] || null,
      getSlots: () => state.slots,
      getPdfUrl: () => state.pdfUrl,
      add: addSlot,
    };
  }

  window.McEditor = { mount, SHAPE, layoutAt };
})();
