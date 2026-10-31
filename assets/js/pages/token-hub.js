(function() {
  'use strict';

  Page.boot({ title: 'Token Hub', requireAuth: true, skeleton: true });

  // dark: true 的主题会把整站切到暗色模式（题目列表那些白色小方块就不会刺眼）
  const THEMES = {
    default:   { name: 'Default',   dark: false, bg: 'var(--card-bg)', color: 'var(--text-primary)' },
    sakura:    { name: 'Sakura',    dark: false, bg: 'linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)', color: '#e91e63' },
    ocean:     { name: 'Ocean',     dark: false, bg: 'linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 100%)', color: '#006064' },
    forest:    { name: 'Forest',    dark: false, bg: 'linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%)', color: '#1b5e20' },
    sunset:    { name: 'Sunset',    dark: false, bg: 'linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%)', color: '#e65100' },
    cyberpunk: { name: 'Cyberpunk', dark: true,  bg: 'linear-gradient(135deg, #0d0221 0%, #ff00cc 100%)', color: '#00ffff' },
    matrix:    { name: 'Matrix',    dark: true,  bg: '#000000', color: '#00ff00' },
    scifi:     { name: 'Sci-Fi',    dark: true,  bg: 'linear-gradient(135deg, #09101a 0%, #14313f 100%)', color: '#c6eeff' },
    midnight:  { name: 'Midnight',  dark: true,  bg: 'linear-gradient(135deg, #0b1020 0%, #1b2440 100%)', color: '#8ab4ff' },
    nord:      { name: 'Nord',      dark: true,  bg: 'linear-gradient(135deg, #2e3440 0%, #3b4252 100%)', color: '#88c0d0' },
    mono:      { name: 'Mono',      dark: true,  bg: 'linear-gradient(135deg, #111111 0%, #333333 100%)', color: '#f5f5f5' }
  };

  // 注意：主题只作用于个人主页（/users/<username>），
  // 不会写 localStorage.theme，也不会影响整站配色。

  let state = null;
  let busy = false;        // Claiming in progress — block double-clicks
  let fetching = false;    // Prevent concurrent duplicate fetches

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (window.DSHUI && DSHUI.esc) ? DSHUI.esc(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  Page.ready(async () => {
    await loadData();
    // Auto-refresh once when coming back from the problem page (tab switch / window focus) — no manual click needed
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') loadData({ silent: true });
    });
    window.addEventListener('focus', () => loadData({ silent: true }));
  });

  async function loadData(opts = {}) {
    if (fetching) return;
    fetching = true;
    try {
      const res = await API.get('/api/token-hub');
      if (!res || !res.success) throw new Error((res && res.message) || 'Failed to load');
      applyState(res);
    } catch (e) {
      if (!opts.silent) DSHUI.toast(e.message || 'Failed to load', 'err');
    } finally {
      fetching = false;
      Page.hideSkeleton();
    }
  }

  function applyState(res) {
    // When the API shape doesn't match the frontend script version (usually the browser
    // is still caching old JS), show an actionable hint instead of a blank white
    // screen with a TypeError.
    if (!res || !Array.isArray(res.quests) || !res.daily || !res.streak) {
      DSHUI.toast('Page script version mismatch — please hard refresh (Ctrl / Cmd + Shift + R)', 'err');
      return;
    }

    state = res;

    $('pv-name').textContent = res.displayName;
    $('pv-rating').textContent = res.rating;
    $('pv-solved').textContent = res.solvedCount;

    if (window.updateTopbarTokens) {
      window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
    }

    $('quest-reset-hint').textContent = 'Resets daily at 00:00 · ' + res.daily.date;

    renderSummary();
    renderQuests();
    renderStreak();
    renderThemes();
    updatePreview(res.theme);
  }

  // ── Top summary ──
  function renderSummary() {
    const st = state.stats || {};
    const lv = state.level || { multiplier: 1 };
    const parts = [
      'Submissions today: <b>' + fmt(st.submitCount) + '</b>',
      'AC: <b>' + fmt(st.acCount) + '</b> problems',
      'Target difficulty: <b>d ≥ ' + fmt(state.daily.targetDifficulty) + '</b>'
    ];
    if (lv.multiplier > 1) {
      parts.push('Level bonus: <b style="color:#f1c40f">×' + lv.multiplier + '</b>');
    }
    $('quest-summary').innerHTML = parts.map((s) => '<span>' + s + '</span>').join('');
  }

  // ── Quest list ──
  function questDesc(q) {
    if (q.id !== 'daily') return q.desc;
    const p = state.daily && state.daily.problem;
    if (!p) return 'AC any problem with difficulty ≥ ' + state.daily.targetDifficulty + ' today.';
    if (p.fallback) return 'You\'ve cleared every problem at the target difficulty — just AC any problem with difficulty ≥ ' + p.difficulty + ' today.';
    return 'Today\'s assignment: <b>' + esc(p.title) + '</b> (' + esc(p.id) + ') · Difficulty ' + p.difficulty;
  }

  function questButton(q) {
    if (q.claimed) {
      return '<button class="btn-complete" disabled><i class="fas fa-check"></i> Claimed</button>';
    }
    if (q.completed) {
      return '<button class="btn-claim" data-claim="' + q.id + '">Claim</button>';
    }
    if (!q.link) {
      return '<button class="btn-ad" disabled>Not completed</button>';
    }
    const label = q.id === 'daily' ? 'Go solve' : 'Go';
    return '<button class="btn-go" data-go="' + q.id + '">' + label + ' <i class="fas fa-arrow-right" style="font-size:.75em"></i></button>';
  }

  function progressHtml(q) {
    if (!q.progress || q.claimed) return '';
    const cur = Math.min(q.progress.current, q.progress.target);
    const pct = q.progress.target ? Math.round(100 * cur / q.progress.target) : 100;
    return '<div class="quest-progress">' +
      '<div class="quest-progress-bar"><i style="width:' + pct + '%"></i></div>' +
      '<span>' + cur + '/' + q.progress.target + '</span>' +
      '</div>';
  }

  function renderQuests() {
    const wrap = $('quest-list');
    const lvMult = (state.level && state.level.multiplier) || 1;
    wrap.innerHTML = state.quests.map((q) => {
      return '<div class="quest-item' + (q.claimed ? ' is-claimed' : '') + '" data-qid="' + q.id + '">' +
        '<div class="quest-icon" style="color:' + q.color + '"><i class="fas ' + q.icon + '"></i></div>' +
        '<div class="quest-info">' +
          '<h4>' + esc(q.title) + '</h4>' +
          '<p>' + questDesc(q) + '</p>' +
          progressHtml(q) +
        '</div>' +
        '<div class="quest-side">' +
          '<span class="quest-reward">+' + fmt(q.reward) +
            (lvMult > 1 ? ' <small>×' + lvMult + '</small>' : '') +
          '</span>' +
          questButton(q) +
        '</div>' +
      '</div>';
    }).join('');

    wrap.onclick = (e) => {
      const claimBtn = e.target.closest('[data-claim]');
      if (claimBtn) { claimQuest(claimBtn.dataset.claim, claimBtn); return; }
      const goBtn = e.target.closest('[data-go]');
      if (goBtn) { goQuest(goBtn.dataset.go); return; }
    };
  }

  function goQuest(questId) {
    const q = state.quests.find((x) => x.id === questId);
    if (!q) return;
    if (q.id === 'daily' && state.daily.problem && state.daily.problem.id) {
      location.href = '/problems/' + encodeURIComponent(state.daily.problem.id);
      return;
    }
    location.href = '/problems';
  }

  async function claimQuest(questId, btn) {
    if (busy) return;
    busy = true;
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
      const res = await API.post('/api/token-hub', { action: 'claim', questId });
      if (!res.success) throw new Error(res.message || 'Claim failed');
      DSHUI.toast(res.message || 'Claimed successfully', 'ok');
      if (res.tokens && window.updateTopbarTokens) {
        window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
      }
      await loadData({ silent: true });
    } catch (e) {
      DSHUI.toast(e.message || 'Claim failed', 'err');
      btn.disabled = false;
      btn.innerHTML = old;
    } finally {
      busy = false;
    }
  }

  // ── Streak milestones ──
  function renderStreak() {
    const panel = $('streak-panel');
    const s = state.streak;
    if (!s) { panel.innerHTML = ''; return; }

    const items = s.milestones.map((m) => {
      let btn;
      if (m.claimed) btn = '<button class="btn-complete" disabled>Claimed</button>';
      else if (m.reached) btn = '<button class="btn-claim" data-streak="' + m.days + '">Claim</button>';
      else btn = '<button class="btn-ad" disabled>' + (m.days - s.days) + ' days to go</button>';

      const cls = 'streak-milestone' + (m.reached ? ' reached' : '') + (m.claimed ? ' claimed' : '');
      return '<div class="' + cls + '">' +
        '<div class="days">' + m.days + ' days</div>' +
        '<div style="color:var(--text-secondary)">+' + fmt(m.reward) + '</div>' +
        btn +
      '</div>';
    }).join('');

    panel.innerHTML =
      '<div class="streak-head"><i class="fas fa-fire" style="color:#e67e22"></i> Learning streak: ' + s.days + ' days</div>' +
      '<div class="streak-milestones">' + items + '</div>';

    panel.onclick = (e) => {
      const btn = e.target.closest('[data-streak]');
      if (btn) claimStreak(Number(btn.dataset.streak), btn);
    };
  }

  async function claimStreak(days, btn) {
    if (busy) return;
    busy = true;
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
      const res = await API.post('/api/token-hub', { action: 'claim_streak', days });
      if (!res.success) throw new Error(res.message || 'Claim failed');
      DSHUI.toast(res.message || 'Claimed successfully', 'ok');
      if (res.tokens && window.updateTopbarTokens) {
        window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
      }
      await loadData({ silent: true });
    } catch (e) {
      DSHUI.toast(e.message || 'Claim failed', 'err');
      btn.disabled = false;
      btn.innerHTML = old;
    } finally {
      busy = false;
    }
  }

  // ── Theme shop (original logic preserved) ──
  function renderThemes() {
    const grid = $('theme-grid');
    grid.innerHTML = Object.keys(THEMES).map((key) => {
      const t = THEMES[key];
      const isActive = state.theme === key;
      const badge = t.dark ? ' <span class="theme-dark-badge">DARK</span>' : '';
      return '<div class="theme-card ' + (isActive ? 'active' : '') + '" data-theme="' + key + '">' +
        '<div class="theme-preview" style="background: ' + t.bg + '; border: 1px solid var(--border-color);"></div>' +
        '<div style="font-weight: bold; font-size: 0.9rem;">' + t.name + badge + '</div>' +
      '</div>';
    }).join('');

    grid.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        const themeKey = card.dataset.theme;
        if (themeKey === state.theme) return;

        updatePreview(themeKey);
        const darkNote = THEMES[themeKey].dark
          ? '\n\nThis is a dark theme — your profile page will render in dark mode.'
          : '';
        if (confirm('Apply "' + THEMES[themeKey].name + '" theme for 300,000 tokens?' + darkNote)) {
          buyTheme(themeKey);
        } else {
          updatePreview(state.theme || 'default');
        }
      });
    });
  }

  function updatePreview(themeKey) {
    const box = $('preview-box');
    const theme = THEMES[themeKey] || THEMES.default;

    box.style.background = theme.bg;
    box.style.color = theme.color;

    box.querySelectorAll('h3, p, i').forEach((el) => {
      el.style.color = theme.color;
    });
  }

  async function buyTheme(themeKey) {
    try {
      const res = await API.post('/api/token-hub', { action: 'buy_theme', theme: themeKey });
      if (!res.success) throw new Error(res.message || 'Purchase failed');
      DSHUI.toast(res.message, 'ok');
      await loadData({ silent: true });
    } catch (e) {
      DSHUI.toast(e.message || 'Purchase failed', 'err');
      if (state) updatePreview(state.theme);
    }
  }
})();