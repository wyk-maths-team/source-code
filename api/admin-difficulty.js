// api/admin-difficulty.js
//
// 管理员的「Auto」按钮：让模型给一道题重新定难度（0-9，两位小数）。
//
// 判据来自 docs/skills/DIFFICULTY.md 第 7 节 —— 那是拿全库 3246 题做统计后
// 得出的结论，最关键的一条是：难度有 57% 的方差来自「哪一批卷子」而不是
// 「题有多难」（CTST 24 题全在 8.88-9.11，M0 97 题只有 6 个取值）。
// 所以 prompt 里第一件事就是把来源标签剥掉，只按题面判。
//
// 只判断不写库：值回填到编辑页输入框，管理员看过理由自己保存。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';
import { computeAiCharge } from '../lib/submission.js';
import { consumeTokens, getTokenBalance } from '../lib/token.js';
import { addAiUsage } from '../lib/aiQuota.js';
import { addTokensUsed } from '../lib/token-meter.js';
import { billingMultiplier } from '../lib/pricing.js';

export const config = { maxDuration: 60 };

const MAX_STATEMENT = 8000;
const MIN_DIFFICULTY = 0;
const MAX_DIFFICULTY = 9.5;

// 判定项：只允许这五个可数量，避免模型自由发挥
const DIMENSIONS = [
  'steps    = how many non-trivial steps must be written down (substitutions of a given formula do not count)',
  'insights = how many key moves a student must INVENT rather than recognise from a textbook (applying a standard formula counts as 0)',
  'cases    = how many mutually exclusive case splits the solution needs',
  'proof    = true when a full argument is required (no numeric answer, or the statement says prove/show that)',
  'estimate = true when the answer needs an inequality estimate rather than an exact computation',
].join('\n');

// 分档表：取自 §7.2，条件全部可判定
const BANDS = [
  'B0  0.00-0.99 | steps<=1, insights=0, cases=0, statement < 120 chars, no max/min asked. Practically only unlabelled records or handout pages.',
  'B1  1.00-1.99 | steps<=2, insights=0, cases=0. Answer falls straight out of ONE substitution or ONE formula (last digit, defined operation, surd simplification).',
  'B2  2.00-2.99 | steps 3-5, insights<=1 and that insight is a textbook standard (telescoping, completing the square, binomial term, solve for a parameter), cases=0.',
  'B3  3.00-3.99 | steps 4-8, exactly ONE non-trivial move (unify exponents, substitute, complete a figure, coordinate-ise); once seen, the rest is mechanical. cases=0.',
  'B4  4.00-4.99 | insights 1-2 with at least one NOT being a textbook routine (pairing symmetry, complement, parity/prime structure); steps 4-8; proof=false.',
  'B5  5.00-5.99 | insights>=2, OR insights=1 with steps>=9, OR cases>=2 with insights>=1. The starting tool has to be chosen, not given.',
  'B6  6.00-6.99 | needs construction / contradiction / invariant (any one), OR insights>=3, OR cases>=3; steps>=10 with guess-then-verify.',
  'B7  7.00-7.99 | needs a deep tool: p-adic valuation, double counting, recurrence modulo analysis, or a global estimate; OR (proof AND insights>=3). Expect 15+ minutes.',
  'B8  8.00-9.30 | a full proof with insights>=4, or a non-standard global estimate (error terms, Vandermonde, complex analysis).',
].join('\n');

// 前置规则与误判拦截：取自 §7.1 / §7.3
const RULES = [
  'R1 Strip the source. The tags may say HKMO / HKMHASC / IMO Prelim / CHSML / HXB / M0 / M2 / CTST / wyk-hw — ignore them entirely while judging. Statistics: HKMO alone contains 28 problems below 2.0 and 23 above 7.0.',
  'R2 The current value is often meaningless. CTST (24 problems inside 8.88-9.11), M0 (97 problems, 6 distinct values) and HXB are batch-assigned and carry no per-problem information. Recompute from the statement; do not anchor on the old number.',
  'R3 A stored difficulty of 0 means UNLABELLED, not easiest. Never treat 0 as a floor.',
  'R4 Proof penalty-lift: if proof=true, the final value is max(band value, 6.00). Corpus evidence: problems with no numeric answer have median 6.50, with answer 3.92. But do not dump every proof at 9 - still split B6-B8 by insight count.',
  'R5 Not a problem: if the content is a handout / lecture note / meta page, return difficulty null instead of a number.',
  'R6 Graduate tools: if the statement genuinely uses complex analysis, measure theory, or similar, output 9.00-9.30.',
].join('\n');

const PITFALLS = [
  'M1 "More computation" is not "harder": problem marks correlate with difficulty at only rho=0.25. If steps is large but insights=0, cap at B3 (3.99).',
  'M2 "Longer or with a figure" is not "harder": length rho=0.15. A figure with no construction stays at B2/B3.',
  'M3 A contest brand is not difficulty - see R1. Skill node names are not difficulty either: grouping by top-level skill explains only 3% of the variance, and within a single skill the spread is often larger than the corpus standard deviation.',
  'M4 Do not use submission counts to infer difficulty: only 18.7% of problems have any submission, and the 5-point band actually has a HIGHER solve rate (33%) than the 3-point band (15%).',
].join('\n');

function buildDifficultyPrompt({ problem }) {
  const statement = String(problem.statement || '').replace(/\s+/g, ' ').slice(0, MAX_STATEMENT);
  const hasAnswer = String(problem.ans ?? '').trim().length > 0;
  const current = Number(problem.difficulty);

  return [
    '<<<SYSTEM INSTRUCTION',
    'You calibrate the difficulty of an olympiad mathematics problem on the 0-9 scale used by this platform.',
    'You judge the problem, not the batch it came from. You do not solve it fully.',
    '>>>',
    '',
    '【MEASURE THESE FIVE THINGS FIRST】',
    DIMENSIONS,
    '',
    '【BANDS — take the FIRST band whose conditions are all satisfied】',
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
    '- difficulty has exactly two decimals and MUST fall inside the band you report (B4 => 4.00-4.99).',
    '- evidence is ONE sentence naming concrete objects from the statement (the function, the condition, the quantity asked for) plus which insight makes it that band. Never write "hard" / "comprehensive" as the reason.',
    '- If R5 applies, output {"difficulty": null, "band": "R5", "evidence": "..."} instead.',
    '',
    '【PROBLEM】',
    'id: ' + String(problem.id || ''),
    'current difficulty (may be unreliable, see R2/R3): ' + (Number.isFinite(current) ? current.toFixed(2) : 'unknown'),
    'numeric answer present: ' + (hasAnswer ? 'yes' : 'no (likely a proof)'),
    'statement:',
    statement || '(empty statement)',
  ].join('\n');
}

function bandRange(band) {
  const b = String(band || '').toUpperCase();
  const map = {
    B0: [0, 0.99], B1: [1, 1.99], B2: [2, 2.99], B3: [3, 3.99], B4: [4, 4.99],
    B5: [5, 5.99], B6: [6, 6.99], B7: [7, 7.99], B8: [8, 9.3],
  };
  return map[b] || null;
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

  // 60 次/分钟：Lab 页会并发跑（默认 3 路），20 次的老额度会被一次 N=30
  // 的评测直接打满，管理员正当使用反而被拦。
  if (!(await applyRateLimit(req, res, {
    name: 'auto-difficulty',
    key: 'u:' + decoded.username,
    max: 60,
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

  const prompt = buildDifficultyPrompt({ problem });

  let out;
  try {
    out = await askDeepSeekAPI(prompt, { effort: 'high', timeoutMs: 50_000 });
  } catch (err) {
    console.error('[auto-difficulty] model failed:', err && err.message);
    return sendError(req, res, 'UPSTREAM', 'The estimator is busy right now, please retry', err);
  }

  const parsed = parseReply(out.content);
  if (!parsed) return sendError(req, res, 'GRADE_ERROR', 'The estimator returned an unreadable value');

  const band = String(parsed.band || '').toUpperCase();
  const evidence = String(parsed.evidence || parsed.rationale || '').slice(0, 400);

  // R5：讲义 / 说明页
  if (parsed.difficulty === null || band === 'R5') {
    return res.status(200).json({
      success: true,
      problemId,
      difficulty: null,
      band: band || 'R5',
      rationale: evidence || 'Not a problem statement (handout or meta page).',
      charged: 0,
      tokens: { daily: balance.daily, global: balance.global },
    });
  }

  let value = Number(parsed.difficulty);
  if (!Number.isFinite(value)) {
    return sendError(req, res, 'GRADE_ERROR', 'The estimator returned an unreadable value');
  }

  // 与 band 自洽：超出就钳回该档，宁可保守
  const range = bandRange(band);
  if (range) value = Math.min(range[1], Math.max(range[0], value));

  // R4：证明题下限 6.00
  if (parsed.proof === true) value = Math.max(6, value);

  const difficulty = Math.round(Math.min(MAX_DIFFICULTY, Math.max(MIN_DIFFICULTY, value)) * 100) / 100;

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

  return res.status(200).json({
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
    charged,
    tokens,
  });
}

export default wrapHandler(handler, { gate: false });
