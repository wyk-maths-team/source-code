// lib/model-router.js
// 后端根据题目难度自动选择模型，前端完全不可见

export const MODELS = {
  'ds-flash':      { provider: 'deepseek', id: 'deepseek-flash',   tier: 'cheap'  },
  'ds-pro':        { provider: 'deepseek', id: 'deepseek-v4-pro',  tier: 'strong' },
  'claude-sonnet': { provider: 'claude',   id: 'claude-sonnet-5',  tier: 'cheap'  },
  'claude-opus':   { provider: 'claude',   id: 'claude-opus-5-5',  tier: 'strong' },
};

// 难度分界线
const DIFFICULTY_THRESHOLD = 5;   // d < 5 用 cheap；d ≥ 5 用 strong
const THINKING_MAX_THRESHOLD = 7; // d < 7 用 high；d ≥ 7 用 max

// 默认模型（按难度）
const DEFAULTS = {
  cheap:  'claude-sonnet',   // d < 5
  strong: 'claude-opus',     // d ≥ 5
};

// Fallback 链
const FALLBACK = {
  'claude-sonnet': ['ds-flash'],
  'claude-opus':   ['ds-flash'],
  'ds-flash':      [],
  'ds-pro':        [],
};

export function pickModel(difficulty) {
  const d = Number(difficulty) || 0;
  return d >= DIFFICULTY_THRESHOLD ? DEFAULTS.strong : DEFAULTS.cheap;
}

/**
 * 思考强度：d < 7 → 'high'；d ≥ 7 → 'max'
 * @param {number} difficulty
 * @returns {'high'|'max'}
 */
export function pickThinkingEffort(difficulty) {
  const d = Number(difficulty) || 0;
  return d >= THINKING_MAX_THRESHOLD ? 'max' : 'high';
}

export function getFallbacks(modelKey) {
  return FALLBACK[modelKey] || [];
}

export function getModelInfo(modelKey) {
  return MODELS[modelKey] || null;
}

export function getModelChain(difficulty) {
  const primary = pickModel(difficulty);
  return [primary, ...getFallbacks(primary)];
}