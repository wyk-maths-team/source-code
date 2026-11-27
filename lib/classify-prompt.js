// lib/classify-prompt.js
//
// 用 LLM 给题目打技能标签。
//
// 设计要点：
//   1. 技能清单固定放在最前面 —— DeepSeek 的 prompt cache 按前缀命中，
//      清单越长越值得缓存（实测占输入 89%）。
//   2. 全英 prompt。中文分类指令会让模型在两种语言间切换，标签准确率下降。
//   3. 要求模型给出 depth（1-3），不只是「用到哪个技能」，还要求「用到多深」：
//        1 = 常规应用，套公式就能走
//        2 = 需要组合或不太显然的变形
//        3 = 这一步本身就是整道题的难点
//
// 调用方负责计费。

const DEPTH_GUIDE = [
  '1 = routine application. A student who knows this technique would apply it without thinking.',
  '2 = requires a non-obvious substitution, a combination with another technique, or careful bookkeeping.',
  '3 = this technique IS the crux. Remove it and the problem is unsolvable; a competitor would remember the problem for this step.',
].join('\n');

/**
 * 构建 prompt。前两段（指令 + 技能清单）对所有题目完全相同，
 * 所以它们能被上游缓存；题目放在最后。
 */
export function buildClassifyPrompt(taxonomy, problemText, tags) {
  const list = (Array.isArray(taxonomy) ? taxonomy : [])
    .filter((s) => s && s.id)
    .map((s) => {
      const name = s.name && (s.name.en || s.name.zh) ? (s.name.en || s.name.zh) : '';
      const desc = String(s.description || '').replace(/\s+/g, ' ').trim();
      return s.id + (name ? ' | ' + name : '') + (desc ? ' | ' + desc : '');
    })
    .join('\n');

  const tagLine = Array.isArray(tags) && tags.length ? '\nExisting tags: ' + tags.join(', ') : '';

  return [
    'You are tagging olympiad mathematics problems with skill ids.',
    '',
    'SKILL LIST — id | name | what it covers',
    list,
    '',
    'RULES',
    '- Pick 1 to 3 ids. Only from the list above. Never invent one.',
    '- Prefer the most specific id. If a problem uses both a broad and a narrow technique, give the narrow one.',
    '- If nothing fits well, return an empty array rather than forcing a match.',
    '- Also say how DEEP the technique is used:',
    DEPTH_GUIDE,
    '',
    'OUTPUT',
    'Return JSON only, no prose, no code fence:',
    '{"skills":[{"id":"algebra.equation.quadratic","depth":1}]}',
    '',
    'PROBLEM',
    String(problemText || '').trim(),
    tagLine,
  ].join('\n');
}

/** 解析模型输出；失败返回 null，由调用方决定重试还是跳过 */
export function parseClassifyReply(text, allowedIds) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  let body = raw;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  body = body.slice(start, end + 1);

  let obj;
  try { obj = JSON.parse(body); } catch (e) { return null; }
  if (!obj || !Array.isArray(obj.skills)) return null;

  const allow = allowedIds ? new Set(allowedIds) : null;
  const out = [];
  const seen = new Set();
  for (const s of obj.skills) {
    if (!s) continue;
    const id = String(typeof s === 'string' ? s : s.id || '').trim();
    if (!id || seen.has(id)) continue;
    if (allow && !allow.has(id)) continue;
    const depth = Math.min(3, Math.max(1, Math.round(Number(s.depth) || 1)));
    seen.add(id);
    out.push({ id, depth });
    if (out.length >= 3) break;
  }
  return out;
}

/** 成本估算：按 deepseek-chat 的公开单价 */
export const PRICE = {
  input: 0.27 / 1e6,
  cachedInput: 0.028 / 1e6,
  output: 1.10 / 1e6,
};

export function estimateCost(usage) {
  const u = usage || {};
  const miss = Number(u.prompt || u.input || 0) - Number(u.cached || 0);
  const cached = Number(u.cached || 0);
  const out = Number(u.completion || u.output || 0);
  return Math.max(0, miss) * PRICE.input + cached * PRICE.cachedInput + out * PRICE.output;
}