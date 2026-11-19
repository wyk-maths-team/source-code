// assets/js/pages/admin-mc-editor.js —— 选择题版式编辑器
//
// 两个模式，对应两种工作：
//
//   Adjust  拖动框和圈，决定这个形状长什么样；改完可以「存为模板」。
//           模板只存形状（框多大、四个圈相对框左上角偏多少），不含位置。
//
//   Place   在页面上点一下，用模板形状在点击处生成一套结构；
//           生成后仍然能继续拖动。位置属于这一道题，不会影响别的题。
//
// 坐标一律 0-1 比例，换屏幕不会错位。

(function () {
  'use strict';
  if (window.McEditor) return;

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

  function fallbackShape() {
    return {
      boxW: 0.5, boxH: 0.34,
      options: [
        { key: 'A', dx: 0.03, dy: 0.05, r: 0.012 },
        { key: 'B', dx: 0.03, dy: 0.12, r: 0.012 },
        { key: 'C', dx: 0.03, dy: 0.19, r: 0.012 },
        { key: 'D', dx: 0.03, dy: 0.26, r: 0.012 },
      ],
    };
  }

  function defaultLayout(shape) {
    const s = shape || fallbackShape();
    const x0 = 0.08, y0 = 0.55;
    return {
      page: 1,
      box: { x: x0, y: y0, w: s.boxW, h: s.boxH },
      options: s.options.map((o) => ({
        key: o.key,
        x: clamp01(x0 + o.dx),
        y: clamp01(y0 + o.dy),
        r: o.r,
      })),
    };
  }

  function normalizeLayout(raw, shape) {
    const d = defaultLayout(shape);
    if (!raw || !raw.box || !Array.isArray(raw.options)) return d;
    const byKey = new Map();
    for (const o of raw.options) {
      const k = String(o && o.key || '').toUpperCase();
      if (!'ABCD'.includes(k)) continue;
      byKey.set(k, { key: k, x: clamp01(o.x), y: clamp01(o.y), r: clamp01(o.r) || 0.012 });
    }
    return {
      page: Math.max(1, Math.round(Number(raw.page) || 1)),
      box: {
        x: clamp01(raw.box.x),
        y: clamp01(raw.box.y),
        w: clamp01(raw.box.w) || d.box.w,
        h: clamp01(raw.box.h) || d.box.h,
      },
      options: ['A', 'B', 'C', 'D'].map((k) => byKey.get(k) || d.options['ABCD'.indexOf(k)]),
    };
  }

  /** 从当前版式提炼形状（就是「存为模板」要发出去的东西） */
  function shapeFrom(layout) {
    return {
      boxW: layout.box.w,
      boxH: layout.box.h,
      options: layout.options.map((o) => ({
        key: o.key,
        dx: Math.round((o.x - layout.box.x) * 10000) / 10000,
        dy: Math.round((o.y - layout.box.y) * 10000) / 10000,
        r: o.r,
      })),
    };
  }

  /** 用形状 + 放置点生成一份完整版式 */
  function layoutFrom(shape, anchor, page) {
    const s = shape || fallbackShape();
    const x0 = clamp01(anchor && anchor.x);
    const y0 = clamp01(anchor && anchor.y);
    return {
      page: Math.max(1, Math.round(Number(page) || 1)),
      box: { x: x0, y: y0, w: s.boxW, h: s.boxH },
      options: s.options.map((o) => ({
        key: o.key,
        x: clamp01(x0 + o.dx),
        y: clamp01(y0 + o.dy),
        r: o.r,
      })),
    };
  }

  function mount(host, opts) {
    const { pdfUrl: initialUrl = '', layout: initialLayout = null, onChange } = opts || {};
    state = {
      pdfUrl: initialUrl,
      layout: normalizeLayout(initialLayout),
      shape: fallbackShape(),
      onChange: onChange || function () {},
      mode: 'adjust',
      pages: [],
      pdfVisible: false,
    };

    host.innerHTML = '';
    host.className = 'mce';

    // ── 顶部：PDF 地址 ──
    const bar = el('div', 'mce-bar');
    bar.innerHTML =
      '<label class="mce-url-label">Paper PDF URL</label>' +
      '<input type="url" class="mce-url" id="mceUrl" placeholder="https://raw.githubusercontent.com/.../paper.pdf" value="' +
        String(initialUrl).replace(/"/g, '&quot;') + '">' +
      '<button type="button" class="mce-btn" id="mceLoad"><i class="fas fa-rotate"></i> Load PDF</button>' +
      '<button type="button" class="mce-btn" id="mceToggle"><i class="fas fa-eye"></i> Show PDF</button>';
    host.appendChild(bar);

    // ── 模式 ──
    const modes = el('div', 'mce-modes');
    modes.innerHTML =
      '<button type="button" class="mce-mode on" data-mode="adjust"><i class="fas fa-arrows-up-down-left-right"></i> Adjust</button>' +
      '<button type="button" class="mce-mode" data-mode="place"><i class="fas fa-crosshairs"></i> Place</button>' +
      '<span class="mce-hint" id="mceHint">Drag the box or a circle to shape it. Adjust sets the shape; Place stamps it somewhere.</span>' +
      '<button type="button" class="mce-btn" id="mceSaveTmpl" title="Store the current shape as the reusable template"><i class="fas fa-bookmark"></i> Save as template</button>' +
      '<button type="button" class="mce-btn" id="mceApplyTmpl" title="Reshape this layout from the saved template"><i class="fas fa-wand-magic-sparkles"></i> Apply template</button>' +
      '<button type="button" class="mce-btn" id="mceHome"><i class="fas fa-arrow-up"></i> Reset to page 1</button>';
    host.appendChild(modes);

    const help = el('div', 'mce-help');
    help.innerHTML =
      '<b>Adjust</b> — move the box and the four circles until the shape is right. ' +
      '<b>Save as template</b> keeps that shape for other questions. ' +
      '<b>Place</b> — click anywhere on a page and the template is stamped there; drag it afterwards if needed. ' +
      'The placement belongs to this question only, so the same shape can sit anywhere on the paper.';
    host.appendChild(help);

    const stage = el('div', 'mce-stage');
    host.appendChild(stage);
    const placeholder = el('div', 'mce-placeholder', 'Enter a PDF URL above and press “Load PDF” to place the answer sheet.');
    stage.appendChild(placeholder);

    const urlInput = bar.querySelector('#mceUrl');
    urlInput.addEventListener('input', () => { state.pdfUrl = urlInput.value.trim(); emit(); });

    bar.querySelector('#mceLoad').addEventListener('click', () => loadPdf(stage, placeholder));

    bar.querySelector('#mceToggle').addEventListener('click', (e) => {
      state.pdfVisible = !state.pdfVisible;
      stage.classList.toggle('mce-pdf-hidden', !state.pdfVisible);
      e.currentTarget.innerHTML = state.pdfVisible
        ? '<i class="fas fa-eye-slash"></i> Hide PDF'
        : '<i class="fas fa-eye"></i> Show PDF';
      layout();
    });

    modes.querySelectorAll('.mce-mode').forEach((b) => {
      b.addEventListener('click', () => {
        state.mode = b.dataset.mode;
        modes.querySelectorAll('.mce-mode').forEach((x) => x.classList.toggle('on', x === b));
        modes.querySelector('#mceHint').textContent = state.mode === 'place'
          ? 'Click a page to stamp the template there. Drag afterwards to fine-tune.'
          : 'Drag the box or a circle to shape it. Save as template when the shape is right.';
        layout();
      });
    });

    modes.querySelector('#mceSaveTmpl').addEventListener('click', async () => {
      const shape = shapeFrom(state.layout);
      try {
        const r = await apiCall('/api/mc-template?action=save', 'POST', { shape });
        if (!r || !r.success) throw new Error((r && r.message) || 'Save failed');
        state.shape = r.shape || shape;
        if (window.DSHUI && DSHUI.toast) DSHUI.toast('Template saved', 'ok');
      } catch (e) {
        if (window.DSHUI && DSHUI.toast) DSHUI.toast(e.message, 'err');
      }
    });

    modes.querySelector('#mceApplyTmpl').addEventListener('click', async () => {
      try {
        const r = await apiCall('/api/mc-template?action=get');
        if (!r || !r.success) throw new Error('Could not read the template');
        state.shape = r.shape || fallbackShape();
        const at = { x: state.layout.box.x, y: state.layout.box.y };
        state.layout = layoutFrom(state.shape, at, state.layout.page);
        emit();
        layout();
        if (window.DSHUI && DSHUI.toast) DSHUI.toast('Template applied', 'ok');
      } catch (e) {
        if (window.DSHUI && DSHUI.toast) DSHUI.toast(e.message, 'err');
      }
    });

    modes.querySelector('#mceHome').addEventListener('click', () => {
      state.layout = defaultLayout(state.shape);
      emit();
      layout();
      const first = state.pages[0];
      if (first && first.wrap && first.wrap.scrollIntoView) {
        first.wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });

    function emit() {
      try { state.onChange(state.layout, state.pdfUrl); } catch (e) { console.error('[mc-editor]', e); }
    }

    async function loadPdf(stageEl, ph) {
      if (!state.pdfUrl) return;
      if (!window.MCSHEET) { ph.textContent = 'PDF viewer is still loading, try again in a moment.'; return; }
      ph.textContent = 'Loading…';
      if (!state.pdfVisible) {
        state.pdfVisible = true;
        stageEl.classList.remove('mce-pdf-hidden');
        bar.querySelector('#mceToggle').innerHTML = '<i class="fas fa-eye-slash"></i> Hide PDF';
      }
      try {
        stageEl.innerHTML = '';
        const inner = el('div', 'mce-scroll');
        stageEl.appendChild(inner);
        state.pages = await window.MCSHEET.renderPdf(inner, state.pdfUrl);

        // 每页 overlay 锁定到自己画布的大小，否则页一多，百分比高度会按整份文档算
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

        buildOverlay();
      } catch (e) {
        stageEl.innerHTML = '';
        const err = el('div', 'mce-placeholder');
        err.textContent = 'Could not load that PDF: ' + (e && e.message ? e.message : 'unknown error');
        stageEl.appendChild(err);
      }
    }

    function buildOverlay() {
      state.pages.forEach((p, idx) => {
        p.overlay.innerHTML = '';
        p.overlay.classList.add('mce-overlay');
        p.overlay.dataset.pageNo = String(idx + 1);
        p.overlay.addEventListener('click', (e) => {
          if (state.mode !== 'place') return;
          if (e.target !== p.overlay && !e.target.classList.contains('mce-ghost')) return;
          const rect = p.overlay.getBoundingClientRect();
          const x = clamp01((e.clientX - rect.left) / rect.width);
          const y = clamp01((e.clientY - rect.top) / rect.height);
          // 放置：用模板形状，把框的左上角放在点击处
          state.layout = layoutFrom(state.shape, { x, y }, idx + 1);
          emit();
          layout();
        });
      });
      layout();
    }

    function layout() {
      state.pages.forEach((p, i) => {
        p.overlay.innerHTML = '';
        p.overlay.style.pointerEvents = 'auto';
        const isTarget = (i + 1) === state.layout.page;
        if (!isTarget) {
          const ghost = el('div', 'mce-ghost');
          p.overlay.appendChild(ghost);
          return;
        }

        const boxEl = el('div', 'mce-box');
        boxEl.dataset.role = 'box';
        applyRect(boxEl, state.layout.box);
        boxEl.appendChild(el('div', 'mce-tag', 'Answer area'));
        const grip = el('div', 'mce-grip');
        boxEl.appendChild(grip);
        p.overlay.appendChild(boxEl);

        bindDrag(boxEl, p.overlay, (dx, dy, rect) => {
          if (state.mode !== 'adjust') return;
          state.layout.box.x = clamp01(state.layout.box.x + dx / rect.width);
          state.layout.box.y = clamp01(state.layout.box.y + dy / rect.height);
          applyRect(boxEl, state.layout.box);
          emit();
        }, { skip: '.mce-grip' });

        bindDrag(grip, p.overlay, (dx, dy, rect) => {
          if (state.mode !== 'adjust') return;
          state.layout.box.w = Math.max(0.08, clamp01(state.layout.box.w + dx / rect.width));
          state.layout.box.h = Math.max(0.06, clamp01(state.layout.box.h + dy / rect.height));
          applyRect(boxEl, state.layout.box);
          emit();
        });

        for (const o of state.layout.options) {
          const c = el('button', 'mce-opt');
          c.type = 'button';
          c.textContent = o.key;
          c.style.left = (o.x * 100) + '%';
          c.style.top = (o.y * 100) + '%';
          c.style.width = (o.r * 200) + '%';
          p.overlay.appendChild(c);

          bindDrag(c, p.overlay, (dx, dy, rect) => {
            o.x = clamp01(o.x + dx / rect.width);
            o.y = clamp01(o.y + dy / rect.height);
            c.style.left = (o.x * 100) + '%';
            c.style.top = (o.y * 100) + '%';
            emit();
          });

          c.addEventListener('wheel', (e) => {
            e.preventDefault();
            o.r = Math.max(0.004, Math.min(0.06, (Number(o.r) || 0.012) + (e.deltaY < 0 ? 0.002 : -0.002)));
            c.style.width = (o.r * 200) + '%';
            emit();
          }, { passive: false });
        }
      });
    }

    function applyRect(node, b) {
      node.style.left = (b.x * 100) + '%';
      node.style.top = (b.y * 100) + '%';
      node.style.width = (b.w * 100) + '%';
      node.style.height = (b.h * 100) + '%';
    }

    /** 指针事件挂 window：只挂元素上的话，鼠标一离开就收不到 move，看起来像拉不动 */
    function bindDrag(node, parent, onMove, opts) {
      const skip = (opts && opts.skip) || null;
      node.addEventListener('pointerdown', (e) => {
        if (skip && e.target.closest(skip)) return;
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

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

    // 先按已有版式画一次（没有 PDF 时给横线占位页）
    if (initialUrl) loadPdf(stage, placeholder);
    else {
      stage.innerHTML = '';
      const fake = el('div', 'mce-scroll');
      const page = el('div', 'mcs-page mce-fakepage');
      const canvas = el('div', 'mce-fakecanvas');
      const overlay = el('div', 'mcs-overlay mce-overlay');
      page.appendChild(canvas);
      page.appendChild(overlay);
      fake.appendChild(page);
      stage.appendChild(fake);
      state.pages = [{ wrap: page, overlay }];
      overlay.dataset.pageNo = '1';
      overlay.addEventListener('click', (e) => {
        if (state.mode !== 'place') return;
        if (e.target !== overlay && !e.target.classList.contains('mce-ghost')) return;
        const rect = overlay.getBoundingClientRect();
        state.layout = layoutFrom(state.shape, {
          x: clamp01((e.clientX - rect.left) / rect.width),
          y: clamp01((e.clientY - rect.top) / rect.height),
        }, 1);
        emit();
        layout();
      });
      layout();
    }

    // 打开时把模板读进来，Place 用的是它
    apiCall('/api/mc-template?action=get').then((r) => {
      if (r && r.success && r.shape) state.shape = r.shape;
    }).catch(() => {});

    return {
      getLayout: () => state.layout,
      getPdfUrl: () => state.pdfUrl,
    };
  }

  window.McEditor = { mount, defaultLayout, normalizeLayout, shapeFrom, layoutFrom };
})();
