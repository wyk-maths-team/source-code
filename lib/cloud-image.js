// lib/cloud-image.js
//
// Cloudinary 图片的服务端变换。
//
// 前端那套在 assets/js/core/img.js，用的是 window.imgUrl；这里给服务端用，
// 逻辑一样但独立实现 —— api/ 下的文件是 Node 环境，不能依赖浏览器全局。
//
// 为什么服务端也要变换：AI 批改吃的是图片字节。原图动辄 200 KB，
// 而模型只需要看清笔迹，w_1200 就够。压小之后上传给模型的 payload 小一半，
// 响应也快一些。
//
// 用 f_auto 而不是 f_webp：模型 API 对 WebP 的支持不如浏览器确定，
// 这里求稳，多花一次 transformation 换「一定能读」。

const MARKER = '/image/upload/';

/** 已经是变换过的 URL 就先把旧的变换段剥掉，避免叠成两层 */
function stripTransform(rest) {
  if (/^v\d+\//.test(rest)) return rest;
  const slash = rest.indexOf('/');
  if (slash > 0 && rest.slice(0, slash).indexOf('_') >= 0) return rest.slice(slash + 1);
  return rest;
}

/**
 * @param {string} url       原始图片地址
 * @param {string} transform 如 'f_auto,q_70,w_1200'
 */
export function cloudTier(url, transform) {
  const src = String(url == null ? '' : url).trim();
  if (!src || !transform) return src;
  if (src.indexOf('res.cloudinary.com') < 0) return src;
  const i = src.indexOf(MARKER);
  if (i < 0) return src;
  const head = src.slice(0, i + MARKER.length);
  const rest = stripTransform(src.slice(i + MARKER.length));
  return head + transform + '/' + rest;
}

export const TIERS = {
  grade: 'f_auto,q_70,w_1200',
  view: 'f_webp,q_70,w_800',
  avatar: 'f_webp,q_90,w_400',
  thumb: 'f_webp,q_50,w_64',
};
