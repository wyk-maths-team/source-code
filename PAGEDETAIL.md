# 页面档案与维护指南

> 覆盖 63 个页面。数据采集自 `tools/audit-pages.mjs`（2026-10-18，重构 M1–M3 之后）。
> 代码变化后重新生成：`node tools/audit-pages.mjs --json > .backup/pages-audit.json`

---

## 0. 先读这一页

### 这个项目是什么

Vercel 静态站 + MongoDB，零构建、零框架。33 个 serverless API + 63 个手写 HTML 页面。

| 项 | 数值 |
|---|---|
| 页面 | 63（根目录 30 / `admin/` 24 / 其他 9） |
| 内联 JS | **16374 行** |
| 内联 CSS | 9955 行 |
| 共享脚本 | `assets/js/` 30 个 + `core/` 4 个 |
| 共享样式 | `assets/css/` 7 个 |
| API | 33 个文件、58 个 `action` |
| rewrite | 78 条（`vercel.json`） |

### 三个最大的问题（按严重度）

1. **每页各自实现同一件事**：`escapeHtml` 有 27 份、`alert()` 46 处、裸 `fetch()` 22 处。
   其中 `charts.html` 的 `escapeHtml` 只转义 `& < >`，**漏了引号**，属性上下文有 XSS 风险。
2. **7 个页面内联 JS 超过 500 行**（`admin/health` 1142、`admin/editproblem` 995、`tr-system` 976、`admin.html` 927、`pk-room` 627、`admin/submissions` 598）。
3. **内联 CSS 9955 行**，与共享的 `assets/css/` 大量重复（如 `styles.css` 里的变量、卡片、按钮样式）。

### 加新页面怎么做

**不要复制现有页面。** 用脚手架：

```powershell
npm run new:page stats --title "Statistics" --icon fa-chart-simple --public
```

它会生成页面、脚本、侧栏条目、`vercel.json` 路由。详见 `_template/README.md`。

### 改代码的正确流程

```powershell
# 1. 改文件（页面 / api / assets）
# 2. 如果改的是 assets/ 下的 js 或 css：
npm run version:assets          # 换版本号，否则线上用户拿不到新版
# 3. 本地验证
vercel dev
# 4. 提交
git add -A && git commit -m "..."
```

---

## 1. 档位说明

每个页面按"内联 JS 行数 + 重复实现数量"分档，决定迁移优先级。

| 档 | 判据 | 页数 | 含义 |
|---|---|---|---|
| **A** | 内联 JS ≤ 50 行 | 10 | 已合规，逻辑已外置或本身极简 |
| **B** | 50–200 行 | 23 | 值得迁，收益明显、风险可控 |
| **C** | 200–500 行 | 20 | 收益大，但需要仔细回归 |
| **D** | > 500 行 | 7 | 复杂，单独评估，不硬上 |
| **X** | 明显临时/待确认 | 3 | 先决定去留，再谈迁移 |

> 档位不是质量评分。A 档里也有逻辑在别处的页面（如 `problems/[id].html` 只有 1 行 JS，
> 因为逻辑在 `assets/js/pd-script.js`）；D 档里也有写得很用心的页面（`admin/health.html`）。

---

## 2. 页面清单

列说明：**JS/CSS** = 内联行数；**API** = 引用的接口数；**鉴权** = `public` 公开 / `auth` 需登录；
**档** = 见上节；**重复** = 本页自带的重复实现（`esc` 转义函数 / `alert×n` / `fetch×n` 裸请求 / `api×n` 旧封装 / `fmt` 日期格式化 / `toast?` 疑似自定义提示）。

### 2.1 根目录（30 页）

| 页面 | 标题 | JS | CSS | API | 鉴权 | 档 | 重复 | 短路径 |
|---|---|---|---|---|---|---|---|---|
| `404.html` | Page Not Found | 23 | 46 | 0 | public | A | | 内部 |
| `admin.html` | Admin Dashboard | 927 | 780 | 2 | auth | **D** | alert×2 fetch×9 | `/admin` |
| `calendar.html` | Calendar | 487 | 362 | 1 | auth | C | esc alert×5 api×5 | — |
| `charts.html` | Solve Progress | 435 | 193 | 1 | auth | C | esc alert×1 api×1 | `/charts` |
| `contest.html` | Contests | 351 | 404 | 1 | auth | C | esc api×1 fmt | `/contest` |
| `contestresults.html` | Contest Results | 343 | 335 | 1 | auth | C | esc api×1 fmt | `/contest/:id/results` |
| `credits.html` | Credits | 19 | 64 | 0 | public | A | | `/credits` |
| `editpassword.html` | Change Password | 85 | 63 | 1 | auth | B | api×1 | `/users/edit` |
| `eeeee.html` | Extra Settings | 68 | 71 | 0 | auth | **X** | | 超长随机路径 |
| `extra.html` | Extra Settings | 277 | 20 | 0 | auth | C | | `/settings/extra` |
| `forgot-password.html` | Forgot Password | 24 | 40 | 1 | public | A | | `/auth/forgot-password` |
| `guide.html` | User Guide | 5 | 272 | 0 | public | A | | `/guide` |
| `index.html` | 首页 | 174 | 362 | 2 | public | B | esc fetch×1 api×1 | `/` |
| `login.html` | Sign In | 92 | 221 | 1 | auth | B | | `/login` |
| `os-temp.html` | OS 临时页 | 255 | 0 | 1 | auth | **X** | | — |
| `pk-invite.html` | PK Invitation | 178 | 64 | 1 | auth | B | esc api×3 | `/pk/invite` |
| `pk-room.html` | PK Room | 627 | 534 | 1 | auth | **D** | api×3 | `/pk/room` |
| `pk-waiting.html` | PK Waiting | 106 | 45 | 1 | auth | B | api×3 | `/pk/waiting` |
| `port.html` | Port 作品集 | 2 | 0 | 0 | auth | A | | `/port/<长路径>` |
| `problems.html` | 题库列表 | 23 | 0 | 0 | auth | A | | `/problems` |
| `ranklist.html` | Leaderboard | 418 | 379 | 1 | public | C | esc api×1 fmt | `/leaderboard` |
| `reset-password.html` | Set New Password | 81 | 33 | 1 | public | B | fetch×1 | `/auth/reset-password` |
| `resources.html` | Notes & Resources | 194 | 39 | 0 | auth | B | fetch×1 | `/resources` |
| `settings.html` | Settings | 302 | 132 | 1 | auth | C | alert×1 api×3 | `/settings` |
| `setup.html` | Set Up Password | 47 | 7 | 1 | auth | A | alert×3 fetch×1 | `/auth/setup` |
| `status.html` | Judge Status | 343 | 236 | 1 | auth | C | alert×1 api×3 fmt | `/status` |
| `submissions.html` | Submissions | 658 | 349 | 1 | auth | **D** | esc api×1 fmt | `/submissions` 等 3 条 |
| `template.html` | Template（旧的坏模板） | 21 | 11 | 0 | auth | **X** | | — |
| `tr-system.html` | TR Training | 976 | 815 | 1 | auth | **D** | fetch×1 api×3 | — |
| `user.html` | User Profile | 425 | 440 | 2 | auth | C | esc alert×2 api×4 fmt | `/users/:username` |

### 2.2 `admin/`（24 页）

| 页面 | 标题 | JS | CSS | API | 档 | 重复 | 短路径 |
|---|---|---|---|---|---|---|---|
| `admin/health.html` | Health Check | **1142** | 432 | **16** | **D** | esc alert×1 fetch×2 fmt | `/admin/health` |
| `admin/editproblem.html` | Edit Problem | 995 | 143 | 3 | **D** | esc alert×12 api×11 | `/admin/problems/:id` |
| `admin/submissions.html` | All Submissions | 598 | 288 | 3 | **D** | esc api×5 fmt toast? | `/admin/submissions` |
| `admin/newproblem.html` | New Problem | 489 | 93 | 2 | C | esc alert×2 api×3 | `/admin/create/problem` |
| `admin/oplog.html` | Activity Timeline | 415 | 354 | 1 | C | esc alert×1 api×2 fmt | `/admin/oplog` |
| `admin/editupdate.html` | Edit Update | 341 | 64 | 2 | C | esc alert×2 api×4 | `/admin/updates/:id` |
| `admin/log.html` | Audit Logs | 296 | 229 | 2 | C | esc api×2 fmt | `/admin/log` |
| `admin/editpkproblem.html` | Edit PK Problem | 279 | 158 | 2 | C | esc alert×2 api×3 | `/admin/pkproblems/:id` |
| `admin/updates.html` | Manage Updates | 253 | 54 | 1 | C | esc api×3 toast? | `/admin/updates` |
| `admin/editcontest.html` | Edit Contest | 246 | 135 | 2 | C | esc alert×2 api×4 | `/admin/contests/:id` |
| `admin/reports.html` | Manage Reports | 241 | 50 | 1 | C | esc api×3 toast? | `/admin/reports` |
| `admin/marksubmissions.html` | Mark Submission | 184 | 88 | 3 | B | esc api×4 | `/admin/marker/:subid` |
| `admin/newupdate.html` | New Update | 183 | 41 | 2 | B | esc api×2 | `/admin/create/update` |
| `admin/teams.html` | Manage Teams | 166 | 23 | 2 | B | api×4 | — |
| `admin/edituser.html` | Edit User | 142 | 11 | 1 | B | esc api×3 | `/admin/users/:username` |
| `admin/newcontest.html` | New Contest | 117 | 135 | 2 | B | api×2 | `/admin/create/contest` |
| `admin/users.html` | Manage Users | 114 | 23 | 1 | B | esc api×5 toast? | `/admin/users` |
| `admin/contest.html` | Manage Contests | 114 | 18 | 2 | B | esc alert×2 api×3 | `/admin/contests` |
| `admin/terminal.html` | Admin Terminal | 113 | 57 | 1 | B | api×4 | `/admin/sql` |
| `admin/problems.html` | Manage Problems | 95 | 13 | 1 | B | esc api×4 toast? | `/admin/problems` |
| `admin/cmd.html` | Admin Command Center | 90 | 113 | 2 | B | api×2 | `/admin/cmd` |
| `admin/pkproblems.html` | PK Problems | 89 | 66 | 1 | B | esc api×1 | `/admin/pkproblems` |
| `admin/newuser.html` | New User | 68 | 21 | 1 | B | api×1 | `/admin/create/user` |
| `admin/marker.html` | Mark Submissions | 31 | 6 | 2 | A | api×2 | `/admin/marker` |

### 2.3 其他目录（9 页）

| 页面 | 标题 | JS | CSS | API | 鉴权 | 档 | 重复 | 短路径 |
|---|---|---|---|---|---|---|---|---|
| `bio/infoday/index.html` | Bio Club Activities | 298 | 259 | 1 | auth | C | esc fetch×3 fmt toast? | — |
| `bio/infoday/admin.html` | Admin · Bio | 163 | 160 | 1 | auth | B | esc alert×2 fetch×2 fmt | — |
| `bio/infoday/leaderboard.html` | Leaderboard · Bio | 95 | 142 | 1 | auth | B | esc fetch×1 fmt | — |
| `contest/[id].html` | Contest Detail | 463 | 308 | 1 | auth | C | esc alert×4 api×3 fmt | `/contest/:id` |
| `mobile/index.html` | 移动版 | 2 | 0 | 0 | auth | A | | `/os` |
| `problems/[id].html` | Problem Detail | 1 | 0 | 0 | auth | A | | `/problems/:id` |
| `problems/bookmark.html` | Bookmarked | 151 | 56 | 2 | auth | B | esc alert×1 api×4 | `/problems/bookmarked` |
| `settings/extra.html` | Extra Settings | 263 | 20 | 0 | auth | C | | — |
| `submissions/detail.html` | Submission Detail | 171 | 78 | 1 | auth | B | esc api×1 | `/submissions/:id/detail` |

---

## 3. 重点页面详解

### 3.1 `problems/[id].html` — 题目详情（最核心的页面）

- **内联 JS 只有 1 行**，全部逻辑在 `assets/js/pd-script.js`（901 行）+ `pd-extras.js`（1299 行）+ `pd-mcq.js`（356 行）
- 这三个是**动态加载**的：`pd-script.js` 里的 `MCQ_JS_URL` / `EXTRAS_JS_URL` 按需加载，带版本号
- 依赖 `draw.js`（几何绘图，`pd-extras.js` 里动态加载）
- **改这里的逻辑要改 JS 文件，不是 HTML**
- 注意 `problem.FS === true` 的题目会禁掉文字提交，只允许 AI 分步批改或图片

### 3.2 `submissions.html` — 提交列表（658 行内联）

- 一个页面服务 3 条路由：`/submissions`、`/submissions/user/:username`、`/submissions/problem/:id`
- 靠 `location.pathname` 分支决定查谁的记录
- 有分页 + 预取（`fetchPage` / `prefetchNearby`）
- 迁移时**别动分页逻辑**，那是最容易出 bug 的部分

### 3.3 `admin/health.html` — 系统健康（1142 行，全站最大）

- 引用 **16 个 API**，是全站最重的页面
- 包含 Server 状态、DB 统计、Cloudinary、Vercel 用量
- 有 `fmt` 日期格式化、`escapeHtml`、裸 `fetch`、`alert`
- **迁移优先级最低**（用户只有 root，风险高收益低）

### 3.4 `admin/editproblem.html` — 题目编辑器（995 行 + 12 个 alert）

- 12 处 `alert()` 是全站最多
- 集成几何绘图（`/assets/js/draw.js`）、LaTeX 预览、题目图片上传
- 迁移时把 `alert` → `DSHUI.toast` 收益很大，但**必须逐个人工确认语义**（有些是确认框，不能直接换）

### 3.5 `tr-system.html` — 训练系统（976 行）

- 题图走 CDN：`https://cdn.jsdelivr.net/gh/wyk-math-team/resources@main/script/tr-images/`
- 这是**刻意保留在 CDN** 的（540 张题图，不适合进 git）
- 内联 CSS 815 行，是全站第二多
- 有独立的 `tr-problems` API（权限白名单 `TR_ALLOWED_USERS`）

### 3.6 `pk-room.html` — PK 对战（627 行）

- 实时对战：轮询 + 房间状态机
- 依赖 `isHost` / `isGuest` / `isSpectator` 三种角色
- 后端 `api/pk.js` 里有一处鉴权被注释掉（见安全审计），迁移前端时不会修复它，需要单独处理

### 3.7 `index.html` — 首页（内联 174 + CSS 362）

- 有 PWA 强制跳转逻辑（`forcePWAHome`）在 `app.js` 里
- 首页公告内容是硬编码在 HTML 里的
- `esc` + `fetch` + `api` 各一份

### 3.8 `settings.html` — 设置（302 行）

- 10 个设置项全部读写 `localStorage`
- 有「Clear cached scripts & styles」按钮 —— 注意它清的是 Service Worker 的 Cache Storage，
  **清不掉 `immutable` 的 HTTP 缓存**（资源更新靠 `npm run version:assets`）
- 有个彩蛋：连续点 Animations 5 次跳 `/settings/extra`

### 3.9 三个 "Extra Settings" 页面（需要你决定）

| 文件 | JS | 访问方式 | 情况 |
|---|---|---|---|
| `extra.html` | 277 | `/settings/extra` | 走 rewrite |
| `settings/extra.html` | 263 | 无 rewrite | 只能直接访问 `/settings/extra.html` |
| `eeeee.html` | 68 | 超长随机路径 `/za984hp9guoq2p948thqp...` | 名字和路径都像彩蛋 |

`extra.html` 与 `settings/extra.html` 标题相同、行数接近，**疑似同一功能的两个版本**。
建议确认后保留一个。

### 3.10 `bio/infoday/*` — 生物科活动（跨学科模块）

- 3 个页面，与数学 OJ 无关
- 用 `api/bio/infoday.js`，**该文件有硬编码默认口令 `bio2026`**
- 排行榜分数由客户端自报（客户端可刷）
- 如果这个活动已经办完，可以考虑整体下线（连带删除 `api/bio/`）

---

## 4. 鉴权与公开页

### 机制

`auth.js` 在页面加载时判断当前路径是否公开。不公开且未登录 → `location.href = '/index.html'`。

判断来源有两个：

1. **硬编码白名单**（`auth.js:260` 附近）：`/`、`/index.html`、`/404`、`/credits`、`/guide`、`/login`、`/os*`、`/root-login`、`/auth/*`、`/ranklist.html`、`/forgot-password.html`、`/reset-password.html`
2. **页面自带声明**（M3 新增）：
   ```html
   <meta name="requires-auth" content="false" />
   ```
   这个优先级更高，用它可以避免回来改 `auth.js`。

### 当前公开页（8 个）

`index` / `404` / `credits` / `guide` / `login` / `ranklist` / `forgot-password` / `reset-password`

### 加新的公开页

用 `npm run new:page xxx --public`，模板会自动写 meta。**不要**再去改 `auth.js` 白名单。

---

## 5. 维护指南

### 5.1 日常改动的正确流程

| 你改了什么 | 要做什么 |
|---|---|
| 页面 HTML（结构、文案） | 直接改，刷新即见（HTML 是 `no-cache`） |
| **页面的业务逻辑 JS** | 改 `assets/js/pages/<页面>.js`，**不是 HTML**（内联已抽离） |
| **页面的专属样式** | 改 `assets/css/pages/<页面>.css`，**不是 HTML**（内联已抽离） |
| `assets/js/*`、`assets/css/*`、`assets/js/pages/*`、`assets/css/pages/*` | 改完跑 `npm run version:assets`，再提交 |
| `api/*.js` | 直接改，`vercel dev` 会热重启 |
| `vercel.json` | 改完重启 `vercel dev`（rewrites 只在启动时读） |
| 新增页面 | `npm run new:page`，然后 `npm run version:assets` |

### 5.1.1 页面脚本在哪（内联已抽离）

原先 63 个页面共有 **16280 行内联 `<script>`**，这些无法被缓存。现已抽到 `assets/js/pages/`：

| 文件命名 | 来源页面 |
|---|---|
| `assets/js/pages/index.js` | `index.html` |
| `assets/js/pages/admin-users.js` | `admin/users.html` |
| `assets/js/pages/problems-id.js` | `problems/[id].html` |
| `assets/js/pages/settings-extra.js` | `settings/extra.html` |
| `assets/js/pages/os-temp.js` / `-2.js` / `-3.js` | 同一页面有多个内联块时按序编号 |

引用一律是**绝对路径** `/assets/js/pages/xxx.js`——与页面层级无关，根目录、`admin/`、`problems/` 下都一样正确，不需要 `../`，也不受 `vercel.json` rewrite 改写 URL 的影响。

**三处仍在 HTML 里内联，是故意的**：

| 内容 | 原因 |
|---|---|
| `<script>window.__BUILD_V='...'</script>` | 由 `version-assets` 注入与管理 |
| 主题防闪白脚本（含 `theme` 且 ≤30 行的片段） | 在 `<head>` 同步执行，抽成外部文件会多一次网络等待，首屏更容易闪白 |
| 小于 15 行的碎片 | 省不了多少，却多一个请求 |

**注意**：抽离后新增文件需要重新跑 `version:assets`，否则它们没带 `?v=`，改代码后浏览器不会更新。

**工具**：`node tools/extract-inline.mjs`（`--check` 只报告，`--only a.html,b.html` 指定页面，`--relative` 用相对路径）。幂等，可重复运行。

### 5.1.2 页面样式也在 assets/css/pages/

同理，原先 **9945 行内联 `<style>`（316 KB）**已抽到 `assets/css/pages/<slug>.css`：

| 文件 | 来源页面 |
|---|---|
| `assets/css/pages/user.css` | `user.html` |
| `assets/css/pages/admin-users.css` | `admin/users.html` |

- `<link>` 插在原来第一个 `<style>` 的位置（仍在 `<head>` 里），**渲染阻塞行为不变，不会 FOUC**
- CSS 占各页 HTML 体积的 57%~78%，抽离后 HTML 小了一半以上

**公共样式为什么没有合并**：实测 63 个跨页重复选择器里，只有 17 个声明完全一致，
其余各页写法不同（`.btn` 有 **9 种**、`.message` 6 种、`.admin-container` 5 种）。
强行合并会改变 20 个页面的按钮外观，收益却只有 1~2 KB，因此只做每页抽离。
要评估公共合并，先跑 `node tools/analyze-css-dup.mjs` 看冲突面。

**工具**：`node tools/extract-css.mjs`（`--check` / `--only` / `--min-lines`）。幂等。

### 5.2 加一个 API

1. 在 `api/` 下新建文件，导出 `default wrapHandler(async (req, res) => {...})`
   （`wrapHandler` 来自 `lib/errors.js`，负责兜底异常 + 自动补 `code`/`requestId`）
2. 用 `sendError(req, res, 'BAD_REQUEST', '缺少参数')` 主动返回错误
3. 前端用 `API.get('/api/xxx')` 调用

### 5.3 改共享脚本（影响全站）

`assets/js/` 下任何一个文件都影响 63 个页面。改之前：

- 先确认这个文件被多少页面引用（`grep` 一下）
- 改完必须 `npm run version:assets`
- `sidebar.js` / `topbar.js` / `auth.js` 是全站骨架，改动要在多个页面回归

### 5.4 缓存与版本号

| 资源 | 生产缓存策略 | 更新方式 |
|---|---|---|
| `/assets/js/*.js`、`*.css` | `immutable` 一年 | 必须换 `?v=` |
| `*.html` | `no-cache` | 部署即生效 |
| 图片/字体 | `immutable` 一年 | 换文件名或加 `?v=` |

**为什么必须换版本号**：`immutable` 意味着浏览器一年内不再请求。文件名不变 → 用户永远拿旧 JS。
`npm run version:assets` 会重算内容指纹并更新 63 个 HTML 里的 `?v=`。

**注意**：`settings` 里的 Clear Cache 按钮清不掉这个（它只清 Service Worker 的 Cache Storage）。

### 5.5 本地开发

```powershell
vercel dev        # 3000 端口，行为最接近线上
```

已知差异：`vercel dev` **不应用** `vercel.json` 的 headers 规则，所以本地所有资源都是
`max-age=0, must-revalidate`。这不是 bug，也不影响线上。

如果你也想在本地验证缓存行为，用 `npm run serve`（读 `vercel.json` 发正确的头）。

### 5.6 调试接口错误

线上出问题时，让用户访问：

```
https://<站点>/?apiDebug=1
```

之后所有接口失败都会弹出详情面板，包含 **错误码 / 说明 / HTTP 状态 / 接口路径 / 请求ID / 真实错误**，
点「复制详情」就能贴给你。

默认行为（不开 debug）：5xx 弹红色 toast（可点开详情），4xx 只写 console——避免打扰学生。

### 5.7 页面被莫名重定向到首页？

八成是鉴权拦截。检查：

1. 是否已登录（`localStorage.auth_token`）
2. 如果是公开页，是否写了 `<meta name="requires-auth" content="false">`
3. 或者路径是否在 `auth.js` 的白名单里

### 5.8 新页面 404？

`vercel.json` 最后一条是 `/(.*) → /404.html`。手工加路由必须插在它**之前**。
用 `npm run new:page` 会自动处理。

---

## 6. 已知陷阱清单

| # | 陷阱 | 后果 | 对策 |
|---|---|---|---|
| 1 | 忘跑 `version:assets` | 线上新页面 + 旧 JS，可能白屏 | 改 assets 后必须跑；`npm run check:versions` 可校验 |
| 2 | 新页面没加 rewrite | 永远 404 | 用脚手架，或插在 404 兜底之前 |
| 3 | 新公开页没声明 meta | 被踢回首页 | 用 `--public` |
| 4 | `charts.html` 的 `escapeHtml` 漏转义引号 | 属性上下文 XSS | 迁移时统一用 `DSHUI.esc` |
| 5 | `api/bio/infoday.js` 的 `bio2026` 默认口令 | 环境变量没配就成万能口令 | 部署前确认 `BIO_INFODAY_ADMIN_PASSWORD` 已配，或该模块已下线 |
| 6 | `vercel dev` 不发缓存头 | 以为线上没缓存 | 已实测线上是 `immutable`，属正常 |
| 7 | 三份 `parseReply` / `cleanStatementForAI` | 修一处漏两处 | 改 AI 评分链路时三处都要看 |
| 8 | `assets/js/pageload.js` 曾是纯注释文件 | 52 个页面白加载 | 已删除（提交 446e317） |
| 9 | 内联脚本里的主题设置 | 删了会闪白 | 主题初始化那两行**必须保留**在 head |
| 10 | `admin.html` 的 `script/xxx.js` 数组 | 是清理功能的**文件路径数据**，不是页面引用 | 批量替换时不要动它 |

---

## 7. 迁移路线（M4）

### 已经完成（M1–M3）

- **M1**：共享脚本从 CDN 收回 `assets/js/`，消除 4 套副本
- **M2**：后端统一错误格式 + 前端 `core/`（`ui` / `net` / `api` / `page`）
- **M3**：页面模板 + `new:page` 脚手架 + 侧栏数据驱动

### 下一步分层（1、2 层已执行）

| 层 | 内容 | 状态 |
|---|---|---|
| **第 1 层 a** | 33 个页面的 `escapeHtml`/`esc` → `DSHUI.esc`（调用点不动，顺带修掉 16 页漏转义引号） | ✅ 已完成 `4ee84e8` |
| **第 1 层 b** | 44 处 `alert()` → `DSHUI.toast()`（按关键字自动分 err/ok；2 处跳转前的保留） | ✅ 已完成 `d6d10c2` |
| **第 1 层 c** | `fmtTime` 等日期函数统一 | ⏭ 跳过：各页用途不同（时钟/日期/相对时间/字节/时长/分数），不是重复实现，强行统一只会增加参数 |
| **第 1 层 d** | 22 处裸 `fetch` → `API` | ⏭ 建议跳过：一半是外部 URL（GitHub API、CDN 预热、资源文件、FILEMAP），本就不该走内部封装；其余已手动带好 auth header 且各有错误处理，改造风险大于收益 |
| **第 2 层** | 错误提示统一 | ✅ 由 1b 覆盖；5xx 详情面板由 `core/net.js` 全局兜底，页面内无需逐个改 |
| 第 3 层（后续） | HTML 骨架对齐 `_template/page.html` | 收益低（无构建，30 行骨架注定写 63 遍），暂不做 |
| 不建议 | 引入构建工具、SSR、重写业务逻辑 | — |

#### 第 1 层迁移的实现方式

统一用 `tools/migrate-escape.mjs` / `tools/migrate-alert.mjs`，原则是**改定义、不改调用**：

- 转义：只替换函数体，全站 200+ 处 `escapeHtml(...)` 调用点一行没动
- 提示：替换为 `(window.DSHUI ? DSHUI.toast(msg, type) : alert(msg))`，DSHUI 未加载时回退 alert，不会静默丢失

两个工具都幂等，可重复运行。踩过的坑记在提交信息里（词法分析被正则字面量干扰、单行版本二次迁移会吞代码等）。

### 按批次的顺序建议

| 批次 | 页面 | 理由 |
|---|---|---|
| 1 | `credits` `guide` `404` `forgot-password` `reset-password` `setup` | A 档，公开页，风险最低，先立样板 |
| 2 | `resources` `index` `login` `ranklist` `problems/bookmark` | B 档，用户高频 |
| 3 | `problems` `submissions` `user` `submissions/detail` | 核心业务，必须仔细回归 |
| 4 | `admin/*` 的 B 档（13 个） | 机械性，按同一样板批量 |
| 5 | C 档（20 个） | 逐个评估 |
| 6 | D 档（7 个）+ X 档（3 个） | 单独讨论，X 档先决定去留 |

### 每批的验收标准

1. 页面能正常加载，零 JS 错误
2. 原有交互行为不变（点击、提交、翻页、筛选）
3. 内联 JS 行数下降，且下降的是"重复实现"而不是业务逻辑
4. 单独提交，可 `git revert` 回滚

---

## 8. 附：数据采集方式

本文所有数字来自：

```powershell
node tools/audit-pages.mjs --json > .backup/pages-audit.json
```

它扫描每个 HTML，统计内联 JS/CSS 行数、引用的 API、共享脚本、重复实现、公共页状态、路由映射。
代码变化后重新跑一次即可刷新本文的数据部分。
