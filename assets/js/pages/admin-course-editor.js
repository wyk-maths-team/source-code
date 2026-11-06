// 课程编辑器：/admin/create/course（新建） 与 /admin/course/:id?track=M（编辑）
(function () {
  'use strict';
  const u = getCurrentUser();
  if (!u || (u.role !== 'admin' && u.role !== 'root')) { location.href = '/index.html'; return; }
  Page.boot({ title: 'Course Editor', requireAuth: true });

  const parts = location.pathname.split('/').filter(Boolean);   // admin/(create/course|course/:id)
  const isEdit = parts[1] === 'course' && parts[2] && parts[2] !== 'create';
  const originId = isEdit ? decodeURIComponent(parts[2]) : '';
  const queryTrack = new URLSearchParams(location.search).get('track') || '';

  const el = (id) => document.getElementById(id);
  const trackSel = el('ceTrack');
  const idInput = el('ceId');
  const topicInput = el('ceTopic');
  const diffSel = el('ceDifficulty');
  const contentInput = el('ceContent');
  const saveBtn = el('ceSave');
  const msg = el('ceMsg');
  const preview = el('cePreview');

  function setMsg(text, kind) {
    msg.textContent = text || '';
    msg.className = 'ce-msg' + (kind ? ' ' + kind : '');
  }

  // KaTeX 是 defer 脚本，第一次预览时可能还没就绪
  function renderMath(node) {
    if (!node) return;
    const once = () => {
      if (typeof window.renderMathInElement !== 'function') return false;
      try {
        window.renderMathInElement(node, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '$', right: '$', display: false },
          ],
          throwOnError: false,
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
        });
      } catch (e) { /* ignore */ }
      return true;
    };
    if (once()) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (once() || ++tries > 50) clearInterval(timer);
    }, 100);
  }

  // 预览：把 <div pid> 换成占位框，保证布局和真页面一致
  function updatePreview() {
    if (!preview) return;
    preview.innerHTML = contentInput.value || '<p style="color:var(--text-secondary);">Nothing to preview yet.</p>';

    preview.querySelectorAll('[pid]').forEach((ph) => {
      const stub = document.createElement('div');
      stub.className = 'ce-prob-stub';
      stub.innerHTML = '<i class="fas fa-square-poll-vertical"></i> Problem <b>' +
        ph.getAttribute('pid').replace(/[<>&"]/g, '') + '</b> will render here';
      ph.replaceWith(stub);
    });

    renderMath(preview);
  }

  let previewTimer = null;
  contentInput.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 300);
  });

  async function loadExisting() {
    if (!isEdit) { setMsg(''); return; }
    if (!queryTrack) { setMsg('Missing ?track= — open this from the course list.', 'err'); saveBtn.disabled = true; return; }

    try {
      const data = await API.get('/api/course?action=adminGet&track=' + encodeURIComponent(queryTrack) + '&id=' + encodeURIComponent(originId));
      const c = data.course;
      trackSel.value = c.track;
      idInput.value = c.id;
      topicInput.value = c.topic || '';
      diffSel.value = c.difficulty || 'easy';
      contentInput.value = c.content || '';
      updatePreview();
      hydratePdf(c.pdf);
    } catch (e) {
      setMsg(e.message || 'Failed to load course', 'err');
      saveBtn.disabled = true;
    }
  }

  saveBtn.addEventListener('click', async () => {
    const track = trackSel.value;
    const id = idInput.value.trim();
    const topic = topicInput.value.trim();
    const difficulty = diffSel.value;
    const content = contentInput.value;

    if (!id) { setMsg('ID is required', 'err'); return; }

    saveBtn.disabled = true;
    setMsg('Saving…', '');

    try {
      if (isEdit) {
        const res = await API.post('/api/course?action=adminUpdate', {
          track: queryTrack, id: originId, newId: id, topic, difficulty, content, pdf: collectPdf(),
        });
        if (!res.success) throw new Error(res.message || 'Save failed');
        setMsg('Saved', 'ok');
        if (id !== originId) {
          // id 改了，URL 同步更新
          history.replaceState(null, '', '/admin/course/' + encodeURIComponent(id) + '?track=' + encodeURIComponent(track));
        }
      } else {
        const res = await API.post('/api/course?action=adminCreate', { track, id, topic, difficulty, content, pdf: collectPdf() });
        if (!res.success) throw new Error(res.message || 'Create failed');
        setMsg('Created', 'ok');
        setTimeout(() => { location.href = '/admin/course'; }, 600);
      }
    } catch (e) {
      setMsg(e.message || 'Save failed', 'err');
    } finally {
      saveBtn.disabled = false;
    }
  });


  // ═══════════════ PDF 版面编辑器 ═══════════════
  // 课程可以附加一份 PDF：每页上叠加若干答案框，框按顺序消耗 ID 模板。
  const PDFJS_VER = '3.11.174';
  const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/';
  const pdfState = { url: '', idPrefix: '', idDigits: 3, boxes: [], doc: null, pageEls: [], adding: false };

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (window.__pdfjsLoading) return window.__pdfjsLoading;
    window.__pdfjsLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_CDN + 'pdf.min.js';
      s.onload = () => {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'pdf.worker.min.js'; } catch (e) {}
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('Failed to load pdf.js (network or CDN blocked)'));
      document.head.appendChild(s);
    });
    return window.__pdfjsLoading;
  }

  function nextPid(prefix, digits, index) {
    const p = String(prefix || '').trim();
    const n = String(index).padStart(Math.max(1, Number(digits) || 3), '0');
    return p + n;
  }

  function buildPdfPanel() {
    const host = contentInput && contentInput.closest('.ce-group, .form-group, .ce-field') || contentInput && contentInput.parentElement;
    if (!host) return;

    // 页预览留在正文流里（要滚动浏览），控制条做成右下角悬浮窗
    const wrap = document.createElement('div');
    wrap.className = 'ce-pdf-panel';
    wrap.style.cssText = 'margin-top:1.4rem;border:1px solid var(--border-color);border-radius:10px;padding:14px;background:var(--card-bg);';
    wrap.innerHTML = '<div style="font-size:.9rem;font-weight:700;margin-bottom:8px;">PDF pages</div>'
      + '<div id="cePdfPages" class="ce-pdf-pages"></div>';
    host.appendChild(wrap);

    const dock = document.createElement('div');
    dock.id = 'cePdfDock';
    dock.style.cssText = [
      'position:fixed;right:18px;bottom:18px;z-index:9998;width:300px;',
      'background:var(--card-bg);border:1px solid var(--border-color);border-radius:12px;',
      'box-shadow:0 10px 30px rgba(0,0,0,.22);font-size:.82rem;overflow:hidden;',
    ].join('');
    dock.innerHTML = [
      '<div id="cePdfDockHead" style="display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:move;',
      'background:rgba(142,92,247,.12);user-select:none;">',
      '  <strong style="font-size:.82rem;flex:1;">PDF boxes</strong>',
      '  <span id="cePdfDockCount" style="color:var(--text-secondary);font-size:.72rem;"></span>',
      '  <button type="button" id="cePdfDockToggle" title="Collapse" style="border:none;background:transparent;',
      'cursor:pointer;font-size:14px;line-height:1;color:var(--text-secondary);">–</button>',
      '</div>',
      '<div id="cePdfDockBody" style="padding:10px;display:flex;flex-direction:column;gap:7px;">',
      '  <div style="display:flex;gap:6px;">',
      '    <input id="cePdfUrl" placeholder="/assets/paper.pdf" style="flex:1;min-width:0;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-color);color:var(--text-primary);font-size:.78rem;">',
      '    <button type="button" id="cePdfLoad" class="btn btn-secondary" style="padding:6px 10px;font-size:.78rem;">Load</button>',
      '  </div>',
      '  <div style="display:flex;gap:6px;">',
      '    <input id="cePdfPrefix" placeholder="prefix M207" style="flex:1;min-width:0;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-color);color:var(--text-primary);font-size:.78rem;">',
      '    <input id="cePdfDigits" type="number" min="1" max="6" value="3" title="Digits" style="width:58px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-color);color:var(--text-primary);font-size:.78rem;">',
      '  </div>',
      '  <button type="button" id="cePdfAdd" class="btn btn-primary" style="padding:7px 10px;font-size:.82rem;font-weight:700;">+ Add box</button>',
      '  <div id="cePdfStatus" style="font-size:.72rem;color:var(--text-secondary);line-height:1.35;"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(dock);

    el('cePdfLoad').addEventListener('click', () => loadPdf(el('cePdfUrl').value.trim()));
    el('cePdfAdd').addEventListener('click', toggleAddMode);
    el('cePdfPrefix').addEventListener('input', () => { syncPids(); });
    el('cePdfDigits').addEventListener('input', () => { syncPids(); });

    // 折叠
    const body = el('cePdfDockBody');
    el('cePdfDockToggle').addEventListener('click', () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'flex' : 'none';
      el('cePdfDockToggle').textContent = hidden ? '–' : '+';
    });

    // 拖动标题栏移动悬浮窗
    const head = el('cePdfDockHead');
    let drag = null;
    head.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const rect = dock.getBoundingClientRect();
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      dock.style.right = 'auto';
      dock.style.bottom = 'auto';
      dock.style.left = rect.left + 'px';
      dock.style.top = rect.top + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      dock.style.left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.dx)) + 'px';
      dock.style.top = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - drag.dy)) + 'px';
    });
    window.addEventListener('mouseup', () => { drag = null; });
  }

  function pdfStatus(text, kind) {
    const s = el('cePdfStatus');
    if (!s) return;
    s.textContent = text || '';
    s.style.color = kind === 'err' ? 'var(--danger)' : 'var(--text-secondary)';
  }


  // ── 共同覆盖层：框不再钉在单页里，才能跨页 ──
  function pdfOverlay() {
    const host = el('cePdfPages');
    if (!host) return null;
    let ov = host.querySelector('.ce-pdf-overlay');
    if (!ov) {
      host.style.position = 'relative';
      ov = document.createElement('div');
      ov.className = 'ce-pdf-overlay';
      ov.style.cssText = 'position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;';
      host.appendChild(ov);
    }
    return ov;
  }

  // 把百分比坐标换算成相对 overlay 的像素
  function placeBoxEl(div, box) {
    const ov = pdfOverlay();
    const pages = pdfState.pageEls;
    if (!ov || !pages.length) return;
    const startIdx = Math.max(0, Number(box.page || 1) - 1);
    const endIdx = Math.max(startIdx, Number(box.pageEnd || box.page || 1) - 1);
    const pStart = pages[startIdx];
    const pEnd = pages[endIdx] || pStart;
    if (!pStart) return;
    const ovRect = ov.getBoundingClientRect();
    const baseTop = ovRect.top;
    const baseLeft = ovRect.left;
    const rS = pStart.getBoundingClientRect();
    const rE = pEnd.getBoundingClientRect();
    const y = Number(box.y) || 0;
    const isSpan = endIdx > startIdx;
    const topPx = (rS.top - baseTop) + rS.height * (y / 100);
    const bottomPx = isSpan
      ? (rE.top - baseTop) + rE.height * ((Number(box.yEnd) || 50) / 100)
      : (rS.top - baseTop) + rS.height * (((Number(box.y) || 0) + (Number(box.h) || 8)) / 100);
    const hPx = Math.max(36, bottomPx - topPx);
    div.style.top = topPx + 'px';
    div.style.height = hPx + 'px';
    // 左右留白相对页面算（覆盖层比页面宽，用百分比会伸出去）
    const px = Number.isFinite(Number(box.x)) ? Number(box.x) : 10;
    const pageLeft = rS.left - baseLeft;
    div.style.left = (pageLeft + rS.width * px / 100) + 'px';
    div.style.width = (rS.width * (100 - 2 * px) / 100) + 'px';
  }

  function renderBoxes() {
    const ov = pdfOverlay();
    if (!ov) return;
    ov.querySelectorAll('.ce-pdf-box').forEach((n) => n.remove());
    pdfState.boxes.forEach((box) => {
      const div = makeBoxEl(box);
      ov.appendChild(div);
      placeBoxEl(div, box);
    });
    updateBoxCount();
  }

  function makeBoxEl(box) {
    const div = document.createElement('div');
    div.className = 'ce-pdf-box';
    div.dataset.pid = box.pid;
    div.style.cssText = 'position:absolute;pointer-events:auto;'
      + 'border:1px dashed #8e5cf7;border-radius:6px;background:rgba(142,92,247,.10);'
      + 'display:flex;align-items:flex-start;justify-content:space-between;gap:4px;padding:2px 4px;box-sizing:border-box;overflow:hidden;';
    const tag = document.createElement('span');
    tag.textContent = box.pid + (box.pageEnd && box.pageEnd > box.page ? ' (p' + box.page + '→' + box.pageEnd + ')' : '');
    tag.style.cssText = 'font-size:10px;font-weight:700;color:#6a3fc9;background:rgba(255,255,255,.85);border-radius:3px;padding:0 3px;white-space:nowrap;';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Remove this box';
    del.style.cssText = 'border:none;background:#d93025;color:#fff;border-radius:3px;cursor:pointer;font-size:11px;line-height:1;padding:1px 5px;';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      // 删除不重排：其它框保留自己的编号，避免学生提交记录错位
      pdfState.boxes = pdfState.boxes.filter((b) => b !== box);
      renderBoxes();
    });
    div.appendChild(tag);
    div.appendChild(del);
    return div;
  }

  function updateBoxCount() {
    const n = pdfState.boxes.length;
    const pages = pdfState.pageEls.length;
    const spanN = pdfState.boxes.filter((b) => b.pageEnd && b.pageEnd > b.page).length;
    const cnt = el('cePdfDockCount');
    if (cnt) cnt.textContent = n + '/' + pages;
    pdfStatus(n
      ? n + ' box(es) on ' + pages + ' page(s)' + (spanN ? ' · ' + spanN + ' spanning' : '')
      : 'Press Add box, then click the page twice (top, then bottom). Drag past a page edge to span pages.');
  }

  // 下次可用的最小编号（跳过已经被占用的）
  function allocatePid() {
    const prefix = el('cePdfPrefix') ? el('cePdfPrefix').value : pdfState.idPrefix;
    const digits = el('cePdfDigits') ? Number(el('cePdfDigits').value) || 3 : pdfState.idDigits;
    const used = new Set(pdfState.boxes.map((b) => b.pid).filter(Boolean));
    for (let i = 1; i <= 9999; i++) {
      const pid = nextPid(prefix, digits, i);
      if (!used.has(pid)) return pid;
    }
    return nextPid(prefix, digits, used.size + 1);
  }

  // 新建框：只分配编号，不动其它框
  function assignPid(box) {
    box.pid = allocatePid();
    return box;
  }

  // 改了前缀 / 位数时才整体重排（用户明确换了模板）
  function syncPids() {
    const prefix = el('cePdfPrefix') ? el('cePdfPrefix').value : pdfState.idPrefix;
    const digits = el('cePdfDigits') ? Number(el('cePdfDigits').value) || 3 : pdfState.idDigits;
    pdfState.idPrefix = prefix;
    pdfState.idDigits = digits;
    const ordered = pdfState.boxes.slice().sort((a, b) => (a.page - b.page) || (a.y - b.y));
    ordered.forEach((b, i) => { b.pid = nextPid(prefix, digits, i + 1); });
    pdfState.boxes = ordered;
    renderBoxes();
  }

  async function loadPdf(url) {
    if (!url) { pdfStatus('Enter a PDF URL first', 'err'); return; }
    pdfState.url = url;
    pdfStatus('Loading PDF…');
    try {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ url, withCredentials: false }).promise;
      pdfState.doc = doc;
      buildPages(doc);
      pdfStatus(doc.numPages + ' page(s) loaded');
    } catch (e) {
      pdfStatus('Failed to load PDF: ' + (e && e.message ? e.message : e), 'err');
    }
  }

  function buildPages(doc) {
    const host = el('cePdfPages');
    if (!host) return;
    host.innerHTML = '';
    pdfState.pageEls = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pageEl = document.createElement('div');
      pageEl.className = 'ce-pdf-page';
      pageEl.dataset.page = String(i);
      pageEl.style.cssText = 'position:relative;margin:14px auto;max-width:720px;background:#fff;'
        + 'border:1px solid var(--border-color);border-radius:6px;overflow:hidden;aspect-ratio:1/1.414;';
      host.appendChild(pageEl);
      pdfState.pageEls.push(pageEl);
    }
    observePdfPages(doc);
    bindCanvasEvents();
    updateBoxCount();
  }

  function observePdfPages(doc) {
    if (!('IntersectionObserver' in window)) {
      pdfState.pageEls.forEach((p, i) => paintPage(doc, i + 1, p));
      return;
    }
    if (pdfState._io) pdfState._io.disconnect();
    pdfState._io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const pageEl = en.target;
        pdfState._io.unobserve(pageEl);
        paintPage(doc, Number(pageEl.dataset.page), pageEl);
      });
    }, { rootMargin: '600px 0px' });
    pdfState.pageEls.forEach((p) => pdfState._io.observe(p));
  }

  async function paintPage(doc, pageNo, pageEl) {
    if (pageEl.dataset.painted === '1') return;
    pageEl.dataset.painted = '1';
    try {
      const page = await doc.getPage(pageNo);
      const vp = page.getViewport({ scale: 3.0 });   // 编辑器用最高清，画框才对得准
      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.cssText = 'display:block;width:100%;height:auto;';
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      pageEl.insertBefore(canvas, pageEl.firstChild);
      pageEl.style.aspectRatio = String(vp.width) + ' / ' + String(vp.height);
      requestAnimationFrame(renderBoxes);   // 尺寸定下来后重排框
    } catch (e) {
      pdfStatus('Page ' + pageNo + ' failed: ' + (e && e.message ? e.message : e), 'err');
    }
  }


  // ── 画框交互：按 Add → 点页面定起点 → 移动鼠标看高度 → 再点固定 ──
  // 支持跨页：鼠标拖到下一页再点，框就会跨过去
  let dragState = null;   // { startPage, startY, endPage, endY }

  function toggleAddMode() {
    pdfState.adding = !pdfState.adding;
    const btn = el('cePdfAdd');
    if (btn) btn.classList.toggle('active', pdfState.adding);
    if (pdfState.adding) {
      if (!pdfState.doc) { pdfState.adding = false; pdfStatus('Load a PDF first', 'err'); return; }
      pdfStatus('Click to set the top, move (even onto the next page), click again to fix the bottom.');
    } else {
      dragState = null;
      const g = document.querySelector('.ce-pdf-ghost');
      if (g) g.remove();
      updateBoxCount();
    }
  }

  function pageUnderPointer(e) {
    const list = pdfState.pageEls;
    for (let i = 0; i < list.length; i++) {
      const r = list[i].getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return list[i];
    }
    return null;
  }

  function relY(pageEl, clientY) {
    const r = pageEl.getBoundingClientRect();
    return Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100));
  }

  function ensureGhost() {
    const ov = pdfOverlay();
    if (!ov) return null;
    let g = ov.querySelector('.ce-pdf-ghost');
    if (!g) {
      g = document.createElement('div');
      g.className = 'ce-pdf-box ce-pdf-ghost';
      g.style.cssText = 'position:absolute;pointer-events:none;left:10%;width:80%;'
        + 'border:1px dashed #8e5cf7;background:rgba(142,92,247,.18);border-radius:6px;';
      ov.appendChild(g);
    }
    return g;
  }

  function updateGhost() {
    if (!dragState) return;
    const g = ensureGhost();
    if (!g) return;
    placeBoxEl(g, {
      page: dragState.startPage,
      pageEnd: dragState.endPage,
      y: dragState.startY,
      yEnd: dragState.endY,
      h: 0, x: 10,
    });
    // 落笔前就把要用的编号显示出来
    const label = allocatePid();
    g.textContent = label;
    g.style.display = 'flex';
    g.style.alignItems = 'flex-start';
    g.style.justifyContent = 'flex-start';
    g.style.padding = '2px 4px';
    g.style.fontSize = '10px';
    g.style.fontWeight = '700';
    g.style.color = '#6a3fc9';
    g.style.boxSizing = 'border-box';
  }

  function bindCanvasEvents() {
    const host = el('cePdfPages');
    if (!host || host.dataset.bound === '1') return;
    host.dataset.bound = '1';

    host.addEventListener('mousemove', (e) => {
      if (!dragState) return;
      const pageEl = pageUnderPointer(e);
      if (!pageEl) return;
      dragState.endPage = Number(pageEl.dataset.page);
      dragState.endY = relY(pageEl, e.clientY);
      updateGhost();
    });

    host.addEventListener('click', (e) => {
      if (!pdfState.adding) return;
      if (e.target.closest('.ce-pdf-box') && !e.target.closest('.ce-pdf-ghost')) return;

      const pageEl = pageUnderPointer(e);
      if (!pageEl) return;
      const pageNo = Number(pageEl.dataset.page);
      const yNow = relY(pageEl, e.clientY);

      if (!dragState) {
        dragState = { startPage: pageNo, startY: yNow, endPage: pageNo, endY: Math.min(100, yNow + 3) };
        updateGhost();
        return;
      }

      let startPage = dragState.startPage;
      let endPage = pageNo;
      let startY = dragState.startY;
      let endY = yNow;

      if (endPage === startPage && endY < startY) { const t = startY; startY = endY; endY = t; }
      if (endPage < startPage) {
        const tp = startPage; startPage = endPage; endPage = tp;
        const ty = startY; startY = endY; endY = ty;
      }

      const ghost = document.querySelector('.ce-pdf-ghost');
      if (ghost) ghost.remove();
      dragState = null;

      const isSpan = endPage > startPage;
      const newBox = {
        page: startPage,
        x: 10,
        y: Math.round(startY * 100) / 100,
        h: isSpan ? 0 : Math.round(Math.max(3, endY - startY) * 100) / 100,
        pageEnd: endPage,
        yEnd: Math.round(endY * 100) / 100,
      };
      assignPid(newBox);              // 用最小未用编号，不影响已有框
      pdfState.boxes.push(newBox);
      renderBoxes();

      pdfState.adding = false;
      const btn = el('cePdfAdd');
      if (btn) btn.classList.remove('active');
    });
  }

  // 收集给后端的 pdf 数据
  function collectPdf() {
    if (!pdfState.url) return null;
    return {
      url: pdfState.url,
      idPrefix: pdfState.idPrefix,
      idDigits: pdfState.idDigits,
      boxes: pdfState.boxes.map((b) => ({
        pid: b.pid, page: b.page, x: b.x,
        y: b.y,
        h: (b.pageEnd && b.pageEnd > b.page) ? 0 : b.h,
        pageEnd: b.pageEnd || b.page,
        yEnd: (b.yEnd == null ? null : b.yEnd),
      })),
    };
  }

  function hydratePdf(pdf) {
    if (!pdf) return;
    pdfState.url = pdf.url || '';
    pdfState.idPrefix = pdf.idPrefix || '';
    pdfState.idDigits = Number(pdf.idDigits) || 3;
    pdfState.boxes = Array.isArray(pdf.boxes) ? pdf.boxes.map((b) => ({ ...b })) : [];
    if (el('cePdfUrl')) el('cePdfUrl').value = pdfState.url;
    if (el('cePdfPrefix')) el('cePdfPrefix').value = pdfState.idPrefix;
    if (el('cePdfDigits')) el('cePdfDigits').value = String(pdfState.idDigits);
    if (pdfState.url) loadPdf(pdfState.url).then(() => renderBoxes());
  }

  Page.ready(async () => {
    if (isEdit) {
      document.getElementById('ceTitle').textContent = 'Edit Course';
      if (queryTrack) trackSel.value = queryTrack;
      idInput.value = originId;
    }
    buildPdfPanel();
    await loadExisting();
    updatePreview();
  });
})();
