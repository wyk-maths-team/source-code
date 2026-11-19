// assets/js/pages/admin-mc-editor.js —— 选择题版式编辑器
//
// 只在题目带 MC 标签时出现。管理员在这块里：
//   - 填整份卷子的 PDF 地址（任意 https 地址都可以，GitHub raw 也行）
//   - 在 PDF 上摆放一个透明答题框和四个选项圈
//   - 拖动移动、拖右下角缩放，实时看到学生端会是什么样子
//   - 用 "Add option" 模式把 A 圈直接丢到鼠标位置，再摆其余三个
//
// 坐标一律以 0-1 比例存进 problem.mcq，所以换屏幕不会错位。
// 保存时由 api/problem.js 负责把版式写回同一份卷子的每一道题。

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

  /** 空白版式：一个居中的框 + 四个等距的圈 */
  function defaultLayout() {
    return {
      page: 1,
      box: { x: 0.08, y: 0.55, w: 0.5, h: 0.34 },
      options: [
        { key: 'A', x: 0.13, y: 0.60, r: 0.012 },
        { key: 'B', x: 0.13, y: 0.66, r: 0.012 },
        { key: 'C', x: 0.13, y: 0.72, r: 0.012 },
        { key: 'D', x: 0.13, y: 0.78, r: 0.012 },
      ],
    };
  }

  function normalizeLayout(raw) {
    if (!raw || !raw.box || !Array.isArray(raw.options)) return defaultLayout();
    const byKey = new Map();
    for (const o of raw.options) {
      const k = String(o && o.key || '').toUpperCase();
      if (!'ABCD'.includes(k)) continue;
      byKey.set(k, { key: k, x: clamp01(o.x), y: clamp01(o.y), r: clamp01(o.r) || 0.012 });
    }
    const options = ['A', 'B', 'C', 'D'].map((k) => byKey.get(k) || {
      key: k, x: 0.13, y: 0.6 + 0.06 * 'ABCD'.indexOf(k), r: 0.012,
    });
    return {
      page: Math.max(1, Math.round(Number(raw.page) || 1)),
      box: { x: clamp01(raw.box.x), y: clamp01(raw.box.y), w: clamp01(raw.box.w) || 0.5, h: clamp01(raw.box.h) || 0.3 },
      options,
    };
  }

  /**
   * 挂载。
   * @param {HTMLElement} host
   * @param {object} opts { pdfUrl, layout, onChange(layout) }
   */
  function mount(host, opts) {
    const { pdfUrl: initialUrl = '', layout: initialLayout = null, onChange } = opts || {};
    state = {
      pdfUrl: initialUrl,
      layout: normalizeLayout(initialLayout),
      onChange: onChange || function () {},
      mode: 'move',          // 'move' | 'add'
      pages: [],
      activePage: null,
      pdfVisible: false,
    };

    host.innerHTML = '';
    host.className = 'mce';

    // ── 顶部控制条 ──
    const bar = el('div', 'mce-bar');
    bar.innerHTML =
      '<label class="mce-url-label">Paper PDF URL</label>' +
      '<input type="url" class="mce-url" id="mceUrl" placeholder="https://raw.githubusercontent.com/.../paper.pdf" value="' +
        String(initialUrl).replace(/"/g, '&quot;') + '">' +
      '<button type="button" class="mce-btn" id="mceLoad"><i class="fas fa-rotate"></i> Load PDF</button>' +
      '<button type="button" class="mce-btn" id="mceToggle"><i class="fas fa-eye"></i> Show PDF</button>';
    host.appendChild(bar);

    // ── 模式切换 ──
    const modes = el('div', 'mce-modes');
    modes.innerHTML =
      '<button type="button" class="mce-mode on" data-mode="move"><i class="fas fa-arrows-up-down-left-right"></i> Move / resize</button>' +
      '<button type="button" class="mce-mode" data-mode="add"><i class="fas fa-crosshairs"></i> Add option at cursor</button>' +
      '<span class="mce-hint" id="mceHint">Drag the box or a circle. Drag the bottom-right corner to resize.</span>' +
      '<button type="button" class="mce-btn" id="mceReset"><i class="fas fa-undo"></i> Reset layout</button>';
    host.appendChild(modes);

    const help = el('div', 'mce-help');
    help.innerHTML =
      'Coordinates are stored as ratios of the page, so the layout survives any screen size. ' +
      'Saving writes this layout to every MC question on the same paper.';
    host.appendChild(help);

    // ── 舞台 ──
    const stage = el('div', 'mce-stage');
    host.appendChild(stage);

    const placeholder = el('div', 'mce-placeholder', 'Enter a PDF URL above and press “Load PDF” to place the answer sheet.');
    stage.appendChild(placeholder);

    // ── 事件接线 ──
    const urlInput = bar.querySelector('#mceUrl');
    urlInput.addEventListener('input', () => {
      state.pdfUrl = urlInput.value.trim();
      emit();
    });

    bar.querySelector('#mceLoad').addEventListener('click', () => {
      loadPdf(stage, placeholder);
    });

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
        modes.querySelector('#mceHint').textContent = state.mode === 'add'
          ? 'Click on the page to drop the A circle there; B, C and D are placed below it.'
          : 'Drag the box or a circle. Drag the bottom-right corner to resize.';
      });
    });

    modes.querySelector('#mceReset').addEventListener('click', () => {
      state.layout = defaultLayout();
      emit();
      layout();
    });

    // ── 渲染 ──
    function emit() {
      try { state.onChange(state.layout, state.pdfUrl); } catch (e) { console.error('[mc-editor]', e); }
    }

    async function loadPdf(stageEl, ph) {
      if (!state.pdfUrl) return;
      if (!window.MCSHEET) {
        ph.textContent = 'PDF viewer is still loading, try again in a moment.';
        return;
      }
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
        buildOverlay();
      } catch (e) {
        stageEl.innerHTML = '';
        const err = el('div', 'mce-placeholder');
        err.textContent = 'Could not load that PDF: ' + (e && e.message ? e.message : 'unknown error');
        stageEl.appendChild(err);
      }
    }

    function pageFor(n) {
      return state.pages[Math.max(0, Math.min(state.pages.length - 1, n - 1))] || null;
    }

    function buildOverlay() {
      state.pages.forEach((p) => {
        p.overlay.innerHTML = '';
        p.overlay.classList.add('mce-overlay');
        p.overlay.addEventListener('click', (e) => {
          if (state.mode !== 'add') return;
          if (e.target !== p.overlay) return;      // 只认空白处
          const rect = p.overlay.getBoundingClientRect();
          const x = clamp01((e.clientX - rect.left) / rect.width);
          const y = clamp01((e.clientY - rect.top) / rect.height);
          state.layout.options = ['A', 'B', 'C', 'D'].map((k, i) => ({
            key: k,
            x,
            y: clamp01(y + i * 0.06),
            r: state.layout.options[i] ? state.layout.options[i].r : 0.012,
          }));
          emit();
          layout();
        });
      });
      layout();
    }

    function layout() {
      state.pages.forEach((p, i) => {
        p.overlay.innerHTML = '';
        const isTarget = (i + 1) === state.layout.page;
        if (!isTarget) {
          p.overlay.style.pointerEvents = 'none';
          return;
        }
        p.overlay.style.pointerEvents = 'auto';

        const boxEl = el('div', 'mce-box');
        boxEl.dataset.role = 'box';
        applyRect(boxEl, state.layout.box);
        const tag = el('div', 'mce-tag', 'Answer area');
        boxEl.appendChild(tag);
        const grip = el('div', 'mce-grip');
        boxEl.appendChild(grip);
        p.overlay.appendChild(boxEl);

        drag(boxEl, p.overlay, (dx, dy, rect) => {
          state.layout.box.x = clamp01(state.layout.box.x + dx / rect.width);
          state.layout.box.y = clamp01(state.layout.box.y + dy / rect.height);
          applyRect(boxEl, state.layout.box);
          emit();
        });

        resize(grip, boxEl, p.overlay, (dx, dy, rect) => {
          state.layout.box.w = clamp01(state.layout.box.w + dx / rect.width);
          state.layout.box.h = clamp01(state.layout.box.h + dy / rect.height);
          applyRect(boxEl, state.layout.box);
          emit();
        });

        for (const o of state.layout.options) {
          const c = el('button', 'mce-opt');
          c.type = 'button';
          c.textContent = o.key;
          c.style.left = (o.x * 100) + '%';
          c.style.top = (o.y * 100) + '%';
          c.style.width = (o.r * 200 * 100) + '%';
          p.overlay.appendChild(c);

          drag(c, p.overlay, (dx, dy, rect) => {
            o.x = clamp01(o.x + dx / rect.width);
            o.y = clamp01(o.y + dy / rect.height);
            c.style.left = (o.x * 100) + '%';
            c.style.top = (o.y * 100) + '%';
            emit();
          });

          // 滚轮改半径
          c.addEventListener('wheel', (e) => {
            e.preventDefault();
            o.r = clamp01(o.r + (e.deltaY < 0 ? 0.002 : -0.002)) || 0.006;
            c.style.width = (o.r * 200 * 100) + '%';
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

    /** 通用拖动：传回相对容器的位移（像素），调用方自己换算成比例 */
    function drag(node, parent, onMove) {
      let dragging = false, sx = 0, sy = 0;
      node.addEventListener('pointerdown', (e) => {
        if (state.mode !== 'move') return;
        if (e.target.closest('.mce-grip')) return;
        e.preventDefault();
        dragging = true;
        sx = e.clientX; sy = e.clientY;
        node.setPointerCapture(e.pointerId);
      });
      node.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const rect = parent.getBoundingClientRect();
        onMove(e.clientX - sx, e.clientY - sy, rect);
        sx = e.clientX; sy = e.clientY;
      });
      const stop = (e) => {
        if (!dragging) return;
        dragging = false;
        try { node.releasePointerCapture(e.pointerId); } catch (err) {}
      };
      node.addEventListener('pointerup', stop);
      node.addEventListener('pointercancel', stop);
    }

    function resize(grip, node, parent, onMove) {
      let on = false, sx = 0, sy = 0;
      grip.addEventListener('pointerdown', (e) => {
        if (state.mode !== 'move') return;
        e.preventDefault(); e.stopPropagation();
        on = true; sx = e.clientX; sy = e.clientY;
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener('pointermove', (e) => {
        if (!on) return;
        const rect = parent.getBoundingClientRect();
        onMove(e.clientX - sx, e.clientY - sy, rect);
        sx = e.clientX; sy = e.clientY;
      });
      const stop = (e) => {
        if (!on) return;
        on = false;
        try { grip.releasePointerCapture(e.pointerId); } catch (err) {}
      };
      grip.addEventListener('pointerup', stop);
      grip.addEventListener('pointercancel', stop);
    }

    // 先按已有版式画一次，即使没加载 PDF 也能看到结构
    if (initialUrl) loadPdf(stage, placeholder);
    else {
      // 没有 PDF 时给一块等比画布，方便先把结构摆好
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
      buildOverlay();
    }

    return {
      getLayout: () => state.layout,
      getPdfUrl: () => state.pdfUrl,
    };
  }

  window.McEditor = { mount, defaultLayout, normalizeLayout };
})();
