// lib/model-router.js
// 全站唯一指定模型：DeepSeek Flash

export const MODELS = {
  'ds-flash': { provider: 'deepseek', id: 'deepseek-flash', tier: 'cheap' },
};

export function pickModel() {
  return 'ds-flash';
}

export function pickThinkingEffort(difficulty) {
  // Flash 其实不吃这个参数，但保留接口兼容老代码
  return 'high';
}

/**
 * 按题目决定思考强度：
 *   - M0 题（基础题）：低强度思考；难度 < 2 直接关闭
 *   - 其余：沿用 pickThinkingEffort
 * 'none' 表示不向接口传 reasoning_effort。
 */
export function pickEffortForProblem(problem) {
  const tags = Array.isArray(problem && problem.tags) ? problem.tags : [];
  if (tags.includes('M0')) {
    const d = Number(problem && problem.difficulty);
    if (Number.isFinite(d) && d < 2) return 'none';
    return 'low';
  }
  return pickThinkingEffort(problem && problem.difficulty);
}

export function getFallbacks() {
  return [];
}

export function getModelInfo(modelKey) {
  return MODELS[modelKey] || MODELS['ds-flash'];
}

export function getModelChain() {
  return ['ds-flash'];
}