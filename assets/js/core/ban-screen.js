// assets/js/core/ban-screen.js —— 被封禁账号的全屏提示
//
// 被踢出来时不再是一个 alert，而是整屏变红、所有交互失效，
// 并说明封禁是手动还是自动、原因是什么、什么时候到期。
//
// 只依赖 window.BanScreen.show({ type, reason, until })。
// 样式写在 assets/css/ban-screen.css，命名空间 .bs-。

(function () {
  'use strict';
  if (window.BanScreen) return;

  let root = null;

  function ensureCss() {
    if (document.getElementById('banScreenCss')) return;
    const l = document.createElement('link');
    l.id = 'banScreenCss';
    l.rel = 'stylesheet';
    l.href = '/assets/css/ban-screen.css' + (window.__BUILD_V ? '?v=' + window.__BUILD_V : '');
    document.head.appendChild(l);
  }

  function formatUntil(until) {
    if (!until) return '';
    try {
      return new Date(until).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
    } catch (e) { return String(until); }
  }

  function show(info) {
    ensureCss();
    const { type = 'manually', reason = '', until = null } = info || {};

    if (root) root.remove();

    root = document.createElement('div');
    root.className = 'bs';
    root.setAttribute('role', 'alertdialog');

    const how = type === 'automatically' ? 'automatically' : 'manually';
    const why = reason || 'violating the site rules';
    const when = formatUntil(until);

    root.innerHTML =
      '<div class="bs__panel">' +
        '<div class="bs__icon"><i class="fas fa-ban"></i></div>' +
        '<h1 class="bs__title">You are banned</h1>' +
        '<p class="bs__line"><strong>' + how + '</strong> for <strong>' + escapeHtml(why) + '</strong>.</p>' +
        (when ? '<p class="bs__line">The ban lifts on <strong>' + escapeHtml(when) + '</strong> (Hong Kong time).</p>' : '') +
        '<p class="bs__hint">If you think this is a mistake, contact your teacher.</p>' +
      '</div>';

    document.body.appendChild(root);
    document.body.style.overflow = 'hidden';

    // 整页禁用交互：不是靠 pointer-events，而是把不属于这一屏的元素都遮住
    document.documentElement.classList.add('bs-active');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
    ));
  }

  function hide() {
    if (root) { root.remove(); root = null; }
    document.documentElement.classList.remove('bs-active');
    document.body.style.overflow = '';
  }

  window.BanScreen = { show, hide, isShown: () => !!root };
})();
