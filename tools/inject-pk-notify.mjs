// tools/inject-pk-notify.mjs —— 把 pk-notify.js 注入所有页面
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);
const TAG_MARKER = 'pk-notify.js';

const DRY = process.argv.includes('--dry');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

let changed = 0, skipped = 0, missing = 0;

for (const file of walk(ROOT).sort()) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let text = fs.readFileSync(file, 'utf8');

  if (text.includes(TAG_MARKER)) { skipped++; continue; }

  const idx = text.lastIndexOf('</body>');
  if (idx < 0) { missing++; console.log(`  无 </body>: ${rel}`); continue; }

  // 取当前页面已用的 build 版本号，保持缓存一致性
  const m = text.match(/\?v=([0-9a-f]{8})/);
  const v = m ? m[1] : '';
  const tag = `<script src="/assets/js/${TAG_MARKER}?v=${v}"></script>\n`;

  const before = text.slice(0, idx);
  const nl = before.endsWith('\n') ? '' : '\n';
  text = before + nl + tag + text.slice(idx);

  if (!DRY) fs.writeFileSync(file, text, 'utf8');
  changed++;
  console.log(`  ${DRY ? '[待改]' : '✓'} ${rel}`);
}

console.log(`\n${DRY ? '将注入' : '已注入'} ${changed} 个页面，跳过 ${skipped} 个（已有），${missing} 个无 </body>`);
