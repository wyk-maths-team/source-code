// // resources/script/pageload.js
// (function () {
//   'use strict';

//   var KEY          = '__pt';
//   var PROGRESS_KEY = '__pt-progress';
//   var TOGGLE_KEY   = 'pageTransition';

//   var VEIL_LIGHT = '#0f3460';
//   var VEIL_DARK  = '#0d1117';

//   var COVER_LIGHT_MS = 220;
//   var COVER_DARK_MS  = 450;
//   var HOLD_MS        = 500;
//   var REVEAL_MS      = 400;
//   var PROGRESS_TO_80 = 550;
//   var PROGRESS_TO_100= 280;    // ⭐ 80→100 时长
//   var MIN_TOTAL_MS   = 900;    // ⭐ 从遮罩出现到开始淡出的最短时间
//   var COVER_TARGET   = 65;

//   function isEnabled() {
//     try { return localStorage.getItem(TOGGLE_KEY) !== 'off'; } catch (e) { return true; }
//   }
//   function themeMode() {
//     try { return localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'; }
//     catch (e) { return 'light'; }
//   }
//   function veilColor() {
//     return themeMode() === 'dark' ? VEIL_DARK : VEIL_LIGHT;
//   }

//   function findMainContainer() {
//     return document.getElementById('mainContent')
//         || document.getElementById('ml-content')
//         || document.querySelector('main.main-content')
//         || document.querySelector('.main-content')
//         || document.querySelector('main')
//         || null;
//   }

//   function positionOverlay(veil) {
//     var container = findMainContainer();
//     if (!container) {
//       veil.style.position = 'fixed';
//       veil.style.left = '0';
//       veil.style.top = '0';
//       veil.style.width = '100vw';
//       veil.style.height = '100vh';
//       return;
//     }
//     var r = container.getBoundingClientRect();
//     veil.style.position = 'fixed';
//     veil.style.left   = Math.max(0, r.left)   + 'px';
//     veil.style.top    = Math.max(0, r.top)    + 'px';
//     veil.style.width  = Math.max(0, r.width)  + 'px';
//     veil.style.height = Math.max(0, r.height) + 'px';
//   }

//   var _cssDone = false;
//   function injectCSS() {
//     if (_cssDone) return;
//     _cssDone = true;
//     var s = document.createElement('style');
//     s.setAttribute('data-pt-style', '1');
//     s.textContent = [
//       '#__pt-veil{',
//         'z-index:2147483647;',
//         'display:flex;align-items:center;justify-content:center;',
//         'opacity:0;pointer-events:none;will-change:opacity;',
//         '-webkit-tap-highlight-color:transparent;',
//         'transition:opacity .25s ease;',
//         'color:#e6edf3;',
//         'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif !important;',
//         'overflow:hidden;',
//       '}',
//       '#__pt-veil.__pt-instant{transition:none !important}',
//       '#__pt-veil .pt-box{text-align:center;width:min(280px,80vw)}',
//       '#__pt-veil .pt-logo{font-size:44px;color:#4a90d9;margin-bottom:16px;opacity:.9}',
//       '#__pt-veil .pt-title{font-size:15px;font-weight:600;color:#e6edf3;margin-bottom:24px;letter-spacing:.3px;font-family:inherit !important}',
//       '#__pt-veil .pt-bar{height:3px;background:rgba(255,255,255,.16);border-radius:2px;overflow:hidden;margin-bottom:10px}',
//       '#__pt-veil .pt-fill{height:100%;width:0%;background:linear-gradient(90deg,#4a90d9,#58a6ff);border-radius:2px}',
//       '#__pt-veil .pt-pct{font-size:11px;font-family:"SF Mono",Consolas,monospace !important;color:rgba(255,255,255,.55);letter-spacing:.5px}',
//     ].join('');
//     document.head.appendChild(s);
//   }

//   var _currentVeil = null;
//   var _resizeHandler = null;
//   function cleanupResize() {
//     if (_resizeHandler) {
//       window.removeEventListener('resize', _resizeHandler);
//       _resizeHandler = null;
//     }
//   }

//   function buildVeil() {
//     injectCSS();
//     var old = document.getElementById('__pt-veil');
//     if (old) old.remove();
//     cleanupResize();

//     var v = document.createElement('div');
//     v.id = '__pt-veil';
//     v.style.background = veilColor();
//     v.innerHTML =
//       '<div class="pt-box">' +
//         '<div class="pt-logo"><i class="fas fa-cube"></i></div>' +
//         '<div class="pt-title">WYK Maths Team</div>' +
//         '<div class="pt-bar"><div class="pt-fill"></div></div>' +
//         '<div class="pt-pct">0%</div>' +
//       '</div>';
//     document.body.appendChild(v);
//     positionOverlay(v);
//     _resizeHandler = function () { positionOverlay(v); };
//     window.addEventListener('resize', _resizeHandler);
//     _currentVeil = v;
//     return {
//       veil: v,
//       fill: v.querySelector('.pt-fill'),
//       pctEl: v.querySelector('.pt-pct'),
//     };
//   }

//   // ⭐ 99.5 以上显示"100%"
//   function setDisplay(res, val) {
//     res.fill.style.width = val + '%';
//     if (res.pctEl) {
//       var disp = val >= 99.5 ? 100 : Math.floor(val);
//       res.pctEl.textContent = disp + '%';
//     }
//   }

//   function animateProgress(res, from, to, duration, cb) {
//     var start = performance.now();
//     function tick(now) {
//       var t = Math.min(1, (now - start) / duration);
//       var eased = 1 - Math.pow(1 - t, 3);
//       var val = from + (to - from) * eased;
//       setDisplay(res, val);
//       if (t < 1) requestAnimationFrame(tick);
//       else if (cb) cb();
//     }
//     requestAnimationFrame(tick);
//   }

//   function setProgressInstant(res, value) {
//     setDisplay(res, value);
//   }

//   // ⭐ 判断是否要跳过过渡（API、外部、特殊）
//   function shouldSkipTransition(url) {
//     if (!url) return true;
//     var s = String(url);
//     if (s.startsWith('/api/')) return true;
//     if (s.startsWith('mailto:') || s.startsWith('tel:') || s.startsWith('javascript:')) return true;
//     return false;
//   }

//   function resolveUrl(url) {
//     try { return new URL(String(url), location.href); }
//     catch (e) { return null; }
//   }

//   // ── 离开页面 ──
//   function playCover(url) {
//     if (shouldSkipTransition(url)) { window.location.href = url; return; }
//     var u = resolveUrl(url);
//     if (!u || u.origin !== location.origin || !/^https?:$/.test(u.protocol)) {
//       window.location.href = url;
//       return;
//     }

//     var mode = themeMode();
//     var duration = (mode === 'dark') ? COVER_DARK_MS : COVER_LIGHT_MS;

//     var res = buildVeil();
//     var v = res.veil;

//     v.classList.add('__pt-instant');
//     v.style.opacity = '0';
//     void v.offsetWidth;

//     v.classList.remove('__pt-instant');
//     v.style.transition = 'opacity ' + duration + 'ms cubic-bezier(.4,0,.2,1)';
//     v.style.opacity = '1';

//     animateProgress(res, 0, COVER_TARGET, duration + 100);

//     setTimeout(function () {
//       var current = parseFloat(res.fill.style.width) || 0;
//       try {
//         sessionStorage.setItem(KEY, 'in');
//         sessionStorage.setItem(PROGRESS_KEY, String(current));
//       } catch (e) {}
//       window.location.href = u.pathname + u.search + u.hash;
//     }, duration + 30);
//   }

//   // ── 进入页面 ──
//   function playReveal() {
//     var res = buildVeil();
//     var v = res.veil;
//     var t0 = performance.now();   // ⭐ 用于 MIN_TOTAL_MS

//     var startValue = 0;
//     try {
//       startValue = parseFloat(sessionStorage.getItem(PROGRESS_KEY)) || 0;
//       sessionStorage.removeItem(PROGRESS_KEY);
//     } catch (e) {}
//     startValue = Math.max(0, Math.min(100, startValue));

//     v.classList.add('__pt-instant');
//     v.style.opacity = '1';
//     void v.offsetWidth;
//     v.classList.remove('__pt-instant');

//     setProgressInstant(res, startValue);
//     animateProgress(res, startValue, Math.max(startValue, 80), PROGRESS_TO_80);

//     var finished = false;
//     function finish() {
//       if (finished) return;
//       finished = true;

//       var elapsed = performance.now() - t0;
//       var wait = Math.max(0, MIN_TOTAL_MS - elapsed);   // ⭐ 至少停留 900ms

//       setTimeout(function () {
//         var cur = parseFloat(res.fill.style.width) || startValue;
//         animateProgress(res, cur, 100, PROGRESS_TO_100, function () {
//           // ⭐ 强制写死 100%
//           res.fill.style.width = '100%';
//           if (res.pctEl) res.pctEl.textContent = '100%';

//           setTimeout(function () {
//             v.style.transition = 'opacity ' + REVEAL_MS + 'ms ease';
//             v.style.opacity = '0';
//             setTimeout(function () {
//               if (v.parentNode) v.parentNode.removeChild(v);
//               if (_currentVeil === v) _currentVeil = null;
//               cleanupResize();
//               document.documentElement.style.background = '';
//             }, REVEAL_MS + 50);
//           }, HOLD_MS);
//         });
//       }, wait);
//     }

//     if (document.readyState === 'complete') {
//       setTimeout(finish, 150);
//     } else {
//       window.addEventListener('load', function () {
//         setTimeout(finish, 120);
//       }, { once: true });
//       setTimeout(finish, 8000);
//     }
//   }

//   function installLinkInterceptor() {
//     document.addEventListener('click', function (e) {
//       if (!isEnabled()) return;
//       if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

//       var a = e.target.closest && e.target.closest('a');
//       if (!a) return;
//       var href = a.getAttribute('href');
//       if (!href) return;
//       if (href.startsWith('#') ||
//           href.startsWith('javascript:') ||
//           href.startsWith('mailto:') ||
//           href.startsWith('tel:') ||
//           a.target === '_blank' ||
//           a.hasAttribute('download') ||
//           a.dataset.noTransition === '1') return;

//       var url;
//       try { url = new URL(href, location.href); } catch (err) { return; }
//       if (url.host !== location.host) return;
//       if (url.pathname === location.pathname && url.search === location.search) return;

//       e.preventDefault();
//       playCover(url.pathname + url.search + url.hash);
//     }, true);
//   }

//   // ⭐ Hook location.href setter
//   function installLocationHrefHook() {
//     try {
//       var loc = window.location;
//       var desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
//       if (!desc || !desc.set) return;
//       var origGet = desc.get;
//       var origSet = desc.set;

//       Object.defineProperty(loc, 'href', {
//         configurable: true,
//         enumerable: true,
//         get: function () { return origGet.call(loc); },
//         set: function (url) {
//           if (!isEnabled() || shouldSkipTransition(url)) {
//             return origSet.call(loc, url);
//           }
//           var u = resolveUrl(url);
//           if (!u || u.origin !== loc.origin || !/^https?:$/.test(u.protocol)) {
//             return origSet.call(loc, url);
//           }
//           playCover(url);
//         }
//       });
//     } catch (e) {
//       console.warn('[pt] location.href hook failed:', e);
//     }
//   }

//   // ⭐ Hook location.assign / replace
//   function installLocationMethodHooks() {
//     try {
//       ['assign', 'replace'].forEach(function (method) {
//         var orig = Location.prototype[method];
//         if (!orig || orig._ptWrapped) return;
//         Location.prototype[method] = function (url) {
//           if (!isEnabled() || this !== window.location || shouldSkipTransition(url)) {
//             return orig.call(this, url);
//           }
//           var u = resolveUrl(url);
//           if (!u || u.origin !== location.origin || !/^https?:$/.test(u.protocol)) {
//             return orig.call(this, url);
//           }
//           playCover(url);
//         };
//         Location.prototype[method]._ptWrapped = true;
//       });
//     } catch (e) {
//       console.warn('[pt] location method hooks failed:', e);
//     }
//   }

//   function onReady() {
//     if (!isEnabled()) {
//       try {
//         sessionStorage.removeItem(KEY);
//         sessionStorage.removeItem(PROGRESS_KEY);
//       } catch (e) {}
//       document.documentElement.style.background = '';
//       installLinkInterceptor();
//       installLocationHrefHook();
//       installLocationMethodHooks();
//       return;
//     }

//     var came = false;
//     try {
//       came = sessionStorage.getItem(KEY) === 'in';
//       if (came) sessionStorage.removeItem(KEY);
//     } catch (e) {}

//     if (came) {
//       playReveal();
//     } else {
//       try { sessionStorage.removeItem(PROGRESS_KEY); } catch (e) {}
//       document.documentElement.style.background = '';
//     }

//     installLinkInterceptor();
//     installLocationHrefHook();
//     installLocationMethodHooks();
//   }

//   if (document.readyState === 'loading') {
//     document.addEventListener('DOMContentLoaded', onReady);
//   } else {
//     onReady();
//   }

//   window.addEventListener('pageshow', function (e) {
//     if (e.persisted) {
//       var v = document.getElementById('__pt-veil');
//       if (v) v.remove();
//       cleanupResize();
//       document.documentElement.style.background = '';
//     }
//   });

//   window.navigate = function (url) {
//     if (!isEnabled()) { window.location.href = url; return; }
//     playCover(url);
//   };
//   window.setPageTransition = function (enable) {
//     try { localStorage.setItem(TOGGLE_KEY, enable ? 'on' : 'off'); } catch (e) {}
//     if (!enable) {
//       try {
//         sessionStorage.removeItem(KEY);
//         sessionStorage.removeItem(PROGRESS_KEY);
//       } catch (e) {}
//       document.documentElement.style.background = '';
//       var v = document.getElementById('__pt-veil');
//       if (v) v.remove();
//       cleanupResize();
//     }
//   };
//   window.isPageTransitionEnabled = isEnabled;
// })();
