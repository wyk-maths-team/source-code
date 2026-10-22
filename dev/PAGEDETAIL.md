# 页面技术档案 · 开发者版

> 面向接手维护的人。这里讲实现细节、数据流、以及踩过的地方。
>
> 只覆盖**非管理员页面**。`admin.html` 与 `admin/` 下的 25 个页面另有维护说明，不在本文范围。
>
> 数字取自 `node tools/audit-pages.mjs --json`（2026-10，M1–M3 重构后）。

---

## 0. 快速定位

| 页面 | 源文件 | 主脚本 | 关键依赖 | 主要陷阱 |
|---|---|---|---|---|
| 题目详情 | `problems/[id].html` | `pd-script.js` / `pd-extras.js` / `pd-mcq.js` | 三个脚本**运行时动态加载** | JS 不在 HTML 里，改 HTML 无效 |
| 提交列表 | `submissions.html` | `pages/submissions.js` | `api/submissions.js` | 一个文件服务 3 条路由 |
| 用户主页 | `user.html` | `pages/user.js` | `api/users.js` | 4 个独立数据源并发 |
| 排行榜 | `ranklist.html` | `pages/ranklist.js` | `api/charts.js` | 前端的聚合口径与后端不同 |
| 评测状态 | `status.html` | `pages/status.js` | `api/status.js` | 依赖轮询，非实时推送 |
| 首页 | `index.html` | `pages/index.js` | `api/updates.js` | 公告内容硬编码 |
| 设置 | `settings.html` | `pages/settings.js` | 纯 `localStorage` | 清缓存按钮清不掉 HTTP 缓存 |
| 题库列表 | `problems.html` | `pages/problems.js` | `api/problem.js` | 列表逻辑在 `pd-script.js` 里 |
| PK 房间 | `pk-room.html` | `pages/pk-room.js` | `api/pk.js` | 三态角色机 + 轮询 |
| 训练系统 | `tr-system.html` | `pages/tr-system.js` | `api/tr-problems.js` | 题图走外部 CDN |

---

## 1. 基础层

### 1.1 一次页面加载发生了什么

```
1. HTML 到达（no-cache，每次协商）
2. <head> 内联：主题初始化脚本（同步，防闪白）
3. <head> 内联：window.__BUILD_V（构建版本号）
4. arch-render.js（同步）—— 成就通知容器注入
5. <body> 底部：
   a. core/ui.js       → window.DSHUI（toast / esc / 错误面板）
   b. core/net.js      → 劫持 window.fetch，统一错误处理
   c. core/api.js      → window.API（带 token 的请求封装）
   d. core/page.js     → window.Page（生命周期 + 全局用户对象）
   e. auth.js          → 鉴权拦截（不通过则跳转）
   f. sidebar.js       → 渲染侧栏导航
   g. topbar.js        → 渲染顶栏
   h. heartbeat.js     → 在线状态上报
   i. pages/<page>.js  → 本页业务逻辑
6. Page.ready(...) 里的回调开始执行
```

**顺序有依赖**：`ui` → `net` → `api` → `page` 必须按此序加载。`net` 劫持的 `fetch` 依赖 `ui` 的错误面板；`api` 依赖 `net`；`page` 依赖前三者。

### 1.2 `core/` 四件套

| 文件 | 暴露 | 职责 | 边界 |
|---|---|---|---|
| `ui.js` | `DSHUI` | `esc()` 转义、`toast()` 提示、`showError()` 错误面板 | 不碰网络 |
| `net.js` | — | 劫持 `window.fetch`；5xx 弹可点开的详情面板，4xx 只写 console | 不改请求内容，只观察 |
| `api.js` | `API` | `get/post/put/del`，自动附 `Authorization`；抛结构化 `ApiError` | 不含业务判断 |
| `page.js` | `Page` | 启动顺序、`user` 对象、骨架屏、错误边界 | 不做鉴权（那是 `auth.js`） |

**`net.js` 的行为开关**：URL 加 `?apiDebug=1` 会让所有失败（含 4xx）弹出完整详情，包含错误码 / requestId / 真实异常。这是线上排障的主要手段。

### 1.3 鉴权

判据有两个来源，后者优先：

1. **硬编码白名单**（`auth.js` 内，约 260 行）：`/`、`/index.html`、`/404`、`/credits`、`/guide`、`/login`、`/os*`、`/root-login`、`/auth/*`、`/ranklist.html`、`/forgot-password.html`、`/reset-password.html`
2. **页面自声明**：`<meta name="requires-auth" content="false" />`

不通过 → `location.href = '/index.html'`。

**新公开页用第 2 种**，不要改白名单。改白名单意味着以后每加一个公开页都要回来动 `auth.js`，而 `auth.js` 被 63 个页面引用。

服务端另有一套独立校验（`lib/` 里的 JWT 验证），前端拦截只是体验优化，**不能当安全边界**。

### 1.4 缓存与版本化

| 资源 | 响应头 | 更新机制 |
|---|---|---|
| `/assets/js/**`、`/assets/css/**` | `immutable, max-age=31536000` | 必须改 `?v=<内容指纹>` |
| `*.html` | `no-cache, must-revalidate` | 部署即生效 |
| 图片 / 字体 | `immutable` | 换文件名 |

`npm run version:assets` 重算内容 SHA、更新全部 HTML 里的 `?v=`、注入 `window.__BUILD_V`。
`npm run check:versions` 校验一致性——**忘了跑这个工具是本项目最常见的线上事故来源**。

`settings.html` 里的 "Clear cached scripts & styles" 只清 Service Worker 的 Cache Storage，**清不掉 `immutable` 的 HTTP 磁盘缓存**。

---

## 2. 核心页面

### 2.1 `problems/[id].html` — 题目详情

**这是全站最复杂的页面，且 HTML 里几乎没有 JS。**

内联只有 1 行。真正的逻辑分三块，全部**运行时按需加载**：

| 脚本 | 行数 | 何时加载 |
|---|---|---|
| `assets/js/pd-script.js` | ~900 | 恒加载 |
| `assets/js/pd-extras.js` | ~1300 | 由 `pd-script.js` 通过 `EXTRAS_JS_URL` 动态插入 |
| `assets/js/pd-mcq.js` | ~356 | 由 `MCQ_JS_URL` 动态插入（仅选择题） |

动态插入时带版本号，所以 `version:assets` 必须能识别这三个文件——它们在 `assets/js/` 根下，不在 `pages/` 里。

**数据流**：

```
URL /problems/HA0001
  ↓ rewrite: /problems/:id → /problems/[id].html
  ↓ 客户端从 pathname 解析 id
  ↓ GET /api/problem?action=detail&id=HA0001
  ↓ 返回 { problem, submission, ... }
  ↓ 渲染 statement（KaTeX 处理数学公式）
  ↓ 按 problem.FS 分支出题界面
```

**两个必须知道的字段**：

- `problem.FS === true` → 禁用文字提交，只允许 AI 分步批改或图片上传。这是「答案不能用一个数表达」的题。
- `problem.mcq` → 走选择题流程，加载 `pd-mcq.js`。

**提交链路**（三种答题方式各不同）：

| 方式 | 接口 | 备注 |
|---|---|---|
| 文字/数值 | `POST /api/submit` | 服务端比对，可能调 `logic-runner.js` 跑沙箱 |
| 图片 | `POST /api/submit`（含 base64） | 上传 Cloudinary，再交给判题 |
| AI 分步 | `POST /api/steps-grade` | 逐步骤评分，可人工复核 |

**改这里的逻辑 = 改 JS 文件**。改 HTML 不会有任何效果，因为逻辑不在 HTML 里。

### 2.2 `submissions.html` — 提交列表

**一个文件服务三条路由**：

```
/submissions                     → 全部提交
/submissions/user/:username     → 某用户的提交
/submissions/problem/:id        → 某题的提交
```

靠 `location.pathname` 正则分支决定查询条件，页脚文案也随之变化。

**分页是这里最脆弱的部分**：

- `fetchPage(page)` 拉取指定页
- `prefetchNearby()` 预取相邻页，配合滚动
- 分页状态存在闭包里，**不要在外部直接改页码变量**，要调 `goto(page)`

改这块时，务必手工验证：首屏 → 下一页 → 上一页 → 跳到末页 → 筛选后分页重置。

**筛选器**（状态/语言/题目）会重置到第 1 页并重新查询。筛选条件同时写进 URL query，所以刷新能保持。

### 2.3 `user.html` — 用户主页

路由 `/users/:username`。

**四个数据源并发请求**，任一失败不应阻塞其余：

```
GET /api/users?action=profile&username=X      → 基本信息、头衔
GET /api/users?action=stats&username=X        → 解题统计、难度分布
GET /api/submissions?action=recent&user=X     → 最近提交
GET /api/charts?action=user&username=X        → 图表数据
```

页面用 `Promise.allSettled` 语义处理——某个卡片没数据时显示占位而不是整页错误。

**自己看自己的主页时**，会额外出现「编辑资料」入口；看别人的不显示。这个分支靠 `window.Page.user.username === targetUsername` 判断。

### 2.4 `ranklist.html` — 排行榜

**公开页**（未登录可见）。

**注意口径**：前端展示的排序规则与后端 `api/charts.js` 的聚合不同——前端拿的是已排序的结果，但「解题数」和「难度分」是两套口径，切换 tab 时请求的参数不同。

分页 + 搜索用户名。搜索是**前端过滤已加载页**，不是全库搜索——数据量大时会有「搜不到」的错觉。

### 2.5 `status.html` — 评测状态

显示最近的提交记录及判题状态。

**关键：这是轮询，不是推送**。页面开着时每 N 秒拉一次，关闭即停。没有 WebSocket。

所以「提交后跳到 status 页看结果」的体验依赖轮询间隔——间隔太短会给数据库造成压力，太长显得迟钝。当前间隔是权衡后的值。

`api/status.js` 的 `system` / `vercel` 两个 action **仅管理员可用**（返回 403），普通用户只能查自己的提交。

### 2.6 `index.html` — 首页

三个要素：

1. **公告**（`api/updates.js`）—— 内容由管理员在后台发布
2. **个人概览**（已登录时）—— 解题数、最近活动
3. **入口卡片**

**PWA 强制跳转**：`app.js` 里有 `forcePWAHome` 逻辑，特定条件下会把移动端用户导向 `/os`。改首页布局时注意别破坏这个判断。

首页 CSS 占 362 行，是全站最多的几个之一，因为承载了落地页的视觉。

### 2.7 `settings.html` — 设置

**10 个设置项全部读写 `localStorage`**，不经过服务端（除改密码外）。

值得注意的几项：

| 设置 | 存储键 | 说明 |
|---|---|---|
| 主题 | `theme` | `light` / `dark`，同时被 `<head>` 内联脚本读取 |
| 动画 | `no-animations` | 给 `body` 加 class |
| 侧栏状态 | `sidebarOpen` / `sidebarHiddenDesktop` | 移动端抽屉与桌面端折叠用**两个不同的键** |
| 代码字号 | 若干 | 影响题面区域 |

**彩蛋**：连续点击 Animations 开关 5 次跳转 `/settings/extra`。

**Clear Cache 按钮的实际作用**：`caches.keys()` → 删除 Cache Storage → 注销 Service Worker。它**不影响** HTTP 缓存，所以「改了 JS 但页面没变」时按它是没用的，要跑 `version:assets`。

### 2.8 `problems.html` — 题库列表

内联 JS 只有 23 行。**列表渲染、筛选、虚拟滚动都在 `pd-script.js` 里**，和题目详情共用同一个文件。

所以改题库列表的行为，要去 `assets/js/pd-script.js`，不要在 HTML 里找。

数据：`GET /api/problem?action=list`，返回题目元数据（不含正文）。

### 2.9 `resources.html` — 笔记与资源

静态资源导航页，内容大部分硬编码。

数据源：`GET /api/problem?action=resources`（或直接读静态清单）。
有个 `fetch` 是用来探测资源可用性的，失败时降级为静态列表。

### 2.10 登录与密码流程

四条独立路径，都**不需要登录**：

| 页面 | 路由 | 流程 |
|---|---|---|
| 登录 | `/login` | 用户名+密码 → JWT 存 `localStorage.auth_token` |
| 忘记密码 | `/auth/forgot-password` | 提交邮箱/用户名 → 发重置链接 |
| 重置密码 | `/auth/reset-password` | 带 token 的链接 → 设新密码 |
| 首次设密 | `/auth/setup` | 新用户首次登录后强制设置 |

**token 的存储与使用**：`localStorage.auth_token`，格式 `header.payload.signature`。所有请求由 `core/api.js` 自动附加 `Authorization: Bearer <token>`。

**登出**：清除 token + `localStorage.removeItem('sidebarOpen')` + 跳首页。`api/heartbeat?action=offline` 会标记离线（`auth.js` 里有调用）。

`login.html` 的鉴权标记是 `auth`（需登录）——听起来矛盾，但它的意思其实是「这个页面会被鉴权系统处理」，登录页本身在白名单里放行。

---

## 3. PK 子系统

三个页面构成一条完整链路：

```
pk-invite.html   邀请/接受邀请 → 创建或加入房间
pk-waiting.html  等待对手就绪 → 轮询房间状态
pk-room.html     对战主体：出题、抢答、判定、结算
```

### 状态机

后端 `api/pk.js` 维护房间状态。前端三态角色：

- `isHost` — 发起方
- `isGuest` — 接受方
- `isSpectator` — 旁观者（**故意允许任何人观看**，这是产品决策，不是漏洞）

三种角色看到的界面不同：只有 host/guest 有作答区，spectator 看实时进度。

### 轮询

没有 WebSocket。`pk-waiting` 和 `pk-room` 都靠定时轮询 `/api/pk?action=state`。

- 等待页间隔更短（要感知对手加入）
- 房间页间隔稍长（但需覆盖抢答的实时性）

**已知问题**：`api/pk.js` 里有一处鉴权判断被注释掉了。这是刻意的（允许旁观），但如果将来要限制，需要在这里恢复。

### 题图

PK 题目和普通题目共用题库，但选题逻辑独立（`admin/pkproblems` 维护 PK 专用题池）。

---

## 4. 训练与其他模块

### 4.1 `tr-system.html` — TR 训练系统

**976 行内联，全站第三大**。

特点：

- 题图**走外部 CDN**：`https://cdn.jsdelivr.net/gh/wyk-math-team/resources@main/script/tr-images/`
  这是刻意的——540 张题图不适合进 git。
- 独立 API `api/tr-problems.js`，权限白名单在环境变量 `TR_ALLOWED_USERS` 里
- 内联 CSS 815 行，是全站第二多

**状态**：这个模块已停止维护（tr-system 荒废）。改它之前先确认是否还该保留。

### 4.2 `port.html` — 作品集

2 行内联 JS。路由是超长随机路径 `/port/<长串>`。

内容由 `api/port/*` 提供（独立的 port 子系统），与主站数据隔离。

### 4.3 `mobile/index.html` — 移动版入口

2 行 JS，路由 `/os`。

主要作用是被 `forcePWAHome` 重定向过来，作为移动端的着陆页。

### 4.4 `contest` 系列（用得少，简略）

- `contest.html` — 竞赛列表
- `contest/[id].html` — 竞赛详情与题目列表
- `contestresults.html` — 赛后成绩单

三条共用一个 `api/contests.js`，靠 `action` 参数区分。竞赛数据与普通题库共用 MongoDB 但不同 collection。

---

## 5. 辅助页面

| 页面 | 内联 JS | 说明 |
|---|---|---|
| `credits.html` | 19 | 致谢页，几乎纯静态 |
| `guide.html` | 5 | 用户指南，272 行 CSS，内容硬编码 |
| `404.html` | 23 | 兜底页。`vercel.json` 最后一条 rewrite 指向它 |
| `calendar.html` | 487 | 学习日历，依赖 `api/calendar.js` |
| `charts.html` | 435 | 解题进度图表，Chart.js |
| `editpassword.html` | 85 | 改密码，走 `/users/edit` |
| `forgot-password.html` | 24 | 见 2.10 |
| `reset-password.html` | 81 | 见 2.10 |
| `setup.html` | 47 | 见 2.10 |

**`charts.html` 的历史遗留**：它自带的 `escapeHtml` 只转义 `& < >`，**漏了引号**，在属性上下文有 XSS 风险。迁移到 `DSHUI.esc` 时已修，但如果有新代码复制了旧版本要留意。

**三个 `extra` 页面**：

| 文件 | 访问 | 状态 |
|---|---|---|
| `extra.html` | `/settings/extra` | 有 rewrite |
| `settings/extra.html` | 无短路径，只能访问 `.html` | 内容与上者高度重复 |
| `eeeee.html` | 超长随机路径 | 彩蛋性质 |

`extra.html` 与 `settings/extra.html` 标题相同、行数接近，**疑为同一功能的两个版本**。确认后可删一个。

`os-temp.html` 与 `template.html` 同属待定：前者是临时页，后者是早期模板（已被 `_template/` 取代）。

---

## 6. 约束与陷阱

| # | 约束 | 后果 |
|---|---|---|
| 1 | 改 `assets/` 必须跑 `version:assets` | 线上新 HTML + 旧 JS，可能白屏 |
| 2 | 新路由必须插在 404 兜底**之前** | 否则永远 404 |
| 3 | 新公开页必须声明 meta | 被踢回首页 |
| 4 | 主题初始化脚本必须留在 `<head>` 内联 | 删了会闪白 |
| 5 | `#mainContent` 的 id 被 `pd-script.js` 依赖 | 改名会破坏题目页渲染 |
| 6 | 内联脚本抽离后，改 HTML 无效 | 逻辑在 `assets/js/pages/` |
| 7 | `window.__BUILD_V` 由工具注入 | 手改会被覆盖 |
| 8 | AI 评分链路有三份 `parseReply` | 修一处漏两处 |

---

## 7. 调试

### 看接口真实错误

```
https://<站点>/?apiDebug=1
```

之后所有失败（含 4xx）都会弹完整详情：错误码 / HTTP 状态 / 接口路径 / requestId / 真实异常。可一键复制。

默认：5xx 弹 toast，4xx 只进 console——避免打扰学生。

### 本地缓存行为

`vercel dev` **不应用** `vercel.json` 的 headers，本地所有资源都是 `must-revalidate`。
想验证真实缓存行为，用 `npm run serve`（读 `vercel.json` 发正确响应头）。

### 页面被莫名重定向

1. 检查 `localStorage.auth_token` 是否存在
2. 若是公开页，检查 `<meta name="requires-auth">`
3. 或路径是否在 `auth.js` 白名单

### 数据一致性

`npm run check:versions` 校验 HTML 里的 `?v=` 与 assets 实际内容是否匹配。
`npm run audit:pages` 重新导出页面清单（本文的数据来源）。
