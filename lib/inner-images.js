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

/** 把圈内图换成一句占位，URL 一并丢掉 */
export function redactInnerImages(html) {
  const src = String(html || '');
  if (src.indexOf('data-inner') < 0) return src;
  return src.replace(INNER_IMG_RE, '<span class="inner-img-locked" title="Restricted">[image restricted]</span>');
}

/** 圈内人原样返回 */
export function filterInnerImages(html, canSee) {
  return canSee ? String(html || '') : redactInnerImages(html);
}
