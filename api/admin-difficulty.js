// api/admin-difficulty.js
//
// 管理员的「Auto」按钮：让模型给一道题重新定难度（0-9，两位小数）。
//
// prompt 不再是硬编码：模板存在 Mongo 的 settings 集合（_id = prompt:difficulty），
// 管理员可以在 /admin/lab 的手风琴里直接改，改完立刻对所有人生效。
// 这里只保留一份 DEFAULT_TEMPLATE 作为出厂值，首次读取时用它，Reset 也回到它。
//
// 模板占位符：{{ID}} {{CURRENT}} {{HAS_ANSWER}} {{STATEMENT}}
// 缺 {{STATEMENT}} 的模板视为无效（否则模型看不到题面，只会瞎猜）。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { askDeepSeekStream } from '../lib/deepseek-api.js';
import { computeAiCharge } from '../lib/submission.js';
import { consumeTokens, getTokenBalance } from '../lib/token.js';
import { addAiUsage } from '../lib/aiQuota.js';
import { addTokensUsed } from '../lib/token-meter.js';
import { billingMultiplier } from '../lib/pricing.js';

export const config = { maxDuration: 300 };

const MAX_STATEMENT = 8000;
const MIN_DIFFICULTY = 0;
const MAX_DIFFICULTY = 9.5;
export const PROMPT_DOC_ID = 'prompt:difficulty';

// 判定项
const DIMENSIONS = [
  'steps    = how many non-trivial steps must be written down (substituting into a given formula does not count)',
  'insights = how many key moves a student must INVENT rather than recognise from a textbook (applying a standard formula counts as 0)',
  'cases    = how many mutually exclusive case splits the solution needs',
  'proof    = true when a full argument is required (no numeric answer, or the statement says prove/show that)',
  'estimate = true when the answer needs an inequality estimate rather than an exact computation',
].join('\n');

const BANDS = [
  'B0  0.00-0.99 | steps<=1, insights=0, cases=0, statement < 120 chars, no max/min asked. Practically only unlabelled records or handout pages.',
  'B1  1.00-1.99 | steps<=2, insights=0, cases=0, and the ENTIRE solution is one substitution into a formula printed in the statement. If you had to decide WHICH substitution to use, it is not B1.',
  'B2  2.00-2.99 | steps 3-5, insights<=1 and that insight is a textbook standard (telescoping, completing the square, binomial term, solve for a parameter), cases=0.',
  'B3  3.00-3.99 | steps 4-8, exactly ONE non-trivial move (unify exponents, substitute, complete a figure, coordinate-ise); once seen, the rest is mechanical. cases=0.',
  'B4  4.00-4.99 | insights 1-2 with at least one NOT being a textbook routine (pairing symmetry, complement, parity/prime structure); steps 4-8; proof=false.',
  'B5  5.00-5.99 | insights>=2, OR insights=1 with steps>=9, OR cases>=2 with insights>=1. The starting tool has to be chosen, not given.',
  'B6  6.00-6.99 | needs construction / contradiction / invariant (any one), OR insights>=3, OR cases>=3; steps>=10 with guess-then-verify.',
  'B7  7.00-7.99 | needs a deep tool: p-adic valuation, double counting, recurrence modulo analysis, or a global estimate; OR (proof AND insights>=3). Expect 15+ minutes.',
  'B8  8.00-9.30 | a full proof with insights>=4, or a non-standard global estimate (error terms, Vandermonde, complex analysis).',
].join('\n');

const RULES = [
  'R1 Strip the source. The tags may say HKMO / HKMHASC / IMO Prelim / CHSML / HXB / M0 / M2 / CTST / wyk-hw - ignore them entirely while judging. Statistics: HKMO alone contains 28 problems below 2.0 and 23 above 7.0.',
  'R2 The current value is often meaningless. CTST (24 problems inside 8.88-9.11), M0 (97 problems, 6 distinct values) and HXB are batch-assigned and carry no per-problem information. Recompute from the statement.',
  'R3 A stored difficulty of 0 means UNLABELLED, not easiest. Never treat 0 as a floor.',
  'R4 Proof lift: if proof=true, the final value is max(band value, 6.00). Corpus evidence: problems with no numeric answer have median 6.50, with answer 3.92. Do not dump every proof at 9 - still split B6-B8 by insight count.',
  'R5 Not a problem: if the content is a handout / lecture note / meta page, return difficulty null instead of a number.',
  'R6 Graduate tools: if the statement genuinely uses complex analysis, measure theory, or similar, output 9.00-9.30.',
  'R7 Calibration for this platform: the stored values were produced by a DIFFERENT model in a single bulk pass, not by human markers. They carry that model habits rather than ground truth, so treat them as a weak prior, not as the answer key. Empirically they run slightly higher than a strict reading: between two bands take the upper one, never output the band edge itself (.00), and start at .05 or above. If you disagree strongly, say so in evidence rather than bending toward the stored value.',
].join('\n');

const PITFALLS = [
  'M1 "More computation" is not "harder": marks correlate with difficulty at only rho=0.25. If steps is large but insights=0, cap at B3 (3.99).',
  'M2 "Longer or with a figure" is not "harder": length rho=0.15. A figure with no construction stays at B2/B3.',
  'M3 A contest brand is not difficulty - see R1. Skill node names are not difficulty either: grouping by top-level skill explains 3% of the variance.',
  'M4 Do not use submission counts to infer difficulty: only 18.7% of problems have any submission, and the 5-point band has a HIGHER solve rate (33%) than the 3-point band (15%).',
].join('\n');

export const DEFAULT_TEMPLATE = [
  '<<<SYSTEM INSTRUCTION',
  'You calibrate the difficulty of an olympiad mathematics problem on the 0-9 scale used by this platform.',
  'You judge the problem, not the batch it came from. You do not solve it fully.',
  '>>>',
  '',
  '【MEASURE THESE FIVE THINGS FIRST】',
  DIMENSIONS,
  '',
  '【BANDS - take the FIRST band whose conditions are all satisfied】',
  BANDS,
  '',
  '【RULES THAT OVERRIDE THE BANDS】',
  RULES,
  '',
  '【COMMON MISJUDGEMENTS TO AVOID】',
  PITFALLS,
  '',
  '【OUTPUT】',
  'Output ONLY this JSON, no prose, no code fences:',
  '{"difficulty": 4.25, "band": "B4", "steps": 6, "insights": 2, "cases": 0, "proof": false, "evidence": "..."}',
  '',
  'Hard requirements:',
  '- difficulty MUST fall inside the band you report (B4 => 4.00-4.99).',
  '- Give TWO MEANINGFUL decimals, not a padded number. 5.35 is right; 5.30 and 5.00 are not acceptable unless you genuinely mean the exact tenth.',
  '  Use the hundredths to say WHERE inside the band the problem sits:',
  '    .05-.20 = just barely clears the lower band edge',
  '    .35-.50 = solidly in the middle',
  '    .70-.95 = almost hard enough for the next band up',
  '- If your assessment lands on a round number, move it to the nearer meaningful hundredth (5.00 -> 5.05 or 4.95) rather than emitting 5.00.',
  '- evidence is ONE sentence naming concrete objects from the statement plus which insight makes it that band. Never write "hard" / "comprehensive" as the reason.',
  '- If R5 applies, output {"difficulty": null, "band": "R5", "evidence": "..."} instead.',
  '',
  '【PROBLEM】',
  'id: {{ID}}',
  'current difficulty (may be unreliable, see R2/R3): {{CURRENT}}',
  'numeric answer present: {{HAS_ANSWER}}',
  'statement:',
  '{{STATEMENT}}',
].join('\n');

function bandRange(band) {
  const b = String(band || '').toUpperCase();
  const map = {
    B0: [0, 0.99], B1: [1, 1.99], B2: [2, 2.99], B3: [3, 3.99], B4: [4, 4.99],
    B5: [5, 5.99], B6: [6, 6.99], B7: [7, 7.99], B8: [8, 9.3],
  };
  return map[b] || null;
}

export function fillTemplate(tpl, problem) {
  const statement = String(problem.statement || '').replace(/\s+/g, ' ').slice(0, MAX_STATEMENT);
  const current = Number(problem.difficulty);
  const hasAnswer = String(problem.ans ?? '').trim().length > 0;
  return String(tpl)
    .replace(/\{\{ID\}\}/g, String(problem.id || ''))
    .replace(/\{\{CURRENT\}\}/g, Number.isFinite(current) ? current.toFixed(2) : 'unknown')
    .replace(/\{\{HAS_ANSWER\}\}/g, hasAnswer ? 'yes' : 'no (likely a proof)')
    .replace(/\{\{STATEMENT\}\}/g, statement || '(empty statement)');
}

/** 读模板：DB 优先，缺/无效时回落到出厂值 */
export async function loadTemplate(db) {
  const doc = await db.collection('settings').findOne({ _id: PROMPT_DOC_ID });
  const text = doc && typeof doc.text === 'string' ? doc.text : '';
  if (text && text.includes('{{STATEMENT}}')) return { text, source: 'db', updatedAt: doc.updatedAt || null };
  return { text: DEFAULT_TEMPLATE, source: 'default', updatedAt: null };
}

function parseReply(raw) {
  const text = String(raw || '');
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const obj = JSON.parse(text.slice(a, b + 1));
    return obj && typeof obj === 'object' ? obj : null;
  } catch (e) { return null; }
}

async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!decoded) return sendError(req, res, 'UNAUTHORIZED', 'Unauthorized');
  if (!['admin', 'root'].includes(decoded.role)) {
    return sendError(req, res, 'FORBIDDEN', 'Administrators only');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  // 1200 次/分钟：Lab 允许一次抽 1000 题，300 的额度会在跑到三分之一时
  // 把人挡在 429 外面。ds-flash 侧并发 2500，真正的成本控制是余额与每日预算。
  if (!(await applyRateLimit(req, res, {
    name: 'auto-difficulty',
    key: 'u:' + decoded.username,
    max: 1200,
    windowMs: 60_000,
    banMs: 60_000,
  }))) return;

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const problemId = String(body.problemId || body.id || '').trim();
  if (!problemId) return sendError(req, res, 'BAD_REQUEST', 'Missing problemId');

  const db = await connectToDatabase();

  const balance = await getTokenBalance(db, decoded.username);
  const available = (Number(balance.daily) || 0) + (Number(balance.global) || 0);
  if (available <= 0) {
    return res.status(402).json({
      success: false,
      code: 'INSUFFICIENT_TOKENS',
      message: 'Out of tokens. Estimating a difficulty costs tokens, same as AI grading.',
      tokens: { daily: balance.daily, global: balance.global },
    });
  }

  const problem = await db.collection('problems').findOne({ id: problemId });
  if (!problem) return sendError(req, res, 'NOT_FOUND', 'Problem not found');

  const tpl = await loadTemplate(db);
  const prompt = fillTemplate(tpl.text, problem);

  // ── 从这里开始走 SSE ──
  // 一次评估经常要 1–3 分钟，Cloudflare 对空闲连接大约 100 秒就断，普通
  // 请求会被砍在半路。改成边算边推：模型每吐一块 reasoning/content 就写
  // 一帧，另外每 15 秒补一个注释帧，连接始终有数据流过。
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  let closed = false;
  req.on('close', function () { closed = true; });

  function send(event, data) {
    if (closed) return;
    try {
      res.write('event: ' + event + '\n');
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    } catch (e) {
      closed = true;
    }
  }

  const beat = setInterval(function () {
    if (closed) return;
    try { res.write(': ping\n\n'); } catch (e) { closed = true; }
  }, 15000);

  let out;
  try {
    out = await askDeepSeekStream(prompt, {
      effort: 'high',
      timeoutMs: 280_000,
      onDelta: function (d) { send(d.type, { text: d.text }); },
    });
  } catch (err) {
    clearInterval(beat);
    console.error('[auto-difficulty] model failed:', err && err.message);
    send('error', { code: 'UPSTREAM', message: 'The estimator is busy right now, please retry' });
    try { res.end(); } catch (e) {}
    return;
  }

  const parsed = parseReply(out.content);

  const band = String((parsed && parsed.band) || '').toUpperCase();
  const evidence = String((parsed && (parsed.evidence || parsed.rationale)) || '').slice(0, 400);

  let charged = 0;
  let tokens = { daily: balance.daily, global: balance.global };
  try {
    const base = computeAiCharge(out.usage || {});
    charged = Math.max(1, Math.round(base * billingMultiplier(new Date())));
    tokens = await consumeTokens(db, decoded.username, charged);
    addAiUsage(db, decoded.username, charged).catch(() => {});
    const spent = Number(out.usage && out.usage.total) || 0;
    if (spent > 0) addTokensUsed(db, spent).catch(() => {});
  } catch (e) {
    console.error('[auto-difficulty] billing failed:', e && e.message);
  }

  clearInterval(beat);

  const finish = (payload) => {
    send('done', payload);
    try { res.end(); } catch (e) {}
  };

  if (!parsed) {
    return finish({ success: false, code: 'GRADE_ERROR', message: 'The estimator returned an unreadable value', charged, tokens });
  }

  if (parsed.difficulty === null || band === 'R5') {
    return finish({
      success: true, problemId, difficulty: null, band: band || 'R5',
      rationale: evidence || 'Not a problem statement (handout or meta page).',
      promptSource: tpl.source, charged, tokens,
    });
  }

  let value = Number(parsed.difficulty);
  if (!Number.isFinite(value)) {
    return finish({ success: false, code: 'GRADE_ERROR', message: 'The estimator returned an unreadable value', charged, tokens });
  }

  const range = bandRange(band);
  if (range) value = Math.min(range[1], Math.max(range[0], value));
  if (parsed.proof === true) value = Math.max(6, value);

  const difficulty = Math.round(Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, value)) * 100) / 100;

  finish({
    success: true,
    problemId,
    difficulty,
    band: band || null,
    previous: Number(problem.difficulty) || 0,
    dimensions: {
      steps: Number(parsed.steps) || 0,
      insights: Number(parsed.insights) || 0,
      cases: Number(parsed.cases) || 0,
      proof: parsed.proof === true,
    },
    rationale: evidence,
    promptSource: tpl.source,
    charged,
    tokens,
  });
}

export default wrapHandler(handler, { gate: false });
