// lib/paperLayout.js —— 试卷每题画板高度的默认规则
//
// 基准是「半张 A4」。几道长题要更多空间：
//   M0 : 第 16 题起，整张
//   M2 : 第 10、11 整张；12、13 两张
//   M1 : 第 9、10 整张；11、12 两张
//
// 返回的是「几张 A4」的倍数，实际像素 = 画板宽度 × (297/210) × factor。
// 存进 papers.layout 时换算成 px（参考宽度见 DEFAULT_WIDTH）。

export const A4_RATIO = 297 / 210;

/** 参考宽度：布局编辑器里画板的常见宽度，用来把倍数换算成 px */
export const DEFAULT_WIDTH = 932;

/** 一道题占几张 A4（0.5 = 半张） */
export function a4FactorFor(track, index1Based) {
  const t = String(track || '').toUpperCase();
  const i = Number(index1Based) || 0;

  if (t === 'M0' && i >= 16) return 1;
  if (t === 'M2' && (i === 10 || i === 11)) return 1;
  if (t === 'M2' && (i === 12 || i === 13)) return 2;
  if (t === 'M1' && (i === 9 || i === 10)) return 1;
  if (t === 'M1' && (i === 11 || i === 12)) return 2;

  return 0.5;
}

/** 默认像素高度 */
export function defaultHeightFor(track, index1Based, width = DEFAULT_WIDTH) {
  const px = Math.round(width * A4_RATIO * a4FactorFor(track, index1Based));
  return Math.max(120, Math.min(3200, px));
}

/** 给一份卷子的题目列表生成 layout.items */
export function defaultLayoutItems(track, pids) {
  return (pids || []).map((pid, i) => ({
    pid,
    page: i + 1,
    height: defaultHeightFor(track, i + 1),
  }));
}
