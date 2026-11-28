// assets/js/core/img.js
//
// 图片 URL 的尺寸/质量变换。
//
// cdn.jsdelivr.net 的图原样返回 —— 那是仓库里的静态素材（题目配图、hint 图），
// 体积本来就不大，而且 jsDelivr 不接受变换参数。
//
// res.cloudinary.com 的图按用途插参数。同一张原图生成不同的派生资源，
// 不额外占存储；首次请求时算一次 transformation，之后全部走 CDN 缓存。
//
// 用 f_webp 而不是 f_auto：f_auto 会为 WebP 和 JPEG 各生成一份，
// transformation 计数翻倍。2024 年后主流浏览器都支持 WebP。

(function () {
  'use strict';

  var MARKER = '/image/upload/';

  // 三档 + 提交图两档
  var TIERS = {
    thumb: 'f_webp,q_50,w_64',       // 排行榜一行一个，实际显示 32–48px
    hover: 'f_webp,q_75,w_200',      // 悬停预览
    avatar: 'f_webp,q_90,w_400',     // 个人页
    grade: 'f_auto,q_70,w_1200',     // AI 批改看，保留 f_auto 求稳
    view: 'f_webp,q_70,w_800'        // 学生看提交图
  };

  /**
   * @param {string} url  原始图片地址
   * @param {string} tier thumb | hover | avatar | grade | view
   * @returns {string}
   */
  function imgUrl(url, tier) {
    var src = String(url == null ? '' : url).trim();
    if (!src) return src;

    var transform = TIERS[tier];
    if (!transform) return src;

    // 只处理 Cloudinary 的原始地址；其他 CDN 原样返回
    if (src.indexOf('res.cloudinary.com') < 0) return src;
    var i = src.indexOf(MARKER);
    if (i < 0) return src;

    var head = src.slice(0, i + MARKER.length);
    var rest = src.slice(i + MARKER.length);

    // 已经带变换段的（形如 f_xxx,q_xx,w_xxx/v123/...），把变换段剥掉重新套
    if (!/^v\d+\//.test(rest)) {
      var slash = rest.indexOf('/');
      if (slash > 0 && rest.slice(0, slash).indexOf('_') >= 0) {
        rest = rest.slice(slash + 1);
      }
    }

    return head + transform + '/' + rest;
  }

  window.imgUrl = imgUrl;
  window.IMG_TIERS = TIERS;
})();
