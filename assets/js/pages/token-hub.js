(function() {
  Page.boot({ title: 'Token Hub', requireAuth: true, skeleton: true });

  const THEMES = {
    default:   { name: 'Default',   bg: 'var(--card-bg)', color: 'var(--text-primary)' },
    cyberpunk: { name: 'Cyberpunk', bg: 'linear-gradient(135deg, #0d0221 0%, #ff00cc 100%)', color: '#00ffff' },
    sakura:    { name: 'Sakura',    bg: 'linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)', color: '#e91e63' },
    matrix:    { name: 'Matrix',    bg: '#000000', color: '#00ff00' },
    scifi:     { name: 'Sci-Fi',    bg: 'linear-gradient(135deg, #09101a 0%, #14313f 100%)', color: '#c6eeff' }
  };

  let state = { tokens: {}, quests: {}, currentTheme: 'default' };

  Page.ready(async (user) => {
    await loadData();
  });

  async function loadData() {
    try {
      const res = await API.get('/api/token-hub');
      if (!res.success) throw new Error(res.message);
      state = res;
      
      document.getElementById('pv-name').textContent = state.displayName;
      document.getElementById('pv-rating').textContent = state.rating;
      document.getElementById('pv-solved').textContent = state.solvedCount;

      if (window.updateTopbarTokens) {
        window.updateTopbarTokens(state.tokens.daily, state.tokens.global);
      }

      // ⭐ Login 自动完成逻辑
      if (!state.quests.login.claimed) {
        await API.post('/api/token-hub', { action: 'claim_login' });
        return loadData(); 
      }

      // 更新 DOM
      if (state.quests.login.claimed) {
        document.getElementById('btn-login-wrap').innerHTML = `<button class="btn-complete"><i class="fas fa-check"></i> Complete</button>`;
      }

      document.getElementById('target-diff').textContent = state.quests.quest.target;
      
      if (state.quests.quest.claimed) {
        document.getElementById('btn-do-wrap').innerHTML = `<button class="btn-complete"><i class="fas fa-check"></i> Complete</button>`;
      } else if (state.quests.quest.completed) {
        const btn = document.getElementById('btn-do');
        if (btn) { // ⭐ 加上判空，防止意外
          btn.textContent = 'Claim Reward';
          btn.style.background = '#2ecc71'; 
        }
      }

      renderThemes();
      updatePreview(state.currentTheme);

      // ⭐ 核心修复：在 DOM 更新完之后，再安全地绑定事件！
      bindEvents();

    } catch (e) {
      DSHUI.toast(e.message, 'err');
    } finally {
      Page.hideSkeleton(); 
    }
  }

  // ⭐ 新增专门的绑定函数
  function bindEvents() {
    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) {
      // 用 onclick 覆盖，防止多次 loadData 重复绑定导致触发多次
      btnLogin.onclick = () => claimReward('claim_login');
    }
    
    const btnDo = document.getElementById('btn-do');
    if (btnDo) {
      btnDo.onclick = () => claimReward('claim_quest');
    }
  }

  async function claimReward(action) {
    try {
      const btn = action === 'claim_login' ? document.getElementById('btn-login') : document.getElementById('btn-do');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading';
      }
      
      const res = await API.post('/api/token-hub', { action });
      if (res.success) {
        DSHUI.toast(res.message, 'ok');
        await loadData(); 
      }
    } catch (e) {
      DSHUI.toast(e.message, 'err');
      const btn = action === 'claim_login' ? document.getElementById('btn-login') : document.getElementById('btn-do');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Go for it';
      }
    }
  }

  function renderThemes() {
    const grid = document.getElementById('theme-grid');
    grid.innerHTML = Object.keys(THEMES).map(key => {
      const t = THEMES[key];
      const isActive = state.currentTheme === key;
      return `
        <div class="theme-card ${isActive ? 'active' : ''}" data-theme="${key}">
          <div class="theme-preview" style="background: ${t.bg}; border: 1px solid var(--border-color);"></div>
          <div style="font-weight: bold; font-size: 0.9rem;">${t.name}</div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', () => {
        const themeKey = card.dataset.theme;
        if (themeKey === state.currentTheme) return;
        
        updatePreview(themeKey);
        if (confirm(`Apply "${THEMES[themeKey].name}" theme for 300,000 tokens?`)) {
          buyTheme(themeKey);
        } else {
          updatePreview(state.currentTheme); 
        }
      });
    });
  }

  function updatePreview(themeKey) {
    const box = document.getElementById('preview-box');
    const theme = THEMES[themeKey] || THEMES.default;
    
    box.style.background = theme.bg;
    box.style.color = theme.color;
    
    // 强制覆盖内部元素的颜色，防止被 var() 覆盖
    box.querySelectorAll('h3, p, i').forEach(el => {
      el.style.color = theme.color;
    });
  }

  async function buyTheme(themeKey) {
    try {
      const res = await API.post('/api/token-hub', { action: 'buy_theme', theme: themeKey });
      if (res.success) {
        DSHUI.toast(res.message, 'ok');
        state.currentTheme = themeKey;
        await loadData();
      }
    } catch (e) {
      DSHUI.toast(e.message, 'err');
      updatePreview(state.currentTheme); 
    }
  }
})();