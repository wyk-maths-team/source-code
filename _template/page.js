// assets/js/pages/{{PAGE_ID}}.js
//
// {{TITLE}}
//
// 约定：
//   - 用 Page.boot() 声明页面元信息，用 Page.ready() 跑业务逻辑
//   - 用 API.get/post 发请求（失败会自动提示，并抛 ApiError）
//   - 只操作 #mainContent，不要碰 topbar / sidebar
//   - 所有往 DOM 里插的用户数据都要用 DSHUI.esc() 转义

Page.boot({
  title: '{{TITLE}}',
  requireAuth: true,   // 改成 false 可让未登录也能看
  skeleton: true,      // false 则关闭骨架屏
});

Page.ready(async (user) => {
  const main = document.getElementById('mainContent');
  if (!main) return;

  try {
    // ── 1. 取数据 ──
    // const data = await API.get('/api/{{PAGE_ID}}');

    // ── 2. 渲染 ──
    main.innerHTML = `
      <div class="page-wrap" style="padding:24px">
        <h1 style="margin-bottom:8px">{{TITLE}}</h1>
        <p style="opacity:.7">Hello ${DSHUI.esc(user && user.displayName || user && user.username || 'there')}，这里是 {{TITLE}} 页面。</p>
      </div>
    `;
  } catch (err) {
    // 5xx 已由 core/net.js 自动弹出详情，这里只做页面内的兜底展示
    main.innerHTML = `
      <div class="page-wrap" style="padding:24px">
        <h1>{{TITLE}}</h1>
        <p style="color:#d93025">加载失败：${DSHUI.esc(err.message || err)}</p>
        <p style="opacity:.7;font-size:13px">错误码 ${DSHUI.esc(err.code || '-')}，请求 ID ${DSHUI.esc(err.requestId || '-')}</p>
      </div>
    `;
  } finally {
    Page.hideSkeleton();
  }
});
