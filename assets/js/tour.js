/* ═══════════════════════════════════════════════════════════════════
 * tour.js — guided onboarding tour engine (multi-page spotlight)
 *
 * Runs on: /index.html, /problems, /problems/:id, /submissions,
 *          /submissions/:id/detail
 *
 * State is persisted in localStorage so a step can advance across
 * full-page navigations (the tour is a state machine keyed by step id;
 * each step declares which page it belongs to).
 *
 * Public API (the "port" for future tutorials):
 *   window.MOJTours.register(id, { name, steps })
 *   window.MOJTours.start(id)      // start a registered tour
 *   window.MOJTours.skip()         // stop + mark done
 *   window.MOJTours.reset()        // clear state + done flag
 *   window.MOJTours.state()        // read current state
 *
 * Force / reset via URL:
 *   ?tour=1  -> (re)start the new-user tour (index) / start at matching step elsewhere
 *   ?tour=0  -> stop the tour and mark it done (won't auto-start again)
 *   Runtime: window.MOJTours.reset()   // forget "done" so it can auto-start again
 * ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MOJTours) return;

  const STATE_KEY = 'wyk_tour_state_v1';
  const DONE_KEY  = 'wyk_tour_newuser_done';
  const PROBLEM_ID = 'A001';

  const registry = {};
  let overlay = null;
  const timers = {};

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  /* ────────────────────────── styles ────────────────────────── */
  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const st = document.createElement('style');
    st.id = 'tour-style';
    st.textContent = `
      #tour-root, #tour-welcome { font-family: system-ui, -apple-system, "Segoe UI", "PingFang HK", sans-serif; }
      .tour-shield { position: absolute; background: rgba(0,0,0,.58); pointer-events: auto; }
      .tour-ring {
        position: absolute; border: 2px solid #4a90ff; border-radius: 10px;
        pointer-events: none; animation: tourPulse 1.8s ease-in-out infinite;
      }
      @keyframes tourPulse {
        0%,100% { box-shadow: 0 0 0 4px rgba(74,144,255,.35), 0 0 26px rgba(74,144,255,.85); }
        50%     { box-shadow: 0 0 0 8px rgba(74,144,255,.18), 0 0 38px rgba(74,144,255,1); }
      }
      .tour-tip {
        position: absolute; pointer-events: auto; background: #fff; color: #1a1a2e;
        border-radius: 12px; padding: 14px 16px; box-shadow: 0 14px 44px rgba(0,0,0,.4);
        border: 1px solid rgba(0,0,0,.08); font-size: .9rem; line-height: 1.5;
        box-sizing: border-box;
      }
      [data-theme="dark"] .tour-tip { background: #1e1e1e; color: #e6edf3; border-color: #333; }
      .tour-tip-body b, .tour-tip-body strong { color: #337ab7; }
      [data-theme="dark"] .tour-tip-body b, [data-theme="dark"] .tour-tip-body strong { color: #6fb2ff; }
      .tour-tip-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
      .tour-tip-spacer { flex: 1; }
      .tour-btn {
        border: none; border-radius: 8px; padding: 7px 14px; font-size: .84rem;
        font-weight: 600; cursor: pointer; background: #337ab7; color: #fff; font-family: inherit;
        transition: filter .15s, transform .15s;
      }
      .tour-btn:hover { filter: brightness(1.1); }
      .tour-btn:active { transform: translateY(1px); }
      .tour-btn-ghost { background: transparent; color: inherit; opacity: .62; padding-left: 6px; padding-right: 6px; }
      .tour-btn-ghost:hover { opacity: 1; }
      .tour-progress {
        font-size: .72rem; font-variant-numeric: tabular-nums; opacity: .5;
        margin-left: 8px; letter-spacing: .3px;
      }
      .tour-wait-spinner {
        display: inline-block; width: 14px; height: 14px; vertical-align: middle;
        border: 2px solid rgba(127,127,127,.3); border-top-color: #337ab7;
        border-radius: 50%; animation: tourSpin .8s linear infinite;
      }
      @keyframes tourSpin { to { transform: rotate(360deg); } }
      #tour-welcome {
        position: fixed; inset: 0; z-index: 2147483001; display: flex;
        align-items: center; justify-content: center; padding: 20px;
        background: rgba(0,0,0,.62);
      }
      .tour-welcome-card {
        background: #fff; color: #1a1a2e; border-radius: 16px; padding: 28px 24px;
        max-width: 440px; width: 100%; box-shadow: 0 24px 70px rgba(0,0,0,.45);
        text-align: center; animation: tourIn .3s ease;
      }
      [data-theme="dark"] .tour-welcome-card { background: #1e1e1e; color: #e6edf3; }
      @keyframes tourIn { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
      .tour-welcome-card h2 { margin: 10px 0 8px; font-size: 1.35rem; letter-spacing: -.3px; }
      .tour-welcome-card p { margin: 0 0 20px; font-size: .9rem; color: #555; line-height: 1.6; }
      [data-theme="dark"] .tour-welcome-card p { color: #aaa; }
      .tour-welcome-icon { font-size: 2.4rem; color: #337ab7; }
      .tour-welcome-actions { display: flex; gap: 10px; justify-content: center; }
      .tour-welcome-actions .tour-btn { padding: 9px 22px; font-size: .9rem; }
    `;
    document.head.appendChild(st);
  }

  /* ────────────────────────── state ────────────────────────── */
  function readState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || null; } catch { return null; }
  }
  function writeState(s) {
    try { s ? localStorage.setItem(STATE_KEY, JSON.stringify(s)) : localStorage.removeItem(STATE_KEY); } catch {}
  }

  /* ────────────────────────── page detection ────────────────────────── */
  function currentPage() {
    const p = (location.pathname || '/').replace(/\/+$/, '') || '/';
    if (p === '/' || p === '/index.html') return 'index';
    if (p === '/problems' || p === '/problems.html') return 'problems';
    if (p === '/submissions' || p === '/submissions.html') return 'submissions';
    if (/^\/submissions\/(user|problem)\/[^/]+$/.test(p)) return 'submissions';
    if (/^\/submissions\/[^/]+\/detail$/.test(p)) return 'submission';
    if (p === '/ranklist' || p === '/leaderboard' || p === '/ranklist.html') return 'ranklist';
    if (/^\/problems\/[^/]+$/.test(p)) {
      const id = decodeURIComponent(p.split('/').pop());
      return (id === 'bookmarked' || id === 'bookmark') ? 'other' : 'problem';
    }
    return 'other';
  }

  function isLoggedInSafe() {
    if (typeof isLoggedIn === 'function') { try { return isLoggedIn(); } catch (e) {} }
    return !!localStorage.getItem('auth_token');
  }

  async function hasNoSolves() {
    const token = localStorage.getItem('auth_token');
    if (!token) return false;
    try {
      const res = await fetch('/api/users?action=stats', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || !data.success) return false;
      const states = data.states || {};
      return !Object.keys(states).some(k => states[k] === 'passed');
    } catch (e) { return false; }
  }

  /* ────────────────────────── overlay ────────────────────────── */
  function clearOverlay() {
    Object.keys(timers).forEach(k => { clearTimeout(timers[k]); delete timers[k]; });
    if (!overlay) return;
    try { if (overlay.cleanup) overlay.cleanup(); } catch (e) {}
    if (overlay.root && overlay.root.parentNode) overlay.root.parentNode.removeChild(overlay.root);
    overlay = null;
  }

  function makeTip(html, buttons, progress) {
    const tip = document.createElement('div');
    tip.className = 'tour-tip';
    const btnHtml = (buttons || []).map(b =>
      `<button class="tour-btn ${b.primary ? '' : 'tour-btn-ghost'}" data-act="${esc(b.act)}">${esc(b.label)}</button>`
    ).join('');
    const progressHtml = progress
      ? `<span class="tour-progress">${esc(progress.now)} / ${esc(progress.total)}</span>`
      : '';
    tip.innerHTML = `
      <div class="tour-tip-body">${html || ''}</div>
      <div class="tour-tip-actions">
        <button class="tour-btn tour-btn-ghost" data-act="skip">Skip tour</button>
        ${progressHtml}
        <div class="tour-tip-spacer"></div>
        ${btnHtml}
      </div>`;
    tip.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'skip') { skipTour(); return; }
      const found = (buttons || []).find(x => x.act === act);
      if (found && typeof found.onClick === 'function') found.onClick();
    });
    return tip;
  }

  function showSpotlight(el, html, buttons, opts) {
    opts = opts || {};
    clearOverlay();
    const root = document.createElement('div');
    root.id = 'tour-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
    document.body.appendChild(root);

    const tip = makeTip(html, buttons, opts.progress);
    root.appendChild(tip);

    const shields = {};
    ['top', 'bottom', 'left', 'right'].forEach(name => {
      const d = document.createElement('div');
      d.className = 'tour-shield';
      shields[name] = d;
      root.appendChild(d);
    });

    const ring = document.createElement('div');
    ring.className = 'tour-ring';
    root.appendChild(ring);

    let raf = null;
    function layout() {
      const r = el.getBoundingClientRect();
      const pad = 6;
      const vw = window.innerWidth, vh = window.innerHeight;
      const top = Math.max(0, r.top - pad);
      const left = Math.max(0, r.left - pad);
      const right = Math.min(vw, r.right + pad);
      const bottom = Math.min(vh, r.bottom + pad);

      shields.top.style.cssText    = `left:0;top:0;width:${vw}px;height:${top}px;`;
      shields.bottom.style.cssText = `left:0;top:${bottom}px;width:${vw}px;height:${Math.max(0, vh - bottom)}px;`;
      shields.left.style.cssText   = `left:0;top:${top}px;width:${left}px;height:${Math.max(0, bottom - top)}px;`;
      shields.right.style.cssText  = `left:${right}px;top:${top}px;width:${Math.max(0, vw - right)}px;height:${Math.max(0, bottom - top)}px;`;

      ring.style.left = left + 'px';
      ring.style.top = top + 'px';
      ring.style.width = (right - left) + 'px';
      ring.style.height = (bottom - top) + 'px';

      // tooltip placement
      tip.style.maxWidth = Math.min(340, vw - 24) + 'px';
      const tw = tip.offsetWidth || 300;
      const th = tip.offsetHeight || 100;
      let tx = Math.min(Math.max(12, (left + right) / 2 - tw / 2), Math.max(12, vw - tw - 12));
      let ty;
      if (vh - bottom > th + 24) ty = bottom + 12;
      else if (top > th + 24) ty = top - th - 12;
      else ty = Math.max(12, vh - th - 16);
      ty = Math.min(ty, Math.max(12, vh - th - 12));
      tip.style.left = tx + 'px';
      tip.style.top = ty + 'px';
    }

    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
    requestAnimationFrame(layout);

    const onResize = () => layout();
    const onScroll = () => { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);

    let targetClick = null;
    if (opts.targetSel && opts.onTargetClick) {
      const ignore = opts.ignoreSel;
      targetClick = (e) => {
        if (e.target.closest('#tour-root')) return;
        const t = e.target.closest(opts.targetSel);
        if (!t) return;
        if (ignore && e.target.closest(ignore)) return;
        opts.onTargetClick(e);
      };
      document.addEventListener('click', targetClick, true);
    }

    overlay = {
      root,
      cleanup: () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scroll', onScroll, true);
        if (targetClick) document.removeEventListener('click', targetClick, true);
        if (raf) cancelAnimationFrame(raf);
        if (opts.cleanup) opts.cleanup();
      },
    };
  }

  function showCenter(html, buttons, progress) {
    clearOverlay();
    const root = document.createElement('div');
    root.id = 'tour-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;pointer-events:auto;box-sizing:border-box;';
    const tip = makeTip(html, buttons, progress);
    tip.style.position = 'relative';
    tip.style.maxWidth = '440px';
    tip.style.width = '100%';
    root.appendChild(tip);
    document.body.appendChild(root);
    overlay = { root, cleanup: () => {} };
  }

  function showWaiting(html) {
    clearOverlay();
    const root = document.createElement('div');
    root.id = 'tour-root';
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;pointer-events:auto;box-sizing:border-box;';
    const tip = makeTip(html, []);
    tip.style.position = 'relative';
    tip.style.maxWidth = '400px';
    tip.style.width = '100%';
    tip.style.textAlign = 'center';
    tip.querySelector('.tour-tip-body').insertAdjacentHTML('beforeend',
      '<div style="margin-top:10px"><span class="tour-wait-spinner"></span> Waiting…</div>');
    root.appendChild(tip);
    document.body.appendChild(root);
    overlay = { root, cleanup: () => {} };
  }

  function waitFor(sel, timeout) {
    return new Promise(resolve => {
      const el = $(sel);
      if (el) return resolve(el);
      const start = Date.now();
      const iv = setInterval(() => {
        const e = $(sel);
        if (e) { clearInterval(iv); resolve(e); }
        else if (Date.now() - start > (timeout || 20000)) { clearInterval(iv); resolve(null); }
      }, 200);
      timers['wait_' + sel] = iv;
    });
  }

  // If the target lives inside the mobile (collapsed) sidebar, open it first.
  function ensureVisible(el, cb) {
    try {
      if (el.closest('#sidebarContainer') && window.innerWidth <= 768 &&
          typeof window.toggleSidebar === 'function') {
        const sb = document.getElementById('sidebarContainer');
        if (sb && !sb.classList.contains('open')) {
          window.toggleSidebar();
          setTimeout(cb, 380);
          return;
        }
      }
    } catch (e) {}
    cb();
  }

  function waitUntil(fn, timeout) {
    return new Promise(resolve => {
      let ok = false;
      try { ok = !!fn(); } catch (e) {}
      if (ok) return resolve(true);
      const start = Date.now();
      const iv = setInterval(() => {
        let done = false;
        try { done = !!fn(); } catch (e) {}
        if (done) { clearInterval(iv); resolve(true); }
        else if (Date.now() - start > (timeout || 8000)) { clearInterval(iv); resolve(false); }
      }, 150);
    });
  }

  /* ────────────────────────── welcome ────────────────────────── */
  function showWelcome(step) {
    clearOverlay();
    const el = document.createElement('div');
    el.id = 'tour-welcome';
    el.innerHTML = `
      <div class="tour-welcome-card">
        <div class="tour-welcome-icon"><i class="fas fa-graduation-cap"></i></div>
        <h2>Welcome to WYK Maths Team</h2>
        <p>A short walkthrough — finding a problem, submitting an answer, and reading the result.</p>
        <div class="tour-welcome-actions">
          <button class="tour-btn tour-btn-ghost" data-act="skip">Skip</button>
          <button class="tour-btn" data-act="start">Start tour</button>
        </div>
      </div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'skip') skipTour();
      if (b.dataset.act === 'start') advanceTo(step.next);
    });
    document.body.appendChild(el);
    overlay = { root: el, cleanup: () => {} };
  }

  /* ────────────────────────── step running ────────────────────────── */
  function stepButtons(step) {
    if (step.type === 'back') {
      return [{
        label: step.buttonLabel || 'Back',
        act: 'back',
        primary: true,
        onClick: () => {
          if (step.next == null) { finishTour(); }
          else advanceTo(step.next);
          if (step.goto) setTimeout(() => { location.href = step.goto; }, 0);
        },
      }];
    }
    if (step.type === 'info') {
      return [{ label: 'Next', act: 'next', primary: true, onClick: () => advanceTo(step.next) }];
    }
    return [];
  }

  function renderStep(tour, step) {
    if (step.type === 'welcome') { showWelcome(step); return; }

    const buttons = stepButtons(step);

    // Progress indicator: position within the tour, counting only the steps the
    // user actually sees (the welcome card has its own layout).
    const visibleSteps = tour.steps.filter(s => s.type !== 'welcome');
    const progress = {
      now: visibleSteps.findIndex(s => s.id === step.id) + 1,
      total: visibleSteps.length,
    };

    if (step.type === 'back') { showCenter(step.html, buttons, progress); return; }

    const renderAt = (el) => {
      // guard: tour may have been skipped / advanced while we were waiting
      const st = readState();
      if (!st || st.step !== step.id) return;
      ensureVisible(el, () => {
        if (step.type === 'input') {
          showSpotlight(el, step.html, buttons, { progress });
          try { el.focus(); } catch (e) {}
          const onInput = () => {
            if (String(el.value || '').trim() === '0.000123') {
              el.removeEventListener('input', onInput);
              advanceTo(step.next);
            }
          };
          el.addEventListener('input', onInput);
          if (String(el.value || '').trim() === '0.000123') advanceTo(step.next);
          // ensure removal if overlay is cleared early
          const prev = overlay.cleanup;
          overlay.cleanup = () => { el.removeEventListener('input', onInput); prev && prev(); };
          return;
        }

        // click step (and 'info' steps fall through here too if a target is set)
        showSpotlight(el, step.html, buttons, {
          progress,
          targetSel: step.target,
          ignoreSel: step.ignoreSel,
          onTargetClick: () => {
            advanceTo(step.next);
            if (typeof step.onAdvance === 'function') {
              try { step.onAdvance(); } catch (e) {}
            }
          },
        });
      });
    };

    const existing = $(step.target);
    if (existing) {
      if (typeof step.ready === 'function') {
        showWaiting(step.html);
        waitUntil(step.ready, step.timeout || 8000).then(() => renderAt(existing));
      } else {
        renderAt(existing);
      }
      return;
    }

    showWaiting(step.html);
    waitFor(step.target, step.timeout || 10000).then(async (el) => {
      if (!el) {
        showCenter(step.html + '<div class="small" style="margin-top:10px;opacity:.6">Target not found on this page — you can skip the tour.</div>', [], progress);
        return;
      }
      if (typeof step.ready === 'function') {
        await waitUntil(step.ready, step.timeout || 8000);
      }
      renderAt(el);
    });
  }

  function runCurrentPage() {
    clearOverlay();
    const st = readState();
    if (!st || !st.tourId) return;
    const tour = registry[st.tourId];
    if (!tour) return;
    const step = tour.steps.find(s => s.id === st.step);
    if (!step) return;
    if (step.page !== currentPage()) return;   // dormant until the matching page
    renderStep(tour, step);
  }

  /* ────────────────────────── advance / end ────────────────────────── */
  function advanceTo(nextId) {
    const st = readState();
    if (!st) return;
    if (nextId == null) { finishTour(); return; }
    st.step = nextId;
    writeState(st);
    setTimeout(() => runCurrentPage(), 0);
  }

  function finishTour() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    writeState(null);
    clearOverlay();
  }

  function skipTour() {
    try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {}
    writeState(null);
    clearOverlay();
  }

  function reset() {
    try { localStorage.removeItem(DONE_KEY); } catch (e) {}
    writeState(null);
    clearOverlay();
  }

  /* ────────────────────────── start / auto ────────────────────────── */
  function startTour(id) {
    const tour = registry[id];
    if (!tour) return;
    writeState({ tourId: id, step: tour.steps[0].id, ctx: {}, active: true });
    runCurrentPage();
  }

  function maybeAutoStart() {
    const params = new URLSearchParams(location.search);
    const force = params.get('tour');
    if (force === '0') { skipTour(); return; }
    if (force === '1') { startTour('new-user'); return; }

    const st = readState();
    if (st && st.tourId) { runCurrentPage(); return; }   // resume an in-progress tour

    if (localStorage.getItem(DONE_KEY) === '1') return;
    if (!isLoggedInSafe()) return;

    hasNoSolves().then((isNew) => {
      if (isNew) startTour('new-user');
    });
  }

  /* ────────────────────────── tour definition ────────────────────────── */
  const NEW_USER_TOUR = {
    name: 'New user tour',
    steps: [
      { id: 'welcome', page: 'index', type: 'welcome', next: 'index_problems' },

      { id: 'index_problems', page: 'index', type: 'click',
        target: '.sidebar-link[data-page="problems"]',
        html: 'The sidebar is how you move around. Start with the <b>Problems</b> bank.',
        next: 'problems_a001' },

      { id: 'problems_a001', page: 'problems', type: 'click',
        target: 'tr.problem-row[data-id="' + PROBLEM_ID + '"]',
        ignoreSel: '.col-fav',
        html: 'Each row carries a difficulty rating and topic tags. Open <b>' + PROBLEM_ID + '</b> to see one from the inside.',
        next: 'detail_text' },

      { id: 'detail_text', page: 'problem', type: 'click',
        target: '.wb-tab[data-mode="text"]',
        html: 'Problems accept more than one answer format. Switch to <b>Text</b> to type one.',
        next: 'detail_statement',
        ready: () => !!(window.PD && window.PD.workbench),
        onAdvance: () => {
          // safety net: open text mode even if the tab handler wasn't bound yet
          setTimeout(() => {
            const pane = document.querySelector('.wb-pane[data-pane="text"]');
            const wb = window.PD && window.PD.workbench;
            if (pane && !pane.classList.contains('active') && wb && wb.mode !== 'text') {
              try { wb.setMode('text'); } catch (e) {}
            }
          }, 60);
        } },

      { id: 'detail_statement', page: 'problem', type: 'info',
        target: '#statementContent',
        html: 'The statement. Formulas are typeset properly, so read them as you would on paper. Click to continue.',
        next: 'detail_input' },

      { id: 'detail_input', page: 'problem', type: 'input',
        target: '#answerInput',
        ready: () => {
          const p = document.querySelector('.wb-pane[data-pane="text"]');
          return !!p && p.classList.contains('active');
        },
        html: 'Enter <b>0.000123</b> as the answer.',
        next: 'detail_submit' },

      { id: 'detail_submit', page: 'problem', type: 'click',
        target: '#checkAnswerBtn',
        html: 'Submit when you are ready. A wrong answer costs nothing — you can try again.',
        next: 'detail_accepted' },

      { id: 'detail_accepted', page: 'problem', type: 'click',
        target: '#wbStatus a.feedback-box',
        html: 'The verdict appears here. Open it to see exactly what was recorded.',
        next: 'submission_back' },

      { id: 'submission_back', page: 'submission', type: 'back',
        buttonLabel: 'Back', goto: '/problems/' + PROBLEM_ID,
        html: 'Your submission, with the answer and the result. Go back to the problem.',
        next: 'detail_problem_subs' },

      { id: 'detail_problem_subs', page: 'problem', type: 'click',
        target: '#submissionsBtn',
        html: 'Every attempt at this problem, from everyone — often useful for comparing methods.',
        next: 'detail_subs_back' },

      { id: 'detail_subs_back', page: 'submissions', type: 'back',
        buttonLabel: 'Back', goto: '/problems/' + PROBLEM_ID,
        html: 'Filter by status or read other people\'s answers here. Back to the problem.',
        next: 'problem_sidebar_rank' },

      { id: 'problem_sidebar_rank', page: 'problem', type: 'click',
        target: '.sidebar-link[data-page="ranklist"], .sidebar-link[href="/ranklist"], .sidebar-link[href="/leaderboard"], .sidebar-link[data-page="leaderboard"]',
        html: 'Last stop: the <b>Leaderboard</b>, to see where you stand.',
        next: 'ranklist_view' },

      { id: 'ranklist_view', page: 'ranklist', type: 'back',
        buttonLabel: 'Finish',
        html: 'That is the whole loop — pick a problem, answer it, read the result. You are ready to start.',
        next: null },
    ],
  };

  registry['new-user'] = NEW_USER_TOUR;

  /* ────────────────────────── init ────────────────────────── */
  injectStyles();

  const forceParam = new URLSearchParams(location.search).get('tour');

  if (currentPage() === 'index') {
    maybeAutoStart();
  } else if (forceParam === '1') {
    // restart triggered from a sub-page: begin at the first step for this page
    const tour = registry['new-user'];
    const pg = currentPage();
    const idx = tour.steps.findIndex(s => s.page === pg);
    writeState({ tourId: 'new-user', step: (idx >= 0 ? tour.steps[idx].id : tour.steps[0].id), ctx: {}, active: true });
    runCurrentPage();
  } else {
    runCurrentPage();
  }

  // bfcache: brand-new page load skips this; restored pages need a re-render
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) runCurrentPage();
  });

  window.MOJTours = {
    register: (id, def) => { registry[id] = def; },
    start: (id) => startTour(id || 'new-user'),
    skip: skipTour,
    reset,
    state: readState,
    page: currentPage,
  };
})();
