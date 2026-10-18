// pd-mcq.js — PDF viewer + MCQ answer sheet
// ═══════════════════════════════════════════════════════════════════
// 依賴：window.PD（由 pd-script.js 提供）
// 暴露：window.__PD_MCQ__ = { init, loadPdfJs, ... }
//
// 注意：樣式由 pd-script.js 的 loadMcq() 先載入 /css/pd-pdf.css
//      這裡不再 injectStyle
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const PD = window.PD;
  if (!PD) { console.error('[pd-mcq] window.PD missing'); return; }
  const { esc, loadScript, getTopbarHeight, clampInt } = PD;

  // ─────────────────────────────────────────────────────────────
  // PDF.js 載入
  // ─────────────────────────────────────────────────────────────
  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    if (!window.pdfjsLib) throw new Error('pdfjsLib not found');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    return window.pdfjsLib;
  }

  let _pdfRenderToken = 0;
  let _pdfCurrentDoc  = null;

  async function renderPdfWithPdfJs(container, pdfUrl) {
    const token = ++_pdfRenderToken;
    if (_pdfCurrentDoc) { try { _pdfCurrentDoc.destroy(); } catch {} _pdfCurrentDoc = null; }

    const oldScrollTop = container.scrollTop || 0;
    container.innerHTML = '<div class="pdf-loading"><span class="spinner"></span> Loading PDF...</div>';

    let pdfjsLib;
    try {
      pdfjsLib = await loadPdfJs();
    } catch {
      if (token !== _pdfRenderToken) return;
      container.innerHTML = `<div class="pdf-error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load PDF viewer</p><a href="${esc(pdfUrl)}" target="_blank" rel="noopener">Open in new tab</a></div>`;
      return;
    }
    if (token !== _pdfRenderToken) return;

    try {
      const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise;
      if (token !== _pdfRenderToken) { try { pdf.destroy(); } catch {} return; }
      _pdfCurrentDoc = pdf;
      container.innerHTML = '';

      const dpr = window.devicePixelRatio || 1;
      const containerWidth = (container.clientWidth || container.offsetWidth || 800) - 8;

      for (let n = 1; n <= pdf.numPages; n++) {
        if (token !== _pdfRenderToken) return;
        const page = await pdf.getPage(n);
        if (token !== _pdfRenderToken) return;
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (containerWidth / unscaled.width) * dpr });
        const canvas = document.createElement('canvas');
        canvas.width  = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width  = Math.floor(viewport.width  / dpr) + 'px';
        canvas.style.height = Math.floor(viewport.height / dpr) + 'px';
        canvas.className = 'pdf-page-canvas';
        container.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
      if (token === _pdfRenderToken && oldScrollTop > 0) {
        requestAnimationFrame(() => { container.scrollTop = oldScrollTop; });
      }
    } catch {
      if (token !== _pdfRenderToken) return;
      container.innerHTML = `<div class="pdf-error"><i class="fas fa-exclamation-triangle"></i><p>Failed to load PDF</p><a href="${esc(pdfUrl)}" target="_blank" rel="noopener">Open in new tab</a></div>`;
    }
  }

  function toGooglePreviewUrl(url) {
    if (!url || !/^https:\/\/(docs|drive)\.google\.com\//.test(url)) return null;
    const drive = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
    if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
    const docs = url.match(/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([^/?#]+)/);
    if (docs) return `https://docs.google.com/${docs[1]}/d/${docs[2]}/preview`;
    return null;
  }

  // ─────────────────────────────────────────────────────────────
  // 拖曳 / 縮放
  // ─────────────────────────────────────────────────────────────
  function makeDraggable(el, handle) {
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handle.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      dragging = true;
      const r = el.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY;
      ox = r.left;    oy = r.top;
      el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
      el.style.right = 'auto';       el.style.bottom = 'auto';
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging) return;
      const minTop = getTopbarHeight();
      el.style.left = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  ox + e.clientX - sx)) + 'px';
      el.style.top  = Math.max(minTop, Math.min(window.innerHeight - el.offsetHeight, oy + e.clientY - sy)) + 'px';
    });
    const end = e => { if (dragging) { dragging = false; try { handle.releasePointerCapture(e.pointerId); } catch {} } };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function makeResizable(el, handle, minW = 260, minH = 200) {
    let resizing = false, sx = 0, sy = 0, sw = 0, sh = 0;
    handle.addEventListener('pointerdown', e => {
      resizing = true;
      sx = e.clientX; sy = e.clientY;
      sw = el.offsetWidth; sh = el.offsetHeight;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault(); e.stopPropagation();
    });
    handle.addEventListener('pointermove', e => {
      if (!resizing) return;
      el.style.width     = Math.max(minW, sw + e.clientX - sx) + 'px';
      el.style.height    = Math.max(minH, sh + e.clientY - sy) + 'px';
      el.style.maxHeight = 'none';
    });
    const end = e => { if (resizing) { resizing = false; try { handle.releasePointerCapture(e.pointerId); } catch {} } };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function applyFloatingInitialLayout(el) {
    const topbarH = getTopbarHeight();
    const isMobile = window.innerWidth <= 768;
    el.style.left = 'auto';
    el.style.right = 'auto';
    if (isMobile) {
      el.style.width    = Math.min(window.innerWidth - 16, 320) + 'px';
      el.style.right    = '8px';
      el.style.top      = (topbarH + 8) + 'px';
      el.style.maxHeight = '55vh';
    } else {
      el.style.width    = '400px';
      el.style.right    = '40px';
      el.style.top      = Math.max(topbarH + 20, 100) + 'px';
      el.style.maxHeight = '75vh';
    }
  }

  // ─────────────────────────────────────────────────────────────
  // PDF + MCQ 掛載
  // ─────────────────────────────────────────────────────────────
  function mountPdfQuizSplit() {
    const pdfMount = document.getElementById('pdf-quiz-split');
    if (!pdfMount) return;
    const pdfUrl = pdfMount.dataset.pdf;
    if (!pdfUrl) return;

    let absolutePdfUrl;
    try { absolutePdfUrl = new URL(pdfUrl, location.href).href; }
    catch { absolutePdfUrl = pdfUrl; }
    const googlePreviewUrl = toGooglePreviewUrl(absolutePdfUrl);

    // ⭐ 不再 injectStyle（CSS 已由 loadMcq 載入）

    const quizMount = document.getElementById('mc-quiz-mount');
    const hasQuiz   = !!quizMount;

    const stage = document.createElement('div');
    stage.className = 'pdf-quiz-stage';
    pdfMount.parentNode.insertBefore(stage, pdfMount);
    stage.appendChild(pdfMount);
    pdfMount.classList.add('pdf-quiz-left');

    pdfMount.innerHTML = `
      <div class="pdf-viewer-header">
        <span class="pdf-viewer-title">📄 ${googlePreviewUrl ? 'Google Drive' : 'PDF'}</span>
        <div class="pdf-viewer-actions">
          ${hasQuiz ? '<button class="mcq-toggle-btn" id="toggleMcqBtn"><i class="fas fa-clipboard-list"></i> Answer Sheet</button>' : ''}
          <a href="${esc(absolutePdfUrl)}" target="_blank" rel="noopener" class="pdf-open-btn">
            <i class="fas fa-external-link-alt"></i> Open
          </a>
        </div>
      </div>
      ${googlePreviewUrl
        ? `<iframe class="pdf-google-frame" src="${esc(googlePreviewUrl)}" allow="autoplay" referrerpolicy="no-referrer"></iframe>`
        : `<div class="pdf-pages-scroll" id="pdf-pages-scroll"></div>`}`;

    if (!googlePreviewUrl) {
      const scroll = pdfMount.querySelector('.pdf-pages-scroll');
      renderPdfWithPdfJs(scroll, absolutePdfUrl);
      scroll.dataset.pdfUrl = absolutePdfUrl;

      if (window.ResizeObserver) {
        if (window.__pdfResizeObserver) { try { window.__pdfResizeObserver.disconnect(); } catch {} }
        let lastWidth = Math.floor(scroll.clientWidth);
        let rt = null;
        window.__pdfResizeObserver = new ResizeObserver(entries => {
          for (const e of entries) {
            const w = Math.floor(e.contentRect.width);
            if (Math.abs(w - lastWidth) < 100) continue;
            lastWidth = w;
            clearTimeout(rt);
            rt = setTimeout(() => {
              const sc = document.getElementById('pdf-pages-scroll');
              if (sc?.dataset.pdfUrl) renderPdfWithPdfJs(sc, sc.dataset.pdfUrl);
            }, 500);
          }
        });
        window.__pdfResizeObserver.observe(scroll);
      }
    }

    if (hasQuiz) {
      const floating = document.createElement('div');
      floating.className = 'mcq-floating-window';
      floating.id = 'mcqFloatingWindow';
      floating.style.display = 'none';

      const header = document.createElement('div');
      header.className = 'mcq-float-header';
      header.id = 'mcqDragHandle';
      header.innerHTML = `
        <span><i class="fas fa-grip-vertical mcq-drag-icon"></i><i class="fas fa-clipboard-list"></i> Answer Sheet</span>
        <button class="mcq-close-btn" id="closeMcqBtn" title="Close">✕</button>`;

      const body = document.createElement('div');
      body.className = 'mcq-float-body';
      quizMount.parentNode.removeChild(quizMount);
      body.appendChild(quizMount);

      floating.appendChild(header);
      floating.appendChild(body);

      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'mcq-resize-handle';
      resizeHandle.title = 'Drag to resize';
      floating.appendChild(resizeHandle);
      document.body.appendChild(floating);

      applyFloatingInitialLayout(floating);
      makeDraggable(floating, header);
      makeResizable(floating, resizeHandle, 260, 200);

      let _lastW = window.innerWidth;
      window.addEventListener('resize', () => {
        if (Math.abs(window.innerWidth - _lastW) < 100) return;
        _lastW = window.innerWidth;
        if (!floating.style.left || floating.style.left === 'auto') applyFloatingInitialLayout(floating);
      });

      const toggleBtn = document.getElementById('toggleMcqBtn');
      const closeBtn  = document.getElementById('closeMcqBtn');
      const showBtnLabel = () => { if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-clipboard-list"></i> Answer Sheet'; };
      const hideBtnLabel = () => { if (toggleBtn) toggleBtn.innerHTML = '<i class="fas fa-times"></i> Hide Answer'; };

      toggleBtn?.addEventListener('click', () => {
        const hidden = floating.style.display === 'none';
        floating.style.display = hidden ? 'flex' : 'none';
        hidden ? hideBtnLabel() : showBtnLabel();
      });
      closeBtn?.addEventListener('click', () => {
        floating.style.display = 'none';
        showBtnLabel();
      });
    }

    // paper-mount 內部：隱藏舊的分割/畫板
    const stmtContent = document.getElementById('statementContent');
    if (stmtContent) { stmtContent.style.flex = '1 1 100%'; stmtContent.style.maxWidth = '100%'; }
    const splitDivider = document.getElementById('splitDivider');
    if (splitDivider) splitDivider.style.display = 'none';
    const drawpadWrapper = document.getElementById('drawpadWrapper');
    if (drawpadWrapper) drawpadWrapper.style.display = 'none';
  }

  // ─────────────────────────────────────────────────────────────
  // MCQ 答案表
  // ─────────────────────────────────────────────────────────────
  function mountMcQuiz() {
    const mount = document.getElementById('mc-quiz-mount');
    if (!mount) return;

    // ⭐ 不再 injectStyle（CSS 已由 loadMcq 載入）

    const TOTAL   = clampInt(mount.dataset.total,   1, 200, 45);
    const OPTIONS = clampInt(mount.dataset.options, 2, 26,  4);
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, OPTIONS);
    const LETTER_SET = new Set(LETTERS.split(''));
    const SEP_EVERY = 5;

    const headerCells = ['<th>#</th>', ...LETTERS.split('').map(ch => `<th>${ch}</th>`)];
    let html = `
      <p style="color:var(--text-secondary);font-size:.85rem;margin:.3rem 0 .6rem 0;">
        Select one option (${LETTERS.split('').join('/')}) for each question. Unanswered → <code>X</code>.
      </p>
      <table class="mc-table${OPTIONS > 4 ? ' mc-many-options' : ''}">
        <thead><tr>${headerCells.join('')}</tr></thead><tbody>`;

    for (let i = 1; i <= TOTAL; i++) {
      const sep = (i % SEP_EVERY === 0 && i < TOTAL) ? ' class="mc-sep"' : '';
      let row = `<tr${sep}><td>${i}</td>`;
      for (const ch of LETTERS) row += `<td><input type="radio" name="mcq-${i}" value="${ch}"></td>`;
      html += row + '</tr>';
    }
    html += `</tbody></table><button id="mc-submit-btn" class="mc-submit-btn">submit</button>`;
    mount.innerHTML = html;

    const answerInputEl = document.getElementById('answerInput');

    function syncRadiosFromInput() {
      const str = (answerInputEl?.value || '').trim().toUpperCase();
      for (let i = 1; i <= TOTAL; i++) {
        const ch = str[i - 1];
        mount.querySelectorAll(`input[name="mcq-${i}"]`).forEach(r => { r.checked = false; });
        if (ch && LETTER_SET.has(ch)) {
          const radio = mount.querySelector(`input[name="mcq-${i}"][value="${ch}"]`);
          if (radio) radio.checked = true;
        }
      }
    }
    function syncInputFromRadios() {
      let ans = '';
      for (let i = 1; i <= TOTAL; i++) {
        const sel = mount.querySelector(`input[name="mcq-${i}"]:checked`);
        ans += sel ? sel.value : 'X';
      }
      ans = ans.replace(/X+$/, '');
      if (answerInputEl) answerInputEl.value = ans;
    }

    answerInputEl?.addEventListener('input', syncRadiosFromInput);

    mount.querySelectorAll('input[type="radio"]').forEach(r => {
      r.addEventListener('mousedown', function () { this.dataset.wasChecked = this.checked ? '1' : '0'; });
      r.addEventListener('click', function () {
        if (this.dataset.wasChecked === '1') { this.checked = false; this.dataset.wasChecked = '0'; }
        syncInputFromRadios();
      });
      r.addEventListener('change', syncInputFromRadios);
    });

    mount.querySelectorAll('.mc-table td').forEach(td => {
      const radio = td.querySelector('input[type="radio"]');
      if (!radio) return;
      td.style.cursor = 'pointer';
      td.addEventListener('click', e => {
        if (e.target === radio) return;
        if (radio.checked) { radio.checked = false; }
        else {
          mount.querySelectorAll(`input[name="${radio.name}"]`).forEach(r => { r.checked = false; });
          radio.checked = true;
        }
        syncInputFromRadios();
      });
    });

    syncRadiosFromInput();

    mount.querySelector('#mc-submit-btn')?.addEventListener('click', () => {
      let answer = '';
      for (let i = 1; i <= TOTAL; i++) {
        const sel = mount.querySelector(`input[name="mcq-${i}"]:checked`);
        answer += sel ? sel.value : 'X';
      }
      // ⭐ extras 可能還沒載完，用可選鏈
      PD.workbench?.setMode?.('text');
      document.getElementById('answerInput').value = answer;
      document.getElementById('checkAnswerBtn')?.click();
    });
  }

  // ─────────────────────────────────────────────────────────────
  // 生命週期
  // ─────────────────────────────────────────────────────────────
  window.addEventListener('pagehide', () => {
    if (window.__pdfResizeObserver) {
      try { window.__pdfResizeObserver.disconnect(); } catch {}
      window.__pdfResizeObserver = null;
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 對外 API
  // ─────────────────────────────────────────────────────────────
  window.__PD_MCQ__ = {
    init() {
      mountPdfQuizSplit();
      mountMcQuiz();   // 不存在 mc-quiz-mount 時會自己 return
    },
    loadPdfJs,
    makeDraggable,
    makeResizable,
    applyFloatingInitialLayout,
  };
})();