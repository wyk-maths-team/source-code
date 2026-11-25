// api/tutor.js
//
// 题目页右下角的答疑助手。
//
// 三条边界，缺一条这个功能就会变成作弊工具或通用聊天机器人：
//   1. 只能碰当前这道题 —— 越界请求直接拒绝，不回答「顺便帮我看看另一题」。
//   2. 不给最终答案 —— 可以讲思路、指错处、提引导问题，但不报答案数值。
//   3. 比赛期间关闭 —— 前端不显示，后端也校验，防止直接用接口抄题。
//
// 计费与批改同口径：computeAiCharge 折算 → 高峰加倍 → consumeTokens 原子扣费，
// 同时计入每日 AI 预算（addAiUsage）与全站累计（addTokensUsed）。
// 对话落库 tutor_threads，换设备登录也能接着上次问。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { findUserActiveContests, computeAiCharge } from '../lib/submission.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';
import { effortForDifficulty } from '../lib/thinking.js';
import { checkAiQuota, addAiUsage } from '../lib/aiQuota.js';
import { consumeTokens, getTokenBalance } from '../lib/token.js';
import { buildStudentProfile, classifyForProblem, profileBlock } from '../lib/student-profile.js';
import { addTokensUsed } from '../lib/token-meter.js';
import { billingMultiplier } from '../lib/pricing.js';

export const config = { maxDuration: 60 };

const MAX_QUESTION = 800;
const MAX_TURNS = 8;          // 送给模型的历史轮数上限
const TURNS_SLICE = 600;      // 单条历史截断
const RATE_PER_MIN = 8;       // 每用户每分钟提问次数
const THREAD_KEEP = 40;       // 每个（用户，题目）保留最近 40 条消息

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

export function buildTutorPrompt({ problem, history, question, profile }) {
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
    '',
    '【MATH NOTATION — KaTeX, follow exactly】',
    'The page renders your reply with KaTeX, so delimiter mistakes show up as broken text.',
    '- Inline math goes between single dollars: $\cos \angle BAC = -1 / 8$. Display math between double dollars: $$DA \cdot DE = DB \cdot DC$$',
    '- Put EVERY symbol, operator and fraction inside the math delimiters. Prose stays outside.',
    '- Never glue several commands together and never drop the backslash: write $\angle BAC$, not "angle BAC"; write $\text{angle bisector}$, not "anglebisector".',
    '- Multi-word English inside a formula must be wrapped: $\text{by Stewart\x27s theorem}$ — but prefer putting sentences outside the math instead.',
    '- Use \frac{}{}, \cdot, \times, \sqrt{}, \angle, \triangle, \sin, \cos, \tan. Do not use Unicode math (², √, ×).',
    '- If you are unsure a command exists in KaTeX, use plain wording instead of a made-up command.',
    '',
    '【STYLE】',
    '- Keep it short: 2-5 sentences unless the student explicitly asks for a fuller explanation.',
    '- One idea per paragraph. Do not dump a full solution.',
    '',
    '【PROBLEM】',
    statement || '(no statement available)',
    '',
    '【REFERENCE ANSWER — internal, never quote, never paraphrase, never compute towards it】',
    answer || '(none)',
    '',
    // 学生画像放在对话之前、问题之后：模型先读题，再读「这个人会什么」，
    // 最后才看到提问 —— 顺序与它组织回答的顺序一致。
    ...(profile ? ['', profile] : []),
    '',
    '【CONVERSATION SO FAR】',
    convo || '(this is the first question)',
    '',
    '【STUDENT QUESTION】',
    question,
  ].join('\n');
}

/** 落库：每个（用户，题目）一条线程，只留最近 THREAD_KEEP 条 */
async function saveThread(db, username, problemId, question, reply) {
  const now = new Date();
  try {
    await db.collection('tutor_threads').updateOne(
      { username, problemId },
      {
        $push: {
          messages: {
            $each: [
              { role: 'user', content: question, at: now },
              { role: 'tutor', content: reply, at: now },
            ],
            $slice: -THREAD_KEEP,
          },
        },
        $set: { updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );
  } catch (e) {
    console.error('[tutor] save thread failed:', e && e.message);
  }
}

async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!decoded) return sendError(req, res, 'UNAUTHORIZED', 'Please sign in to use the tutor');

  const action = req.query && req.query.action;
  const db = await connectToDatabase();

  // ── 对话历史（换设备也能接着看）──
  if (action === 'history') {
    const problemId = String((req.query && req.query.problemId) || '').trim();
    if (!problemId) return sendError(req, res, 'BAD_REQUEST', 'Missing problemId');
    const doc = await db.collection('tutor_threads').findOne(
      { username: decoded.username, problemId },
      { projection: { messages: 1, _id: 0 } }
    );
    return res.status(200).json({ success: true, messages: (doc && doc.messages) || [] });
  }

  // ── 前端用它决定要不要显示按钮 ──
  if (action === 'info' || req.method === 'GET') {
    const problemId = String((req.query && req.query.problemId) || '').trim();
    if (!problemId) return sendError(req, res, 'BAD_REQUEST', 'Missing problemId');
    const blocked = await isInActiveContest(db, decoded.username, problemId);

    // 顺带把「这道题对学生个人而言卡在哪」算出来，前端用来提示先讲什么。
    // 失败就当没有，不影响按钮是否显示。
    let hint = null;
    if (!blocked) {
      try {
        const vector = await db.collection('problem_vectors').findOne(
          { problemId }, { projection: { skills: 1, _id: 0 } }
        );
        const needed = (vector && Array.isArray(vector.skills)) ? vector.skills : [];
        const profile = await buildStudentProfile(db, decoded.username, { extraSkills: needed });
        if (!profile.empty) {
          const split = classifyForProblem(profile, needed);
          hint = {
            known: split.known.length,
            gap: split.gap.length,
            fresh: split.fresh.length,
            focus: split.gap[0] || split.fresh[0] || null,
          };
        }
      } catch (e) {
        console.error('[tutor] info profile failed:', e && e.message);
      }
    }

    return res.status(200).json({
      success: true,
      allowed: !blocked,
      reason: blocked ? 'contest' : null,
      hint,
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

  // 余额为 0 就别调模型了 —— 和批改一样，先看钱包再看算力
  const balance = await getTokenBalance(db, decoded.username);
  const available = (Number(balance.daily) || 0) + (Number(balance.global) || 0);
  if (available <= 0) {
    return res.status(402).json({
      success: false,
      code: 'INSUFFICIENT_TOKENS',
      message: 'Out of tokens. Answering a question costs tokens, same as AI grading.',
      tokens: { daily: balance.daily, global: balance.global },
    });
  }

  // 按用户计费，而不是按 IP —— 同一间电脑室共用出口 IP 也不会互相拖累
  if (!(await applyRateLimit(req, res, {
    name: 'tutor',
    key: 'u:' + decoded.username,
    max: RATE_PER_MIN,
    windowMs: 60_000,
    banMs: 60_000,
  }))) return;

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
    return res.status(429).json({ success: false, code: 'RATE_LIMITED', message: quota.message });
  }

  // 学生知识画像：练过没做对 → 缺口；做对过 → 已掌握。查不到就退化成原 prompt，
  // 不让画像查询失败拖垮一次正常的答疑。
  let profileText = '';
  let profileMeta = null;
  try {
    const vector = await db.collection('problem_vectors').findOne(
      { problemId }, { projection: { skills: 1, _id: 0 } }
    );
    const needed = (vector && Array.isArray(vector.skills)) ? vector.skills : [];
    const profile = await buildStudentProfile(db, decoded.username, { extraSkills: needed });
    const split = classifyForProblem(profile, needed);
    profileText = profileBlock(profile, split);
    profileMeta = {
      known: split.known.length,
      gap: split.gap.length,
      fresh: split.fresh.length,
      solvedCount: profile.solvedCount,
    };
  } catch (e) {
    console.error('[tutor] profile build failed:', e && e.message);
  }

  const prompt = buildTutorPrompt({ problem, history: body.history, question, profile: profileText });
  const effort = effortForDifficulty(problem.difficulty);

  try {
    const out = await askDeepSeekAPI(prompt, { effort, timeoutMs: 45_000 });
    const reply = String((out && out.content) || '').trim().slice(0, 4000);
    if (!reply) throw new Error('empty reply');

    // ── 计费：与批改同一套折算，高峰双倍 ──
    let charged = 0;
    let tokens = { daily: balance.daily, global: balance.global };
    try {
      const base = computeAiCharge((out && out.usage) || {});
      charged = Math.max(1, Math.round(base * billingMultiplier(new Date())));
      tokens = await consumeTokens(db, decoded.username, charged);
      addAiUsage(db, decoded.username, charged).catch(() => {});
      const spent = Number(out && out.usage && out.usage.total) || 0;
      if (spent > 0) addTokensUsed(db, spent).catch(() => {});
    } catch (e) {
      console.error('[tutor] billing failed:', e && e.message);
    }

    await saveThread(db, decoded.username, problemId, question, reply);

    return res.status(200).json({ success: true, reply, charged, tokens, profile: profileMeta });
  } catch (err) {
    console.error('[tutor] model failed:', err && err.message);
    return sendError(req, res, 'UPSTREAM', 'The tutor is busy right now, please try again', err);
  }
}

export default wrapHandler(handler, { gate: false });
