// api/validate.js
//
// 管理员用：让模型读一遍题目，看它自相矛盾不矛盾。
//
//   POST /api/validate  { problemId }
//     -> { success, verdict: 'ok'|'suspicious'|'broken', reason, raw }
//
// 为什么要传上一题的答案：HKMO 的个人赛是链式的（规则第 6 条写明
// 四部分依次依赖），MO18FI02 的题面里有 $A$、FI03 里有 $B$，
// 这些符号的值来自前一小问。单独把一道题丢给模型，它会判「$A$ 未定义」，
// 那是误报。所以顺着 MO{年}FI{序号} 找来上一题的 ans 一起给过去。
//
// 没有系统提示词：这里要的是模型的原始判断，不是被角色设定带偏的说法。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';

const FI = /^MO(\d{2})FI(\d{2})$/;

function stripTags(html) {
  return String(html || '')
    .replace(/<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, ' [figure: $1] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** MO18FI02 -> MO18FI01。不是 FI 题就返回 null。 */
function previousPart(id) {
  const m = FI.exec(String(id));
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n) || n <= 1) return null;
  return 'MO' + m[1] + 'FI' + String(n - 1).padStart(2, '0');
}

function buildPrompt(problem, prev) {
  const lines = [
    'You are checking a maths competition problem for internal errors.',
    '',
    'Problem id: ' + problem.id,
    'Statement:',
    stripTags(problem.statement),
    '',
    'Stored answer: ' + String(problem.ans == null ? '(none)' : problem.ans),
  ];
  if (problem.exact) lines.push('Exact form: ' + String(problem.exact));
  if (Array.isArray(problem.tags) && problem.tags.length) {
    lines.push('Tags: ' + problem.tags.join(', '));
  }
  if (prev) {
    lines.push('');
    lines.push('This problem is one part of a chained set. The previous part is ' + prev.id
      + ', whose stored answer is ' + String(prev.ans == null ? '(none)' : prev.ans) + '.');
    lines.push('Any symbol in this statement that looks undefined is probably that answer.');
  }
  lines.push('');
  lines.push('Answer these three questions:');
  lines.push('1. Is the statement self-contained enough to have one definite answer?');
  lines.push('2. Does the stored answer actually follow from the statement?');
  lines.push('3. Is anything missing, contradictory, or referencing a figure that is not described?');
  lines.push('');
  lines.push('Reply in exactly this shape, nothing else:');
  lines.push('VERDICT: ok | suspicious | broken');
  lines.push('REASON: one or two sentences.');
  return lines.join('\n');
}

async function handler(req, res) {
  if (req.method !== 'POST') return sendError(req, res, 'BAD_REQUEST', 'Method not allowed');

  const user = await verifyToken(req);
  if (!user) return sendError(req, res, 'UNAUTHORIZED', 'Unauthorized');
  if (!['admin', 'root'].includes(user.role)) return sendError(req, res, 'FORBIDDEN', 'Admin only');

  if (!(await applyRateLimit(req, res, { name: 'validate', key: 'u:' + user.username, max: 30, windowMs: 60_000, banMs: 60_000 }))) return;

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const id = String(body.problemId || '').trim();
  if (!id) return sendError(req, res, 'BAD_REQUEST', 'Missing problemId');

  const db = await connectToDatabase();
  const problem = await db.collection('problems').findOne(
    { id },
    { projection: { _id: 0, id: 1, statement: 1, ans: 1, exact: 1, tags: 1, name: 1 } }
  );
  if (!problem) return sendError(req, res, 'NOT_FOUND', 'Problem not found');

  const prevId = previousPart(id);
  let prev = null;
  if (prevId) {
    prev = await db.collection('problems').findOne(
      { id: prevId },
      { projection: { _id: 0, id: 1, ans: 1 } }
    );
  }

  const started = Date.now();
  let out;
  try {
    out = await askDeepSeekAPI(buildPrompt(problem, prev), { effort: 'none', timeoutMs: 90_000 });
  } catch (e) {
    return res.status(200).json({ success: false, message: 'Model failed: ' + String((e && e.message) || e).slice(0, 200) });
  }

  const raw = String(out.content || '').trim();
  const m = /VERDICT:\s*(ok|suspicious|broken)/i.exec(raw);
  const r = /REASON:\s*([\s\S]+)/i.exec(raw);
  const verdict = m ? m[1].toLowerCase() : 'unknown';

  // 用量进全局计数，不扣个人额度 —— 和分类器一致
  try {
    const { addTokensUsed } = await import('../lib/token-meter.js');
    const u = out.usage || {};
    await addTokensUsed(db, (Number(u.prompt) || 0) + (Number(u.completion) || 0));
  } catch (e) { /* 记账失败不影响结果 */ }

  return res.status(200).json({
    success: true,
    problemId: id,
    previousPart: prev ? { id: prev.id, ans: prev.ans } : null,
    verdict,
    reason: r ? r[1].trim().slice(0, 600) : '',
    raw: raw.slice(0, 1200),
    seconds: Math.round((Date.now() - started) / 100) / 10,
  });
}

export default wrapHandler(handler, { gate: false });
export const config = { maxDuration: 120 };
