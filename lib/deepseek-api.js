// lib/deepseek-api.js
// 直接调用 DeepSeek 官方 API（OpenAI 兼容格式）
// 用 fetch，无依赖

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_TIMEOUT_MS = 55_000;

// bridge 里的 'r1' / 'v3' → DeepSeek API model 名
const MODEL_MAP = {
  r1: 'deepseek-reasoner',
  v3: 'deepseek-chat',
};

/**
 * 呼叫 DeepSeek API，回傳純文字回覆
 * @param {string} prompt
 * @param {object} opts
 * @param {'r1'|'v3'} opts.model
 * @param {number}     opts.timeoutMs
 * @returns {Promise<string>}
 */
export async function askDeepSeekAPI(prompt, opts = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const base    = process.env.DEEPSEEK_API_BASE || DEFAULT_BASE;
  const model   = MODEL_MAP[opts.model] || MODEL_MAP.r1;
  const timeout = opts.timeoutMs || DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`DeepSeek API ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      // 402 = 余额不足，401/403 = key 问题 → 这些不应该 fallback 到 bridge
      err.permanent = [401, 402, 403].includes(res.status);
      throw err;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from DeepSeek API');
    return content;

  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      const err = new Error(`DeepSeek API timeout (${timeout}ms)`);
      err.permanent = false;
      throw err;
    }
    throw e;
  }
}
