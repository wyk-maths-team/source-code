(function(){
  try {
    // ⭐ 只在頂層窗口執行，iframe 內不重定向
    if (window.top !== window.self) return;

    var isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true
                    || window.matchMedia('(display-mode: fullscreen)').matches
                    || window.matchMedia('(display-mode: minimal-ui)').matches;
    if (!isStandalone) return;
    if (location.pathname.indexOf('/os') === 0) return;
    if (location.pathname.indexOf('/admin') === 0) return;
    if (!sessionStorage.getItem('pwaEnteredOS')) {
      sessionStorage.setItem('pwaEnteredOS', '1');
      location.replace('/os' + location.search + location.hash);
    }
  } catch(e){}
})();
