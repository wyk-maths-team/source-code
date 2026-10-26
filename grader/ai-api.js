// ai-api.js
const config = require('./config');

async function ask(prompt, { model = 'r1', timeoutMs = 60_000 } = {}) {
  const modelName = model === 'r1' ? 'deepseek-reasoner' : 'deepseek-chat';
  
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: modelName,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${t.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function launch() { return {}; }
async function close() {}

module.exports = { ask, launch, close };