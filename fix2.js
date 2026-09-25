// add-inline-redirect.js
const fs = require('fs');
const path = require('path');

const INLINE = `<script>
(function(){
  try {
    var isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true
                    || window.matchMedia('(display-mode: fullscreen)').matches
                    || window.matchMedia('(display-mode: minimal-ui)').matches;
    if (!isStandalone) return;
    if (location.pathname.indexOf('/os') === 0) return;
    if (location.pathname.indexOf('/admin') === 0) return;
    if (!sessionStorage.getItem('pwaEnteredOS')) {
      sessionStorage.setItem('pwaEnteredOS', '1');
      location.replace('/mobile' + location.search + location.hash);
    }
  } catch(e){}
})();
</script>
`;

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));
for (const f of files) {
  const file = path.join(__dirname, f);
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes("pwaEnteredOS")) { console.log(`⏭  ${f}`); continue; }
  // 插在 <head> 之後
  const idx = html.indexOf('<head>');
  if (idx === -1) { console.log(`⚠️  ${f} 沒 <head>`); continue; }
  html = html.slice(0, idx + 6) + '\n' + INLINE + html.slice(idx + 6);
  fs.writeFileSync(file, html, 'utf8');
  console.log(`✅ ${f}`);
}