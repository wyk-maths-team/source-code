// assets/js/core/ban-index.js —— 被封账号的首页提示
//
// 被封的人可以正常浏览全站、看资讯，只是所有 API 请求都被 ban-guard 拦住了。
// 这里只做两件事：给页面加一层红色调，并在顶部说明封禁情况。

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
        '<div class="ban-banner__line ban-banner__line--muted">You can still read the site, but submitting answers, sending messages and everything else that needs the server is turned off.</div>' +
      '</div>';
    document.body.insertBefore(bar, document.body.firstChild);

    // 导览弹窗对已经被封的人没有意义，收掉（它们用的是 id，不是 class）
    setTimeout(() => {
      document.querySelectorAll('[id^="tour-"], .tour-tip').forEach((el) => {
        if (!bar.contains(el)) el.style.display = 'none';
      });
    }, 500);
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
