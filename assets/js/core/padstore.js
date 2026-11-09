// assets/js/core/padstore.js —— 画板草稿的存储层
//
// 三个目标：
//   1. 省地方：坐标量化到 0-999 的整数、扁平数组、相邻点差值(delta)，
//      相比原来的浮点对象小一半以上；再按距离抽稀，肉眼几乎看不出差别。
//   2. 会用不完：localStorage 是同步 API、约 5MB。写满时自动转存 IndexedDB
//      (localforage)，读的时候两边都查，调用方不用管存在哪。
//   3. 会自己打扫：每份草稿带 savedAt，超过保留期的自动清掉，
//      保留期默认 30 天，可以在设置里改。
//
// 没有 IndexedDB / localforage 加载失败时，全部退回 localStorage，功能不受影响。

(function () {
  'use strict';

  const PAD_VERSION = 2;
  const COORD_SCALE = 1000;        // 坐标量化到 0..1000
  const MIN_DIST = 3;              // 相对 1000 尺度的最小采样距离（约 3px @ 1000px 宽）
  const DEFAULT_TTL_DAYS = 30;
  const TTL_KEY = 'padstore_ttl_days';

  let lfPromise = null;

  function loadLocalforage() {
    if (window.localforage) return Promise.resolve(window.localforage);
    if (lfPromise) return lfPromise;
    lfPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/localforage@1.10.0/dist/localforage.min.js';
      s.onload = () => {
        if (!window.localforage) return reject(new Error('localforage missing'));
        resolve(window.localforage);
      };
      s.onerror = () => reject(new Error('localforage failed to load'));
      document.head.appendChild(s);
    }).catch((e) => { lfPromise = null; throw e; });
    return lfPromise;
  }

  async function idb() {
    const lf = await loadLocalforage();
    return lf.createInstance({ name: 'wyk_pads', storeName: 'pads' });
  }

  // ── 编解码 ──────────────────────────────────────────────

  /**
   * strokes: [{ color:'#111827', width:4, points:[{x,y}] }]
   * 返回紧凑字符串；style 表只在这种题里出现过的颜色/粗细各存一次。
   */
  function encode(strokes, w, h) {
    const colors = [];
    const widths = [];
    const out = [];

    for (const st of strokes) {
      if (!st || !st.points || !st.points.length) continue;
      let ci = colors.indexOf(st.color);
      if (ci < 0) { ci = colors.length; colors.push(st.color); }
      // 橡皮擦用「负的粗细」表示，省一个字段
      const widthVal = st.erase ? -Math.abs(st.width || 1) : (st.width || 4);
      let wi = widths.indexOf(widthVal);
      if (wi < 0) { wi = widths.length; widths.push(widthVal); }

      const flat = [];
      let lastX = null, lastY = null;
      for (const p of st.points) {
        // 传进来的是 0-1 归一化坐标（画板统一这么存），量化到 0-1000
        const qx = Math.round(p.x * COORD_SCALE);
        const qy = Math.round(p.y * COORD_SCALE);
        if (lastX == null) { flat.push(qx, qy); }
        else {
          // 抽稀：离上一个点太近就不记，笔迹看着一样但省很多
          const dx = qx - lastX, dy = qy - lastY;
          if (Math.abs(dx) + Math.abs(dy) < MIN_DIST) continue;
          flat.push(dx, dy);
        }
        lastX = qx; lastY = qy;
      }
      if (flat.length >= 2) out.push([ci, wi, flat]);
    }

    return JSON.stringify({ v: PAD_VERSION, w: Math.round(w || 0), h: Math.round(h || 0), c: colors, wd: widths, s: out, t: Date.now() });
  }

  function decode(raw, targetW, targetH) {
    if (!raw) return [];
    let d;
    try { d = JSON.parse(raw); } catch (e) { return []; }
    if (!d) return [];

    // v1（老的浮点对象格式）里存的是绝对像素、且没记原尺寸，
    // 现在画板统一按 0-1 解读，读进来只会画到错误的位置。
    // 宁可从空白开始，也不要把以前的笔迹画歪。
    if (!d.v || d.v < 2) return [];

    const colors = d.c || ['#111827'];
    const widths = d.wd || [4];

    const strokes = [];
    for (const item of (d.s || [])) {
      const [ci, wi, flat] = item;
      const pts = [];
      let x = 0, y = 0;
      for (let i = 0; i < flat.length; i += 2) {
        if (i === 0) { x = flat[0]; y = flat[1]; }
        else { x += flat[i]; y += flat[i + 1]; }
        // 一律还原成 0-1，交给画板自己按当前尺寸展开
        pts.push({ x: x / COORD_SCALE, y: y / COORD_SCALE });
      }
      if (pts.length) {
        const wv = widths[wi] != null ? widths[wi] : widths[0];
        strokes.push({ color: colors[ci] || colors[0], width: Math.abs(wv) || 4, erase: wv < 0, points: pts });
      }
    }
    return strokes;
  }

  // ── 存活期 ──────────────────────────────────────────────

  function ttlDays() {
    try {
      const v = Number(localStorage.getItem(TTL_KEY));
      if (Number.isFinite(v) && v > 0) return v;
    } catch (e) {}
    return DEFAULT_TTL_DAYS;
  }

  function setTtlDays(days) {
    const d = Math.max(1, Math.min(3650, Number(days) || DEFAULT_TTL_DAYS));
    try { localStorage.setItem(TTL_KEY, String(d)); } catch (e) {}
    return d;
  }

  function isExpired(raw) {
    if (!raw) return false;
    let t = 0;
    try { t = Number(JSON.parse(raw).t) || 0; } catch (e) { return false; }
    if (!t) return false;    // 老格式没有时间戳，先留着
    return Date.now() - t > ttlDays() * 86400_000;
  }

  // ── 读写 ────────────────────────────────────────────────

  function saveSync(storageKey, raw) {
    try { localStorage.setItem(storageKey, raw); return true; }
    catch (e) { return false; }   // QuotaExceeded
  }

  async function save(storageKey, strokes, w, h) {
    if (!strokes || !strokes.length) { remove(storageKey); return 'removed'; }
    const raw = encode(strokes, w, h);

    if (saveSync(storageKey, raw)) return 'local';

    // localStorage 满了 → 转存 IndexedDB
    try {
      const store = await idb();
      await store.setItem(storageKey, raw);
      // 本地留个空占位，读取时知道要去 IDB 找
      saveSync(storageKey, '');
      return 'idb';
    } catch (e) {
      console.warn('[PadStore] could not persist', e && e.message);
      return 'failed';
    }
  }

  /** 同步读：只碰 localStorage。返回 { found, strokes, overflowed } */
  function loadSync(storageKey, w, h) {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return { found: false, strokes: [] };
      if (raw === '') return { found: false, strokes: [], overflowed: true };
      if (isExpired(raw)) { localStorage.removeItem(storageKey); return { found: false, strokes: [] }; }
      return { found: true, strokes: decode(raw, w, h) };
    } catch (e) { return { found: false, strokes: [] }; }
  }

  /** 异步读：localStorage 没有、且是个溢出占位时再去 IDB 找 */
  async function load(storageKey, w, h) {
    const sync = loadSync(storageKey, w, h);
    if (sync.found || !sync.overflowed) return sync.strokes;

    try {
      const store = await idb();
      const raw = await store.getItem(storageKey);
      if (!raw) return [];
      if (isExpired(raw)) { await store.removeItem(storageKey); remove(storageKey); return []; }
      return decode(raw, w, h);
    } catch (e) { return []; }
  }

  function remove(storageKey) {
    try { localStorage.removeItem(storageKey); } catch (e) {}
    idb().then((s) => s.removeItem(storageKey)).catch(() => {});
  }

  // 扫一遍所有画板草稿，删掉过期的
  async function purgeExpired() {
    let removed = 0;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (/^(pd_scratchpad:|coursePad:|paperPad:|inlinePad:|pdfPad)/.test(k)) keys.push(k);
      }
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw === '') continue;    // 内容在 IDB，下面处理
        if (isExpired(raw)) { localStorage.removeItem(k); removed++; }
      }
      // IDB 里的
      const store = await idb();
      const idbKeys = await store.keys();
      for (const k of idbKeys) {
        const raw = await store.getItem(k);
        if (isExpired(raw)) { await store.removeItem(k); localStorage.removeItem(k); removed++; }
      }
    } catch (e) { /* 没有 IDB 就只清 localStorage */ }
    return removed;
  }

  // ── 自动打扫 ──────────────────────────────────────────────
  // 每次加载最多跑一次（按天节流），不用等学生想起来去点「Purge expired」
  const LAST_PURGE_KEY = 'padstore_last_purge';

  function autoPurge() {
    try {
      const last = Number(localStorage.getItem(LAST_PURGE_KEY)) || 0;
      if (Date.now() - last < 86400_000) return;     // 一天一次够了
      localStorage.setItem(LAST_PURGE_KEY, String(Date.now()));
    } catch (e) { return; }
    purgeExpired().catch(() => {});
  }

  window.addEventListener('load', () => setTimeout(autoPurge, 2500));

  window.PadStore = {
    encode, decode, save, load, loadSync, remove, purgeExpired,
    ttlDays, setTtlDays,
    DEFAULT_TTL_DAYS,
    VERSION: PAD_VERSION,
  };
})();
