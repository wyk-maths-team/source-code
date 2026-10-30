(function() {
  'use strict';

  Page.boot({ title: 'Token Hub', requireAuth: true, skeleton: true });

  const THEMES = {
    default:   { name: 'Default',   bg: 'var(--card-bg)', color: 'var(--text-primary)' },
    cyberpunk: { name: 'Cyberpunk', bg: 'linear-gradient(135deg, #0d0221 0%, #ff00cc 100%)', color: '#00ffff' },
    sakura:    { name: 'Sakura',    bg: 'linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)', color: '#e91e63' },
    matrix:    { name: 'Matrix',    bg: '#000000', color: '#00ff00' },
    scifi:     { name: 'Sci-Fi',    bg: 'linear-gradient(135deg, #09101a 0%, #14313f 100%)', color: '#c6eeff' }
  };

  let state = null;
  let busy = false;        // 领取中，挡住连点
  let fetching = false;    // 防并发重复拉取

  const $ = (id) => document.getElementById(id);
  const esc = (s) => (window.DSHUI && DSHUI.esc) ? DSHUI.esc(s) : String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  Page.ready(async () => {
    await loadData();
    // 从题目页回来（切标签页 / 回到窗口）自动刷新一次，不用手点
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
      if (!opts.silent) DSHUI.toast(e.message || '加载失败', 'err');
    } finally {
      fetching = false;
      Page.hideSkeleton();
    }
  }

  function applyState(res) {
    // 接口结构和前端脚本版本对不上时（多半是浏览器还缓存着旧 JS），
    // 给一句能照做的提示，而不是白屏一个 TypeError。
    if (!res || !Array.isArray(res.quests) || !res.daily || !res.streak) {
      DSHUI.toast('页面脚本版本不匹配，请强制刷新（Ctrl / Cmd + Shift + R）', 'err');
      return;
    }

    state = res;

    $('pv-name').textContent = res.displayName;
    $('pv-rating').textContent = res.rating;
    $('pv-solved').textContent = res.solvedCount;

    if (window.updateTopbarTokens) {
      window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
    }

    $('quest-reset-hint').textContent = '每天 00:00 刷新 · ' + res.daily.date;

    renderSummary();
    renderQuests();
    renderStreak();
    renderThemes();
    updatePreview(res.theme);
  }

  // ── 顶部概览 ──
  function renderSummary() {
    const st = state.stats || {};
    $('quest-summary').innerHTML = [
      '今日提交 <b>' + fmt(st.submitCount) + '</b> 次',
      'AC <b>' + fmt(st.acCount) + '</b> 道',
      '目标难度 <b>d ≥ ' + fmt(state.daily.targetDifficulty) + '</b>'
    ].map((s) => '<span>' + s + '</span>').join('');
  }

  // ── 任务列表 ──
  function questDesc(q) {
    if (q.id !== 'daily') return q.desc;
    const p = state.daily && state.daily.problem;
    if (!p) return '今天 AC 任意一道难度 ≥ ' + state.daily.targetDifficulty + ' 的题。';
    if (p.fallback) return '目标难度的题都被你清完了，今天 AC 任意一道难度 ≥ ' + p.difficulty + ' 的题即可。';
    return '今天派给你的是 <b>' + esc(p.title) + '</b>（' + esc(p.id) + '）· 难度 ' + p.difficulty;
  }

  function questButton(q) {
    if (q.claimed) {
      return '<button class="btn-complete" disabled><i class="fas fa-check"></i> 已领取</button>';
    }
    if (q.completed) {
      return '<button class="btn-claim" data-claim="' + q.id + '">领取</button>';
    }
    if (!q.link) {
      return '<button class="btn-ad" disabled>未完成</button>';
    }
    const label = q.id === 'daily' ? '去做题' : '去完成';
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
    wrap.innerHTML = state.quests.map((q) => {
      return '<div class="quest-item' + (q.claimed ? ' is-claimed' : '') + '" data-qid="' + q.id + '">' +
        '<div class="quest-icon" style="color:' + q.color + '"><i class="fas ' + q.icon + '"></i></div>' +
        '<div class="quest-info">' +
          '<h4>' + esc(q.title) + '</h4>' +
          '<p>' + questDesc(q) + '</p>' +
          progressHtml(q) +
        '</div>' +
        '<div class="quest-side">' +
          '<span class="quest-reward">+' + fmt(q.reward) + '</span>' +
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
      if (!res.success) throw new Error(res.message || '领取失败');
      DSHUI.toast(res.message || '领取成功', 'ok');
      if (res.tokens && window.updateTopbarTokens) {
        window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
      }
      await loadData({ silent: true });
    } catch (e) {
      DSHUI.toast(e.message || '领取失败', 'err');
      btn.disabled = false;
      btn.innerHTML = old;
    } finally {
      busy = false;
    }
  }

  // ── 连续学习里程碑 ──
  function renderStreak() {
    const panel = $('streak-panel');
    const s = state.streak;
    if (!s) { panel.innerHTML = ''; return; }

    const items = s.milestones.map((m) => {
      let btn;
      if (m.claimed) btn = '<button class="btn-complete" disabled>已领取</button>';
      else if (m.reached) btn = '<button class="btn-claim" data-streak="' + m.days + '">领取</button>';
      else btn = '<button class="btn-ad" disabled>还差 ' + (m.days - s.days) + ' 天</button>';

      const cls = 'streak-milestone' + (m.reached ? ' reached' : '') + (m.claimed ? ' claimed' : '');
      return '<div class="' + cls + '">' +
        '<div class="days">' + m.days + ' 天</div>' +
        '<div style="color:var(--text-secondary)">+' + fmt(m.reward) + '</div>' +
        btn +
      '</div>';
    }).join('');

    panel.innerHTML =
      '<div class="streak-head"><i class="fas fa-fire" style="color:#e67e22"></i> 连续学习 ' + s.days + ' 天</div>' +
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
      if (!res.success) throw new Error(res.message || '领取失败');
      DSHUI.toast(res.message || '领取成功', 'ok');
      if (res.tokens && window.updateTopbarTokens) {
        window.updateTopbarTokens(res.tokens.daily, res.tokens.global);
      }
      await loadData({ silent: true });
    } catch (e) {
      DSHUI.toast(e.message || '领取失败', 'err');
      btn.disabled = false;
      btn.innerHTML = old;
    } finally {
      busy = false;
    }
  }

  // ── 主题商店（原逻辑保留）──
  function renderThemes() {
    const grid = $('theme-grid');
    grid.innerHTML = Object.keys(THEMES).map((key) => {
      const t = THEMES[key];
      const isActive = state.theme === key;
      return '<div class="theme-card ' + (isActive ? 'active' : '') + '" data-theme="' + key + '">' +
        '<div class="theme-preview" style="background: ' + t.bg + '; border: 1px solid var(--border-color);"></div>' +
        '<div style="font-weight: bold; font-size: 0.9rem;">' + t.name + '</div>' +
      '</div>';
    }).join('');

    grid.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        const themeKey = card.dataset.theme;
        if (themeKey === state.theme) return;

        updatePreview(themeKey);
        if (confirm('Apply "' + THEMES[themeKey].name + '" theme for 300,000 tokens?')) {
          buyTheme(themeKey);
        } else {
          updatePreview(state.theme);
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
      if (!res.success) throw new Error(res.message || '购买失败');
      DSHUI.toast(res.message, 'ok');
      await loadData({ silent: true });
    } catch (e) {
      DSHUI.toast(e.message || '购买失败', 'err');
      if (state) updatePreview(state.theme);
    }
  }
})();
