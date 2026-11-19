// assets/js/pd-mc-page.js —— 学生端：整份 PDF + 覆盖式作答
//
// 一道题可以有多个作答框（mcSlots），也可以只有一个（旧的 mcq）。
// 每个框是一道小题：点圆圈选答案，框左边有 check 可以单独批改这个框。
// 页尾 Submit 把这一页上所有已作答的框一次交上去。
//
// 提交时答案按框的顺序拼成 "B|A|D"，交给 problem.logic 判分。

(function () {
  'use strict';
  if (window.MCPage) return;

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function storageKey(pid) { return 'mcPicks:' + pid; }

  function loadPicks(pid) {
    try { return JSON.parse(localStorage.getItem(storageKey(pid)) || '{}') || {}; } catch (e) { return {}; }
  }
  function savePicks(pid, picks) {
    try { localStorage.setItem(storageKey(pid), JSON.stringify(picks)); } catch (e) {}
  }

  /**
   * @param {object} opts
   *   host       容器
   *   problemId
   *   pdfUrl
   *   slots      数组，每项 { page, box, options }
   */
  async function mount(opts) {
    const { host, problemId, pdfUrl, slots } = opts;
    if (!host || !pdfUrl || !Array.isArray(slots) || !slots.length) return false;

    const picks = loadPicks(problemId);          // { 0: 'B', 1: 'A', ... }
    const views = new Map();                     // idx -> drawQuestion 返回值

    host.innerHTML = '';
    host.classList.add('mcs-sheet');

    // ── 工具条 ──
    const toolbar = el('div', 'mcs-toolbar');
    toolbar.innerHTML =
      '<span class="mcs-progress">Answered <b id="mcsAnswered">0</b> / <b>' + slots.length + '</b></span>' +
      '<span class="mcs-spacer"></span>' +
      '<a class="mcs-open" target="_blank" rel="noopener" href="' + pdfUrl + '">' +
        '<i class="fas fa-external-link-alt"></i> Open PDF</a>';
    host.appendChild(toolbar);

    const scroll = el('div', 'mcs-scroll');
    host.appendChild(scroll);

    let pages;
    try {
      pages = await window.MCSHEET.renderPdf(scroll, pdfUrl);
    } catch (e) {
      host.innerHTML = '<div class="mcs-error"><i class="fas fa-triangle-exclamation"></i> Could not load the paper PDF.</div>';
      return false;
    }

    // 每个框按自己的页去画
    slots.forEach((slot, idx) => {
      const pageEl = pages[Math.max(0, (Number(slot.page) || 1) - 1)];
      if (!pageEl) return;

      const picked = picks[idx] || '';
      const view = window.MCSHEET.drawQuestion(pageEl, slot, {
        keyLabel: 'Q' + (idx + 1),
        picked,
        showCheck: slots.length > 0,
        onPick(key) {
          picks[idx] = key;
          savePicks(problemId, picks);
          view.setPick(key);
          updateProgress();
        },
        onCheck() {
          const pick = picks[idx];
          if (!pick) {
            if (window.DSHUI && DSHUI.toast) DSHUI.toast('Pick an option first', 'err');
            return;
          }
          checkOne(idx, view);
        },
      });
      views.set(idx, view);
    });

    function updateProgress() {
      const n = Object.keys(picks).filter((k) => picks[k]).length;
      const a = document.getElementById('mcsAnswered');
      if (a) a.textContent = String(n);
    }

    /** 单框批改：把当前所有已答的答案按顺序拼起来提交 */
    async function checkOne(idx, view) {
      view.setChecking(true);
      try {
        const answer = slots.map((_, i) => picks[i] || '').join('|');
        const res = await apiCall('/api/paper-mc?action=check', 'POST', { problemId, pick: answer });
        if (!res || !res.success) throw new Error((res && res.message) || 'Check failed');
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

    // ── 页尾 Submit ──
    const footer = el('div', 'mcs-footer');
    const btn = el('button', 'mcs-submit');
    btn.type = 'button';
    btn.textContent = 'Submit paper';
    btn.addEventListener('click', async () => {
      const answered = slots.map((_, i) => picks[i] || '').join('|');
      if (!answered.replace(/\|/g, '')) {
        if (window.DSHUI && DSHUI.toast) DSHUI.toast('Answer at least one question first', 'err');
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Marking…';
      try {
        const res = await apiCall('/api/paper-mc?action=check', 'POST', { problemId, pick: answered });
        if (!res || !res.success) throw new Error((res && res.message) || 'Submit failed');
        // 判分是按整串答案给出的，这里只把结果标在每题上：
        // 整题对 → 全部绿；整题错 → 只把学生选的标红，不透露正确答案
        slots.forEach((_, i) => {
          const v = views.get(i);
          if (!v || !picks[i]) return;
          v.markResult(!!res.correct);
        });
        btn.textContent = res.correct ? 'Marked · correct' : 'Marked · see comments';
        if (window.DSHUI && DSHUI.toast) {
          DSHUI.toast(res.comment || (res.correct ? 'Correct' : 'Incorrect'), res.correct ? 'ok' : 'err');
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

    updateProgress();
    return true;
  }

  window.MCPage = { mount };
})();
