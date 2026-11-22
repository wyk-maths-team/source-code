#!/usr/bin/env node
// tools/migrate-alert.mjs
//
// 把页面里的 alert() 换成 DSHUI.toast()。
//
// 用法：
//   node tools/migrate-alert.mjs --check
//   node tools/migrate-alert.mjs
//
// 规则：
//   - 只处理 alert，不碰 confirm / prompt
//   - 同一行紧跟 location 跳转的保持不变（alert 会阻塞，用户看得到后再跳；
//     toast 不阻塞，换了会导致提示一闪而过甚至看不到）
//   - 按关键字判定类型：失败类 -> err，成功类 -> ok，其余 -> 普通
//   - DSHUI 未加载时回退到 window.alert，保证不会静默丢失提示

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);
const CHECK = process.argv.includes('--check');

const ERR_WORDS = /error|fail|failed|invalid|cannot|wrong|denied|required|max |must |copy failed|network|not found|缺少|失败|错误|无法|不能/i;
const OK_WORDS = /success|created|updated|saved|deleted|done|ok\b|成功|已保存/i;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

// 匹配 alert( ... )，参数到匹配的右括号（处理嵌套）
function replaceAlerts(text, file) {
  let out = '';
  let i = 0;
  let count = 0;
  const notes = [];
  while (i < text.length) {
    const m = /\balert\s*\(/.exec(text.slice(i));
    if (!m) { out += text.slice(i); break; }
    const start = i + m.index;
    out += text.slice(i, start);

    // 找匹配的右括号
    let depth = 0, j = start + m[0].length - 1, inStr = null, inTpl = false;
    for (; j < text.length; j++) {
      const c = text[j];
      if (inStr) { if (c === '\\') { j++; continue; } if (c === inStr) inStr = null; continue; }
      if (inTpl) { if (c === '\\') { j++; continue; } if (c === '`') inTpl = false; continue; }
      if (c === '"' || c === "'") { inStr = c; continue; }
      if (c === '`') { inTpl = true; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) { out += text.slice(start); break; }

    const argText = text.slice(start + m[0].length, j);
    const lineStart = text.lastIndexOf('\n', start) + 1;
    const lineEnd = text.indexOf('\n', j) < 0 ? text.length : text.indexOf('\n', j);
    const wholeLine = text.slice(lineStart, lineEnd);

    // 同行有跳转 -> 保持 alert（用户需要看到提示后再跳）
    if (/location\s*[.=]|location\.href|location\.replace/.test(wholeLine)) {
      notes.push(`保留(同行有跳转): ${argText.slice(0, 40).replace(/\s+/g, ' ')}`);
      out += text.slice(start, j + 1);
      i = j + 1;
      continue;
    }

    const type = ERR_WORDS.test(argText) ? ', \'err\'' : (OK_WORDS.test(argText) ? ', \'ok\'' : '');
    out += `(window.DSHUI ? DSHUI.toast(${argText}${type}) : alert(${argText}))`;
    notes.push(`转 toast${type ? type.replace(', ', '[') + ']' : ''}: ${argText.slice(0, 40).replace(/\s+/g, ' ')}`);
    count++;
    i = j + 1;
  }
  return { text: out, count, notes };
}

let totalPages = 0, totalAlerts = 0, kept = 0;
for (const f of walk(ROOT).sort()) {
  const orig = fs.readFileSync(f, 'utf8');
  const { text, count, notes } = replaceAlerts(orig, f);
  const keptHere = notes.filter(n => n.startsWith('保留')).length;
  kept += keptHere;
  if (count > 0) {
    totalPages++; totalAlerts += count;
    if (!CHECK) fs.writeFileSync(f, text, 'utf8');
    console.log(`  ${CHECK ? '[待改]' : '✓'} ${path.relative(ROOT, f).replace(/\\/g, '/')}  转 ${count} 处${keptHere ? `，保留 ${keptHere} 处` : ''}`);
  }
}
console.log(`\n${CHECK ? '需要修改' : '已修改'} ${totalPages} 个页面，转 toast ${totalAlerts} 处，保留 alert ${kept} 处`);
