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

export function getFallbacks() {
  return [];
}

export function getModelInfo(modelKey) {
  return MODELS[modelKey] || MODELS['ds-flash'];
}

export function getModelChain() {
  return ['ds-flash'];
}