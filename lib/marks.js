// lib/marks.js —— 从题干里把「(3 marks)」这类分值加起来
//
// 一道题常常分成 (a)(b) 两小问，各自标分数，比如
//   "(a) ... (3 marks)  (b) ... (4 marks)"
// 整题就是 7 分。以前只取第一个匹配，会显示成 3 marks，
// AI 批改的上限也被压到 3 分。

const MARKS_RE = /\((\d+(?:\.\d+)?)\s*marks?\)/gi;

/** 返回题干里所有分值之和；一个都没找到时返回 null */
export function sumMarks(statement) {
  const text = String(statement || '');
  let total = 0;
  let found = 0;
  let m;
  MARKS_RE.lastIndex = 0;
  while ((m = MARKS_RE.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) { total += n; found++; }
  }
  return found ? total : null;
}

/** 例：3 + 4 -> "7 marks"，1 -> "1 mark"，没有 -> "" */
export function marksLabel(statement) {
  const total = sumMarks(statement);
  if (total === null) return '';
  return total + (total === 1 ? ' mark' : ' marks');
}
