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
    const placeholders = [...contentEl.querySelectorAll('[pid]')];
    placeholders.forEach((ph) => {
      const pid = ph.getAttribute('pid');
      if (!pid) return;
      const card = document.createElement('div');
      card.className = 'inline-problem';
      card.dataset.pid = pid;
      card.innerHTML = '<div class="ip-head"><span class="ip-tag">' + esc(pid) + '</span><span class="ip-status">Loading…</span></div>';
      ph.replaceWith(card);
      loadInlineProblem(card, pid, solved.has(pid));
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

  function showResult(card, result, subid) {
    const score = Number(result && result.score);
    const ok = score === 100;
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
