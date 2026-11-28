// tools/check-bundle-lists.mjs
//
// bundle-loader.js 里有一份和 build-bundle.mjs 的 PARTS 一模一样的文件列表。
//
// 为什么要这份重复：useBundle=false 时 loader 逐个 <script> 加载，
// 用不到 bundle；而 bundle 只有在 localStorage 里开了 moj:perf:bundle 才走。
// 也就是说**默认路径是那份手写列表**。
//
// core/img.js 加进 PARTS 却漏了这里，结果默认用户全都没有 window.imgUrl，
// 排行榜 / 提交列表 / 个人页一起炸 ReferenceError。
//
// 这个脚本在 build-bundle.mjs 里跑，发现两边不一致就中止构建。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'assets', 'js');

/** 从 build-bundle.mjs 源代码里抠出 PARTS 的 head / body 数组 */
function readParts() {
  const src = fs.readFileSync(path.join(ROOT, 'tools', 'build-bundle.mjs'), 'utf8');
  const out = {};
  for (const part of ['head', 'body']) {
    const i = src.indexOf(part + ': [');
    if (i < 0) continue;
    const j = src.indexOf(']', i);
    const body = src.slice(i, j);
    out[part] = (body.match(/'([\w./-]+\.js)'/g) || []).map((s) => s.slice(1, -1));
  }
  return out;
}

/** 从 bundle-loader.js 里抠出 LISTS 的 files 数组 */
function readLoader() {
  const src = fs.readFileSync(path.join(JS_DIR, 'bundle-loader.js'), 'utf8');
  const out = {};
  for (const part of ['head', 'body']) {
    const key = part + ': {';
    const i = src.indexOf(key);
    if (i < 0) continue;
    const filesAt = src.indexOf('files: [', i);
    if (filesAt < 0) continue;
    const j = src.indexOf(']', filesAt);
    const body = src.slice(filesAt, j);
    out[part] = (body.match(/'([\w./-]+\.js)'/g) || []).map((s) => s.slice(1, -1));
  }
  return out;
}

export function checkBundleLists() {
  const parts = readParts();
  const loader = readLoader();
  const problems = [];

  for (const part of ['head', 'body']) {
    const want = (parts[part] || []).slice().sort();
    const got = (loader[part] || []).slice().sort();
    if (!want.length || !got.length) {
      problems.push(part + ': 有一边没解析出来');
      continue;
    }
    const missing = want.filter((f) => !got.includes(f));
    const extra = got.filter((f) => !want.includes(f));
    if (missing.length) problems.push(part + ': loader 里缺 ' + missing.join(', '));
    if (extra.length) problems.push(part + ': loader 里多 ' + extra.join(', '));
  }
  return problems;
}

// 直接跑：node tools/check-bundle-lists.mjs
if (process.argv[1] && process.argv[1].endsWith('check-bundle-lists.mjs')) {
  const problems = checkBundleLists();
  if (problems.length) {
    console.error('bundle-loader.js 和 build-bundle.mjs 的列表对不上：');
    problems.forEach((p) => console.error('  - ' + p));
    console.error('');
    console.error('useBundle=false 时 loader 走的是自己那份列表，');
    console.error('缺文件会让整个页面 ReferenceError。');
    process.exit(1);
  }
  console.log('两边的文件列表一致');
}
