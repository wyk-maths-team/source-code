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
  const effort  = opts.effort;

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  };

  // deepseek-flash 也支持 reasoning_effort（官方 thinking_mode 文档：low / high / max），
  // 之前的 model 判断是过时的，导致分级一直没生效。
  // 'none' 表示显式关闭思考：不发这个字段，走模型默认。
  if (effort && effort !== 'none') {
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

    // ⭐ 新增：提取 Token Usage
    const usage = data?.usage || {};
    
    // 缓存的命中/未命中要分开：计费公式对两者的权重差 50 倍
    const cached = Number(usage.prompt_cache_hit_tokens) || 0;
    const promptTotal = Number(usage.prompt_tokens) || 0;
    const miss = Number.isFinite(Number(usage.prompt_cache_miss_tokens))
      ? Number(usage.prompt_cache_miss_tokens)
      : Math.max(0, promptTotal - cached);

    return {
      content,
      usage: {
        prompt: promptTotal,
        completion: Number(usage.completion_tokens) || 0,
        total: Number(usage.total_tokens) || 0,
        cached,
        miss,
      }
    };

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