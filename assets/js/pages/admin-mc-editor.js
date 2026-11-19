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
          if (e.target !== p.overlay && !e.target.classList.contains('mce-ghost')) return;

          const pageNo = Number(p.wrap.dataset.page || 1) || 1;
          const rect = p.overlay.getBoundingClientRect();
          const x = clamp01((e.clientX - rect.left) / rect.width);
          const y = clamp01((e.clientY - rect.top) / rect.height);

          // 换页就把整份结构搬过去；同页则只挪圆圈
          if (pageNo !== state.layout.page) {
            state.layout.page = pageNo;
            state.layout.box = { x: clamp01(x - 0.04), y: clamp01(y - 0.04), w: 0.5, h: 0.3 };
          }
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
        // 每一页都可以放结构：点哪一页的空白处就把结构摆到哪一页
        p.overlay.style.pointerEvents = 'auto';
        p.wrap.dataset.activePage = String(i + 1);
        const isTarget = (i + 1) === state.layout.page;
        if (!isTarget) {
          // 非当前页只画一圈淡轮廓，提示这里可以放结构
          const ghost = el('div', 'mce-ghost');
          p.overlay.appendChild(ghost);
          return;
        }

        const boxEl = el('div', 'mce-box');
        boxEl.dataset.role = 'box';
        applyRect(boxEl, state.layout.box);
        const tag = el('div', 'mce-tag', 'Answer area');
        boxEl.appendChild(tag);
        const grip = el('div', 'mce-grip');
        boxEl.appendChild(grip);
        p.overlay.appendChild(boxEl);

        bindDrag(boxEl, p.overlay, (dx, dy, rect) => {
          state.layout.box.x = clamp01(state.layout.box.x + dx / rect.width);
          state.layout.box.y = clamp01(state.layout.box.y + dy / rect.height);
          applyRect(boxEl, state.layout.box);
          emit();
        }, { skip: '.mce-grip' });

        bindDrag(grip, p.overlay, (dx, dy, rect) => {
          // 最小 8% x 6%：否则往左上拖两下就缩成一条线，看起来像「一拉就扁」
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

          // 滚轮改半径
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

    /**
     * 通用拖动。
     *
     * 指针事件必须挂在 window 上：只挂在被拖元素上时，鼠标一离开元素
     * （或者 setPointerCapture 在部分浏览器里没生效）就收不到 pointermove，
     * 表现就是「拉不动」或者「拉一下就扁」。
     */
    function bindDrag(node, parent, onMove, opts) {
      const skipSelector = (opts && opts.skip) || null;

      node.addEventListener('pointerdown', (e) => {
        if (state.mode !== 'move') return;
        if (skipSelector && e.target.closest(skipSelector)) return;
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        let px = e.clientX;
        let py = e.clientY;

        const move = (ev) => {
          const rect = parent.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          onMove(ev.clientX - px, ev.clientY - py, rect);
          px = ev.clientX;
          py = ev.clientY;
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
