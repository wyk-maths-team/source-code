// assets/js/pd-scratchpad.js —— 题目详情页的草稿板（Scratchpad）
//
// 在 Submissions 按钮左边加一个按钮，点开后是一个盖住整页的画板：
//   顶栏：题目 id - 名称 + 关闭
//   正文：题干
//   底部：提交按钮 + 状态
// 画布是点阵纸，支持 4 档笔粗、6 种颜色、撤销、清空。
//
// 提交不走自己的接口：把画布导出成 base64 塞进工作台的 photo 面板，
// 再触发原本的 Submit，让图片批改走和拍照上传完全相同的路径。

(function () {
  'use strict';

  const COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#7c3aed'];
  const WIDTHS = [2, 4, 7, 11];

  let root = null;
  let canvas = null;
  let ctx = null;
  let pad = null;          // { strokes, active, color, width, erase }
  let dpr = 1;

  // ── 草稿：按题目存到 localStorage，关掉画板/刷新后还能接上 ──
  const DRAFT_PREFIX = 'pd_scratchpad:';

  function currentPid() {
    const el = document.getElementById('detailProblemName');
    const txt = el ? el.textContent.trim() : '';
    const m = /^([A-Za-z0-9_-]+)/.exec(txt);
    return m ? m[1] : '';
  }

  function draftKey() {
    const pid = currentPid();
    return pid ? DRAFT_PREFIX + pid : '';
  }

  function saveDraft() {
    const key = draftKey();
    if (!key || !pad || !canvas) return;
    try {
      if (!pad.strokes.length) { localStorage.removeItem(key); return; }
      // 归一化到 0-1，换设备/改窗口大小也能大致还原
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      const strokes = pad.strokes.map((st) => ({
        color: st.color,
        width: st.width,
        points: st.points.map((p) => [p.x / w, p.y / h]),
      }));
      localStorage.setItem(key, JSON.stringify({ w, h, strokes }));
    } catch (e) { /* 存不下就算了 */ }
  }

  function loadDraft() {
    const key = draftKey();
    if (!key) return [];
    let raw = null;
    try { raw = localStorage.getItem(key); } catch (e) { return []; }
    if (!raw) return [];
    try {
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.strokes)) return [];
      return d.strokes.map((st) => ({
        color: st.color || COLORS[0],
        width: Number(st.width) || WIDTHS[1],
        points: (st.points || []).map(([x, y]) => ({ x, y })),
      }));
    } catch (e) { return []; }
  }

  function clearDraft() {
    const key = draftKey();
    if (key) { try { localStorage.removeItem(key); } catch (e) {} }
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function buildDom() {
    root = el('div', 'sp-overlay');
    root.innerHTML =
      '<div class="sp-panel">' +
        '<div class="sp-head">' +
          '<div class="sp-title" id="spTitle"></div>' +
          '<button type="button" class="sp-close" id="spClose" title="Close"><i class="fas fa-times"></i></button>' +
        '</div>' +
        '<div class="sp-statement" id="spStatement"></div>' +
        '<div class="sp-tools">' +
          '<span class="sp-colors" id="spColors"></span>' +
          '<span class="sp-widths" id="spWidths"></span>' +
          '<span class="sp-gap"></span>' +
          '<button type="button" class="sp-tool" id="spUndo" title="Undo"><i class="fas fa-rotate-left"></i></button>' +
          '<button type="button" class="sp-tool" id="spClear" title="Clear"><i class="fas fa-trash"></i></button>' +
        '</div>' +
        '<div class="sp-canvas-wrap"><canvas id="spCanvas"></canvas></div>' +
        '<div class="sp-foot">' +
          '<span class="sp-status" id="spStatus"></span>' +
          '<button type="button" class="sp-submit" id="spSubmit"><i class="fas fa-paper-plane"></i> Submit drawing</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    canvas = root.querySelector('#spCanvas');
    ctx = canvas.getContext('2d');
    pad = { strokes: [], active: null, color: COLORS[0], width: WIDTHS[1], erase: false };

    // 颜色
    const colorsBox = root.querySelector('#spColors');
    COLORS.forEach((c, i) => {
      const b = el('button', 'sp-color' + (i === 0 ? ' on' : ''));
      b.type = 'button';
      b.style.background = c;
      b.dataset.color = c;
      b.addEventListener('click', () => {
        pad.color = c;
        pad.erase = false;
        colorsBox.querySelectorAll('.sp-color').forEach((o) => o.classList.toggle('on', o === b));
      });
      colorsBox.appendChild(b);
    });

    // 粗细
    const widthsBox = root.querySelector('#spWidths');
    WIDTHS.forEach((w, i) => {
      const b = el('button', 'sp-width' + (i === 1 ? ' on' : ''));
      b.type = 'button';
      b.dataset.width = String(w);
      b.innerHTML = '<span style="width:' + Math.min(16, w + 4) + 'px;height:' + Math.min(16, w + 4) + 'px"></span>';
      b.addEventListener('click', () => {
        pad.width = w;
        widthsBox.querySelectorAll('.sp-width').forEach((o) => o.classList.toggle('on', o === b));
      });
      widthsBox.appendChild(b);
    });

    root.querySelector('#spClose').addEventListener('click', close);
    root.addEventListener('click', (e) => { if (e.target === root) close(); });
    root.querySelector('#spUndo').addEventListener('click', () => {
      if (pad.active) { pad.active = null; redraw(); saveDraft(); return; }
      pad.strokes.pop();
      redraw();
      saveDraft();
    });
    root.querySelector('#spClear').addEventListener('click', () => {
      pad.strokes = [];
      pad.active = null;
      redraw();
      clearDraft();
    });
    root.querySelector('#spSubmit').addEventListener('click', submitDrawing);

    bindDrawing();
  }

  function fit() {
    if (!canvas) return;
    const box = canvas.parentElement;
    const w = box.clientWidth || 600;
    const h = box.clientHeight || 400;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    redraw();
  }

  function paintBase() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 均匀小点
    const step = 22 * dpr;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
    const r = Math.max(1.2, dpr * 1.2);
    for (let y = step; y < canvas.height; y += step) {
      for (let x = step; x < canvas.width; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function strokePath(st) {
    if (!st.points.length) return;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.width;
    ctx.beginPath();
    const p0 = st.points[0];
    ctx.moveTo(p0.x, p0.y);
    if (st.points.length === 1) { ctx.lineTo(p0.x + 0.1, p0.y + 0.1); }
    else for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
    ctx.stroke();
  }

  function redraw() {
    if (!ctx) return;
    paintBase();
    for (const st of pad.strokes) strokePath(st);
    if (pad.active) strokePath(pad.active);
  }

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function bindDrawing() {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pad.active = { color: pad.color, width: pad.width, points: [pos(e)] };
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!pad.active) return;
      pad.active.points.push(pos(e));
      redraw();
    });
    const end = () => {
      if (!pad.active) return;
      if (pad.active.points.length) pad.strokes.push(pad.active);
      pad.active = null;
      redraw();
      saveDraft();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  function open() {
    if (!root) buildDom();
    const titleEl = document.getElementById('detailProblemName');
    root.querySelector('#spTitle').textContent = titleEl ? titleEl.textContent.trim() : 'Scratchpad';

    const stmtEl = document.getElementById('statementContent');
    root.querySelector('#spStatement').innerHTML = stmtEl ? stmtEl.innerHTML : '';
    try { if (window.PD && PD.renderMath) PD.renderMath(root.querySelector('#spStatement')); } catch (e) {}

    root.querySelector('#spStatus').textContent = '';
    root.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // 恢复这道题上次没交出去的笔迹
    const draft = loadDraft();
    pad.strokes = [];
    pad.active = null;
    setTimeout(() => {
      fit();
      if (draft.length) {
        // 存的坐标是 0-1，按当前画布尺寸还原
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        pad.strokes = draft.map((st) => ({
          color: st.color,
          width: st.width,
          points: st.points.map((p) => ({ x: p.x * w, y: p.y * h })),
        }));
        redraw();
      }
    }, 30);
  }

  function close() {
    saveDraft();
    if (root) root.style.display = 'none';
    document.body.style.overflow = '';
  }

  // 把画布塞进工作台的 photo 面板，再触发原本的提交
  function submitDrawing() {
    const status = root.querySelector('#spStatus');
    const btn = root.querySelector('#spSubmit');

    // 有没有画东西：检查像素里有没有非白点
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let inked = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) { inked = true; break; }
    }
    if (!inked) { status.textContent = 'Draw something first'; return; }

    const imageData = canvas.toDataURL('image/jpeg', 0.9);

    const wb = window.__PD_EXTRAS__ && window.__PD_EXTRAS__.workbench;
    const checkBtn = document.getElementById('checkAnswerBtn');
    if (!wb || !checkBtn) { status.textContent = 'Workbench not ready — reload the page'; return; }

    // 贴到 photo 面板
    wb.imageData = imageData;
    const previewImg = document.getElementById('imagePreview');
    const preview = document.getElementById('wbPhotoPreview');
    const dropzone = document.getElementById('wbDropzone');
    if (previewImg) previewImg.src = imageData;
    if (preview) preview.hidden = false;
    if (dropzone) dropzone.hidden = true;
    wb.setMode('photo');

    // 交出去了就不留草稿，下次打开是干净的
    clearDraft();

    btn.disabled = true;
    status.textContent = 'Submitting…';

    // 把页面上工作台的状态变化同步到覆盖层的状态行
    const statusBox = document.getElementById('wbStatus');
    const sync = () => {
      if (statusBox && statusBox.textContent) status.textContent = statusBox.textContent.slice(0, 160);
    };
    let observer = null;
    if (statusBox && window.MutationObserver) {
      observer = new MutationObserver(sync);
      observer.observe(statusBox, { childList: true, characterData: true, subtree: true });
    }

    checkBtn.click();

    // 提交结束（按钮重新可点）后停掉观察
    const stop = setInterval(() => {
      sync();
      if (!checkBtn.disabled || btn.disabled === false) { /* noop */ }
      if (!checkBtn.disabled) {
        clearInterval(stop);
        if (observer) observer.disconnect();
        btn.disabled = false;
        if (!status.textContent || status.textContent === 'Submitting…') status.textContent = 'Submitted';
      }
    }, 800);
    setTimeout(() => {
      clearInterval(stop);
      if (observer) observer.disconnect();
      btn.disabled = false;
    }, 180000);
  }

  function ensureCss() {
    if (document.getElementById('spCss')) return;
    const l = document.createElement('link');
    l.id = 'spCss';
    l.rel = 'stylesheet';
    l.href = '/assets/css/pd-scratchpad.css' + (window.__BUILD_V ? '?v=' + window.__BUILD_V : '');
    document.head.appendChild(l);
  }

  function mount() {
    ensureCss();
    const btn = document.getElementById('submissionsBtn');
    if (!btn || document.getElementById('scratchpadBtn')) return;
    const sp = el('button', 'wb-btn-secondary', '<i class="fas fa-tablet-screen-button"></i> Scratchpad');
    sp.type = 'button';
    sp.id = 'scratchpadBtn';
    sp.title = 'Open a full-screen scratchpad';
    sp.addEventListener('click', open);
    btn.parentNode.insertBefore(sp, btn);
  }

  window.addEventListener('resize', () => {
    if (root && root.style.display === 'flex') fit();
  });

  // 题目正文是异步渲染的，按钮不一定立刻在。轮询等它出现，不要押在某一次定时上。
  function waitAndMount() {
    if (document.getElementById('scratchpadBtn')) return;
    const btn = document.getElementById('submissionsBtn');
    if (btn) { mount(); return; }
    mount();
    if (!document.getElementById('scratchpadBtn')) setTimeout(waitAndMount, 300);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(waitAndMount, 200));
  } else {
    setTimeout(waitAndMount, 200);
  }
  // 换题（SPA 式重渲染）时按钮会被重建，再补几次
  setTimeout(waitAndMount, 1200);
  setTimeout(waitAndMount, 3000);
})();
