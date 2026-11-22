#!/usr/bin/env node
/**
 * tools/extract-colors.mjs
 *
 * 把内联 <style> 里的「中性色」硬编码提取成 CSS 变量，并生成暗色/科幻覆盖。
 *
 * 为什么只处理中性色：
 *   内联样式里共 273 种颜色、939 处引用，但其中大部分是**语义色**——
 *   成功绿 #2e7d32、错误红 #e74c3c、警告橙 #f0ad4e，以及代码高亮用的
 *   #2d2d2d / #d4d4d4。这些在深色背景下依然成立，盲目替换会让按钮失去
 *   对比度、代码块失去层次。
 *
 *   真正让暗色/科幻主题崩坏的，是「浅色背景 + 深色文字 + 浅灰边框」这类
 *   中性色，它们写死在样式里，不跟随主题。
 *
 * 用法：
 *   node tools/extract-colors.mjs --check
 *   node tools/extract-colors.mjs --only user.html,ranklist.html
 *   node tools/extract-colors.mjs
 *
 * 幂等：已注入 `--c-surface` 变量块的页面会跳过。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', '.backup', '.acl-recovery', 'node_modules', '.chrome-profile', 'private', 'grader', 'temp', '.vercel', '_template']);

const CHECK = process.argv.includes('--check');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1].split(',').map(s => s.trim()).filter(Boolean) : null;

/** 中性色 → 语义变量名。键统一小写，含 3 位与 6 位写法。 */
const NEUTRAL = {
  '#ffffff': 'surface', '#fff': 'surface',
  '#fafafa': 'surface-sunken', '#f8f9fa': 'surface-sunken',
  '#f9f9f9': 'surface-sunken', '#f5f5f5': 'surface-sunken',
  '#f0f4f8': 'surface-sunken', '#f0f2f5': 'surface-sunken',
  '#f0f0f0': 'surface-raised', '#eee': 'surface-raised', '#eeeeee': 'surface-raised',
  '#e9ecef': 'surface-muted', '#e2e3e5': 'surface-muted',
  '#dddddd': 'border', '#ddd': 'border',
  '#dee2e6': 'border', '#cccccc': 'border', '#ccc': 'border',
  '#bbbbbb': 'border-strong', '#bbb': 'border-strong',
  '#333333': 'text', '#333': 'text',
  '#212529': 'text', '#2c2c2c': 'text',
  '#666666': 'text-muted', '#666': 'text-muted',
  '#6c757d': 'text-muted', '#777': 'text-muted',
  '#999999': 'text-subtle', '#999': 'text-subtle',
};

const LIGHT = {
  surface: '#ffffff', 'surface-sunken': '#f8f9fa', 'surface-raised': '#f0f0f0',
  'surface-muted': '#e9ecef', border: '#dddddd', 'border-strong': '#bbbbbb',
  text: '#333333', 'text-muted': '#666666', 'text-subtle': '#999999',
};
const DARK = {
  surface: '#161b22', 'surface-sunken': '#0d1117', 'surface-raised': '#21262d',
  'surface-muted': '#21262d', border: '#30363d', 'border-strong': '#484f58',
  text: '#c9d1d9', 'text-muted': '#8b949e', 'text-subtle': '#6e7681',
};
const SCIFI = {
  surface: '#09101a', 'surface-sunken': '#070d15', 'surface-raised': '#0f2231',
  'surface-muted': '#101b26', border: '#14313f', 'border-strong': '#1e4a5e',
  text: '#c6eeff', 'text-muted': '#6c8fa3', 'text-subtle': '#546f80',
};

function varsBlock(selector, map) {
  const body = Object.entries(map).map(([k, v]) => `      --c-${k}: ${v};`).join('\n');
  return `    ${selector} {\n${body}\n    }`;
}

function buildBlock() {
  return [
    '    /* ── 中性色变量（由 tools/extract-colors.mjs 生成）──────────────',
    '       原先写死在内联样式里的浅色背景 / 深色文字 / 浅灰边框，抽取成',
    '       变量后暗色与科幻主题只需覆盖取值，不必逐条重写规则。',
    '       语义色（成功绿、错误红、警告橙）与代码高亮色刻意保留，',
    '       它们在深色背景下依然成立。 */',
    varsBlock(':root', LIGHT),
    varsBlock(':root[data-theme="dark"]', DARK),
    varsBlock(':root[data-theme="scifi"]', SCIFI),
    '',
  ].join('\n');
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else if (/\.html$/i.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 只替换属性上下文里的中性色。
 * 三个属性分开处理——合并成一个正则时分支会互相干扰，background 会被漏掉。
 */
function rewriteCss(css) {
  let replaced = 0;

  // background / background-color
  css = css.replace(/(background(?:-color)?\s*:\s*)(#[0-9a-fA-F]{3,8})\b/g, (whole, prefix, hex) => {
    const key = NEUTRAL[hex.toLowerCase()];
    if (!key) return whole;
    replaced++;
    return `${prefix}var(--c-${key})`;
  });

  // color（不含 background-color，用前置字符断言排除）
  css = css.replace(/((?:^|[;{\s])color\s*:\s*)(#[0-9a-fA-F]{3,8})\b/g, (whole, prefix, hex) => {
    const key = NEUTRAL[hex.toLowerCase()];
    if (!key) return whole;
    // surface 白在 color 上下文通常是彩色按钮上的白字，保留以保证对比度
    if (key === 'surface') return whole;
    replaced++;
    return `${prefix}var(--c-${key})`;
  });

  // border / border-color / border-top ...
  css = css.replace(/(border(?:-[a-z]+)?\s*:[^;{}]*?)(#[0-9a-fA-F]{3,8})\b/g, (whole, prefix, hex) => {
    const key = NEUTRAL[hex.toLowerCase()];
    if (!key) return whole;
    replaced++;
    return `${prefix}var(--c-${key})`;
  });

  return { css, replaced };
}

let files = 0, totalReplaced = 0, skipped = 0;
const report = [];

for (const file of walk(ROOT).sort()) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  if (ONLY && !ONLY.some(o => rel.endsWith(o))) continue;

  let text = fs.readFileSync(file, 'utf8');
  if (text.includes('--c-surface')) { skipped++; continue; }

  const blocks = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  if (blocks.length === 0) continue;

  let pageReplaced = 0;
  for (const b of blocks) {
    const { css, replaced } = rewriteCss(b[1]);
    if (replaced > 0) {
      pageReplaced += replaced;
      text = text.replace(b[1], css);
    }
  }
  if (pageReplaced === 0) continue;

  // 变量块插到第一个 <style> 内部最前面
  const first = text.match(/(<style[^>]*>)/i);
  if (first) {
    const at = first.index + first[0].length;
    text = text.slice(0, at) + '\n' + buildBlock() + text.slice(at);
  }

  files++; totalReplaced += pageReplaced;
  report.push(`  ${CHECK ? '[待改]' : '✓'} ${rel.padEnd(30)} ${pageReplaced} 处`);

  if (!CHECK) fs.writeFileSync(file, text, 'utf8');
}

console.log(report.join('\n'));
console.log(`\n${CHECK ? '将处理' : '已处理'} ${files} 个页面 / ${totalReplaced} 处硬编码中性色，跳过 ${skipped} 个（已含变量）`);
console.log('保持不变：语义色（成功/错误/警告）与代码高亮色');
