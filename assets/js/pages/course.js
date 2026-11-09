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

  // Papers 是第四条入口，和上面三个 track 并列但走自己的流程
  const PAPER_TRACKS = {
    M0: { label: 'M0', desc: 'DSE Paper 1 · full papers', cls: 'track-M'  },
    M1: { label: 'M1', desc: 'Extended M1 papers',        cls: 'track-M2' },
    M2: { label: 'M2', desc: 'Extended M2 papers',        cls: 'track-MO' },
  };
  let PAPER_YEARS={ M0: [], M1: [], M2: [] };
  // 每份卷子的 得分/总分（来自 listPapers），跟年份共用同一次请求
  let _paperScoresPromise = null;
  function paperScores() {
    if (_paperScoresPromise) return _paperScoresPromise;
    _paperScoresPromise = (async () => {
      try {
        const res = await apiCall('/api/paper?action=listPapers');
        const out = {};
        ((res && res.papers) || []).forEach((p) => {
          out[p.track + ':' + p.year] = { myScore: p.myScore || 0, totalMarks: p.totalMarks || 0 };
        });
        return out;
      } catch (e) {
        console.warn('[course] could not load paper scores:', e && e.message);
        return {};
      }
    })();
    return _paperScoresPromise;
  }

  // Papers 的年份列表按需加载（只在这几个页面到才请求），
  // 而且只请求一次 —— 以前它挂在 Page.ready 里，进任何 course 页面
  // 都会先多打一个 /api/paper?action=listPapers，失败时还会抛到
  // 未处理的 promise 里，控制台报错但页面假装没事。
  let _paperYearsPromise = null;
  function ensurePaperYears() {
    if (_paperYearsPromise) return _paperYearsPromise;
    _paperYearsPromise = (async () => {
      try {
        const res = await apiCall('/api/paper?action=listPapers');
        const papers = (res && res.papers) || [];
        const next = { M0: [], M1: [], M2: [] };
        papers.forEach((cur) => {
          if (next[cur.track]) next[cur.track].push(cur.year);
        });
        Object.keys(next).forEach((k) => next[k].sort((a, b) => b - a));
        PAPER_YEARS = next;
      } catch (e) {
        // 取不到就当没有，不要抛未处理的 rejection
        console.warn('[course] could not load paper years:', e && e.message);
      }
      return PAPER_YEARS;
    })();
    return _paperYearsPromise;
  }

  // const PAPER_YEARS = { M0: [2025], M1: [], M2: [] };

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
  
  // 把题干里所有 (N marks) 加起来：一道题拆成 (a)(b) 时总分会是几段之和
  function totalMarksLabel(statement) {
    const text = String(statement || '');
    const re = /\((\d+(?:\.\d+)?)\s*marks?\)/gi;
    let total = 0, found = 0, m;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) { total += n; found++; }
    }
    if (!found) return '';
    return total + (total === 1 ? ' mark' : ' marks');
  }

  function fmtTokens(n) {
    const v = Number(n) || 0;
    return v >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k' : String(v);
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

    // /course/papers            → 选 M0 / M1 / M2
    // /course/papers/M0         → 选年份
    // /course/papers/M0/2025    → 试卷
    if (parts[1] === 'submissions') return { view: 'dseSubmissions' };

    if (parts[1] === 'papers') {
      if (parts.length === 2) return { view: 'paperTracks' };
      if (parts.length === 3) return { view: 'paperYears', track: decodeURIComponent(parts[2]) };
      return { view: 'paper', track: decodeURIComponent(parts[2]), year: Number(parts[3]) || 2025 };
    }

    if (parts.length === 2) return { view: 'list', track: decodeURIComponent(parts[1]) };
    return { view: 'course', track: decodeURIComponent(parts[1]), id: decodeURIComponent(parts[2]) };
  }


  // ─────────── PDF 尾巴的题目清单 ───────────
  // 列出这份 notes 里所有题目，管理员可以直接点进编辑页。
  function renderProblemIndex(course) {
    const list = (course && course.problems) || [];
    if (!list.length) return;

    const old = document.getElementById('problemIndex');
    if (old) old.remove();

    const user = (typeof window.getCurrentUser === 'function' ? window.getCurrentUser() : null) || {};
    const isAdmin = user.role === 'admin' || user.role === 'root';

    const solvedCount = list.filter((p) => p.solved).length;

    const box = document.createElement('section');
    box.id = 'problemIndex';
    box.className = 'problem-index';
    box.innerHTML =
      '<div class="pi-head">' +
        '<span class="pi-title"><i class="fas fa-list-check"></i> Questions in this set</span>' +
        '<span class="pi-count">' + solvedCount + ' / ' + list.length + ' solved</span>' +
      '</div>' +
      '<div class="pi-grid">' +
        list.map((p) => {
          const cls = p.solved ? ' ok' : '';
          const href = isAdmin ? '/admin/problems/' + encodeURIComponent(p.id) : '/problems/' + encodeURIComponent(p.id);
          const title = p.name ? (p.name + ' · ' + p.id) : p.id;
          return '<a class="pi-item' + cls + '" href="' + href + '" title="' + esc(isAdmin ? ('Edit ' + p.id) : title) + '">' +
            '<span class="pi-id">' + esc(p.id) + '</span>' +
            '<span class="pi-name">' + esc(p.name || '') + '</span>' +
            (isAdmin ? '<span class="pi-edit">Edit</span>' : (p.solved ? '<span class="pi-done">✓</span>' : '')) +
          '</a>';
        }).join('') +
      '</div>';

    const pdfHost = document.getElementById('coursePdf');
    const anchor = pdfHost || document.getElementById('courseContent');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    } else if (root) {
      root.appendChild(box);
    }
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

  // ─────────── 四张卡片（三个 track + Papers）───────────
  async function renderTracks() {
    root.classList.remove('wide');
    const paperCard = `
        <a class="track-card track-Papers" href="/course/papers">
          <div class="tc-code">P</div>
          <div class="tc-name">Papers</div>
          <div class="tc-sub">Full DSE papers · draw and get marked</div>
        </a>
        <a class="track-card track-Submissions" href="/course/submissions">
          <div class="tc-code">S</div>
          <div class="tc-name">Submissions</div>
          <div class="tc-sub">Everyone's marked answers · visible to all</div>
        </a>`;
    root.innerHTML = crumbs([{ text: 'Course' }]) +
      '<div class="course-tracks">' + Object.entries(TRACKS).map(([code, t]) => `
        <a class="track-card ${t.cls}" href="/course/${code}">
          <div class="tc-code">${esc(code)}</div>
          <div class="tc-name">${esc(t.label)}</div>
          <div class="tc-sub">${esc(t.desc)}</div>
        </a>`).join('') + paperCard + '</div>';

    // 三个领域的课程数：一次请求拿全部，不再每个 track 打一次
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
      const href = '/course/' + encodeURIComponent(track) + '/' + encodeURIComponent(c.id);
      return `
        <tr class="course-row" data-href="${href}" tabindex="0" role="link">
          <td class="col-id">${esc(c.id)}</td>
          <td class="col-topic">
            <a href="${href}">${esc(c.topic || '(untitled)')}</a>
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

    bindRowClicks();
  }

  // 整行可点：点到行内任意位置都跳转，点链接本身则交给浏览器
  function bindRowClicks() {
    root.querySelectorAll('.course-row[data-href]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        location.href = tr.dataset.href;
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          location.href = tr.dataset.href;
        }
      });
    });
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
      // PDF 尾巴挂一份题目清单
      renderProblemIndex(c);
      renderCourseDrawPad(c);
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
      <div class="ip-modes">
        <button type="button" data-mode="text" class="on">Text</button>
        <button type="button" data-mode="draw">Draw</button>
      </div>
      <div class="ip-input-row">
        <textarea placeholder="Write your steps here — the AI grades the reasoning, not just the answer."></textarea>
      </div>
      <div class="ip-board paper-pad paper-pad-locked" hidden></div>
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

    // Text / Draw 切换：Draw 才创建画板（懒加载），提交走图片批改
    const boardEl = card.querySelector('.ip-board');
    const inputRow = card.querySelector('.ip-input-row');
    const modeBtns = card.querySelectorAll('.ip-modes button');
    let mode = 'text';
    let ipPad = null;

    function ensureIpPad() {
      if (ipPad) return ipPad;
      ipPad = createDrawPad(boardEl, 'inlinePad:' + pid, { transparent: true });
      ipPad.restore();
      const tools = buildPadToolbar(ipPad);
      tools.style.position = 'absolute';
      tools.style.left = '6px';
      tools.style.top = '6px';
      tools.style.display = 'flex';
      tools.style.zIndex = '3';
      boardEl.appendChild(tools);

      const unlock = document.createElement('button');
      unlock.type = 'button';
      unlock.className = 'paper-pad-unlock';
      unlock.innerHTML = '<i class="fas fa-pen"></i> Tap to write';
      boardEl.appendChild(unlock);
      unlock.addEventListener('click', () => {
        boardEl.classList.remove('paper-pad-locked');
        boardEl.classList.add('paper-pad-active');
        unlock.remove();
      });
      return ipPad;
    }

    modeBtns.forEach((b) => {
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        modeBtns.forEach((o) => o.classList.toggle('on', o === b));
        const isDraw = mode === 'draw';
        inputRow.hidden = isDraw;
        boardEl.hidden = !isDraw;
        if (isDraw) ensureIpPad();
        btn.textContent = isDraw ? 'Submit drawing' : 'Submit to AI';
      });
    });

    btn.addEventListener('click', async () => {
      if (mode === 'draw') {
        const pd = ensureIpPad();
        if (pd.isEmpty()) { statusEl.textContent = 'Draw something first.'; statusEl.className = 'ip-status err'; return; }
        const image = pd.toDataUrl();
        if (!image) { statusEl.textContent = 'Could not export the drawing'; statusEl.className = 'ip-status err'; return; }
        btn.disabled = true;
        statusEl.textContent = 'Uploading…';
        statusEl.className = 'ip-status';
        try {
          const sub = await API.post('/api/submit', { problemId: pid, type: 'image', image });
          if (!sub || !sub.success) throw new Error((sub && sub.message) || 'Submit failed');
          statusEl.textContent = 'Grading…';
          const graded = await API.post('/api/image-grade', { problemId: pid, subid: sub.subid, imageUrl: sub.imageUrl });
          if (graded && graded.success && graded.grade) {
            const g = graded.grade;
            card.insertAdjacentHTML('beforeend', '<div class="ip-result" style="padding:0 16px 14px;"><strong>' + esc(String(g.score != null ? g.score : '')) + '</strong> ' + esc(g.comment || '') + '</div>');
            renderMath(card);
            statusEl.textContent = 'Graded';
          } else {
            statusEl.textContent = 'Submitted — grading is still running';
          }
          pd.clear();
        } catch (e) {
          statusEl.textContent = e.message || 'Submit failed';
          statusEl.className = 'ip-status err';
        } finally {
          btn.disabled = false;
        }
        return;
      }

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

  // 手写作答图导出时的缩放（百分比）。降一点能显著减少上传体积和 AI 读图耗时，
  // 但太低会让笔迹糊掉 —— 75% 是清晰度和速度的平衡点。改这一个数即可。
  const HANDWRITING_EXPORT_SCALE = 0.75;
  // Fast 模式下的导出缩放：像素再压一半，上传更快、AI 读图也更省
  const HANDWRITING_EXPORT_SCALE_FAST = 0.5;
  let padCompress = false;   // 由试卷页的 Fast 开关控制

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
  function createDrawPad(host, storageKey, opts) {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:crosshair;'
      + 'user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;';
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var state = { color: '#111111', width: 2, erase: false };
    var strokes = [];     // { color, width, erase, points: [{x,y}] }
    var ready = false;
    var dpr = window.devicePixelRatio || 1;
    // 逻辑尺寸（CSS 像素）。存草稿和恢复都用它，绝不从 canvas.width / dpr 反推 ——
    // dpr 一改、画布还没 fit、或者不同设备之间来回，反推出来的宽度就不一致，
    // 存档比例随之错位，恢复后笔迹就整体缩水。
    var logicalW = 0;
    var logicalH = 0;
    var pendingRestore = false;   // 画板还没量出真实尺寸时，等 fit() 完成后补一次恢复

    // ── 本地存档：按 pid 存，刷新页面不丢 ──
    var saveTimer = null;
    function padSize() {
      // 优先用 fit() 记下的逻辑尺寸；还没 fit 就用容器尺寸兜底
      if (logicalW > 2 && logicalH > 2) return { w: logicalW, h: logicalH };
      var w = host.clientWidth || 0;
      var h = host.clientHeight || 0;
      return { w: w, h: h };
    }

    function persist() {
      if (!storageKey) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        // PadStore 做量化 + delta 压缩，localStorage 满了自动转 IndexedDB
        if (!window.PadStore) return;
        var sz = padSize();
        if (sz.w < 2 || sz.h < 2) return;    // 量不出来就先别存，免得存错比例
        PadStore.save(storageKey, strokes, sz.w, sz.h);
      }, 400);
    }

    function restore() {
      if (!storageKey || !window.PadStore) return;
      // 画布还没量过尺寸时必须先 fit()
      if (!ready) fit();
      // 画板常常是在加入 DOM 之前就创建的（host.clientWidth 为 0）。
      // 这时绝不能退回到 300x120 那种默认尺寸去恢复 —— 存档是按真实宽度归一化的，
      // 拿一个假宽度当目标，笔迹就会被整体缩掉一大截。挂个标记，等 fit() 拿到真尺寸再补。
      if (!ready || logicalW < 2 || logicalH < 2) { pendingRestore = true; return; }
      var sz = padSize();
      if (sz.w < 2 || sz.h < 2) { pendingRestore = true; return; }
      var w = sz.w;
      var h = sz.h;
      var st = PadStore.loadSync(storageKey, w, h);
      if (st.found && st.strokes.length) {
        strokes = st.strokes;
        redraw();
        return;
      }
      // 内容可能在 IndexedDB 里（localStorage 曾满过），异步补一次
      if (st.overflowed) {
        PadStore.load(storageKey, w, h).then(function (arr) {
          if (arr && arr.length) { strokes = arr; redraw(); }
        }).catch(function () {});
      }
    }

    function clearStorage() {
      if (!storageKey) return;
      // PadStore 会同时清 localStorage 和对应的 IndexedDB 条目
      if (window.PadStore) PadStore.remove(storageKey);
      else { try { localStorage.removeItem(storageKey); } catch (e) {} }
    }

    var transparent = !!(opts && opts.transparent);
    var bgImage = null;          // 导入的作答图，导出时垫在底下

    function paintBase() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (bgImage) {
        // 导入的作答图就是这张纸：先铺满，再在上面画笔迹
        ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
      } else if (transparent) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }

    function strokePath(st) {
      if (!st.points.length) return;
      // strokes 里是 0-1，画的时候按当前逻辑尺寸展开
      var W = logicalW || canvas.width / (dpr || 1);
      var H = logicalH || canvas.height / (dpr || 1);
      ctx.strokeStyle = st.erase ? '#ffffff' : st.color;
      ctx.lineWidth = st.erase ? Math.max(10, st.width * 5) : st.width;
      ctx.beginPath();
      var p0 = st.points[0];
      ctx.moveTo(p0.x * W, p0.y * H);
      if (st.points.length === 1) {
        ctx.lineTo(p0.x * W + 0.1, p0.y * H);
      } else {
        for (var i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i].x * W, st.points[i].y * H);
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
      // 只用真实尺寸：以前 host.clientWidth 为 0 时退回 300x120，
      // 而画板往往在进 DOM 前就创建，那个假尺寸会被当成「逻辑宽度」写进存档，
      // 归一化比例因此整体偏小 —— 恢复回来就是缩小。
      var w = host.clientWidth || 0;
      var h = host.clientHeight || 0;
      if (w < 10 || h < 10) return;

      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      logicalW = w;
      logicalH = h;

      // 坐标已经是 0-1，尺寸怎么变都不需要换算，直接重画即可
      ready = true;
      redraw();     // 尺寸变了，按路径重画，笔迹不丢

      // 尺寸终于可信了 —— 补上之前跳过的恢复
      if (pendingRestore) {
        pendingRestore = false;
        restore();
      }
    }

    // 坐标一律用 0-1 归一化存进 strokes。
    // 这样画板宽高怎么变、dpr 怎么变、什么时候恢复，笔迹的位置和大小都不会跑 ——
    // 以前存的是像素，每次尺寸变化都要换算，任何一处对不上就整体偏移或缩放。
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      var w = r.width || 1;
      var h = r.height || 1;
      return { x: (e.clientX - r.left) / w, y: (e.clientY - r.top) / h };
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
      // 导入的作答图当作「纸」：铺在画板底下，学生可以在上面继续写，
      // 提交时把背景图和笔迹合成一张。
      setBackground: function (url) {
        return new Promise(function (resolve) {
          if (!url) { bgImage = null; resolve(false); return; }
          var im = new Image();
          // 必须带 crossOrigin：背景图一旦画进主画布，缺 CORS 头就会把画布污染，
          // 之后 toDataURL 直接抛 SecurityError，导出永远是空 —— 表现就是「点 Mark 没反应」。
          // 图源没有 CORS 头时宁可加载失败并提示，也不要静默污染。
          im.crossOrigin = 'anonymous';
          im.onload = function () {
            bgImage = im;
            // 按宽度铺满，高度跟着图片比例走
            var w = host.clientWidth || 800;
            var h = Math.max(120, Math.round(w * im.naturalHeight / im.naturalWidth));
            host.style.height = h + 'px';
            setTimeout(function () { fit(); redraw(); resolve(true); }, 0);
          };
          im.onerror = function () {
            bgImage = null;
            DSHUI.toast('Could not load that image as a background', 'warn');
            resolve(false);
          };
          im.src = url;
        });
      },
      getBackground: function () { return bgImage ? bgImage.src : null; },
      toDataUrl: function () {
        try {
          var base = padCompress ? HANDWRITING_EXPORT_SCALE_FAST : HANDWRITING_EXPORT_SCALE;
          var scale = Math.max(0.3, Math.min(1, base));
          var out = document.createElement('canvas');
          out.width = Math.max(1, Math.round(canvas.width * scale));
          out.height = Math.max(1, Math.round(canvas.height * scale));
          var octx = out.getContext('2d');

          // 有背景图就先铺它（当作已经写过的部分），否则画白纸 + 灰横线
          if (bgImage) {
            try {
              octx.drawImage(bgImage, 0, 0, out.width, out.height);
              octx.drawImage(canvas, 0, 0, out.width, out.height);
              return out.toDataURL('image/jpeg', 0.9);
            } catch (e) {
              // 背景图把 canvas 污染了（缺 CORS 头），退回到只导出笔迹
              octx.clearRect(0, 0, out.width, out.height);
              octx.fillStyle = '#ffffff';
              octx.fillRect(0, 0, out.width, out.height);
            }
          }

          octx.fillStyle = '#ffffff';
          octx.fillRect(0, 0, out.width, out.height);

          if (transparent) {
            var step = 28 * dpr * scale;
            var offset = 4 * dpr * scale;
            octx.strokeStyle = 'rgba(0, 0, 0, 0.13)';
            octx.lineWidth = Math.max(1, Math.round(dpr * scale));
            for (var y = offset + step; y < out.height; y += step) {
              octx.beginPath();
              octx.moveTo(0, y + 0.5);
              octx.lineTo(out.width, y + 0.5);
              octx.stroke();
            }
          }

          octx.drawImage(canvas, 0, 0, out.width, out.height);
          return out.toDataURL('image/jpeg', 0.85);
        } catch (e) { return ''; }
      },
      restore: restore,
      persist: persist,
    };
  }


  // 画板工具栏：颜色 / 粗细 / 橡皮 / 撤销 / 清空。课程 PDF 框和 DSE 试卷共用。
  function buildPadToolbar(pad) {
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


    return padTools;
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
    var padTools = buildPadToolbar(pad);
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



  // ─────────── Submissions：所有人的 DSE 提交 ───────────
  async function renderDseSubmissions(page) {
    root.classList.remove('wide');
    const p = Number(page) || 1;
    root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: 'Submissions' }]) +
      '<div id="dseSubRoot"><div class="course-empty">Loading submissions…</div></div>';

    const host = document.getElementById('dseSubRoot');
    let data;
    try {
      data = await API.get('/api/paper?action=dseSubmissions&page=' + p + '&limit=30');
    } catch (e) {
      host.innerHTML = '<div class="course-empty">Could not load submissions: ' + esc(e.message || 'error') + '</div>';
      return;
    }
    if (!data || !data.success) {
      host.innerHTML = '<div class="course-empty">Submissions unavailable.</div>';
      return;
    }

    const rows = data.submissions || [];
    const unlockCost = Number(data.unlockCost) || 100000;
    const pg = data.pagination || { page: p, totalPages: 1, total: rows.length };

    let html = '<div class="dse-sub-head">' +
      '<div class="dse-sub-title">DSE submissions</div>' +
      '<div class="dse-sub-count">' + pg.total + ' marked question' + (pg.total === 1 ? '' : 's') + '</div>' +
      '</div>';

    if (!rows.length) {
      host.innerHTML = html + '<div class="course-empty">Nobody has submitted a paper yet.</div>';
      return;
    }

    html += '<div class="dse-sub-list">';
    rows.forEach((r) => {
      const t = r.createdAt ? new Date(r.createdAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }) : '';
      const score = Number(r.score) || 0;
      const cls = score >= 80 ? 'good' : score >= 50 ? 'mid' : 'bad';
      const head = (r.awarded != null && r.total != null) ? (r.awarded + ' / ' + r.total) : (score + '%');
      const lines = Array.isArray(r.lines) ? r.lines : [];

      html += '<details class="dse-sub-row">' +
        '<summary>' +
          '<span class="dse-sub-user"><a href="/users/' + encodeURIComponent(r.username) + '">' + esc(r.username) + '</a></span>' +
          '<span class="dse-sub-paper">' + esc(r.paperTrack) + ' ' + esc(r.paperYear) + '</span>' +
          '<span class="dse-sub-pid">' + esc(r.pid) + '</span>' +
          '<span class="dse-sub-score ' + cls + '">' + esc(head) + '</span>' +
          '<span class="dse-sub-time">' + esc(t) + '</span>' +
        '</summary>' +
        '<div class="dse-sub-body">' +
          (lines.length ? renderMarkTable(lines) : '') +
          (r.summary ? '<div class="dse-sub-summary">' + esc(r.summary) + '</div>' : '') +
          ((r.usage || r.chargedTokens) ? '<div class="dse-sub-usage"><i class="fas fa-coins"></i>' + fmtUsage(r) + '</div>' : '') +
          '<div class="dse-sub-actions">' +
            (r.hasImage !== false ? '<button class="dse-view-img" data-subid="' + esc(r.subid) + '">' + (r.own ? 'View my answer' : (r.unlockable ? 'View answer · ' + fmtTokens(unlockCost) : 'View answer')) + '</button>' : '<span class="dse-no-img">No image</span>') +
            '<a href="/course/papers/' + encodeURIComponent(r.paperTrack) + '/' + r.paperYear + '">Open paper</a>' +
          '</div>' +
          '<div class="dse-img-slot"></div>' +
        '</div>' +
      '</details>';
    });
    html += '</div>';

    // 分页
    if (pg.totalPages > 1) {
      html += '<div class="dse-sub-pager">';
      if (pg.page > 1) html += '<a href="/course/submissions?page=' + (pg.page - 1) + '">← Newer</a>';
      html += '<span>Page ' + pg.page + ' / ' + pg.totalPages + '</span>';
      if (pg.page < pg.totalPages) html += '<a href="/course/submissions?page=' + (pg.page + 1) + '">Older →</a>';
      html += '</div>';
    }

    host.innerHTML = html;
    renderMath(host);

    // 查看作答图：本人/管理员免费，其他人每条扣一次
    host.querySelectorAll('.dse-view-img').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const subid = btn.dataset.subid;
        const slot = btn.closest('.dse-sub-body').querySelector('.dse-img-slot');
        if (slot.dataset.loaded === '1') {
          slot.innerHTML = '';
          slot.dataset.loaded = '0';
          return;
        }
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = 'Loading…';
        try {
          const out = await API.get('/api/paper?action=dseImage&subid=' + encodeURIComponent(subid));
          if (!out || !out.success) throw new Error((out && out.message) || 'Cannot view this image');
          slot.innerHTML = '<img class="dse-img" src="' + esc(out.imageUrl) + '" alt="answer" loading="lazy">';
          slot.dataset.loaded = '1';
          btn.textContent = 'Hide answer';
          if (out.charged) DSHUI.toast('Charged ' + fmtTokens(out.charged) + ' tokens', 'ok');
        } catch (e) {
          btn.textContent = old;
          DSHUI.toast(e.message, 'warn');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }




  // ─────────── 课程页：每题一个作答区（文字 / 画板可切换）───────────
  function renderCourseDrawPad(course) {
    const old = document.getElementById('courseDrawPad');
    if (old) old.remove();

    const list = (course && course.problems) || [];
    if (!list.length) return;

    const box = document.createElement('section');
    box.id = 'courseDrawPad';
    box.className = 'course-drawpad';
    box.innerHTML =
      '<div class="cdp-head">' +
        '<span class="cdp-title"><i class="fas fa-pen-line"></i> Answer this set</span>' +
        '<span class="cdp-count" id="cdpCount">0 / ' + list.length + ' submitted</span>' +
      '</div>' +
      '<div class="cdp-list" id="cdpList"></div>';

    const anchor = document.getElementById('problemIndex') || document.getElementById('courseContent');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(box, anchor.nextSibling);
    else if (root) root.appendChild(box);

    const host = box.querySelector('#cdpList');
    let submitted = 0;

    function bumpCount() {
      const el3 = box.querySelector('#cdpCount');
      if (el3) el3.textContent = submitted + ' / ' + list.length + ' submitted';
    }

    list.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'cdp-item';
      card.innerHTML =
        '<div class="cdp-item-head">' +
          '<span class="cdp-id">' + esc(p.id) + '</span>' +
          (p.name ? '<span class="cdp-name">' + esc(p.name) + '</span>' : '') +
          (p.solved ? '<span class="cdp-done">✓ solved</span>' : '') +
          '<span class="cdp-modes">' +
            '<button type="button" data-mode="text" class="on">Text</button>' +
            '<button type="button" data-mode="draw">Draw</button>' +
          '</span>' +
        '</div>' +
        '<textarea class="cdp-text" rows="4" placeholder="Type your answer…"></textarea>' +
        '<div class="cdp-board paper-pad paper-pad-locked" hidden></div>' +
        '<div class="cdp-row">' +
          '<button type="button" class="cdp-submit">Submit</button>' +
          '<span class="cdp-status"></span>' +
        '</div>' +
        '<div class="cdp-result"></div>';
      host.appendChild(card);

      const ta = card.querySelector('.cdp-text');
      const board = card.querySelector('.cdp-board');
      const status = card.querySelector('.cdp-status');
      const result = card.querySelector('.cdp-result');
      const submitBtn = card.querySelector('.cdp-submit');
      const modeBtns = card.querySelectorAll('.cdp-modes button');

      let mode = 'text';
      let pad = null;

      // 画板按需创建：切到 Draw 才建，避免 17 块 canvas 一起初始化
      function ensurePad() {
        if (pad) return pad;
        pad = createDrawPad(board, 'coursePad:' + (course.track || '') + ':' + (course.id || '') + ':' + p.id, { transparent: true });
        pad.restore();
        board.appendChild(buildPadToolbar(pad));

        const unlock = document.createElement('button');
        unlock.type = 'button';
        unlock.className = 'paper-pad-unlock';
        unlock.innerHTML = '<i class="fas fa-pen"></i> Tap to write';
        board.appendChild(unlock);
        unlock.addEventListener('click', () => {
          board.classList.remove('paper-pad-locked');
          board.classList.add('paper-pad-active');
          unlock.remove();
        });
        return pad;
      }

      modeBtns.forEach((b) => {
        b.addEventListener('click', () => {
          mode = b.dataset.mode;
          modeBtns.forEach((o) => o.classList.toggle('on', o === b));
          if (mode === 'draw') {
            ta.hidden = true;
            board.hidden = false;
            ensurePad();
          } else {
            ta.hidden = false;
            board.hidden = true;
          }
          submitBtn.textContent = mode === 'draw' ? 'Submit drawing' : 'Submit answer';
        });
      });
      submitBtn.textContent = 'Submit answer';

      submitBtn.addEventListener('click', async () => {
        submitBtn.disabled = true;
        status.textContent = 'Submitting…';
        try {
          let payload = { problemId: p.id };
          if (mode === 'text') {
            const text = ta.value.trim();
            if (!text) { status.textContent = 'Type something first'; submitBtn.disabled = false; return; }
            payload.type = 'text';
            payload.answer = text;
          } else {
            const pd = ensurePad();
            if (pd.isEmpty()) { status.textContent = 'Draw something first'; submitBtn.disabled = false; return; }
            const image = pd.toDataUrl();
            if (!image) { status.textContent = 'Could not export the drawing'; submitBtn.disabled = false; return; }
            payload.type = 'image';
            payload.image = image;
          }

          const sub = await API.post('/api/submit', payload);
          if (!sub || !sub.success) throw new Error((sub && sub.message) || 'Submit failed');

          const score = sub.score != null ? sub.score : (sub.grade && sub.grade.score);
          const comment = sub.comment || (sub.grade && sub.grade.comment) || '';
          const verdict = sub.result || (sub.correct === true ? 'correct' : (sub.correct === false ? 'wrong' : ''));

          result.innerHTML = '<div class="cdp-mark">' +
            (verdict ? '<span class="cdp-score">' + esc(String(verdict)) + '</span>' : '') +
            (score != null ? '<span class="cdp-score">' + esc(String(score)) + '</span>' : '') +
            (comment ? '<span class="cdp-comment">' + esc(comment) + '</span>' : '') +
          '</div>';
          renderMath(result);
          status.textContent = 'Submitted';
          submitted++;
          bumpCount();
          if (mode === 'text') ta.value = '';
          else if (pad) pad.clear();
        } catch (e) {
          status.textContent = 'Failed: ' + (e.message || 'error');
        } finally {
          submitBtn.disabled = false;
        }
      });
    });
  }

  // ─────────── Papers：M0 / M1 / M2 ───────────
  async function renderPaperTracks() {
    root.classList.remove('wide');
    root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: 'Papers' }]) +
      '<div class="course-tracks">' + Object.entries(PAPER_TRACKS).map(([code, t]) => `
        <a class="track-card ${t.cls}" href="/course/papers/${code}">
          <div class="tc-code">${esc(code)}</div>
          <div class="tc-name">${esc(t.label)}</div>
          <div class="tc-sub">${esc(t.desc)}</div>
        </a>`).join('') + '</div>';
  }

  // ─────────── Papers：年份 ───────────
  async function renderPaperYears(track) {
    root.classList.remove('wide');
    // 先等年份加载完再渲染，否则手写的卷子在数据到达前会显示成空
    await ensurePaperYears();
    const years = PAPER_YEARS[track] || [];
    const t = PAPER_TRACKS[track];
    if (!t) { root.innerHTML = '<div class="course-empty">Unknown paper track.</div>'; return; }

    if (!years.length) {
      root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: 'Papers', href: '/course/papers' }, { text: track }]) +
        '<div class="course-empty">No papers for ' + esc(track) + ' yet.</div>';
      return;
    }

    const scores = await paperScores();
    root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: 'Papers', href: '/course/papers' }, { text: track }]) +
      '<div class="course-tracks">' + years.map((y) => {
        const info = scores[track + ':' + y] || { myScore: 0, totalMarks: 0 };
        return `
        <a class="track-card ${t.cls}" href="/course/papers/${track}/${y}">
          <div class="tc-code">${y}</div>
          <div class="tc-name">${y} Paper</div>
          <div class="tc-sub">${esc(t.label)}</div>
          <div class="tc-score">${Number(info.myScore) || 0} / ${Number(info.totalMarks) || 0}</div>
        </a>`;
      }).join('') + '</div>';
  }

  // ─────────── Papers：试卷本体 ───────────
  async function renderPaper(track, year) {
    root.classList.add('wide');
    root.innerHTML = crumbs([{ text: 'Course', href: '/course' }, { text: 'Papers', href: '/course/papers' },
      { text: track, href: '/course/papers/' + track }, { text: String(year) }]) +
      '<div id="paperRoot"><div class="course-empty">Loading paper…</div></div>';

    const host = document.getElementById('paperRoot');
    let data;
    try {
      data = await API.get('/api/paper?action=get&track=' + encodeURIComponent(track) + '&year=' + year);
    } catch (e) {
      host.innerHTML = '<div class="course-empty">Could not load this paper: ' + esc(e.message || 'error') + '</div>';
      return;
    }
    if (!data || !data.success) {
      host.innerHTML = '<div class="course-empty">Paper unavailable.</div>';
      return;
    }

    const paper = data.paper;
    const marks = data.marks || {};
    const pads = {};      // pid → pad

    // ── 顶部工具条 ──
    const bar = document.createElement('div');
    bar.className = 'paper-bar';
    bar.innerHTML = `
      <div class="paper-title">${esc(paper.title)}</div>
      <div class="paper-actions">
        <span class="paper-mode" id="paperMode">
          <button type="button" data-toggle="fast" title="Downscale the image before it is uploaded">Fast</button>
          <button type="button" data-toggle="ultra" title="Force low thinking effort on every question (implies Fast)">Ultra</button>
        </span>
        <span class="paper-score" id="paperScore">${paper.scoredMarks || 0} / ${paper.totalMarks || 0} marks</span>
        <span class="paper-count" id="paperCount">0 / ${paper.questions.length} attempted</span>
        <button class="paper-mark-all" id="paperMarkAll">Mark my paper</button>
        <span class="paper-status" id="paperStatus"></span>
      </div>`;
    host.innerHTML = '';
    host.appendChild(bar);

    // 两个独立开关：
    //   Fast  = 图片先压像素（上传更快、AI 读图更省）
    //   Ultra = 所有题思考强度强制 low；打开时连带打开 Fast
    let fastOn = false;
    let ultraOn = false;
    try {
      fastOn = localStorage.getItem('paperFast') === '1';
      ultraOn = localStorage.getItem('paperUltra') === '1';
    } catch (e) {}
    if (ultraOn) fastOn = true;   // 存档里可能不一致，这里对齐
    padCompress = fastOn;
    const markMode = () => (ultraOn ? 'ultra' : '');

    const modeBox = bar.querySelector('#paperMode');
    function paintModes() {
      if (!modeBox) return;
      modeBox.querySelector('[data-toggle="fast"]').classList.toggle('on', fastOn);
      modeBox.querySelector('[data-toggle="ultra"]').classList.toggle('on', ultraOn);
    }
    function persistModes() {
      try {
        localStorage.setItem('paperFast', fastOn ? '1' : '0');
        localStorage.setItem('paperUltra', ultraOn ? '1' : '0');
      } catch (e) {}
    }
    if (modeBox) {
      modeBox.querySelector('[data-toggle="fast"]').addEventListener('click', () => {
        fastOn = !fastOn;
        if (!fastOn) ultraOn = false;   // 关掉压缩，Ultra 也就没意义了
        padCompress = fastOn;
        paintModes();
        persistModes();
      });
      modeBox.querySelector('[data-toggle="ultra"]').addEventListener('click', () => {
        ultraOn = !ultraOn;
        if (ultraOn) fastOn = true;     // Ultra 强制 Fast
        padCompress = fastOn;
        paintModes();
        persistModes();
      });
      paintModes();
    }

    const list = document.createElement('div');
    list.className = 'paper-list';
    host.appendChild(list);

    paper.questions.forEach((q, i) => {
      const layoutItem = (paper.layout.items || []).find((it) => it.pid === q.id) || {};
      const height = Number(layoutItem.height) || 260;

      const card = document.createElement('section');
      card.className = 'paper-q';
      card.dataset.pid = q.id;

      const marksLabel = totalMarksLabel(q.statement);

      card.innerHTML = `
        <div class="paper-q-head">
          <span class="paper-q-no">Q${i + 1}</span>
          ${marksLabel ? '<span class="paper-q-marks">' + marksLabel + '</span>' : ''}
          <span class="paper-q-id">${esc(q.id)}</span>
        </div>
        <div class="paper-q-stmt"></div>`;

      // 题干：走 KaTeX 渲染
      const stmtEl = card.querySelector('.paper-q-stmt');
      stmtEl.innerHTML = q.statement || '';
      renderMath(stmtEl);

      // 画板：灰横线纸
      const padWrap = document.createElement('div');
      padWrap.className = 'paper-pad';
      padWrap.style.height = height + 'px';
      card.appendChild(padWrap);

      const pad = createDrawPad(padWrap, 'paperPad:' + track + ':' + year + ':' + q.id, { transparent: true });
      pad.restore();
      pads[q.id] = pad;

      // 先锁住画布：大幅滑动页面时不想误画，点一下才解锁
      padWrap.classList.add('paper-pad-locked');
      const unlock = document.createElement('button');
      unlock.type = 'button';
      unlock.className = 'paper-pad-unlock';
      unlock.innerHTML = '<i class="fas fa-pen"></i> Tap to write';
      padWrap.appendChild(unlock);
      unlock.addEventListener('click', (ev) => {
        ev.stopPropagation();
        padWrap.classList.remove('paper-pad-locked');
        padWrap.classList.add('paper-pad-active');
        unlock.remove();
      });

      // 工具条浮在画板顶部：颜色 / 粗细 / 橡皮 / 撤销 / 清空
      const tools = buildPadToolbar(pad);
      tools.style.left = '6px';
      tools.style.top = '6px';
      tools.style.position = 'absolute';
      tools.style.zIndex = '3';
      tools.style.display = 'flex';
      padWrap.appendChild(tools);

      // 单题提交按钮
      const row = document.createElement('div');
      row.className = 'paper-q-actions';
      const oneBtn = document.createElement('button');
      oneBtn.type = 'button';
      oneBtn.className = 'paper-mark-one';
      oneBtn.textContent = 'Mark this question';
      row.appendChild(oneBtn);

      // Import：把设备上的照片或别的提交图拿来做这一题的作答
      const importWrap = document.createElement('span');
      importWrap.className = 'paper-import';
      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'paper-import-btn';
      importBtn.textContent = 'Import';
      const choices = document.createElement('span');
      choices.className = 'paper-import-choices';
      choices.hidden = true;
      choices.innerHTML = '<button type="button" data-src="device">From device</button>' +
        '<button type="button" data-src="submissions">From submissions</button>';
      importWrap.appendChild(importBtn);
      importWrap.appendChild(choices);
      row.appendChild(importWrap);
      card.appendChild(row);

      const importPreview = document.createElement('div');
      importPreview.className = 'paper-import-preview';
      importPreview.hidden = true;
      card.appendChild(importPreview);

      bindImport({ q, importBtn, choices, importPreview, padWrap, pad, card });

      // 批改结果区
      const res = document.createElement('div');
      res.className = 'paper-mark';
      card.appendChild(res);
      if (marks[q.id]) renderMarkInto(res, marks[q.id]);

      oneBtn.addEventListener('click', async () => {
        const p = pads[q.id];
        const hasBg = p && p.getBackground && p.getBackground();
        if ((!p || p.isEmpty()) && !hasBg) {
          oneBtn.textContent = 'Draw or import something first';
          setTimeout(() => { oneBtn.textContent = 'Mark this question'; }, 1800);
          return;
        }
        const image = p ? p.toDataUrl() : '';
        if (!image) {
          // 导出失败最常见的原因是导入的图把画布污染了（图源没有 CORS 头）
          oneBtn.textContent = 'Could not export — try Remove background';
          setTimeout(() => { oneBtn.textContent = 'Mark this question'; }, 2600);
          return;
        }
        oneBtn.disabled = true;
        oneBtn.textContent = 'Marking…';
        try {
          const out = await API.post('/api/paper?action=mark', { track, year, pid: q.id, image, mode: markMode() });
          if (!out || !out.success) throw new Error((out && out.message) || 'Marking failed');
          if (out.usage) out.mark.usage = out.usage;
          if (out.chargedTokens) out.mark.chargedTokens = out.chargedTokens;
          // 成就解锁 → 右上角广播
          if (out.unlockedAchievements && typeof window.showAchievementToasts === 'function') {
            window.showAchievementToasts(out.unlockedAchievements);
          }
          renderMarkInto(res, out.mark);
          marks[q.id] = out.mark;
          refreshPaperScore();
          oneBtn.textContent = 'Re-mark';
        } catch (err) {
          oneBtn.textContent = 'Failed — retry';
        } finally {
          oneBtn.disabled = false;
        }
      });

      list.appendChild(card);

      padWrap.addEventListener('pointerup', updateCount, true);
    });

    // 页面顶部得分 = 所有已批改题的 awarded 之和
    function refreshPaperScore() {
      const scored = paper.questions.reduce((acc, q) => {
        const m = marks[q.id];
        return acc + (m && Number.isFinite(Number(m.awarded)) ? Number(m.awarded) : 0);
      }, 0);
      const el3 = document.getElementById('paperScore');
      if (el3) el3.textContent = scored + ' / ' + (paper.totalMarks || 0) + ' marks';
    }

    function updateCount() {
      const n = paper.questions.filter((q) => pads[q.id] && !pads[q.id].isEmpty()).length;
      const el2 = document.getElementById('paperCount');
      if (el2) el2.textContent = n + ' / ' + paper.questions.length + ' attempted';
    }
    updateCount();

    // 记住滚动位置：刷新或从别的页面回来时停在原处
    const scrollKey = 'paperScroll:' + track + ':' + year;
    requestAnimationFrame(() => {
      try {
        const y = Number(localStorage.getItem(scrollKey) || 0);
        if (y > 0) window.scrollTo({ top: y, behavior: 'auto' });
      } catch (e) {}
    });

    if (window.__paperScrollHandler) {
      window.removeEventListener('scroll', window.__paperScrollHandler);
    }
    let scrollTimer = null;
    window.__paperScrollHandler = function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        try { localStorage.setItem(scrollKey, String(window.scrollY)); } catch (e) {}
      }, 250);
    };
    window.addEventListener('scroll', window.__paperScrollHandler, { passive: true });

    // ── 一键批改 ──
    document.getElementById('paperMarkAll').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const status = document.getElementById('paperStatus');
      const answers = [];
      paper.questions.forEach((q) => {
        const pad = pads[q.id];
        const hasBg = pad && pad.getBackground && pad.getBackground();
        if (!pad || (pad.isEmpty() && !hasBg)) return;
        const image = pad.toDataUrl();
        if (image) answers.push({ pid: q.id, image });
      });

      if (!answers.length) {
        status.textContent = 'Draw something first';
        status.className = 'paper-status err';
        return;
      }

      btn.disabled = true;
      status.className = 'paper-status';
      status.textContent = 'Marking ' + answers.length + ' question(s)…';

      try {
        const out = await API.post('/api/paper?action=markAll', { track, year, answers, mode: markMode() });
        if (!out || !out.success) throw new Error((out && out.message) || 'Marking failed');

        (out.marked || []).forEach((m) => {
          const card = list.querySelector('.paper-q[data-pid="' + CSS.escape(m.pid) + '"] .paper-mark');
          if (card) renderMarkInto(card, m.mark);
        });
        refreshPaperScore();
        if (out.unlockedAchievements && typeof window.showAchievementToasts === 'function') {
          window.showAchievementToasts(out.unlockedAchievements);
        }
        const failed = (out.failed || []).length;
        status.textContent = 'Marked ' + (out.marked || []).length + (failed ? ' · ' + failed + ' failed' : '');
        status.className = 'paper-status ok';
      } catch (e) {
        status.textContent = e.message || 'Marking failed';
        status.className = 'paper-status err';
      } finally {
        btn.disabled = false;
      }
    });
  }



  // ─────────── 导入图片的裁剪编辑器 ───────────
  // 拍照常有背景，让学生拖一个框选出真正要交的部分，确认后用 canvas 裁出来。
  function openCropEditor(srcUrl, onApply) {
    const mask = document.createElement('div');
    mask.className = 'crop-mask';
    mask.innerHTML =
      '<div class="crop-panel">' +
        '<div class="crop-stage"><img class="crop-img" alt=""><div class="crop-box">' +
          '<span class="crop-handle" data-h="se"></span>' +
        '</div></div>' +
        '<div class="crop-bar">' +
          '<span class="crop-hint">Drag the box to choose what to keep</span>' +
          '<button type="button" class="crop-cancel">Cancel</button>' +
          '<button type="button" class="crop-apply">Apply crop</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    const img = mask.querySelector('.crop-img');
    const box = mask.querySelector('.crop-box');
    const stage = mask.querySelector('.crop-stage');

    let rect = null;      // 相对图片显示区域的选框 {x,y,w,h}

    function clamp() {
      const W = img.clientWidth, H = img.clientHeight;
      rect.w = Math.max(40, Math.min(rect.w, W));
      rect.h = Math.max(40, Math.min(rect.h, H));
      rect.x = Math.max(0, Math.min(rect.x, W - rect.w));
      rect.y = Math.max(0, Math.min(rect.y, H - rect.h));
      box.style.left = rect.x + 'px';
      box.style.top = rect.y + 'px';
      box.style.width = rect.w + 'px';
      box.style.height = rect.h + 'px';
    }

    img.onload = () => {
      const W = img.clientWidth, H = img.clientHeight;
      // 默认取中间 80%
      rect = { x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.8 };
      clamp();
    };
    img.src = srcUrl;

    let drag = null;
    box.addEventListener('pointerdown', (e) => {
      const onHandle = e.target.classList.contains('crop-handle');
      drag = { mode: onHandle ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, ox: rect.x, oy: rect.y, ow: rect.w, oh: rect.h };
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    box.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      if (drag.mode === 'move') { rect.x = drag.ox + dx; rect.y = drag.oy + dy; }
      else { rect.w = drag.ow + dx; rect.h = drag.oh + dy; }
      clamp();
    });
    const endDrag = () => { drag = null; };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);

    function close() { mask.remove(); }
    mask.querySelector('.crop-cancel').addEventListener('click', close);
    mask.addEventListener('click', (e) => { if (e.target === mask) close(); });

    mask.querySelector('.crop-apply').addEventListener('click', () => {
      const scale = img.naturalWidth / img.clientWidth;
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(rect.w * scale));
      out.height = Math.max(1, Math.round(rect.h * scale));
      const ctx = out.getContext('2d');
      ctx.drawImage(
        img,
        rect.x * scale, rect.y * scale, rect.w * scale, rect.h * scale,
        0, 0, out.width, out.height
      );
      const dataUrl = out.toDataURL('image/jpeg', 0.9);
      close();
      if (onApply) onApply(dataUrl);
    });
  }

  // ─────────── 每题 Import：从设备或历史提交取一张图作为作答 ───────────
  // 选完图后只留 Import 按钮，图片按宽度撑满显示；批改时优先用这张图。
  function bindImport({ q, importBtn, choices, importPreview, padWrap, pad, card }) {
    const state = { image: null, open: false, listEl: null };

    // 导入的图不替换画板，而是当画板的底图 —— 学生可以在上面继续写
    async function setImage(url) {
      if (!url) {
        await pad.setBackground(null);
        state.image = null;
        importPreview.hidden = true;
        importPreview.innerHTML = '';
        if (padWrap) { padWrap.style.display = ''; padWrap.classList.add('paper-pad-locked'); }
        importBtn.textContent = 'Import';
        return;
      }

      state.image = url;
      const ok = await pad.setBackground(url);
      if (!ok) DSHUI.toast('Could not load that image', 'warn');

      importPreview.hidden = false;
      importPreview.innerHTML =
        '<div class="pi-bg-note"><i class="fas fa-layer-group"></i> Imported image is now the background — keep writing on top.</div>' +
        '<div class="paper-import-edit">' +
          '<button type="button" class="pi-edit-btn">Remove background</button>' +
        '</div>';
      const rm = importPreview.querySelector('.pi-edit-btn');
      if (rm) rm.addEventListener('click', () => setImage(null));

      choices.hidden = true;
      if (state.listEl) { state.listEl.remove(); state.listEl = null; }
      // 解锁，方便直接在导入的图上继续画
      if (padWrap) {
        padWrap.style.display = '';
        padWrap.classList.remove('paper-pad-locked');
        padWrap.classList.add('paper-pad-active');
        const lockEl = padWrap.querySelector('.paper-pad-unlock');
        if (lockEl) lockEl.remove();
      }
      importBtn.textContent = 'Change background';
    }

    function resetToBoard() {
      state.image = null;
      importPreview.hidden = true;
      importPreview.innerHTML = '';
      if (padWrap) padWrap.style.display = '';
      importBtn.textContent = 'Import';
    }

    importBtn.addEventListener('click', () => {
      if (state.image) {
        // 再点一次可以换图或退回画板
        const back = window.confirm('Remove the imported image and go back to the drawing board?');
        if (back) return resetToBoard();
        setImage(state.image);
        return;
      }
      choices.hidden = !choices.hidden;
    });

    choices.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-src]');
      if (!b) return;
      choices.hidden = true;

      if (b.dataset.src === 'device') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', () => {
          const f = input.files && input.files[0];
          if (!f) return;
          if (f.size > 8 * 1024 * 1024) { DSHUI.toast('Image too large (max 8MB)', 'warn'); return; }
          const fr = new FileReader();
          fr.onload = () => setImage(String(fr.result));
          fr.onerror = () => DSHUI.toast('Could not read that file', 'warn');
          fr.readAsDataURL(f);
        });
        input.click();
        return;
      }

      // submissions：拉自己的历史图片，选一个
      importBtn.textContent = 'Loading…';
      try {
        const res = await API.get('/api/paper?action=myImages&limit=20&pid=' + encodeURIComponent(q.id));
        const list = (res && res.images) || [];
        if (!list.length) {
          importBtn.textContent = 'Import';
          DSHUI.toast('You have no image submissions yet', 'warn');
          return;
        }
        const ul = document.createElement('div');
        ul.className = 'paper-import-list';
        ul.innerHTML = list.map((it, i) => {
          const when = it.at ? new Date(it.at).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }) : '';
          return '<button type="button" data-i="' + i + '">' +
            '<img src="' + esc(it.imageUrl) + '" alt="">' +
            '<span class="pi-meta">' + esc(it.label || it.pid || '') + '<br>' + esc(when) + '</span>' +
          '</button>';
        }).join('');
        ul.addEventListener('click', (ev) => {
          const btn = ev.target.closest('button[data-i]');
          if (!btn) return;
          const pick = list[Number(btn.dataset.i)];
          if (pick) setImage(pick.imageUrl);
        });
        card.appendChild(ul);
        state.listEl = ul;
        importBtn.textContent = 'Import';
      } catch (err) {
        importBtn.textContent = 'Import';
        DSHUI.toast('Could not load your submissions', 'warn');
      }
    });


  }

  // 把批改结果排进卡片：得分 + 逐行 ✔/✘
  // token 用量的一行摘要：输入 / 输出 / 合计 + 实际扣费
  function fmtUsage(obj) {
    const u = (obj && obj.usage) || {};
    const pt = Number(u.prompt_tokens) || 0;
    const ct = Number(u.completion_tokens) || 0;
    const tt = Number(u.total_tokens) || (pt + ct);
    const cost = Number(obj && obj.chargedTokens) || 0;
    const parts = [];
    if (tt) parts.push(tt.toLocaleString() + " tokens (" + pt.toLocaleString() + " in / " + ct.toLocaleString() + " out)");
    if (cost) parts.push("charged " + cost.toLocaleString());
    return parts.length ? parts.join(" · ") : "usage unavailable";
  }

  // 逐行评分排成表格：第一列用图标表示这一点有没有拿到，
  // 正文只留「1M — 说明」，把 AI 自己在行首加的表情/勾叉去掉。
  function splitMarkLine(raw) {
    let s = String(raw == null ? '' : raw).trim();

    // 去掉行首的一串符号（✔ ✓ ✘ ✗ ✅ ❌ ● ○ 等），保留真正的判断
    let earned = null;
    const lead = /^[\s\u2713\u2714\u2717\u2718\u2705\u274C\u274E\u2B50\u25CF\u25CB\u2022\u00B7\-\u2013\u2014]*/;
    const leadMatch = lead.exec(s);
    if (leadMatch && leadMatch[0].trim()) {
      const sym = leadMatch[0];
      if (/[\u2713\u2714\u2705]/.test(sym)) earned = true;
      else if (/[\u2717\u2718\u274C\u274E]/.test(sym)) earned = false;
      s = s.slice(sym.length).trim();
    }
    // 有些回复写成 "1M — ..." 或 "1M: ..."，把编号拆出来单独一列
    let tag = '';
    const tagMatch = /^([0-9]*\s*[MA])\s*[—–:\-]\s*/i.exec(s);
    if (tagMatch) {
      tag = tagMatch[1].replace(/\s+/g, '');
      s = s.slice(tagMatch[0].length).trim();
    }
    // 句子本身就是用英文写的 ok / wrong 判断时，拿来当图标依据
    if (earned == null) {
      if (/^(ok\b|correct|awarded|earned)/i.test(s)) earned = true;
      else if (/^(no\b|not\b|missing|lost|incorrect|wrong)/i.test(s)) earned = false;
    }
    return { earned, tag, text: s };
  }

  function renderMarkTable(lines) {
    const rows = lines.map((raw) => splitMarkLine(raw));
    const gained = rows.filter((r) => r.earned === true).length;
    const lost = rows.filter((r) => r.earned === false).length;

    const body = rows.map((r) => {
      // 绿色对勾 / 红色叉 / 中性点，和主站题目的 Solved 标记同一套视觉
      const icon = r.earned === true
        ? '<i class="fas fa-circle-check pmf-ok"></i>'
        : r.earned === false
          ? '<i class="fas fa-circle-xmark pmf-bad"></i>'
          : '<i class="fas fa-circle-minus pmf-neutral"></i>';
      return '<tr>' +
        '<td class="pmf-icon">' + icon + '</td>' +
        (r.tag ? '<td class="pmf-tag">' + esc(r.tag) + '</td>' : '<td class="pmf-tag"></td>') +
        '<td class="pmf-text">' + esc(r.text) + '</td>' +
      '</tr>';
    }).join('');

    return '<table class="paper-mark-table">' +
      '<thead><tr>' +
        '<th class="pmf-icon"></th>' +
        '<th class="pmf-tag">Mark</th>' +
        '<th class="pmf-text">Comment</th>' +
        '<th class="pmf-count">' + (gained || lost
          ? gained + ' <i class="fas fa-check pmf-ok"></i> · ' + lost + ' <i class="fas fa-xmark pmf-bad"></i>'
          : '') + '</th>' +
      '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
    '</table>';
  }

  function renderMarkInto(el, mark) {
    if (!mark) return;
    const score = Number(mark.score) || 0;
    const cls = score >= 80 ? 'good' : score >= 50 ? 'mid' : 'bad';
    const head = mark.awarded != null && mark.total != null
      ? mark.awarded + ' / ' + mark.total + ' marks'
      : score + '%';
    const lines = Array.isArray(mark.lines) ? mark.lines : [];

    el.innerHTML = `
      <div class="paper-mark-head ${cls}">
        <span class="pm-score">${esc(head)}</span>
        ${mark.summary ? '<span class="pm-summary">' + esc(mark.summary) + '</span>' : ''}
      </div>
      ${(mark.usage || mark.chargedTokens) ? '<div class="pm-usage"><i class="fas fa-coins"></i>' + esc(fmtUsage(mark)) + '</div>' : ''}
      ${lines.length ? renderMarkTable(lines) : ''}`;

    // 评语里带 LaTeX，直接渲染出来（$...$ / $$...$$）
    renderMath(el);
  }

  // ─────────── 启动 ───────────
  Page.ready(async () => {
    const route = parseRoute();
    if (route.view === 'tracks') return renderTracks();
    if (route.view === 'dseSubmissions') {
      const qp = new URLSearchParams(location.search);
      return renderDseSubmissions(qp.get('page'));
    }
    if (route.view === 'paperTracks') return renderPaperTracks();
    if (route.view === 'paperYears') return renderPaperYears(route.track);
    if (route.view === 'paper') return renderPaper(route.track, route.year);
    if (route.view === 'list') return renderList(route.track);
    return renderCourse(route.track, route.id);
  });
})();
