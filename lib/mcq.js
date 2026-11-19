// lib/mcq.js —— 选择题（MC）的共享定义
//
// 一道带 MC 标签的题由三部分组成：
//   1. pdfUrl   —— 整份卷子的 PDF，可以是外部地址（GitHub raw、Cloudinary 都行）
//   2. mcq      —— 四个选项圈的版式：位置用 0-1 比例，换屏幕不会错位
//   3. logic    —— 判分逻辑，保存时自动注入，管理员不用手写
//
// 版式结构：
//   {
//     page: 1,                          // 这份 PDF 的第几页（1 起）
//     box:  { x, y, w, h },             // 学生端那个透明长方形（answer sheet 区域）
//     options: [                        // 四个选项圈，按 A/B/C/D 顺序
//       { key: 'A', x, y, r }, ...
//     ]
//   }
// 坐标全部相对该页渲染后的宽高（0..1），r 也是相对页宽。

export const MC_TAG = 'MC';

/** 选项字母，顺序即渲染顺序 */
export const OPTION_KEYS = ['A', 'B', 'C', 'D'];

/**
 * 判断一道题是不是选择题。
 * 只看标签，不看有没有版式 —— 带 MC 标签但还没画版式的题也应该走这条路径。
 */
export function isMcq(problem) {
  const tags = Array.isArray(problem && problem.tags) ? problem.tags : [];
  return tags.some((t) => String(t || '').trim().toUpperCase() === MC_TAG);
}

/**
 * MC 题的判分逻辑源码。
 *
 * 存成一个字符串写进 problem.logic，和手写的自定义逻辑走同一条执行通道
 * （lib/logic-runner.js），所以不需要给它开特殊分支。
 *
 * 参数就是 judge() 传进来的那两个：正确答案 ans，学生答案 uans。
 */
export function mcLogicSource() {
  return [
    'function (ans, uans) {',
    "  const norm = (v) => String(v == null ? '' : v).trim().toUpperCase();",
    '  const correct = norm(ans);',
    '  const picked = norm(uans);',
    "  if (!picked) return { score: 0, comment: 'No option selected.' };",
    "  if (!correct) return { score: 0, comment: 'This question has no answer key.' };",
    '  if (picked === correct) return { score: 100, comment: "Correct. You chose " + picked + "." };',
    '  return { score: 0, comment: "Incorrect. You chose " + picked + "." };',
    '}',
  ].join('\n');
}

/** 保存题目时：带 MC 标签且没有 logic → 自动写入；去掉标签则清掉自动写入的那份 */
export function applyMcqLogic(tags, logic) {
  const mc = Array.isArray(tags) && tags.some((t) => String(t || '').trim().toUpperCase() === MC_TAG);
  const hasLogic = String(logic || '').trim() !== '';
  if (mc && !hasLogic) return mcLogicSource();
  return logic || '';
}

/** 校验并规整管理员提交的版式；非法就返回 null，前端保持原样 */
export function normalizeMcq(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const clamp01 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(1, Math.max(0, n));
  };

  const page = Math.max(1, Math.round(Number(raw.page) || 1));

  const srcBox = raw.box || {};
  const box = {
    x: clamp01(srcBox.x),
    y: clamp01(srcBox.y),
    w: clamp01(srcBox.w),
    h: clamp01(srcBox.h),
  };
  if (box.x == null || box.y == null || box.w == null || box.h == null) return null;
  if (box.w <= 0 || box.h <= 0) return null;

  const optsIn = Array.isArray(raw.options) ? raw.options : [];
  const byKey = new Map();
  for (const o of optsIn) {
    const k = String((o && o.key) || '').trim().toUpperCase();
    if (!OPTION_KEYS.includes(k)) continue;
    const x = clamp01(o.x);
    const y = clamp01(o.y);
    const r = clamp01(o.r);
    if (x == null || y == null || r == null || r <= 0) continue;
    byKey.set(k, { key: k, x, y, r });
  }

  // 四个圈必须齐全，缺一个就整份不收 —— 半套版式渲染出来会误导学生
  const options = [];
  for (const k of OPTION_KEYS) {
    const o = byKey.get(k);
    if (!o) return null;
    options.push(o);
  }

  return { page, box, options };
}

/**
 * 某份卷子的共享版式。
 * 你选的是「同一份 paper 的所有题共用一套」，所以取该 paper 下任意一道
 * 已带版式的题作为来源；管理员改的时候写回该 paper 的每一道题。
 */
export function paperKeyOf(problemId) {
  const id = String(problemId || '');
  // DSE/试卷题号形如 HA0108 → HA01 为一份卷子；没有可辨识前缀就当成单独一份
  const m = /^([A-Za-z]{1,6}\d{0,4})\d{2}$/.exec(id);
  return m ? m[1] : id;
}
