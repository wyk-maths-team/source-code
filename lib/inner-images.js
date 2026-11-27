// lib/inner-images.js
//
// 「小群体」专用：题面里某些 <img> 只给圈内人看。
//
// 动机是实际存在的风险 —— 站里有些题带同人图（比如 WG003 的 Yuri 插画），
// 一旦有人恶意举报「网站含低俗内容」，整站要跟着挨刀。所以这些图打上
// data-inner 标记，服务端在返回题面时就把它们摘掉：不在圈内的人拿到的
// HTML 里连图片 URL 都没有，不是靠前端隐藏。
//
// 标记写法：<img src="..." data-inner>  或  <img src="..." data-inner="1">
// 管理员在小群体外也一样会被过滤 —— 编辑页读原文时不过这道闸（见 api/problem.js）。

const INNER_IMG_RE = /<img\b[^>]*\bdata-inner\b[^>]*>/gi;

/** 这个人能不能看圈内图 */
export async function isSmallGroup(db, username) {
  if (!username) return false;
  try {
    const u = await db.collection('users').findOne(
      { username: String(username) },
      { projection: { smallGroup: 1, role: 1, _id: 0 } }
    );
    return !!(u && u.smallGroup === true);
  } catch (e) {
    // 查不到就按圈外处理：宁可少显示，也不能漏
    return false;
  }
}

/**
 * 把圈内图整段摘掉，URL 一并丢掉。
 *
 * 早期版本会留一句 [image restricted] 当占位，但那个占位本身就是个信号：
 * 圈外人看到「这里被遮住了」反而会去猜内容、去问、去举报。现在直接消失，
 * 题面看起来就是一道没有配图的题 —— 绝大多数题的图只是示意图，文字已经说全。
 */
export function redactInnerImages(html) {
  const src = String(html || '');
  if (src.indexOf('data-inner') < 0) return src;
  // 整段摘掉，不留占位：占位符本身会提示「这里藏了东西」，反而招来追问和举报。
  // 摘掉后题面就是一道没有配图的题 —— 这些题的图都是示意图，文字已经说全。
  return src.replace(INNER_IMG_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 圈内人原样返回 */
export function filterInnerImages(html, canSee) {
  return canSee ? String(html || '') : redactInnerImages(html);
}
