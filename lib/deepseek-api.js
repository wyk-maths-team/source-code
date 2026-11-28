// lib/deepseek-api.js
// DeepSeek API 封装

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_TIMEOUT_MS = 55_000;

/**
 * 组装 messages。
 *
 * 不传 opts.system 时保持原样（一条 user），所有既有调用者行为不变。
 * 只有结构化输出这类任务才把指令放进 system —— 那里指令和题面必须分开，
 * 否则题面里的一句话就能改写评分规则。
 */
function buildMessages(prompt, opts) {
  const sys = opts && opts.system ? String(opts.system) : '';
  if (!sys) return [{ role: 'user', content: prompt }];
  return [
    { role: 'system', content: sys },
    { role: 'user', content: prompt },
  ];
}

/**
 * JSON Output 是**逐调用**开关，默认关。
 *
 * 官方要求（api-docs.deepseek.com/guides/json_mode）：
 *   1. response_format = { type: 'json_object' }
 *   2. prompt 里必须出现 json 字样并给出样例
 *   3. max_tokens 要留够，否则 JSON 会被截断
 *
 * 还有一条坑：输出无法解析成 JSON 时，API 会把非 JSON 部分替换成空格，
 * content 可能只剩空白而 finish_reason 仍是 stop —— 调用方必须自己兜空。
 *
 * 这个函数只在 opts.jsonMode === true 时动手。tutor 对话、hint 生成、
 * 批改解释这些地方一行不改，否则整站回复都会变成 JSON。
 */
function applyJsonMode(body, opts) {
  if (!opts || opts.jsonMode !== true) return;
  body.response_format = { type: 'json_object' };
  if (!body.max_tokens && opts.maxTokens) body.max_tokens = opts.maxTokens;
}

export async function askDeepSeekAPI(prompt, opts = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const base = process.env.DEEPSEEK_API_BASE || DEFAULT_BASE;
  const model = opts.model || 'deepseek-flash';
  const timeout = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const effort  = opts.effort;

  const body = {
    model,
    messages: buildMessages(prompt, opts),
    stream: false,
  };

  // deepseek-flash 也支持 reasoning_effort（官方 thinking_mode 文档：low / high / max），
  // 之前的 model 判断是过时的，导致分级一直没生效。
  // 'none' 表示显式关闭思考：不发这个字段，走模型默认。
  if (effort && effort !== 'none') {
    body.reasoning_effort = effort;
  }
  applyJsonMode(body, opts);

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
/**
 * 流式调用。和 askDeepSeekAPI 的区别：
 *   1. stream: true，逐块把 delta 交给 onDelta
 *   2. 把 reasoning_content 一起暴露出来 —— 非流式接口根本不返回它
 *   3. 结束时才拿到 usage（stream_options.include_usage）
 *
 * onDelta({ type, text })
 *   type = 'reasoning' | 'content'
 *
 * 返回结构与 askDeepSeekAPI 一致，方便计费代码复用。
 */
export async function askDeepSeekStream(prompt, opts = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const base = process.env.DEEPSEEK_API_BASE || DEFAULT_BASE;
  const model = opts.model || 'deepseek-flash';
  const timeout = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const effort = opts.effort;
  const onDelta = typeof opts.onDelta === 'function' ? opts.onDelta : function () {};

  const body = {
    model,
    messages: buildMessages(prompt, opts),
    stream: true,
    // 不给这个，流式响应里就没有 usage，计费会归零
    stream_options: { include_usage: true },
  };
  if (effort && effort !== 'none') body.reasoning_effort = effort;
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  applyJsonMode(body, opts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      clearTimeout(timer);
      const text = await res.text().catch(() => '');
      const err = new Error('DeepSeek API ' + res.status + ': ' + text.slice(0, 200));
      err.status = res.status;
      err.permanent = [401, 402, 403].includes(res.status);
      throw err;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';
    let usage = null;

    while (true) {
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });

      // SSE 按行切；一行可能被拆在两次 read 之间，所以留 residual
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || line.startsWith(':')) continue;          // 心跳/注释
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        let obj;
        try { obj = JSON.parse(payload); } catch (e) { continue; }

        if (obj.usage) usage = obj.usage;

        const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          onDelta({ type: 'reasoning', text: delta.reasoning_content });
        }
        if (delta.content) {
          content += delta.content;
          onDelta({ type: 'content', text: delta.content });
        }
      }
    }

    clearTimeout(timer);

    if (!content) throw new Error('Empty response from DeepSeek API');

    const u = usage || {};
    const cached = Number(u.prompt_cache_hit_tokens) || 0;
    const promptTotal = Number(u.prompt_tokens) || 0;
    const miss = Number.isFinite(Number(u.prompt_cache_miss_tokens))
      ? Number(u.prompt_cache_miss_tokens)
      : Math.max(0, promptTotal - cached);

    return {
      content,
      reasoning,
      usage: {
        prompt: promptTotal,
        completion: Number(u.completion_tokens) || 0,
        total: Number(u.total_tokens) || 0,
        cached,
        miss,
      },
    };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      const err = new Error('DeepSeek API timeout (' + timeout + 'ms)');
      err.permanent = false;
      throw err;
    }
    throw e;
  }
}

