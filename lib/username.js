// lib/username.js —— 用户名格式：WYK + 两位年份 + 一位班别字母 + 两位学号
// 例：WYK22R42（旧格式 s22r42 会被自动转换）

export const WYK_RE = /^WYK\d{2}[A-Z]\d{2}$/;
const OLD_RE = /^s(\d{2})([a-z])(\d{2})$/i;

/** s22r42 → WYK22R42；已经是新格式则原样返回（统一大写） */
export function toWyk(raw) {
  const s = String(raw == null ? '' : raw).trim();
  const m = OLD_RE.exec(s);
  if (m) return 'WYK' + m[1] + m[2].toUpperCase() + m[3];
  const up = s.toUpperCase();
  if (WYK_RE.test(up)) return up;
  return s;
}

export function isWyk(raw) {
  return WYK_RE.test(String(raw == null ? '' : raw).trim().toUpperCase());
}

/** 给前端用的提示文案 */
export function usernameHint() {
  return 'Usernames look like WYK22R42 (old s22r42 style still works during the transition).';
}
