// api/tutor.js
//
// 题目页右下角的答疑助手。
//
// 三条边界，缺一条这个功能就会变成作弊工具或通用聊天机器人：
//   1. 只能碰当前这道题 —— 越界请求直接拒绝，不回答「顺便帮我看看另一题」。
//   2. 不给最终答案 —— 可以讲思路、指错处、提引导问题，但不报答案数值。
//   3. 比赛期间关闭 —— 前端不显示，后端也校验，防止直接用接口抄题。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { findUserActiveContests } from '../lib/submission.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';
import { effortForDifficulty } from '../lib/thinking.js';
import { checkAiQuota, addAiUsage } from '../lib/aiQuota.js';

export const config = { maxDuration: 60 };

const MAX_QUESTION = 800;
const MAX_TURNS = 8;          // 客户端带上来的历史，只取最近 8 条
const TURNS_SLICE = 600;      // 单条历史截断
const RATE_PER_MIN = 8;       // 每用户每分钟提问次数

/** 这道题是否正被用户参与的某场进行中比赛占用 */
async function isInActiveContest(db, username, problemId) {
  try {
    const contests = await findUserActiveContests(db, username, new Date());
    for (const c of contests || []) {
      const hit = (c.problems || []).some((p) => {
        const id = (typeof p === 'object' && p && p.problemId) ? String(p.problemId) : String(p);
        return id === problemId;
      });
      if (hit) return true;
    }
    return false;
  } catch (e) {
    // 查不到就按「在比赛中」处理：宁可这一会儿用不了，也不能在比赛里开口子
    console.error('[tutor] contest lookup failed:', e);
    return true;
  }
}

function buildTutorPrompt({ problem, history, question }) {
  const statement = String(problem.statement || '').slice(0, 6000);
  const answer = String(problem.ans ?? '').slice(0, 400);
  const turns = (Array.isArray(history) ? history : []).slice(-MAX_TURNS);
  const convo = turns.map((m) => {
    const who = (m && m.role === 'tutor') ? 'TUTOR' : 'STUDENT';
    const text = String((m && m.content) || '').replace(/\s+/g, ' ').slice(0, TURNS_SLICE);
    return who + ': ' + text;
  }).join('\n');

  return [
    '<<<SYSTEM INSTRUCTION',
    'You are the tutor embedded in the page for ONE problem. The student is reading that page right now.',
    'You can see the statement, and the reference answer for your own checking.',
    'You do NOT hand over the final answer.',
    '>>>',
    '',
    '【SCOPE — HARD RULE】',
    '1. Only discuss THIS problem: the statement, the ideas it needs, how to get started, why a step fails.',
    '2. If the request is off-topic — another problem, general chatting, unrelated homework, writing code or essays, anything not about this statement — refuse in ONE short sentence and offer to help with this problem instead. Do not answer the off-topic part at all, not even partially.',
    '3. Never state the final answer, and never hand over a decisive intermediate value that would let the student skip the work. Guide instead: name the idea, ask a leading question, point at the exact step that breaks.',
    '4. If the student shows their working, check it and say exactly where it goes wrong — quote the line if that helps.',
    '5. Match the student language: Chinese -> Traditional Chinese (繁體中文, HK style); otherwise English.',
    '6. Write all mathematics in LaTeX: inline $x^2$, display $$a^2+b^2=c^2$$. Never use Unicode superscripts or plain-text algebra.',
    '7. Keep it short: 2-5 sentences unless the student explicitly asks for a fuller explanation.',
    '',
    '【PROBLEM】',
    statement || '(no statement available)',
    '',
    '【REFERENCE ANSWER — internal, never quote, never paraphrase, never compute towards it】',
    answer || '(none)',
    '',
    '【CONVERSATION SO FAR】',
    convo || '(this is the first question)',
    '',
    '【STUDENT QUESTION】',
    question,
  ].join('\n');
}

async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!decoded) return sendError(req, res, 'UNAUTHORIZED', 'Please sign in to use the tutor');

  const action = req.query && req.query.action;

  // ── 前端用它决定要不要显示按钮 ──
  if (action === 'info' || req.method === 'GET') {
    const problemId = String((req.query && req.query.problemId) || '').trim();
    if (!problemId) return sendError(req, res, 'BAD_REQUEST', 'Missing problemId');
    const db = await connectToDatabase();
    const blocked = await isInActiveContest(db, decoded.username, problemId);
    return res.status(200).json({
      success: true,
      allowed: !blocked,
      reason: blocked ? 'contest' : null,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const body = (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) ? req.body : {};
  const problemId = String(body.problemId || '').trim();
  const question = String(body.question || '').trim();

  if (!problemId || !question) return sendError(req, res, 'BAD_REQUEST', 'Missing problemId or question');
  if (question.length > MAX_QUESTION) {
    return sendError(req, res, 'BAD_REQUEST', 'Question is too long (max ' + MAX_QUESTION + ' characters)');
  }

  // 按用户计费，而不是按 IP —— 同一间电脑室共用出口 IP 也不会互相拖累
  if (!(await applyRateLimit(req, res, {
    name: 'tutor',
    key: 'u:' + decoded.username,
    max: RATE_PER_MIN,
    windowMs: 60_000,
    banMs: 60_000,
  }))) return;

  const db = await connectToDatabase();

  const blocked = await isInActiveContest(db, decoded.username, problemId);
  if (blocked) {
    return sendError(req, res, 'FORBIDDEN', 'The tutor is off while this problem is part of a running contest');
  }

  const problem = await db.collection('problems').findOne({ id: problemId });
  if (!problem) return sendError(req, res, 'NOT_FOUND', 'Problem not found');

  // 提问烧的是同一个每日 AI 预算（400k token），不另开额度 ——
  // 否则 tutor 会变成绕开批改配额的后门。
  const quota = await checkAiQuota(db, decoded.username);
  if (!quota.allowed) {
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: quota.message,
    });
  }

  const prompt = buildTutorPrompt({ problem, history: body.history, question });
  const effort = effortForDifficulty(problem.difficulty);

  try {
    const out = await askDeepSeekAPI(prompt, { effort, timeoutMs: 45_000 });
    const reply = String((out && out.content) || '').trim().slice(0, 4000);
    if (!reply) throw new Error('empty reply');

    const spent = Number(out && out.usage && out.usage.total) || 0;
    if (spent > 0) {
      addAiUsage(db, decoded.username, spent).catch((e) => {
        console.error('[tutor] usage accounting failed:', e && e.message);
      });
    }

    return res.status(200).json({ success: true, reply });
  } catch (err) {
    console.error('[tutor] model failed:', err && err.message);
    return sendError(req, res, 'UPSTREAM', 'The tutor is busy right now, please try again', err);
  }
}

export default wrapHandler(handler, { gate: false });
