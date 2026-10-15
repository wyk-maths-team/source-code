// lib/temp/claude-api.js
// 临时：Claude API 封装（$100 额度用完就删）
// ⭐ Claude 不传 effort，使用模型默认值（省 token）

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_TIMEOUT_MS = 280_000;

const MODEL_MAP = {
  'claude-opus':   'claude-opus-5-5',
  'claude-sonnet': 'claude-sonnet-5',
};

export async function askClaude(prompt, opts = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const model = MODEL_MAP[opts.model] || opts.model;
  if (!model || !model.startsWith('claude-')) {
    throw new Error(`Invalid Claude model: ${opts.model}`);
  }

  const timeout = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxTk   = opts.maxTokens || 8192;

  // ⭐ 不传 effort，不传 thinking — 全部用模型默认
  const body = {
    model,
    max_tokens: maxTk,
    messages: [{ role: 'user', content: prompt }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const err = new Error(`Claude ${r.status}: ${t.slice(0, 200)}`);
      err.status = r.status;
      err.permanent = [401, 402, 403].includes(r.status);
      throw err;
    }

    const data = await r.json();
    const text = data?.content?.[0]?.text || '';
    if (!text) throw new Error('Empty Claude response');
    return text;

  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      const err = new Error(`Claude timeout (${timeout}ms)`);
      err.permanent = false;
      throw err;
    }
    throw e;
  }
}