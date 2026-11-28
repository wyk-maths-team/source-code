// tools/install-hooks.mjs
//
// 一键把仓库的 git 钩子指到 tools/hooks/。
//
//   node tools/install-hooks.mjs
//
// 配置存在 .git/config 的 core.hooksPath 里，不会进版本库。
// 换机器 / 重新 clone 之后要再跑一次。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = '.githooks';
if (!fs.existsSync(path.join(dir, 'pre-commit'))) {
  console.error('找不到 ' + dir + '/pre-commit');
  process.exit(1);
}

execFileSync('git', ['config', 'core.hooksPath', dir], { stdio: 'inherit' });

// 类 Unix 上要给执行位；Windows 上 chmod 基本是空操作，留着无害
try { fs.chmodSync(path.join(dir, 'pre-commit'), 0o755); } catch (e) {}

console.log('已把 core.hooksPath 设为 ' + dir);
console.log('现在每次提交，只要改了 assets/ 或 *.html，就会自动重打 ?v= 指纹');
