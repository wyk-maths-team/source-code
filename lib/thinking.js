// lib/thinking.js —— 按题目决定思考强度（reasoning_effort）
//
// 官方文档（api-docs.deepseek.com/guides/thinking_mode.md）：
//   deepseek-flash 支持 reasoning_effort: low / high / max，默认 high。
//
// 规则：
//   普通题    难度 1-3 → low；4-7 → high；8+ → max
//   DSE M0    第 1-15 题 low；第 16 题起 high
//   DSE M1/M2 最后 4 题 high，其余 low

export const EFFORT = { LOW: 'low', HIGH: 'high', MAX: 'max' };

/** 普通平台题：按 difficulty */
export function effortForDifficulty(difficulty) {
  const d = Number(difficulty) || 0;
  if (d >= 8) return EFFORT.MAX;
  if (d >= 4) return EFFORT.HIGH;
  return EFFORT.LOW;
}

/** DSE 卷子：按 track + 题号 */
export function effortForDse(track, index1Based, totalCount) {
  const i = Number(index1Based) || 0;
  const total = Number(totalCount) || 0;

  if (String(track || '').toUpperCase() === 'M0') {
    return i >= 16 ? EFFORT.HIGH : EFFORT.LOW;
  }
  // M1 / M2：最后四题 high
  return total > 0 && i > total - 4 ? EFFORT.HIGH : EFFORT.LOW;
}

/** 从题目 id 解析出 track 和题号：M0DSE2519 -> { track:'M0', index:19 } */
export function parseDseId(id) {
  const m = /^(M[012])DSE\d{2}(\d{2})$/i.exec(String(id || ''));
  if (!m) return null;
  return { track: m[1].toUpperCase(), index: Number(m[2]) };
}

/** 一道题该用多少思考强度：DSE 题目按卷子规则，其余按难度 */
export function effortForProblem(problem, context = {}) {
  const p = problem || {};
  const parsed = parseDseId(p.id);
  if (parsed) {
    const total = Number(context.total) || 0;
    return effortForDse(parsed.track, parsed.index, total);
  }
  return effortForDifficulty(p.difficulty);
}
