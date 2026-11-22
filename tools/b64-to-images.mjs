// scripts/b64-to-images.mjs
// 從 images.json（{ id: "data:image/png;base64,..." }）解碼出獨立圖片檔案
// 用法：
//   node scripts/b64-to-images.mjs private/images.json private/tr-images
//   node scripts/b64-to-images.mjs private/images.json private/tr-images --filemap

import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const positional = args.filter(a => !a.startsWith('--'));
const [imagesPath, outDir = 'tr-images'] = positional;
const genFilemap = args.includes('--filemap');

if (!imagesPath) {
  console.error('Usage: node b64-to-images.mjs <images.json> [outDir] [--filemap]');
  process.exit(1);
}

const MIME_EXT = {
  'image/png':     'png',
  'image/jpeg':    'jpg',
  'image/jpg':     'jpg',
  'image/gif':     'gif',
  'image/webp':    'webp',
  'image/svg+xml': 'svg',
  'image/bmp':     'bmp',
  'image/x-icon':  'ico',
  'image/tiff':    'tiff',
};

function parseDataUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('data:')) return null;
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/.exec(uri);
  if (!m) return null;
  const mime = (m[1] || 'application/octet-stream').toLowerCase();
  const isB64 = !!m[2];
  const payload = m[3];
  try {
    const buffer = isB64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    const ext = MIME_EXT[mime] || 'bin';
    return { mime, ext, buffer, size: buffer.length };
  } catch (e) {
    return null;
  }
}

// ═══════════ 讀取 ═══════════
console.log(`Reading ${imagesPath}...`);
const imageMap = JSON.parse(fs.readFileSync(imagesPath, 'utf8'));
const ids = Object.keys(imageMap);
console.log(`Loaded ${ids.length} images`);

// ═══════════ 建立輸出目錄 ═══════════
fs.mkdirSync(outDir, { recursive: true });
console.log(`Output dir: ${outDir}`);

// ═══════════ 解碼並寫檔 ═══════════
const fileMap = {};       // { id: "AQ-12292.png" }
const stats = { ok: 0, failed: 0, byExt: {}, totalBytes: 0 };
const failedIds = [];

for (const id of ids) {
  const parsed = parseDataUri(imageMap[id]);
  if (!parsed) {
    console.warn(`  ✗ Cannot parse: ${id}`);
    stats.failed++;
    failedIds.push(id);
    continue;
  }

  // 安全檔名
  const safeId = String(id).replace(/[^\w.-]/g, '_');
  const fileName = `${safeId}.${parsed.ext}`;
  const filePath = path.join(outDir, fileName);

  try {
    fs.writeFileSync(filePath, parsed.buffer);
    fileMap[id] = fileName;
    stats.ok++;
    stats.byExt[parsed.ext] = (stats.byExt[parsed.ext] || 0) + 1;
    stats.totalBytes += parsed.size;
  } catch (e) {
    console.warn(`  ✗ Write failed for ${id}: ${e.message}`);
    stats.failed++;
    failedIds.push(id);
  }
}

// ═══════════ 輸出 filemap.json ═══════════
if (genFilemap) {
  const filemapPath = path.join(outDir, 'filemap.json');
  fs.writeFileSync(filemapPath, JSON.stringify(fileMap, null, 2), 'utf8');
  console.log(`\nWrote ${filemapPath}`);
}

// ═══════════ 統計 ═══════════
console.log('\n─── Stats ───');
console.log({
  totalImages:      ids.length,
  written:          stats.ok,
  failed:           stats.failed,
  byExtension:      stats.byExt,
  totalSizeMB:      (stats.totalBytes / 1048576).toFixed(2),
  outputDir:        outDir,
});
if (failedIds.length > 0) {
  console.log('\nFailed IDs (first 10):', failedIds.slice(0, 10));
  fs.writeFileSync(path.join(outDir, '_failed.txt'), failedIds.join('\n'), 'utf8');
  console.log(`Full list written to ${path.join(outDir, '_failed.txt')}`);
}