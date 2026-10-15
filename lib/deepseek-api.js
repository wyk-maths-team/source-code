// lib/deepseek-api.js
// DeepSeek API 封装

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_TIMEOUT_MS = 55_000;

export async function askDeepSeekAPI(prompt, opts = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const base = process.env.DEEPSEEK_API_BASE || DEFAULT_BASE;
  const model = opts.model || 'deepseek-flash';
  const timeout = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const effort  = opts.effort;   // 'low' | 'high' | 'max' | undefined

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };

  // ⭐ 只对支持 reasoning 的模型传 reasoning_effort
  if (effort && model !== 'deepseek-flash') {
    body.reasoning_effort = effort;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`DeepSeek API ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
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