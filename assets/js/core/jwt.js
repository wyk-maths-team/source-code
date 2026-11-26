// assets/js/core/jwt.js
//
// JWT 的读取与解码，给「还没有 bundle、也不需要登录态」的页面用。
//
// 为什么单独抽出来：setup.html 与 reset-password.html 从来没有引入过
// assets/js/auth.js（它们不需要登录态），却都要调 window.decodeJwtPayload
// 来显示账号名 —— 于是那个函数在页面上根本不存在，一调就抛 TypeError，
// 被 catch 成 alert('Invalid token')，用户从 Microsoft 回来只看到「token 无效」。
//
// 这个文件只做三件纯函数的事，没有任何副作用：
//   b64urlToJson(part)       → base64url 段 → 对象
//   decodeJwtPayload(token)  → 取第二段解出来（不验签，仅展示用）
//   readUrlToken()           → 从地址栏安全地取 token

(function () {
  'use strict';

  /**
   * JWT 的 payload 段是 base64url（RFC 4648 §5）：'+' 写成 '-'，'/' 写成 '_'，
   * 并省略末尾的 '='。裸 atob() 只认标准 base64，遇到 '-' 或 '_' 直接抛
   * InvalidCharacterError —— 症状就是「明明登录成功，却被当成未登录」。
   */
  function b64urlToJson(part) {
    if (!part) throw new Error('empty jwt segment');
    var s = String(part).replace(/-/g, '+').replace(/_/g, '/');
    var pad = s.length % 4;
    if (pad === 1) throw new Error('bad jwt segment length');
    if (pad) s += new Array(5 - pad).join('=');
    var bin = atob(s);
    // JWT 规定 UTF-8：先取字节再按 UTF-8 解码，避免中文 displayName 变乱码
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var json;
    try {
      json = new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      json = bin;
    }
    return JSON.parse(json);
  }

  function decodeJwtPayload(token) {
    return b64urlToJson(String(token || '').split('.')[1]);
  }

  /**
   * 从地址栏读 token。
   *
   * 不用 URLSearchParams.get()：它把未编码的 '+' 解码成空格。JWT 本身是
   * base64url（不含 '+'），但复制粘贴、某些客户端重写 URL 时会把 '-' '_'
   * 换回 '+' '/'，那之后 token 就被拆成「含空格的一串」，存进 localStorage
   * 后每个请求都带着坏 token，服务端只会回 "invalid token"。
   * 这里把空格换回 '+'，至少让这一路还能救回来。
   */
  function readUrlToken() {
    var m = /[?&]token=([^&]*)/.exec(window.location.search);
    if (!m) return null;
    var raw = m[1];
    try { raw = decodeURIComponent(raw); } catch (e) { /* 编码本身就是坏的，按原样用 */ }
    if (raw.indexOf(' ') >= 0) raw = raw.replace(/ /g, '+');
    return raw || null;
  }

  window.b64urlToJson = b64urlToJson;
  window.decodeJwtPayload = window.decodeJwtPayload || decodeJwtPayload;
  window.readUrlToken = window.readUrlToken || readUrlToken;
})();
