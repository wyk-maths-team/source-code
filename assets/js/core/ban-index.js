// assets/js/core/ban-index.js —— 封禁账号在首页的只读模式
//
// 被封的人能登进来，但只能看首页：整页转成红色调，
// 除了说明封禁原因的那一块，其他交互全部禁用。

(function () {
  'use strict';
  if (window.BanIndex) return;

  function getInfo() {
    try {
      if (typeof window.getBanInfo === 'function') return window.getBanInfo();
      const raw = localStorage.getItem('ban_info');
      if (!raw) return null;
      const info = JSON.parse(raw);
      if (info.until && new Date(info.until).getTime() <= Date.now()) {
        localStorage.removeItem('ban_info');
        return null;
      }
      return info;
    } catch (e) { return null; }
  }

  function fmtUntil(until) {
    if (!until) return '';
    try { return new Date(until).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }); }
    catch (e) { return String(until); }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function apply(info) {
    if (!info) return;

    document.documentElement.classList.add('banned-mode');

    const how = info.type === 'automatically' ? 'automatically' : 'manually';
    const why = info.reason || 'violating the site rules';
    const when = fmtUntil(info.until);

    const bar = document.createElement('div');
    bar.className = 'ban-banner';
    bar.innerHTML =
      '<div class="ban-banner__icon"><i class="fas fa-ban"></i></div>' +
      '<div class="ban-banner__body">' +
        '<div class="ban-banner__title">You are banned</div>' +
        '<div class="ban-banner__line"><strong>' + how + '</strong> for <strong>' + esc(why) + '</strong>.</div>' +
        (when ? '<div class="ban-banner__line">The ban lifts on <strong>' + esc(when) + '</strong> (Hong Kong time).</div>'
              : '<div class="ban-banner__line">This ban is permanent until a teacher lifts it.</div>') +
        '<div class="ban-banner__line ban-banner__line--muted">While banned this page is the only one you can open — any other link sends you back here.</div>' +
      '</div>';
    document.body.insertBefore(bar, document.body.firstChild);

    // 除了这条横幅，页面上所有可点的东西都停掉
    const kill = () => {
      // 导览/提示这些浮层在封禁状态下没有意义，直接收掉。
      // 它们用的是 id（#tour-root / #tour-welcome）而不是 class，得单独点名。
      document.querySelectorAll('[id^="tour-"], [id*="-tour"], .tour-tip, .tour-welcome-card').forEach((el) => {
        if (bar && bar.contains(el)) return;
        const host = el.closest('[id^="tour-"]') || el;
        host.style.display = 'none';
      });

      document.querySelectorAll('a, button, input, select, textarea, [role="button"], [tabindex]').forEach((el) => {
        if (bar.contains(el)) return;
        el.setAttribute('tabindex', '-1');
        el.setAttribute('aria-disabled', 'true');
        if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') el.disabled = true;
        el.style.pointerEvents = 'none';
        el.style.cursor = 'not-allowed';
      });
    };
    kill();
    setTimeout(kill, 300);
    setTimeout(kill, 1200);

    // 页面还会异步插进来一堆东西（导览、通知、弹层）。
    // 光靠定时扫会漏，用一个 observer 持续收编新节点。
    if (window.MutationObserver) {
      const mo = new MutationObserver((records) => {
        let dirty = false;
        for (const rec of records) {
          for (const node of rec.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node === bar || bar.contains(node)) continue;
            // 覆盖层直接收掉：封禁状态下没有任何弹窗是有意义的
            const cs = getComputedStyle(node);
            if (cs.position === 'fixed' && node.classList.length && /overlay|modal|tour|toast|popup/i.test(node.className)) {
              node.style.display = 'none';
            }
            dirty = true;
          }
        }
        if (dirty) kill();
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    // 拦截冒泡阶段的点击，兜住那些没被扫到的元素
    document.addEventListener('click', (e) => {
      if (bar.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // 键盘也别想溜过去（Tab / Enter / 快捷键）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  function init() {
    const info = getInfo();
    if (!info) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => apply(info));
    } else {
      apply(info);
    }
  }

  window.BanIndex = { init, getInfo };
  init();
})();
