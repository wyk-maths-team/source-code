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
// 评分上限 10.00：新量尺到 B10，不再是原来那条封在 9.30 的老曲线。
const MAX_DIFFICULTY = 10;
export const PROMPT_DOC_ID = 'prompt:difficulty';

// 模板搬到了 lib/difficulty-prompt.js —— 那里分成 SYSTEM 和 USER 两段，
// 评分规则不再和题面混在同一个 message 里。
import { DEFAULT_TEMPLATE, splitTemplate } from '../lib/difficulty-prompt.js';
export { DEFAULT_TEMPLATE };

function bandRange(band) {
  const b = String(band || '').toUpperCase();
  const map = {
    B0: [0, 0.99], B1: [1, 1.99], B2: [2, 2.99], B3: [3, 3.99], B4: [4, 4.99],
    B5: [5, 5.99], B6: [6, 6.99], B7: [7, 7.99],
    B8: [8, 8.99], B9: [9, 9.49], B10: [9.5, 10],
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
  // 模板分两段：评分规则进 system，题目进 user。
  // 老模板没有分隔符，splitTemplate 会整份当 user，行为不变。
  const filled = fillTemplate(tpl.text, problem);
  const split = splitTemplate(filled);

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
    out = await askDeepSeekStream(split.prompt, {
      effort: 'high',
      timeoutMs: 280_000,
      // 只有这里开 JSON Output：整站共用的 askDeepSeek 默认仍是普通文本，
      // tutor、hint、批改那些地方一个字都不会变成 json。
      jsonMode: true,
      system: split.system,
      // JSON 被截断就等于白跑一次评估，留足余量
      maxTokens: 2000,
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
