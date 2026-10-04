// add-pwa-tags.js — 給根目錄所有 HTML 注入 PWA 標籤
// 用法：
//   node add-pwa-tags.js           # 乾跑（預覽會改哪些檔案）
//   node add-pwa-tags.js --write   # 實際寫入

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const WRITE = process.argv.includes('--write');

// 要注入的標籤
const INJECT = `  <!-- ⭐ PWA（必須靜態寫入 <head>

<script src="https://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/arch-render.js"></script>，不能靠 JS 動態注入） -->
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1a1a2e">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="WYK Maths">
  <meta name="mobile-web-app-capable" content="yes">
`;

const files = fs.readdirSync(ROOT)
  .filter(f => f.toLowerCase().endsWith('.html'))
  .filter(f => fs.statSync(path.join(ROOT, f)).isFile());

console.log(`找到 ${files.length} 個根目錄 HTML 檔案\n`);

let modified = 0, skipped = 0, failed = 0;

for (const name of files) {
  const file = path.join(ROOT, name);
  let html;
  try {
    html = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.log(`❌ ${name} — 讀取失敗: ${e.message}`);
    failed++;
    continue;
  }

  // 已有 manifest 就不動
  if (/<link[^>]+rel=["']manifest["']/i.test(html)) {
    console.log(`⏭  ${name} — 已有 manifest，跳過`);
    skipped++;
    continue;
  }

  // 找 </head>
  const idx = html.search(/<\/head\s*>/i);
  if (idx === -1) {
    console.log(`⚠️  ${name} — 找不到 </head>，跳過`);
    failed++;
    continue;
  }

  const newHtml = html.slice(0, idx) + INJECT + '\n' + html.slice(idx);

  if (WRITE) {
    fs.writeFileSync(file, newHtml, 'utf8');
    console.log(`✅ ${name} — 已寫入`);
  } else {
    console.log(`📝 ${name} — 會注入（乾跑模式）`);
  }
  modified++;
}

console.log(`\n===== 總結 =====`);
console.log(`修改：${modified}`);
console.log(`跳過：${skipped}`);
console.log(`失敗：${failed}`);

if (!WRITE && modified > 0) {
  console.log(`\n這是乾跑模式。加上 --write 才會實際寫入：`);
  console.log(`  node add-pwa-tags.js --write`);
}