// add-inline-redirect.js
const fs = require('fs');
const path = require('path');

const INLINE = `<!-- <script>
(function(){
  try {
    if (window.top !== window.self) return;
    // if (sessionStorage.getItem('desktopPreferred')) return;   // 用戶手動選桌面版
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (!isMobile) return;
    if (location.pathname.indexOf('/mobile') === 0) return;
    // if (location.pathname.indexOf('/os') === 0) return;
    if (location.pathname.indexOf('/admin') === 0) return;
    location.replace('/mobile/' + location.search + location.hash);
  } catch(e){}
})();
</script> -->
`;

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));
for (const f of files) {
  const file = path.join(__dirname, f);
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes("pwaEnteredOS")) { console.log(`⏭  ${f}`); continue; }
  // 插在 <head>
<script src="https://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/arch-render.js"></script> 之後
  const idx = html.indexOf('<head>
<script src="https://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/arch-render.js"></script>');
  if (idx === -1) { console.log(`⚠️  ${f} 沒 <head>
<script src="https://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/arch-render.js"></script>`); continue; }
  html = html.slice(0, idx + 6) + '\n' + INLINE + html.slice(idx + 6);
  fs.writeFileSync(file, html, 'utf8');
  console.log(`✅ ${f}`);
}