// assets/js/core/radial-menu.js —— Alt 键环形导航
//
// 交互：
//   按住 Alt   → 在光标处张开八向环形菜单，移动鼠标即高亮
//   松开 Alt   → 执行高亮项
//   Esc / 点空白 → 取消
//   点顶栏时间  → 光标归位到屏幕中央并张开（键盘不在手边时也能用）
//
// 刻意做成无依赖的独立组件：只有 window.RadialMenu 一个入口，
// 样式全部在 assets/css/radial-menu.css 里，不往页面里塞内联样式。

(function () {
  'use strict';
  if (window.RadialMenu) return;

  // 八个入口，顺时针排列；angle 0 = 正上方
  const ITEMS = [
    { id: 'home',      label: 'Home',       icon: 'fa-house',            href: '/index.html' },
    { id: 'problems',  label: 'Problems',   icon: 'fa-list-check',       href: '/problems' },
    { id: 'subs',      label: 'Subs',       icon: 'fa-inbox',            href: '/submissions' },
    { id: 'rank',      label: 'Ranking',    icon: 'fa-ranking-star',     href: '/leaderboard' },
    { id: 'courses',   label: 'Course',     icon: 'fa-graduation-cap',   href: '/course' },
    { id: 'contests',  label: 'Contest',    icon: 'fa-trophy',           href: '/contest' },
    { id: 'tokens',    label: 'Tokens',     icon: 'fa-coins',            href: '/token-hub' },
    { id: 'settings',  label: 'Settings',   icon: 'fa-gear',             href: '/settings' },
  ];

  const STEP = 360 / ITEMS.length;

  let root = null;
  let hub = null;
  let items = [];
  let open = false;
  let activeIndex = -1;
  let anchor = { x: 0, y: 0 };
  let cssLoaded = false;

  function ensureCss() {
    if (cssLoaded || document.getElementById('radialMenuCss')) { cssLoaded = true; return; }
    const l = document.createElement('link');
    l.id = 'radialMenuCss';
    l.rel = 'stylesheet';
    l.href = '/assets/css/radial-menu.css' + (window.__BUILD_V ? '?v=' + window.__BUILD_V : '');
    document.head.appendChild(l);
    cssLoaded = true;
  }

  function build() {
    if (root) return;
    ensureCss();

    root = document.createElement('div');
    root.className = 'rm';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Quick navigation');
    // 关键定位内联写死：样式表是异步加载的，在它到达之前如果先用 open()，
    // .rm 会退化成普通 div —— hub 的 left/top 就变成了相对文档流，
    // 环心会莫名偏掉（实测偏了 30px）。这几条保证任何时刻坐标都以视口为准。
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:none;pointer-events:none;';

    const scrim = document.createElement('div');
    scrim.className = 'rm__scrim';
    scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });

    hub = document.createElement('div');
    hub.className = 'rm__hub';
    // 注意：不要在 hub 上设 --rm-x / --rm-y。
    // 设在 hub 自身会覆盖从 .rm 继承下来的值，hub 永远停在 50% 而不是光标处。
    // 坐标只由 show() 写在 .rm 上，靠继承往下传。

    const origin = document.createElement('div');
    origin.className = 'rm__origin';
    hub.appendChild(origin);

    items = ITEMS.map((it, i) => {
      const a = document.createElement('a');
      a.className = 'rm__item';
      a.href = it.href;
      a.style.setProperty('--rm-angle', (i * STEP) + 'deg');
      a.dataset.index = String(i);
      a.innerHTML = '<i class="fas ' + it.icon + '"></i><span>' + it.label + '</span>';
      a.addEventListener('pointerenter', () => setActive(i));
      a.addEventListener('click', (e) => {
        // 交给浏览器正常跳转；菜单收掉
        e.stopPropagation();
        close();
      });
      hub.appendChild(a);
      return a;
    });

    const hint = document.createElement('div');
    hint.className = 'rm__hint';
    hint.innerHTML = 'Move to a slice and release <kbd>Alt</kbd> · <kbd>Esc</kbd> to cancel';

    root.appendChild(scrim);
    root.appendChild(hub);
    root.appendChild(hint);
    document.body.appendChild(root);

    root.addEventListener('pointermove', onPointerMove);
  }

  function setActive(i) {
    if (i === activeIndex) return;
    if (items[activeIndex]) items[activeIndex].classList.remove('is-active');
    activeIndex = i;
    if (items[i]) items[i].classList.add('is-active');
  }

  function onPointerMove(e) {
    if (!open) return;
    const dx = e.clientX - anchor.x;
    const dy = e.clientY - anchor.y;
    const dist = Math.hypot(dx, dy);

    // 死区：离中心太近就不选任何项，避免刚张开就误触
    if (dist < 36) { setActive(-1); return; }

    // atan2 得到的是「从正右方顺时针」，转成「从正上方顺时针」
    let deg = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    const idx = Math.round(deg / STEP) % ITEMS.length;
    setActive(idx);
  }

  function show(x, y) {
    build();
    anchor = { x, y };
    root.style.setProperty('--rm-x', x + 'px');
    root.style.setProperty('--rm-y', y + 'px');
    root.dataset.open = 'true';
    root.style.display = 'block';
    root.style.pointerEvents = 'auto';
    open = true;
    setActive(-1);
  }

  function close() {
    if (!root) return;
    root.dataset.open = 'false';
    root.style.display = 'none';
    root.style.pointerEvents = 'none';
    open = false;
    setActive(-1);
  }

  function commit() {
    if (!open) return;
    if (activeIndex >= 0 && items[activeIndex]) {
      const href = items[activeIndex].getAttribute('href');
      close();
      if (href) location.href = href;
      return;
    }
    close();
  }

  // ── Alt ─────────────────────────────────────────────
  let altHeld = false;

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { close(); return; }
    if (e.key !== 'Alt') return;
    e.preventDefault();
    if (altHeld) return;      // 长按会重复触发
    altHeld = true;
    // Alt 本身不带鼠标坐标，用上次记录的位置
    show(lastX, lastY);
  }, true);

  window.addEventListener('keyup', (e) => {
    if (e.key !== 'Alt') return;
    if (!altHeld) return;
    altHeld = false;
    commit();
  }, true);

  // 切窗口时别把菜单留在那儿
  window.addEventListener('blur', () => { altHeld = false; close(); });

  // 记录光标位置，供 Alt 使用
  let lastX = Math.round(window.innerWidth / 2);
  let lastY = Math.round(window.innerHeight / 2);
  window.addEventListener('pointermove', (e) => {
    if (open) return;      // 张开后由菜单自己处理
    lastX = e.clientX;
    lastY = e.clientY;
  }, { passive: true });

  // ── 点顶栏时间：光标归位到中央再张开 ─────────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('.clock, #clockTime, [data-radial-trigger]');
    if (!el) return;
    e.preventDefault();
    const cx = Math.round(window.innerWidth / 2);
    const cy = Math.round(window.innerHeight / 2);
    lastX = cx;
    lastY = cy;
    show(cx, cy);
    // 键盘党：直接按 Esc 或点某项即可
  }, true);

  window.RadialMenu = {
    open: (x, y) => show(x == null ? window.innerWidth / 2 : x, y == null ? window.innerHeight / 2 : y),
    close,
    isOpen: () => open,
  };
})();
