// lib/deepseek-api.js
// 直连 DeepSeek API（OpenAI 兼容）
// 環境變數：
//   DEEPSEEK_API_KEY      必填
//   DEEPSEEK_API_BASE     可選，預設 https://api.deepseek.com
//   DEEPSEEK_TEXT_MODEL   可選，預設 deepseek-chat
//   DEEPSEEK_VISION_MODEL 可選，預設 deepseek-flash

const API_BASE     = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
const API_KEY      = process.env.DEEPSEEK_API_KEY;
const TEXT_MODEL   = process.env.DEEPSEEK_TEXT_MODEL || 'deepseek-chat';
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash';

const DEFAULT_TIMEOUT = 120_000;

async function callDeepSeek({ prompt, imageUrls = [], timeoutMs = DEFAULT_TIMEOUT }) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY not set');

  const content = [{ type: 'text', text: prompt }];
  for (const url of imageUrls) {
    if (typeof url === 'string' && url.startsWith('http')) {
      content.push({ type: 'image_url', image_url: { url } });
    }
  }

  const model = imageUrls.length > 0 ? VISION_MODEL : TEXT_MODEL;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        max_tokens: 8000,
        temperature: 0.3,
      }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`DeepSeek API ${res.status}: ${t.slice(0, 200)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    const reply  = choice?.message?.content || '';
    if (!reply) throw new Error('DeepSeek API returned empty reply');

    return {
      reply,
      usage: data.usage || null,
      model: data.model || model,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { callDeepSeek, TEXT_MODEL, VISION_MODEL };