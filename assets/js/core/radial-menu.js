// assets/js/core/radial-menu.js —— Alt 键环形导航
//
// 交互：
//   按住 Alt   → 在光标处张开圆环，移动鼠标高亮对应扇区
//   松开 Alt   → 执行高亮项
//   Esc / 点空白 → 取消
//   点顶栏时间  → 光标归位到屏幕中央并张开
//
// 圆环用 SVG 画：整圈按入口数量切成等分扇区，悬停时整份填满。
// 半径、厚度、缝隙都从 CSS 变量读，JS 只负责算路径。

(function () {
  'use strict';
  if (window.RadialMenu) return;

  const ITEMS = [
    { id: 'home',     label: 'Home',     icon: 'fa-house',          href: '/index.html' },
    { id: 'problems', label: 'Problems', icon: 'fa-list-check',     href: '/problems' },
    { id: 'subs',     label: 'Subs',     icon: 'fa-inbox',          href: '/submissions' },
    { id: 'rank',     label: 'Ranking',  icon: 'fa-ranking-star',   href: '/leaderboard' },
    { id: 'courses',  label: 'Course',   icon: 'fa-graduation-cap', href: '/course' },
    { id: 'contests', label: 'Contest',  icon: 'fa-trophy',         href: '/contest' },
    { id: 'tokens',   label: 'Tokens',   icon: 'fa-coins',          href: '/token-hub' },
    { id: 'settings', label: 'Settings', icon: 'fa-gear',           href: '/settings' },
  ];

  const N = ITEMS.length;
  const STEP = 360 / N;        // 每份的角度
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let root = null;
  let hub = null;
  let ring = null;
  let slices = [];
  let labels = [];
  let open = false;
  let activeIndex = -1;
  let anchor = { x: 0, y: 0 };

  function ensureCss() {
    if (document.getElementById('radialMenuCss')) return;
    const l = document.createElement('link');
    l.id = 'radialMenuCss';
    l.rel = 'stylesheet';
    l.href = '/assets/css/radial-menu.css' + (window.__BUILD_V ? '?v=' + window.__BUILD_V : '');
    document.head.appendChild(l);
  }

  // 圆环参数从 CSS 变量读，保证 JS 和样式用的是同一组数字
  function readGeom() {
    const cs = getComputedStyle(root);
    const radius = parseFloat(cs.getPropertyValue('--rm-radius')) || 150;
    const thickness = parseFloat(cs.getPropertyValue('--rm-thickness')) || 64;
    const gapDeg = parseFloat(cs.getPropertyValue('--rm-gap-deg')) || 0;
    return { R: radius, r: Math.max(8, radius - thickness), gapDeg };
  }

  function polar(cx, cy, radius, deg) {
    const rad = (deg - 90) * Math.PI / 180;   // 0 度 = 正上方
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  // 一个扇区的 path：外弧 → 内弧反向 → 闭合
  function slicePath(cx, cy, R, r, fromDeg, toDeg) {
    const large = (toDeg - fromDeg) > 180 ? 1 : 0;
    const o1 = polar(cx, cy, R, fromDeg);
    const o2 = polar(cx, cy, R, toDeg);
    const i2 = polar(cx, cy, r, toDeg);
    const i1 = polar(cx, cy, r, fromDeg);
    return [
      'M', o1.x.toFixed(2), o1.y.toFixed(2),
      'A', R, R, 0, large, 1, o2.x.toFixed(2), o2.y.toFixed(2),
      'L', i2.x.toFixed(2), i2.y.toFixed(2),
      'A', r, r, 0, large, 0, i1.x.toFixed(2), i1.y.toFixed(2),
      'Z',
    ].join(' ');
  }

  function buildRing() {
    const { R, r, gapDeg } = readGeom();
    const size = R * 2;
    const cx = R, cy = R;

    // SVG 尺寸跟着半径走
    ring.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    ring.setAttribute('width', String(size));
    ring.setAttribute('height', String(size));
    ring.innerHTML = '';

    slices = [];
    ITEMS.forEach((it, i) => {
      const start = i * STEP + gapDeg / 2;
      const end = (i + 1) * STEP - gapDeg / 2;

      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', 'rm__slice');
      p.setAttribute('d', slicePath(cx, cy, R, r, start, end));
      p.dataset.index = String(i);
      p.addEventListener('pointerenter', () => setActive(i));
      ring.appendChild(p);
      slices.push(p);
    });

    // 图标 + 文字：叠在扇区中点
    labels.forEach((l) => l.remove());
    labels = ITEMS.map((it, i) => {
      const mid = (i + 0.5) * STEP;
      const midR = (R + r) / 2;
      const pos = polar(cx, cy, midR, mid);
      const el = document.createElement('div');
      el.className = 'rm__label';
      el.style.left = (pos.x - R) + 'px';
      el.style.top = (pos.y - R) + 'px';
      el.innerHTML = '<i class="fas ' + it.icon + '"></i><span>' + it.label + '</span>';
      hub.appendChild(el);
      return el;
    });
  }

  function build() {
    if (root) return;
    ensureCss();

    root = document.createElement('div');
    root.className = 'rm';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Quick navigation');
    // 关键定位内联写死：样式表是独立请求，在它到达之前先用 open()，
    // .rm 会退化成普通 div，hub 的坐标就变成相对文档流了。
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:none;pointer-events:none;';

    const scrim = document.createElement('div');
    scrim.className = 'rm__scrim';
    scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });

    hub = document.createElement('div');
    hub.className = 'rm__hub';
    // 不要在 hub 上设 --rm-x / --rm-y：设在自身会盖掉从 .rm 继承的值

    ring = document.createElementNS(SVG_NS, 'svg');
    ring.setAttribute('class', 'rm__ring');

    const origin = document.createElement('div');
    origin.className = 'rm__origin';

    hub.appendChild(ring);
    hub.appendChild(origin);

    const hint = document.createElement('div');
    hint.className = 'rm__hint';
    hint.innerHTML = 'Move onto a slice and release <kbd>Alt</kbd> · <kbd>Esc</kbd> to cancel';

    root.appendChild(scrim);
    root.appendChild(hub);
    root.appendChild(hint);
    document.body.appendChild(root);

    root.addEventListener('pointermove', onPointerMove);
    // 窗口尺寸变化时重新算几何（半径可能被媒体查询改过）
    window.addEventListener('resize', () => { if (root && open) buildRing(); });
  }

  function setActive(i) {
    if (i === activeIndex) return;
    if (slices[activeIndex]) slices[activeIndex].classList.remove('is-active');
    if (labels[activeIndex]) labels[activeIndex].classList.remove('is-active');
    activeIndex = i;
    if (slices[i]) slices[i].classList.add('is-active');
    if (labels[i]) labels[i].classList.add('is-active');
  }

  function onPointerMove(e) {
    if (!open) return;
    const dx = e.clientX - anchor.x;
    const dy = e.clientY - anchor.y;
    const dist = Math.hypot(dx, dy);
    const { R, r } = readGeom();

    // 中心空盘：光标在环内圈里就什么都不选
    if (dist < r) { setActive(-1); return; }
    // 环外也退出（否则鼠标飘远还锁着上一份）
    if (dist > R * 1.6) { setActive(-1); return; }

    let deg = (Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360;
    setActive(Math.floor(deg / STEP) % N);
  }

  function show(x, y) {
    build();
    if (!slices.length) buildRing();
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
    if (activeIndex >= 0 && ITEMS[activeIndex]) {
      const href = ITEMS[activeIndex].href;
      close();
      if (href) location.href = href;
      return;
    }
    close();
  }

  // ── Alt ─────────────────────────────────────────────
  let altHeld = false;
  let lastX = Math.round(window.innerWidth / 2);
  let lastY = Math.round(window.innerHeight / 2);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { close(); return; }
    if (e.key !== 'Alt') return;
    e.preventDefault();
    if (altHeld) return;
    altHeld = true;
    show(lastX, lastY);
  }, true);

  window.addEventListener('keyup', (e) => {
    if (e.key !== 'Alt') return;
    if (!altHeld) return;
    altHeld = false;
    commit();
  }, true);

  window.addEventListener('blur', () => { altHeld = false; close(); });

  window.addEventListener('pointermove', (e) => {
    if (open) return;
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
    lastX = cx; lastY = cy;
    show(cx, cy);
  }, true);

  window.RadialMenu = {
    open: (x, y) => show(x == null ? window.innerWidth / 2 : x, y == null ? window.innerHeight / 2 : y),
    close,
    isOpen: () => open,
  };
})();
