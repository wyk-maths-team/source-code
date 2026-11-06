// assets/js/pages/course.js —— 课程页（/course、/course/:track、/course/:track/:id）
(function () {
  'use strict';

  if (!isLoggedIn()) { location.href = '/index.html'; return; }

  Page.boot({ title: 'Course', requireAuth: true });

  const TRACKS = {
    M:  { label: 'Compulsory', desc: 'Core DSE-level foundations', cls: 'track-M'  },
    M2: { label: 'Extended',   desc: 'Beyond the syllabus',        cls: 'track-M2' },
    MO: { label: 'Olympiad',   desc: 'Competition training',       cls: 'track-MO' },
  };

  const DIFF_LABEL = {
    easy: 'Easy', medium: 'Medium', hard: 'Hard',
    challenging: 'Challenging', insane: 'Insane',
  };

  const root = document.getElementById('courseRoot');

  // 草稿：直接复用题目页 steps 输入框的存储（pd_workbench_drafts:<pid>），
  // 所以在课程里写了一半，去题目页还能接着写，反之亦然。
  const DRAFTS_KEY = 'pd_workbench_drafts';
  function readStepsDraft(pid) {
    try {
      const raw = localStorage.getItem(DRAFTS_KEY + ':' + pid);
      if (!raw) return '';
      return JSON.parse(raw)?.steps || '';
    } catch { return ''; }
  }
  function writeStepsDraft(pid, val) {
    try {
      const key = DRAFTS_KEY + ':' + pid;
      const cur = JSON.parse(localStorage.getItem(key) || '{}') || {};
      const s = String(val == null ? '' : val);
      if (s) cur.steps = s; else delete cur.steps;
      if (Object.keys(cur).length) localStorage.setItem(key, JSON.stringify(cur));
      else localStorage.removeItem(key);
    } catch { /* 配额满了就算了 */ }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[m]);
  }

  function parseRoute() {
    const parts = location.pathname.split('/').filter(Boolean);  // ['course', 'M', '1']
    if (parts[0] !== 'course') return { view: 'tracks' };
    if (parts.length === 1) return { view: 'tracks' };
    if (parts.length === 2) return { view: 'list', track: decodeURIComponent(parts[1]) };
    return { view: 'course', track: decodeURIComponent(parts[1]), id: decodeURIComponent(parts[2]) };
  }

  function crumbs(items) {
    return '<div class="course-crumbs">' + items.map((it, i) => {
      const sep = i ? '<i class="fas fa-chevron-right" style="font-size:.62rem;opacity:.5;"></i>' : '';
      return sep + (it.href
        ? '<a href="' + it.href + '">' + esc(it.text) + '</a>'
        : '<span>' + esc(it.text) + '</span>');
    }).join('') + '</div>';
  }

  // KaTeX 是 defer 脚本，可能在第一次渲染时还没就绪 —— 轮询等它
  function renderMath(el) {
    if (!el) return;
    const once = () => {
      if (typeof window.renderMathInElement !== 'function') return false;
      try {
        window.renderMathInElement(el, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '$', right: '$', display: false },
          ],
          throwOnError: false,
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
        });
      } catch (e) { /* 单次失败不抛给用户 */ }
      return true;
    };
    if (once()) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (once() || ++tries > 50) clearInterval(timer);
    }, 100);
  }

  // ─────────── 三张卡片 ───────────
  async function renderTracks() {
    root.classList.remove('wide');
    root.innerHTML = crumbs([{ text: 'Course' }]) +
      '<div class="course-tracks">' + Object.entries(TRACKS).map(([code, t]) => `
        <a class="track-card ${t.cls}" href="/course/${code}">
          <div class="tc-code">${esc(code)}</div>
          <div class="tc-name">${esc(t.label)}</div>
          <div class="tc-sub">${esc(t.desc)}</div>
        </a>`).join('') + '</div>';

    // 顺带把三个领域的课程数拉出来
    try {
      const counts = await Promise.all(Object.keys(TRACKS).map(async (code) => {
        const r = await API.get('/api/course?action=list&track=' + code);
        return { code, n: (r.courses || []).length };
      }));
      counts.forEach(({ code, n }) => {
        const card = root.querySelector('.track-card[href="/course/' + code + '"]');
        if (!card) return;
        const el = document.createElement('div');
        el.className = 'tc-count';
        el.textContent = n + (n === 1 ? ' lesson' : ' lessons');
        card.appendChild(el);
      });
    } catch (e) { /* 数量拿不到不影响卡片 */ }
  }

  // ─────────── 某个领域的课程列表 ───────────
  async function renderList(track) {
    root.classList.remove('wide');
    const t = TRACKS[track];
    if (!t) { root.innerHTML = '<div class="course-empty">Unknown track.</div>'; return; }

    root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: t.label }]) +
      '<div class="course-empty"><span class="spinner"></span> Loading…</div>';

    let data;
    try { data = await API.get('/api/course?action=list&track=' + encodeURIComponent(track)); }
    catch (e) { root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: t.label }]) + '<div class="course-empty">Failed to load.</div>'; return; }

    const courses = data.courses || [];
    if (!courses.length) {
      root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: t.label }]) +
        '<div class="course-empty">No lessons here yet.</div>';
      return;
    }

    const rows = courses.map((c) => {
      const pct = c.total ? Math.round(c.solved / c.total * 100) : 0;
      const cls = pct >= 100 ? 'p-green' : (pct >= 50 ? 'p-yellow' : 'p-red');
      return `
        <tr>
          <td class="col-id">${esc(c.id)}</td>
          <td class="col-topic">
            <a href="/course/${encodeURIComponent(track)}/${encodeURIComponent(c.id)}">${esc(c.topic || '(untitled)')}</a>
          </td>
          <td class="col-progress">
            <div class="progbar ${cls}"><i style="width:${pct}%"></i></div>
            <div class="progbar-text">${c.solved} / ${c.total}</div>
          </td>
          <td class="col-diff"><span class="diff-chip diff-${esc(c.difficulty)}">${esc(DIFF_LABEL[c.difficulty] || c.difficulty)}</span></td>
        </tr>`;
    }).join('');

    root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: t.label }]) + `
      <table class="course-table">
        <thead><tr>
          <th class="col-id">ID</th>
          <th class="col-topic">Topic</th>
          <th class="col-progress">Progress</th>
          <th class="col-diff">Difficulty</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ─────────── 单节教程 ───────────
  async function renderCourse(track, id) {
    const t = TRACKS[track];
    if (!t) { root.innerHTML = '<div class="course-empty">Unknown track.</div>'; return; }

    // 详情页铺满可用宽度
    root.classList.add('wide');

    root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: t.label, href: '/course/' + track }, { text: id }]) +
      '<div class="course-empty"><span class="spinner"></span> Loading…</div>';

    let data;
    try { data = await API.get('/api/course?action=get&track=' + encodeURIComponent(track) + '&id=' + encodeURIComponent(id)); }
    catch (e) {
      root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: t.label, href: '/course/' + track }, { text: id }]) +
        '<div class="course-empty">Course not found.</div>';
      return;
    }

    const c = data.course;
    const pids = c.pids || [];
    const solved = new Set(c.solvedPids || []);

    root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: t.label, href: '/course/' + track }, { text: c.topic || c.id }]) + `
      <div class="course-body">
        <div class="course-title-row">
          <h1 class="course-topic">${esc(c.topic || c.id)}</h1>
          <span class="diff-chip diff-${esc(c.difficulty)}">${esc(DIFF_LABEL[c.difficulty] || c.difficulty)}</span>
          <span style="margin-left:auto;font-size:.8rem;color:var(--text-secondary);">${solved.size} / ${pids.length} problems solved</span>
          <button type="button" class="course-reset" title="Clear this lesson's progress">
            <i class="fas fa-rotate-left"></i> Reset
          </button>
        </div>
        <div class="course-content" id="courseContent">${c.content || ''}</div>
      </div>`;

    const contentEl = document.getElementById('courseContent');
    renderMath(contentEl);

    // PDF 版式（如果有）+ 滚动位置
    const scrollKey = 'courseScroll:' + track + '/' + id;
    mountPdf(c, solved).finally(function () {
      try {
        const y = Number(localStorage.getItem(scrollKey) || 0);
        if (y > 0) setTimeout(function () { window.scrollTo({ top: y, behavior: 'auto' }); }, 250);
      } catch (e) {}
    }).catch(function () {});

    let scrollTimer = null;
    window.removeEventListener('scroll', window.__courseScrollHandler || (function () {}));
    window.__courseScrollHandler = function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        try { localStorage.setItem(scrollKey, String(window.scrollY)); } catch (e) {}
      }, 300);
    };
    window.addEventListener('scroll', window.__courseScrollHandler, { passive: true });

    // 重置这门课的进度
    root.querySelector('.course-reset')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (!confirm('Reset progress for this lesson?')) return;
      btn.disabled = true;
      try {
        const res = await API.post('/api/course?action=reset', { track, id });
        if (!res.success) throw new Error(res.message || 'Reset failed');
        if (window.DSHUI) DSHUI.toast('Progress reset', 'ok');
        location.reload();
      } catch (err) {
        if (window.DSHUI) DSHUI.toast(err.message || 'Reset failed', 'err');
        btn.disabled = false;
      }
    });

    // 把 <div pid="X"></div> 换成题目卡片
    // 有的课有上百道题，一次性全部拉取会把接口打爆 —— 进入视口前 400px 才加载
    const placeholders = [...contentEl.querySelectorAll('[pid]')];

    const observer = ('IntersectionObserver' in window)
      ? new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            const card = entry.target;
            loadInlineProblem(card, card.dataset.pid, card.dataset.solved === '1');
          });
        }, { rootMargin: '400px 0px' })
      : null;

    placeholders.forEach((ph) => {
      const pid = ph.getAttribute('pid');
      if (!pid) return;
      const card = document.createElement('div');
      card.className = 'inline-problem';
      card.dataset.pid = pid;
      card.dataset.solved = solved.has(pid) ? '1' : '0';
      card.innerHTML = '<div class="ip-head"><span class="ip-tag">' + esc(pid) + '</span><span class="ip-status">Waiting…</span></div>';
      ph.replaceWith(card);

      if (observer) observer.observe(card);
      else loadInlineProblem(card, pid, solved.has(pid));
    });
  }

  // ─────────── 内嵌题目 ───────────
  async function loadInlineProblem(card, pid, alreadySolved) {
    let problem = null;
    try {
      const r = await API.get('/api/problem?action=page&id=' + encodeURIComponent(pid));
      problem = r.problem;
    } catch (e) {
      card.innerHTML = '<div class="ip-head"><span class="ip-tag">' + esc(pid) + '</span>'
        + '<span class="ip-status err">Problem not available</span></div>';
      return;
    }

    const badge = alreadySolved
      ? '<span class="ip-badge solved"><i class="fas fa-check"></i> Solved</span>'
      : '<span class="ip-badge todo">Not solved</span>';

    card.innerHTML = `
      <div class="ip-head">
        <span class="ip-tag">${esc(pid)}</span>
        <span style="font-weight:600;">${esc(problem.name || '')}</span>
        ${badge}
      </div>
      <div class="ip-statement">${problem.statement || ''}</div>
      <div class="ip-input-row">
        <textarea placeholder="Write your steps here — the AI grades the reasoning, not just the answer."></textarea>
      </div>
      <div class="ip-draft-note" style="display:none;padding:0 16px 8px;font-size:.74rem;color:var(--text-secondary);">
        <i class="fas fa-floppy-disk"></i> Draft restored
      </div>
      <div class="ip-actions">
        <button type="button" class="ip-submit">Submit to AI</button>
        <span class="ip-status"></span>
      </div>`;

    renderMath(card.querySelector('.ip-statement'));

    const textarea = card.querySelector('textarea');
    const btn = card.querySelector('.ip-submit');
    const statusEl = card.querySelector('.ip-actions .ip-status');

    // 恢复这道题上次的草稿（和题目页共用一个 key）
    const draft = readStepsDraft(pid);
    if (draft) {
      textarea.value = draft;
      const note = card.querySelector('.ip-draft-note');
      if (note) { note.style.display = ''; note.textContent = 'Draft restored'; }
    }

    // 输入即存；清空则删掉
    let draftTimer = null;
    textarea.addEventListener('input', () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        writeStepsDraft(pid, textarea.value);
        const note = card.querySelector('.ip-draft-note');
        if (note) note.style.display = textarea.value.trim() ? '' : 'none';
      }, 300);
    });
    textarea.addEventListener('blur', () => writeStepsDraft(pid, textarea.value));

    btn.addEventListener('click', async () => {
      const steps = textarea.value.trim();
      if (!steps) { statusEl.textContent = 'Write something first.'; statusEl.className = 'ip-status err'; return; }

      btn.disabled = true;
      statusEl.textContent = 'Submitting…';
      statusEl.className = 'ip-status';

      try {
        const res = await API.post('/api/steps-grade', { problemId: pid, steps });
        if (!res || !res.success) throw new Error(res && res.message ? res.message : 'Submit failed');

        if (res.status === 'done') {
          showResult(card, res.result, res.subid);
        } else if (res.taskId) {
          statusEl.textContent = 'Grading… (this can take a minute)';
          pollGrade(card, res.taskId);
        } else {
          throw new Error('Unexpected response');
        }
      } catch (e) {
        statusEl.textContent = e.message || 'Submit failed';
        statusEl.className = 'ip-status err';
        btn.disabled = false;
      }
    });
  }


  // ═══════════════ PDF 版式（学生端）═══════════════
  const PDFJS_VER = '3.11.174';
  const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/build/';

  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (window.__pdfjsLoading) return window.__pdfjsLoading;
    window.__pdfjsLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_CDN + 'pdf.min.js';
      s.onload = function () {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_CDN + 'pdf.worker.min.js'; } catch (e) {}
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error('pdf.js failed to load')); };
      document.head.appendChild(s);
    });
    return window.__pdfjsLoading;
  }

  const PDF_BOX_STYLE = 'position:absolute;left:10%;width:80%;border:1px solid var(--border-color);'
    + 'border-radius:8px;background:rgba(255,255,255,.96);box-shadow:0 2px 10px rgba(0,0,0,.12);'
    + 'display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;';
  const PDF_BOX_DARK = '[data-theme="dark"] .pdf-box{background:rgba(30,34,42,.97);}';

  function mountPdf(course, solved) {
    var pdf = course && course.pdf;
    if (!pdf || !pdf.url) return Promise.resolve();

    var holder = document.getElementById('coursePdf');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'coursePdf';
      holder.className = 'course-pdf';
      var contentEl = document.getElementById('courseContent');
      if (contentEl && contentEl.parentNode) contentEl.parentNode.insertBefore(holder, contentEl);
      else root.appendChild(holder);
    }

    holder.innerHTML = '<div style="padding:12px;color:var(--text-secondary);font-size:.85rem;"><span class="spinner"></span> Loading PDF…</div>';

    return loadPdfJs().then(function (pdfjs) {
      return pdfjs.getDocument({ url: pdf.url, withCredentials: false }).promise;
    }).then(function (doc) {
      holder.innerHTML = '';
      var pages = [];
      for (var i = 1; i <= doc.numPages; i++) {
        var pageEl = document.createElement('div');
        pageEl.className = 'pdf-page';
        pageEl.dataset.page = String(i);
        pageEl.style.cssText = 'position:relative;margin:16px auto;max-width:760px;background:#fff;'
          + 'border:1px solid var(--border-color);border-radius:8px;overflow:hidden;aspect-ratio:1/1.414;';
        pageEl.appendChild(document.createElement('div'));
        holder.appendChild(pageEl);
        pages.push(pageEl);
      }

      // 共同覆盖层：跨页的答案框必须跳出单页容器，否则会被 overflow:hidden 裁掉
      var overlay = document.createElement('div');
      overlay.className = 'pdf-overlay';
      overlay.style.cssText = 'position:absolute;left:0;right:0;top:0;bottom:0;pointer-events:none;';
      holder.appendChild(overlay);

      // 懒加载：只看视口附近的页
      var io = null;
      var paint = function (pageEl) {
        if (pageEl.dataset.painted === '1') return;
        pageEl.dataset.painted = '1';
        var n = Number(pageEl.dataset.page);
        doc.getPage(n).then(function (page) {
          // 清晰度由用户在 /settings 选（1.6 省流 ~ 3.0 最清晰）
          var qScale = 2.2;
          try {
            var saved = parseFloat(localStorage.getItem('pdfRenderScale'));
            if (isFinite(saved) && saved >= 1.4 && saved <= 3.2) qScale = saved;
          } catch (e) {}
          var vp = page.getViewport({ scale: qScale });
          var canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.cssText = 'display:block;width:100%;height:auto;';
          return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function () {
            pageEl.insertBefore(canvas, pageEl.firstChild);
            pageEl.style.aspectRatio = vp.width + ' / ' + vp.height;
            return page.getTextContent().then(function (tc) {
              pageEl.dataset.text = (tc.items || []).map(function (it) { return it.str; }).join(' ').slice(0, 3500);
            }).catch(function () {});
          });
        }).catch(function () {
          pageEl.dataset.painted = '0';
        });
      };

      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            io.unobserve(en.target);
            paint(en.target);
          });
        }, { rootMargin: '700px 0px' });
        pages.forEach(function (p) { io.observe(p); });
      } else {
        pages.forEach(paint);
      }

      // 叠加答案框（统一放进 overlay，用像素坐标定位，支持跨页）
      var boxEls = [];
      (pdf.boxes || []).forEach(function (box) {
        var pageEl = pages[box.page - 1];
        if (!pageEl) return;
        var el = makeAnswerBox(box, pageEl, solved);
        el.dataset.page = String(box.page);
        el.dataset.pageEnd = String(box.pageEnd || box.page);
        el.dataset.y = String(box.y);
        el.dataset.h = String(box.h);
        el.dataset.yEnd = String(box.yEnd == null ? '' : box.yEnd);
        el.dataset.x = String(box.x == null ? 10 : box.x);
        el.style.position = 'absolute';
        el.style.pointerEvents = 'auto';
        overlay.appendChild(el);
        boxEls.push(el);
      });

      // 把百分比坐标换算成相对 overlay 的像素
      var layoutBoxes = function () {
        if (!overlay) return;
        var baseRect = overlay.getBoundingClientRect();
        var baseTop = baseRect.top;
        var baseLeft = baseRect.left;
        boxEls.forEach(function (el) {
          var startIdx = Number(el.dataset.page) - 1;
          var endIdx = Number(el.dataset.pageEnd) - 1;
          var pStart = pages[startIdx];
          var pEnd = pages[endIdx] || pStart;
          if (!pStart) return;
          var rStart = pStart.getBoundingClientRect();
          var rEnd = pEnd.getBoundingClientRect();
          var y = Number(el.dataset.y) || 0;
          var h = Number(el.dataset.h) || 8;
          var yEndRaw = el.dataset.yEnd;
          var isSpan = endIdx > startIdx;
          var topPx = (rStart.top - baseTop) + rStart.height * (y / 100);
          var bottomPx = isSpan
            ? (rEnd.top - baseTop) + rEnd.height * ((Number(yEndRaw) || 50) / 100)
            : (rStart.top - baseTop) + rStart.height * ((y + h) / 100);
          if (bottomPx - topPx < 36) bottomPx = topPx + 36;
          el.style.top = topPx + 'px';
          el.style.height = (bottomPx - topPx) + 'px';
          // 左右留白要相对「页面」算，不是相对覆盖层 —— 覆盖层比页面宽，
          // 直接用百分比会让框伸出页面边缘
          var px = Number(el.dataset.x);
          if (!Number.isFinite(px)) px = 10;
          var pageLeft = rStart.left - baseLeft;
          var pageW = rStart.width;
          el.style.left = (pageLeft + pageW * px / 100) + 'px';
          el.style.width = (pageW * (100 - 2 * px) / 100) + 'px';
          el.dataset.span = isSpan ? '1' : '0';
        });
      };

      layoutBoxes();
      window.addEventListener('resize', layoutBoxes);
      if ('ResizeObserver' in window) {
        try { new ResizeObserver(layoutBoxes).observe(holder); } catch (e) {}
      }

      return doc;
    }).catch(function (e) {
      holder.innerHTML = '<div style="padding:14px;color:var(--danger);font-size:.85rem;">'
        + 'Could not load the PDF: ' + esc(e && e.message ? e.message : String(e)) + '</div>';
    });
  }

  // 轻量画板：白底 canvas + 指针绘制；支持笔色 / 橡皮 / 粗细 / 撤销
  // 笔画以「路径列表」保存，撤销只要重绘，比存 ImageData 省内存
  function createDrawPad(host, storageKey) {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:crosshair;'
      + 'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var state = { color: '#111111', width: 2, erase: false };
    var strokes = [];     // { color, width, erase, points: [{x,y}] }
    var ready = false;
    var dpr = window.devicePixelRatio || 1;

    // ── 本地存档：按 pid 存，刷新页面不丢 ──
    var saveTimer = null;
    function persist() {
      if (!storageKey) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        try {
          if (!strokes.length) { localStorage.removeItem(storageKey); return; }
          var payload = {
            v: 1,
            strokes: strokes.map(function (st) {
              return {
                c: st.color, w: st.width, e: !!st.erase,
                p: st.points.map(function (pt) {
                  return [Math.round(pt.x * 10) / 10, Math.round(pt.y * 10) / 10];
                }),
              };
            }),
          };
          var json = JSON.stringify(payload);
          if (json.length > 400000) return;   // 太大就放弃，别把 localStorage 撑爆
          localStorage.setItem(storageKey, json);
        } catch (e) { /* 配额满 / 隐私模式，忽略 */ }
      }, 400);
    }

    function restore() {
      if (!storageKey) return;
      try {
        var raw = localStorage.getItem(storageKey);
        if (!raw) return;
        var data = JSON.parse(raw);
        if (!data || !Array.isArray(data.strokes)) return;
        strokes = data.strokes.map(function (st) {
          return {
            color: st.c || '#111111',
            width: Number(st.w) || 2,
            erase: !!st.e,
            points: (st.p || []).map(function (pt) {
              return { x: Number(pt[0]) || 0, y: Number(pt[1]) || 0 };
            }),
          };
        }).filter(function (st) { return st.points.length; });
        redraw();
      } catch (e) { /* 存档坏了就当没有 */ }
    }

    function clearStorage() {
      if (!storageKey) return;
      try { localStorage.removeItem(storageKey); } catch (e) {}
    }

    function paintBase() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }

    function strokePath(st) {
      if (!st.points.length) return;
      ctx.strokeStyle = st.erase ? '#ffffff' : st.color;
      ctx.lineWidth = st.erase ? Math.max(10, st.width * 5) : st.width;
      ctx.beginPath();
      ctx.moveTo(st.points[0].x, st.points[0].y);
      if (st.points.length === 1) {
        // 单点：画一个小圆点
        ctx.lineTo(st.points[0].x + 0.1, st.points[0].y);
      } else {
        for (var i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x, st.points[i].y);
      }
      ctx.stroke();
    }

    function redraw() {
      paintBase();
      for (var i = 0; i < strokes.length; i++) strokePath(strokes[i]);
      // 正在画的多条笔画
      active.forEach(function (st) { strokePath(st); });
    }

    function fit() {
      var w = host.clientWidth || 300;
      var h = host.clientHeight || 120;
      if (w < 10 || h < 10) return;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ready = true;
      redraw();     // 尺寸变了，按路径重画，笔迹不丢
    }

    function pos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // 多指：每个 pointerId 维护自己的笔画（照 draw.js 的做法），互不干扰
    var active = new Map();          // pointerId -> stroke

    // 落笔时锁住整页的文本选择，收笔再放开；
    // 这样手指/鼠标滑出画板也不会顺带选中 PDF 上的文字
    var savedUserSelect = null;
    function lockSelection() {
      if (active.size !== 0) return;
      savedUserSelect = document.body.style.userSelect || '';
      document.body.style.userSelect = 'none';
      try { window.getSelection().removeAllRanges(); } catch (err) {}
    }
    function unlockSelection() {
      if (active.size !== 0 || savedUserSelect === null) return;
      document.body.style.userSelect = savedUserSelect;
      savedUserSelect = null;
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (!ready) fit();
      if (active.has(e.pointerId)) return;
      lockSelection();
      active.set(e.pointerId, {
        color: state.color,
        width: state.width,
        erase: state.erase,
        points: [pos(e)],
      });
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      redraw();
      e.preventDefault();
    });

    canvas.addEventListener('pointermove', function (e) {
      var st = active.get(e.pointerId);
      if (!st) return;               // 这个指针没按在画布上
      st.points.push(pos(e));
      redraw();
      e.preventDefault();
    });

    function endPointer(e) {
      var st = active.get(e.pointerId);
      if (!st) return;
      if (st.points.length) strokes.push(st);
      active.delete(e.pointerId);
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      redraw();
      unlockSelection();
      persist();
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    // 手势被系统打断时，把这根手指的笔画收尾
    window.addEventListener('blur', function () {
      if (!active.size) return;
      active.forEach(function (st) { if (st.points.length) strokes.push(st); });
      active.clear();
      redraw();
      unlockSelection();
    });

    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(function () { fit(); });
      ro.observe(host);
    }

    return {
      canvas: canvas,
      fit: fit,
      setColor: function (c) { state.color = c; state.erase = false; },
      setWidth: function (w) { state.width = w; },
      setErase: function (on) { state.erase = !!on; },
      getState: function () { return { color: state.color, width: state.width, erase: state.erase }; },
      undo: function () {
        if (active.size) { active.clear(); redraw(); return true; }
        if (!strokes.length) return false;
        strokes.pop();
        redraw();
        persist();
        return true;
      },
      canUndo: function () { return strokes.length > 0 || active.size > 0; },
      count: function () { return strokes.length; },
      clear: function () { strokes = []; active.clear(); redraw(); clearStorage(); },
      isEmpty: function () {
        for (var i = 0; i < strokes.length; i++) {
          if (!strokes[i].erase) return false;   // 有非橡皮的笔画才算有内容
        }
        return active.size === 0;
      },
      toDataUrl: function () {
        try { return canvas.toDataURL('image/jpeg', 0.85); } catch (e) { return ''; }
      },
      restore: restore,
      persist: persist,
    };
  }

  function makeAnswerBox(box, pageEl, solved) {
    var wrap = document.createElement('div');
    wrap.className = 'pdf-box';
    wrap.dataset.pid = box.pid;
    wrap.style.cssText = PDF_BOX_STYLE + 'top:' + box.y + '%;height:' + box.h + '%;';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 6px;font-size:10px;font-weight:700;'
      + 'color:var(--text-secondary);background:rgba(142,92,247,.10);flex:0 0 auto;';
    head.innerHTML = '<span>' + esc(box.pid) + '</span>'
      + (solved && solved.has(box.pid) ? '<span style="color:#27a567;">✓ solved</span>' : '')
      + '<span class="pdf-mode-switch" style="margin-left:auto;display:inline-flex;gap:2px;">'
      + '<button type="button" class="pdf-mode-btn active" data-mode="text" style="padding:1px 7px;border-radius:4px;border:1px solid var(--border-color);background:var(--card-bg);color:var(--text-primary);font-size:9px;cursor:pointer;">Text</button>'
      + '<button type="button" class="pdf-mode-btn" data-mode="draw" style="padding:1px 7px;border-radius:4px;border:1px solid var(--border-color);background:transparent;color:var(--text-secondary);font-size:9px;cursor:pointer;">Draw</button>'
      + '</span>';

    var ta = document.createElement('textarea');
    ta.className = 'pdf-box-input';
    ta.placeholder = 'Your steps…';
    ta.style.cssText = 'flex:1 1 auto;min-height:36px;resize:none;border:none;outline:none;padding:4px 6px;'
      + 'background:transparent;color:var(--text-primary);font-size:12px;font-family:inherit;';

    // ── 画板（Draw 模式）──
    var padWrap = document.createElement('div');
    padWrap.className = 'pdf-box-pad';
    padWrap.style.cssText = 'display:none;flex:1 1 auto;min-height:36px;position:relative;background:#fff;overflow:hidden;'
      + 'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';
    var pad = createDrawPad(padWrap, 'pdfPad:' + box.pid);
    // ── 画板工具栏：颜色 / 橡皮 / 粗细 / 撤销 / 清空 ──
    var padTools = document.createElement('div');
    padTools.className = 'pdf-pad-tools';
    padTools.style.cssText = 'position:absolute;left:3px;right:3px;top:3px;display:none;align-items:center;gap:4px;'
      + 'z-index:2;background:rgba(255,255,255,.92);border:1px solid #e0e0e0;border-radius:6px;padding:2px 4px;';

    var COLORS = ['#111111', '#d93025', '#1a73e8', '#27a567'];
    var widths = [1, 2, 4];
    var colorBtns = [];

    COLORS.forEach(function (c, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.dataset.color = c;
      b.style.cssText = 'width:13px;height:13px;border-radius:50%;border:1px solid #bbb;cursor:pointer;padding:0;'
        + 'background:' + c + ';' + (i === 0 ? 'outline:2px solid #8e5cf7;outline-offset:1px;' : '');
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        pad.setColor(c);
        colorBtns.forEach(function (o) {
          o.style.outline = (o.dataset.color === c) ? '2px solid #8e5cf7' : 'none';
          o.style.outlineOffset = '1px';
        });
        eraseBtn.style.outline = 'none';
        widthBtns[1].click();  // 选颜色时退出橡皮，恢复默认粗细
      });
      colorBtns.push(b);
      padTools.appendChild(b);
    });

    var sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:12px;background:#ddd;margin:0 2px;';
    padTools.appendChild(sep);

    // 粗细
    var widthBtns = [];
    widths.forEach(function (w, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = String(w);
      b.style.cssText = 'width:17px;height:15px;border-radius:3px;border:1px solid #ccc;background:#fff;color:#444;'
        + 'font-size:9px;line-height:1;cursor:pointer;padding:0;'
        + (i === 1 ? 'outline:2px solid #8e5cf7;' : '');
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        pad.setWidth(w);
        widthBtns.forEach(function (o) { o.style.outline = (o === b) ? '2px solid #8e5cf7' : 'none'; });
      });
      widthBtns.push(b);
      padTools.appendChild(b);
    });

    var sep2 = document.createElement('span');
    sep2.style.cssText = 'width:1px;height:12px;background:#ddd;margin:0 2px;';
    padTools.appendChild(sep2);

    // 橡皮
    var eraseBtn = document.createElement('button');
    eraseBtn.type = 'button';
    eraseBtn.textContent = 'Erase';
    eraseBtn.style.cssText = 'padding:0 5px;height:15px;border-radius:3px;border:1px solid #ccc;background:#fff;color:#444;'
      + 'font-size:9px;line-height:1;cursor:pointer;';
    eraseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var st = pad.getState();
      var next = !st.erase;
      pad.setErase(next);
      eraseBtn.style.outline = next ? '2px solid #8e5cf7' : 'none';
      colorBtns.forEach(function (o) { o.style.outline = next ? 'none' : (o.dataset.color === '#111111' ? '2px solid #8e5cf7' : 'none'); });
    });
    padTools.appendChild(eraseBtn);

    // 撤销
    var undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.textContent = 'Undo';
    undoBtn.style.cssText = 'padding:0 5px;height:15px;border-radius:3px;border:1px solid #ccc;background:#fff;color:#444;'
      + 'font-size:9px;line-height:1;cursor:pointer;';
    undoBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      pad.undo();
    });
    padTools.appendChild(undoBtn);

    // 清空
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'padding:0 5px;height:15px;border-radius:3px;border:1px solid #ccc;background:#fff;color:#555;'
      + 'font-size:9px;line-height:1;cursor:pointer;margin-left:auto;';
    clearBtn.addEventListener('click', function (e) { e.stopPropagation(); pad.clear(); });
    padTools.appendChild(clearBtn);

    padWrap.appendChild(padTools);
    pad.restore();

    var foot = document.createElement('div');
    foot.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 6px 4px;flex:0 0 auto;';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pdf-submit';
    btn.textContent = 'Submit';
    btn.style.cssText = 'padding:2px 10px;border-radius:5px;border:none;background:#8e5cf7;color:#fff;'
      + 'font-size:11px;font-weight:700;cursor:pointer;';
    var status = document.createElement('span');
    status.className = 'pdf-status';
    status.style.cssText = 'font-size:10px;color:var(--text-secondary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

    var comment = document.createElement('div');
    comment.className = 'pdf-box-comment';
    comment.style.cssText = 'display:none;padding:4px 6px 6px;font-size:11px;color:var(--text-primary);'
      + 'border-top:1px dashed var(--border-color);max-height:45%;overflow:auto;';

    foot.appendChild(btn);
    foot.appendChild(status);
    wrap.appendChild(head);
    wrap.appendChild(ta);
    wrap.appendChild(padWrap);
    wrap.appendChild(foot);
    wrap.appendChild(comment);

    // 草稿：和题目页共用同一个 key
    var draft = (function () {
      try {
        var raw = localStorage.getItem('pd_workbench_drafts:' + box.pid);
        return raw ? (JSON.parse(raw).steps || '') : '';
      } catch (e) { return ''; }
    })();
    if (draft) ta.value = draft;

    var timer = null;
    ta.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        try {
          var key = 'pd_workbench_drafts:' + box.pid;
          var cur = JSON.parse(localStorage.getItem(key) || '{}') || {};
          if (ta.value) cur.steps = ta.value; else delete cur.steps;
          if (Object.keys(cur).length) localStorage.setItem(key, JSON.stringify(cur));
          else localStorage.removeItem(key);
        } catch (e) {}
      }, 300);
    });

    var mode = 'text';

    // 模式切换
    wrap.querySelectorAll('.pdf-mode-btn').forEach(function (mb) {
      mb.addEventListener('click', function (e) {
        e.stopPropagation();
        var m = mb.dataset.mode;
        if (m === mode) return;
        mode = m;
        wrap.querySelectorAll('.pdf-mode-btn').forEach(function (o) {
          var on = o.dataset.mode === mode;
          o.classList.toggle('active', on);
          o.style.background = on ? 'var(--card-bg)' : 'transparent';
          o.style.color = on ? 'var(--text-primary)' : 'var(--text-secondary)';
        });
        var isDraw = mode === 'draw';
        ta.style.display = isDraw ? 'none' : '';
        padWrap.style.display = isDraw ? 'block' : 'none';
        padTools.style.display = isDraw ? 'flex' : 'none';
        if (isDraw) setTimeout(function () { pad.fit(); }, 30);
      });
    });

    btn.addEventListener('click', function () {
      btn.disabled = true;

      if (mode === 'draw') {
        if (pad.isEmpty()) { status.textContent = 'Draw something first'; btn.disabled = false; return; }
        var dataUrl = pad.toDataUrl();
        if (!dataUrl) { status.textContent = 'Could not export the drawing'; btn.disabled = false; return; }
        status.textContent = 'Uploading…';

        // 1) 以 image 类型提交（云端会存一份 submission）
        API.post('/api/submit', { problemId: box.pid, type: 'image', image: dataUrl })
          .then(function (sub) {
            if (!sub || !sub.success) throw new Error((sub && sub.message) || 'Submit failed');
            status.textContent = 'Grading…';
            // 2) 交给图片判分（同步返回结果）
            return API.post('/api/image-grade', {
              problemId: box.pid,
              subid: sub.subid,
              imageUrl: sub.imageUrl,
            });
          })
          .then(function (res) {
            if (!res || !res.success) throw new Error((res && res.message) || 'Grading failed');
            if (res.tokens && window.updateTopbarTokens) {
              window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
            }
            showBoxResult(wrap, res.result, res.subid);
          })
          .catch(function (e) {
            status.textContent = e.message || 'Failed';
            btn.disabled = false;
          });
        return;
      }

      var steps = ta.value.trim();
      if (!steps) { status.textContent = 'Write something first'; btn.disabled = false; return; }
      status.textContent = 'Submitting…';
      API.post('/api/steps-grade', {
        problemId: box.pid,
        steps: steps,
        autoCreate: true,
        statementHint: pageEl.dataset.text || '',
      }).then(function (res) {
        if (!res || !res.success) throw new Error(res && res.message ? res.message : 'Submit failed');
        if (res.status === 'done') return showBoxResult(wrap, res.result, res.subid);
        if (res.taskId) { status.textContent = 'Grading…'; return pollBox(wrap, res.taskId); }
        throw new Error('Unexpected response');
      }).catch(function (e) {
        status.textContent = e.message || 'Failed';
        btn.disabled = false;
      });
    });

    return wrap;
  }

  function showBoxResult(wrap, result, subid) {
    var score = Number(result && result.score);
    var ok = score === 100;
    var btn = wrap.querySelector('.pdf-submit');
    var statusEl = wrap.querySelector('.pdf-status');
    var box = wrap.querySelector('.pdf-box-comment');
    if (btn) btn.disabled = false;

    if (box) {
      box.style.display = 'block';
      box.innerHTML = '<strong>' + (ok ? 'Accepted' : 'Scored ' + (Number.isFinite(score) ? score : '?')) + '</strong>'
        + (result && result.comment ? '<div>' + esc(result.comment).replace(/\n/g, '<br>') + '</div>' : '')
        + (subid ? '<a href="/submissions/' + encodeURIComponent(subid) + '/detail" style="font-size:10px;">View</a>' : '');
      renderMath(box);
      if (ok) wrap.style.borderColor = '#27a567';
    }
    var head = wrap.firstChild;
    if (ok && head && !head.textContent.includes('✓')) {
      head.innerHTML += '<span style="color:#27a567;">✓ solved</span>';
    }
    if (statusEl) statusEl.textContent = ok ? 'Solved!' : 'Submitted';
  }

  async function pollBox(wrap, taskId) {
    var tries = 0;
    while (tries++ < 120) {
      await new Promise(function (r) { setTimeout(r, 2000); });
      try {
        var res = await API.get('/api/steps-grade?taskId=' + encodeURIComponent(taskId));
        if (!res || !res.success) continue;
        if (res.status === 'done') { showBoxResult(wrap, res.result, res.subid); return; }
      } catch (e) { /* 继续等 */ }
    }
    var s = wrap.querySelector('button');
    if (s) s.disabled = false;
  }

  function showResult(card, result, subid) {
    const score = Number(result && result.score);
    const ok = score === 100;
    if (ok) {
      card.classList.add('solved');
    }
    const box = document.createElement('div');
    box.className = 'ip-result';
    box.innerHTML = '<strong>' + (ok ? 'Accepted' : 'Scored ' + (Number.isFinite(score) ? score : '?')) + '</strong>'
      + (result && result.comment
          ? '<div class="ip-comment" style="margin-top:6px;opacity:.9;">' + esc(result.comment).replace(/\n/g, '<br>') + '</div>'
          : '')
      + (subid ? '<a href="/submissions/' + encodeURIComponent(subid)+'/detail' + '">View submission <i class="fas fa-arrow-right"></i></a>' : '');
    card.appendChild(box);
    renderMath(box);   // AI 评语里可能有 $...$

    const btn = card.querySelector('.ip-submit');
    if (btn) { btn.disabled = false; }
    const statusEl = card.querySelector('.ip-actions .ip-status');
    if (statusEl) { statusEl.textContent = ok ? 'Solved!' : 'Submitted'; statusEl.className = 'ip-status ' + (ok ? 'ok' : ''); }

    if (ok) {
      const badge = card.querySelector('.ip-badge');
      if (badge) { badge.className = 'ip-badge solved'; badge.innerHTML = '<i class="fas fa-check"></i> Solved'; }

      // 做对了就不用留着草稿了
      const pid = card.dataset.pid;
      if (pid) {
        writeStepsDraft(pid, '');
        const note = card.querySelector('.ip-draft-note');
        if (note) note.style.display = 'none';
      }
    }
  }

  async function pollGrade(card, taskId) {
    const btn = card.querySelector('.ip-submit');
    const statusEl = card.querySelector('.ip-actions .ip-status');
    let tries = 0;

    while (tries++ < 120) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await API.get('/api/steps-grade?taskId=' + encodeURIComponent(taskId));
        if (!res || !res.success) continue;
        if (res.status === 'done') {
          showResult(card, res.result, res.subid);
          return;
        }
        if (res.status === 'error') {
          statusEl.textContent = res.message || 'Grading failed';
          statusEl.className = 'ip-status err';
          if (btn) btn.disabled = false;
          return;
        }
        statusEl.textContent = 'Grading… (' + (tries * 2) + 's)';
      } catch (e) { /* 继续轮询 */ }
    }
    statusEl.textContent = 'Grading is taking too long. Check your submissions page.';
    statusEl.className = 'ip-status err';
    if (btn) btn.disabled = false;
  }

  // ─────────── 启动 ───────────
  Page.ready(async () => {
    const route = parseRoute();
    if (route.view === 'tracks') return renderTracks();
    if (route.view === 'list') return renderList(route.track);
    return renderCourse(route.track, route.id);
  });
})();
