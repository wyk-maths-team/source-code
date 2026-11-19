// assets/js/pd-mc-sheet.js —— 选择题卷子：整份 PDF + 覆盖式答题
//
// 用法（由 pd-script 在题目加载后调用）：
//   MCSHEET.mount({
//     host,                 // 放 PDF 的容器
//     pdfUrl,               // 整份卷子的地址（GitHub raw / Cloudinary 都行）
//     layout,               // { page, box:{x,y,w,h}, options:[{key,x,y,r}] }
//     picks,                // 已选答案 { A: true } 之类，key 是题号
//     onPick(pid, key),     // 点了某个圈
//     onCheck(pid),         // 点了某题的 check
//     onSubmit(),           // 页尾 Submit
//   })
//
// 坐标全部是 0-1 比例（相对该页渲染后的宽高），所以换分辨率不会错位。

(function () {
  'use strict';
  if (window.MCSHEET) return;

  let pdfjsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pdfjsPromise = null;
        reject(new Error('pdf.js timed out'));
      }, 15000);
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      s.onload = () => {
        clearTimeout(t);
        if (!window.pdfjsLib) return reject(new Error('pdfjsLib missing'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => {
        clearTimeout(t);
        pdfjsPromise = null;
        reject(new Error('pdf.js failed to load'));
      };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }

  // 解析度：跟 settings 里的 pdfQuality 走，默认 1.5
  function qualityScale() {
    const raw = Number(localStorage.getItem('pdfQuality'));
    if (Number.isFinite(raw) && raw > 0) return Math.min(3, Math.max(0.75, raw));
    return 1.5;
  }

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /**
   * 把一份 PDF 渲染到容器里，返回每一页的包装元素（下标 0 = 第 1 页）。
   */
  async function renderPdf(host, pdfUrl) {
    // 先把 loading 摆出来：pdf.js 是从 CDN 拉的，慢的时候不能让人对着空白页
    host.innerHTML = '<div class="mcs-loading"><span class="spinner"></span> Loading PDF viewer…</div>';
    const lib = await loadPdfJs();
    host.innerHTML = '<div class="mcs-loading"><span class="spinner"></span> Rendering pages…</div>';

    const pdf = await lib.getDocument({ url: pdfUrl }).promise;
    host.innerHTML = '';

    const width = (host.clientWidth || 900) - 8;
    const scale = qualityScale();
    const pages = [];

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const unscaled = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / unscaled.width) * scale });

      const wrap = el('div', 'mcs-page');
      wrap.dataset.page = String(n);

      const canvas = el('canvas', 'mcs-canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = Math.floor(vp.width / scale) + 'px';
      canvas.style.height = Math.floor(vp.height / scale) + 'px';

      const overlay = el('div', 'mcs-overlay');
      wrap.appendChild(canvas);
      wrap.appendChild(overlay);
      host.appendChild(wrap);
      pages.push({ wrap, overlay });

      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }

    return pages;
  }

  /**
   * 在某一页上画题目层：一个透明答题框 + 四个选项圈。
   * 返回 { setPick(key), markResult(ok) } 供外部驱动状态。
   */
  function drawQuestion(pageEl, layout, opts) {
    const { keyLabel, picked, onPick, onCheck, showCheck } = opts;
    const overlay = pageEl.overlay;

    const boxEl = el('div', 'mcs-box');
    boxEl.style.left = (layout.box.x * 100) + '%';
    boxEl.style.top = (layout.box.y * 100) + '%';
    boxEl.style.width = (layout.box.w * 100) + '%';
    boxEl.style.height = (layout.box.h * 100) + '%';
    overlay.appendChild(boxEl);

    const tag = el('div', 'mcs-tag');
    tag.textContent = keyLabel;
    boxEl.appendChild(tag);

    const circles = [];
    for (const o of layout.options) {
      const c = el('button', 'mcs-opt');
      c.type = 'button';
      c.dataset.key = o.key;
      c.textContent = o.key;
      // 圆心定位：left/top 是圆心，用 transform 回退半个直径
      c.style.left = (o.x * 100) + '%';
      c.style.top = (o.y * 100) + '%';
      c.style.width = (o.r * 200) + '%';   // r 是半径（相对页宽），直径 = 2r
      c.style.transform = 'translate(-50%, -50%)';
      if (picked === o.key) c.classList.add('picked');
      c.addEventListener('click', (e) => {
        e.preventDefault();
        onPick && onPick(o.key);
      });
      overlay.appendChild(c);
      circles.push(c);
    }

    let checkBtn = null;
    if (showCheck) {
      checkBtn = el('button', 'mcs-check');
      checkBtn.type = 'button';
      checkBtn.title = 'Check this question';
      checkBtn.innerHTML = '<i class="fas fa-check"></i>';
      // 放在 A 圈左边
      const a = layout.options[0];
      checkBtn.style.left = ((a.x - a.r * 2.4) * 100) + '%';
      checkBtn.style.top = (a.y * 100) + '%';
      checkBtn.style.transform = 'translate(-50%, -50%)';
      checkBtn.addEventListener('click', (e) => {
        e.preventDefault();
        onCheck && onCheck();
      });
      overlay.appendChild(checkBtn);
    }

    return {
      setPick(key) {
        circles.forEach(c => c.classList.toggle('picked', c.dataset.key === key));
      },
      setChecking(on) {
        if (!checkBtn) return;
        checkBtn.disabled = !!on;
        checkBtn.innerHTML = on
          ? '<i class="fas fa-circle-notch fa-spin"></i>'
          : '<i class="fas fa-check"></i>';
      },
      markResult(ok) {
        circles.forEach(c => {
          c.classList.remove('right', 'wrong');
          if (c.dataset.key !== picked) return;
          c.classList.add(ok ? 'right' : 'wrong');
        });
      },
      clearResult() {
        circles.forEach(c => c.classList.remove('right', 'wrong'));
      },
    };
  }

  window.MCSHEET = { renderPdf, drawQuestion, loadPdfJs, qualityScale };
})();
