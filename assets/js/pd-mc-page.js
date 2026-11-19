// assets/js/pd-mc-page.js —— 把一道 MC 题接成「整份 PDF + 覆盖式答题」的页面
//
// 由 pd-script 在题目数据到手之后调用（见 pd-script.js 里的 mountMcSheet）。
// 只在题目同时满足三个条件时接管：
//   1. tags 里带 MC
//   2. 有 pdfUrl
//   3. 有 mcq 版式（box + 四个圈）
// 缺任何一条就回退成普通题目，不做任何改造。

(function () {
  'use strict';
  if (window.MCPage) return;

  const PICKS_KEY = (pid) => 'mcPicks:' + pid;

  function loadPicks(pid) {
    try { return JSON.parse(localStorage.getItem(PICKS_KEY(pid)) || '{}'); } catch (e) { return {}; }
  }
  function savePicks(pid, picks) {
    try { localStorage.setItem(PICKS_KEY(pid), JSON.stringify(picks)); } catch (e) {}
  }

  /**
   * @param {object} opts
   *   host      放 PDF 的容器（会被整体接管）
   *   problemId 当前题号
   *   pdfUrl
   *   layout    { page, box, options }
   *   paperIds  同一份卷子的其他题号（整卷提交用）
   */
  async function mount(opts) {
    const { host, problemId, pdfUrl, layout, paperIds } = opts;
    if (!host || !pdfUrl || !layout) return false;

    const picks = loadPicks(problemId);
    const answers = new Map();          // problemId -> 选的字母
    const views = new Map();            // problemId -> drawQuestion 的返回

    host.innerHTML = '';
    host.classList.add('mcs-sheet');

    const toolbar = document.createElement('div');
    toolbar.className = 'mcs-toolbar';
    toolbar.innerHTML =
      '<span class="mcs-progress">Answered <b id="mcsAnswered">0</b> / <b id="mcsTotal">' + paperIds.length + '</b></span>' +
      '<span class="mcs-spacer"></span>' +
      '<a class="mcs-open" target="_blank" rel="noopener" href="' + pdfUrl + '">' +
        '<i class="fas fa-external-link-alt"></i> Open PDF</a>';
    host.appendChild(toolbar);

    const scroll = document.createElement('div');
    scroll.className = 'mcs-scroll';
    host.appendChild(scroll);

    let pages;
    try {
      pages = await window.MCSHEET.renderPdf(scroll, pdfUrl);
    } catch (e) {
      host.innerHTML = '<div class="mcs-error"><i class="fas fa-triangle-exclamation"></i> Could not load the paper PDF.</div>';
      return false;
    }

    const pageEl = pages[Math.max(0, (layout.page || 1) - 1)];
    if (!pageEl) {
      host.innerHTML = '<div class="mcs-error">The layout points at page ' + layout.page + ' but the PDF has ' + pages.length + '.</div>';
      return false;
    }

    // 当前题先画上
    function drawFor(pid, lay) {
      const picked = answers.get(pid) || '';
      const view = window.MCSHEET.drawQuestion(pageEl, lay, {
        keyLabel: pid,
        picked,
        showCheck: paperIds.length === 1,
        onPick(key) {
          answers.set(pid, key);
          const cur = loadPicks(problemId);
          cur[pid] = key;
          savePicks(problemId, cur);
          view.setPick(key);
          updateProgress();
        },
        onCheck() {
          const pick = answers.get(pid);
          if (!pick) {
            if (window.DSHUI && DSHUI.toast) DSHUI.toast('Pick an option first', 'err');
            return;
          }
          checkOne(pid, pick, view);
        },
      });
      views.set(pid, view);
      return view;
    }

    async function checkOne(pid, pick, view) {
      view.setChecking(true);
      try {
        const res = await apiCall('/api/paper-mc?action=check', 'POST', { problemId: pid, pick });
        if (!res.success) throw new Error(res.message || 'Check failed');
        view.markResult(!!res.correct);
        if (window.DSHUI && DSHUI.toast) {
          DSHUI.toast(res.comment || (res.correct ? 'Correct' : 'Incorrect'), res.correct ? 'ok' : 'err');
        }
      } catch (e) {
        if (window.DSHUI && DSHUI.toast) DSHUI.toast(e.message, 'err');
      } finally {
        view.setChecking(false);
      }
    }

    function updateProgress() {
      const n = answers.size;
      const a = document.getElementById('mcsAnswered');
      if (a) a.textContent = String(n);
    }

    drawFor(problemId, layout);
    updateProgress();

    // 整卷提交
    if (paperIds.length > 1) {
      const footer = document.createElement('div');
      footer.className = 'mcs-footer';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mcs-submit';
      btn.textContent = 'Submit paper';
      btn.addEventListener('click', async () => {
        const items = paperIds
          .map((pid) => ({ problemId: pid, pick: answers.get(pid) || '' }))
          .filter((x) => x.pick);
        if (!items.length) {
          if (window.DSHUI && DSHUI.toast) DSHUI.toast('Answer at least one question first', 'err');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Marking…';
        try {
          const res = await apiCall('/api/paper-mc?action=submit', 'POST', { items });
          if (!res.success) throw new Error(res.message || 'Submit failed');
          (res.results || []).forEach((r) => {
            const v = views.get(r.problemId);
            if (!v || r.attempted === false || r.error) return;
            v.markResult(!!r.correct);
          });
          btn.textContent = 'Marked · ' + res.correct + '/' + res.attempted;
          if (window.DSHUI && DSHUI.toast) {
            DSHUI.toast('Marked ' + res.attempted + ' answered, ' + res.correct + ' correct', 'ok');
          }
          if (window.updateTopbarTokens) {
            apiCall('/api/token').then((t) => {
              if (t && t.success) window.updateTopbarTokens(t.daily, t.global);
            }).catch(() => {});
          }
        } catch (e) {
          btn.disabled = false;
          btn.textContent = 'Submit paper';
          if (window.DSHUI && DSHUI.toast) DSHUI.toast(e.message, 'err');
        }
      });
      footer.appendChild(btn);
      host.appendChild(footer);
    }

    return true;
  }

  window.MCPage = { mount };
})();
