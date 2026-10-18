/* ═══════════ 全站禁止縮放（移動端 pinch-zoom） ═══════════ */
(function () {
  'use strict';

  // 1) 攔截多指觸摸（iOS + Android 通用）
  //    單指正常放行，兩指以上一律阻擋
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  // 2) iOS Safari 專屬的 gesture 事件（Safari 13+ 仍會派發）
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(evt => {
    document.addEventListener(evt, (e) => {
      e.preventDefault();
    }, { passive: false });
  });

  // 3) 桌面瀏覽器 Ctrl/Cmd + 滾輪縮放（順手一起擋）
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      // 但如果游標在某個視窗的內容區內，讓那個視窗的 handler 自己處理
      // （.os-win-body 有自己的 wheel 監聽，會 stopPropagation 嗎？不會，
      //   但我們這裡的判斷會干擾它，所以做個例外）
      const inWinBody = e.target.closest && e.target.closest('.os-win-body');
      if (!inWinBody) e.preventDefault();
    }
  }, { passive: false });

  // 4) 攔截雙擊縮放（iOS Safari 舊版可能透過此觸發）
  let _lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - _lastTouchEnd <= 300) {
      e.preventDefault();
    }
    _lastTouchEnd = now;
  }, { passive: false });

  // 5) 保險：把 viewport meta 再次寫死（有些 SPA 動態改寫）
  window.addEventListener('load', () => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      meta.setAttribute('content',
        'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover');
    }
  });
})();
