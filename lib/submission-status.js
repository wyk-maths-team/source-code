// lib/submission-status.js —— 提交结果的单一存储格式
//
// 一条提交的结果只存一个字段：submissions.status
//
//   AC      全对
//   PS60    部分分 60（两位数，补零）
//   WA      答错
//   V60     违规，原分 60（两位数，补零）
//   SE      系统错误
//
// 以前是 marked / score / correct / systemError / violation 五个字段各说各话，
// 每处代码都要自己拼一遍判断，稍微漏一个就出现「60 分却显示 Violation」那种事。
// 现在只认一个字符串，读的地方调 parseStatus()，写的地方调 encodeStatus()。

export const VERDICT = {
  AC: 'AC',
  PS: 'PS',
  WA: 'WA',
  VIOLATION: 'V',
  SE: 'SE',
};

/** 把分数夹到 0..99，补成两位 —— 100 是 AC 的地盘，不进 PS/V */
function twoDigit(score) {
  const n = Math.max(0, Math.min(99, Math.round(Number(score) || 0)));
  return String(n).padStart(2, '0');
}

/**
 * 生成要存进 submissions.status 的字符串。
 *
 * @param {{ score?: number, correct?: boolean, systemError?: boolean, violation?: boolean }} r
 */
export function encodeStatus(r) {
  const score = Math.round(Number(r?.score) || 0);

  if (r?.systemError) return 'SE';

  // 违规优先于分数：原来拿了几分不重要，这条对外只显示 Violation
  if (r?.violation) return 'V' + twoDigit(score);

  if (score >= 100 || r?.correct === true) return 'AC';
  if (score <= 0) return 'WA';
  return 'PS' + twoDigit(score);
}

/**
 * 解析存储值，得到所有需要的信息。
 * 无法识别的值按 WA 处理，并且 lost=true —— 迁移脚本会把它列出来人工看。
 */
export function parseStatus(status) {
  const s = String(status || '').trim().toUpperCase();

  if (s === 'AC') {
    return { verdict: 'AC', score: 100, correct: true, systemError: false, violation: false };
  }
  if (s === 'WA') {
    return { verdict: 'WA', score: 0, correct: false, systemError: false, violation: false };
  }
  if (s === 'SE') {
    return { verdict: 'SE', score: 0, correct: false, systemError: true, violation: false };
  }

  let m = /^PS(\d{1,2})$/.exec(s);
  if (m) {
    const score = Math.max(1, Math.min(99, parseInt(m[1], 10)));
    return { verdict: 'PS', score, correct: false, systemError: false, violation: false };
  }

  m = /^V(\d{1,2})$/.exec(s);
  if (m) {
    const score = Math.max(0, Math.min(99, parseInt(m[1], 10)));
    // 违规的题也可能本来是满分，但既然标了违规，对外一律不算对
    return { verdict: 'V', score, correct: false, systemError: false, violation: true };
  }

  return { verdict: 'WA', score: 0, correct: false, systemError: false, violation: false, lost: true };
}

/**
 * 旧记录没有 status 时的兜底：按当年的五个字段推一遍。
 * 迁移完成后这个方法只会被历史数据用到，新写入永远有 status。
 */
export function encodeFromLegacy(s) {
  if (!s) return 'WA';
  if (s.systemError) return 'SE';
  if (s.violation) {
    const base = Number.isFinite(Number(s.score)) ? Number(s.score) : 0;
    return 'V' + twoDigit(base);
  }
  const score = Number(s.score);
  if (s.marked && Number.isFinite(score)) {
    if (score >= 100) return 'AC';
    if (score <= 0) return 'WA';
    return 'PS' + twoDigit(score);
  }
  if (s.correct === true) return 'AC';
  if (s.type === 'image' && !s.marked) return 'WA';   // 未批改的历史数据，按未知算
  return 'WA';
}

/** 读一条提交最终该用的 status：优先存储值，否则从旧字段推。 */
export function statusOf(sub) {
  if (sub && typeof sub.status === 'string' && sub.status.trim()) {
    const s = sub.status.trim().toUpperCase();
    if (/^(AC|WA|SE|PS\d{1,2}|V\d{1,2})$/.test(s)) return s;
  }
  return encodeFromLegacy(sub);
}

/** 直接给前端看的短标签（列表、详情页用） */
export function labelOf(status) {
  const p = parseStatus(status);
  switch (p.verdict) {
    case 'AC': return 'Accepted';
    case 'WA': return 'Wrong Answer';
    case 'SE': return 'System Error';
    case 'PS': return 'Partial Score (' + p.score + ')';
    case 'V': return 'Violation';
    default: return 'Wrong Answer';
  }
}

/** 列表里用的 CSS 类名 */
export function classOf(status) {
  const p = parseStatus(status);
  switch (p.verdict) {
    case 'AC': return 'status-accepted';
    case 'WA': return 'status-wrong';
    case 'SE': return 'status-system';
    case 'PS': return 'status-partial';
    case 'V': return 'status-violation';
    default: return 'status-wrong';
  }
}

/** 筛选器参数 → MongoDB 查询条件 */
export function statusFilter(kind) {
  switch (String(kind || '').toLowerCase()) {
    case 'accepted': return { status: 'AC' };
    case 'wrong': return { status: 'WA' };
    case 'partial': return { status: { $regex: '^PS\\d{1,2}$' } };
    case 'violation': return { status: { $regex: '^V\\d{1,2}$' } };
    case 'system': return { status: 'SE' };
    // pending 是「图片还没批」，状态字段里没有对应值，靠页面另外判断
    case 'pending': return { status: { $exists: false } };
    default: return null;
  }
}
