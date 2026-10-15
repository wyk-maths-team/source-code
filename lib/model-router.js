// lib/model-router.js
// 后端根据题目难度自动选择模型，前端完全不可见

export const MODELS = {
  'ds-flash':      { provider: 'deepseek', id: 'deepseek-flash',              tier: 'cheap'  },
  'claude-haiku':  { provider: 'claude',   id: 'claude-haiku-4-5-20251001',   tier: 'cheap'  },
  'claude-sonnet': { provider: 'claude',   id: 'claude-sonnet-5',             tier: 'strong' },
  'claude-opus':   { provider: 'claude',   id: 'claude-opus-5-5',             tier: 'strong' },
};

// 难度分界线
const DIFFICULTY_THRESHOLD = 5;

// 默认模型（按难度）
const DEFAULTS = {
  cheap:  'claude-haiku',     // d < 5 优先 Haiku
  strong: 'claude-sonnet',    // d ≥ 5 优先 Sonnet
};

// Fallback 链（主模型失败时依次尝试）
const FALLBACK = {
  'claude-haiku':  ['ds-flash'],
  'ds-flash':      ['claude-haiku'],
  'claude-sonnet': ['claude-opus'],
  'claude-opus':   ['claude-sonnet'],
};

export function pickModel(difficulty) {
  const d = Number(difficulty) || 0;
  return d >= DIFFICULTY_THRESHOLD ? DEFAULTS.strong : DEFAULTS.cheap;
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