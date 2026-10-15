// lib/deepseek-api.js
// DeepSeek API 封装（2026-10 版本，使用 deepseek-flash）
// 注意：deepseek-chat / deepseek-reasoner 已于 2026-07-24 退役

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_TIMEOUT_MS = 55_000;

export async function askDeepSeekAPI(prompt, opts = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const base = process.env.DEEPSEEK_API_BASE || DEFAULT_BASE;
  const model = opts.model || 'deepseek-flash';
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
        // thinking mode 默认已启用（effort: high）
        // 对批改任务，关掉 thinking 更快更省
        reasoning_effort: opts.thinking ? 'high' : 'none',
        stream: false,
      }),
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