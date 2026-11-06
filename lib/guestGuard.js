// lib/guestGuard.js —— 访客（G001 这类）的访问限制
//
// 访客账号就是用户名形如 G + 三位数字的普通账号。它们共享给校外参观者，
// 所以不能看到华夏杯（HX 前缀）的题目 —— 那些是给本校学生练的。
//
// 这里集中放判定逻辑，各处入口统一调用，避免只挡了一个地方。

const GUEST_RE = /^G\d{3}$/;
const HUAXIA_RE = /^HX/i;

/** 是否访客账号 */
export function isGuest(username) {
  return GUEST_RE.test(String(username || ''));
}

/** 是否华夏杯题目（id 以 HX 开头，如 HXB21P5-01） */
export function isHuaXiaProblem(id) {
  return HUAXIA_RE.test(String(id || ''));
}

/**
 * 访客是否被禁止看这道题。
 * 管理员不受限制。
 */
export function guestBlockedFromProblem(user, problemId) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'root') return false;
  return isGuest(user.username) && isHuaXiaProblem(problemId);
}

/** 给 Mongo 查询用的过滤片段：访客时排除 HX 题 */
export function problemFilterFor(user) {
  if (!user || user.role === 'admin' || user.role === 'root') return {};
  if (!isGuest(user.username)) return {};
  return { id: { $not: /^HX/i } };
}
