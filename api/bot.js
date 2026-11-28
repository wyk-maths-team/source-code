// api/bot.js
//
// 转发一次对话到 wykpybot（独立的 Vercel 项目，跑 Hugging Face 的 pyBot）。
//
//   POST /api/bot  { text }  ->  { success, reply, module, seconds }
//
// 为什么中间隔一层：
//   1. 浏览器不该拿到 PYBOT_TOKEN —— 那是服务间共享密钥
//   2. 只有登录的管理员能玩，用 OJ 自己的 JWT 判
//   3. pyBot 单轮要 20-30 秒（它不是模型，是 528 个模块逐个跑规则），
//      需要把超时和错误话术收在这里，而不是让前端干等
//
// 没有记忆：每次请求都是空 memory，pyBot 不记得上一句。

import { verifyToken } from '../lib/auth.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { applyRateLimit } from '../lib/rateLimit.js';

const TIMEOUT_MS = 70_000;

async function handler(req, res) {
  if (req.method !== 'POST') return sendError(req, res, 'BAD_REQUEST', 'Method not allowed');

  const user = await verifyToken(req);
  if (!user) return sendError(req, res, 'UNAUTHORIZED', 'Unauthorized');
  // if (!['admin', 'root'].includes(user.role)) return sendError(req, res, 'FORBIDDEN', 'Admin only');

  if (!(await applyRateLimit(req, res, { name: 'bot', key: 'u:' + user.username, max: 20, windowMs: 60_000, banMs: 60_000 }))) return;

  const base = process.env.PYBOT_URL;
  const token = process.env.PYBOT_TOKEN;
  if (!base || !token) {
    return sendError(req, res, 'NOT_CONFIGURED', 'PYBOT_URL / PYBOT_TOKEN are not set');
  }

  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const text = String(body.text || '').trim();
  if (!text) return sendError(req, res, 'BAD_REQUEST', 'Missing text');
  if (text.length > 2000) return sendError(req, res, 'BAD_REQUEST', 'Keep it under 2000 characters');

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(base.replace(/\/$/, '') + '/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return res.status(200).json({
      success: false,
      message: timedOut
        ? 'PyBot took longer than ' + Math.round(TIMEOUT_MS / 1000) + 's. It runs on a cold Vercel function and has to load half a million lines of Python first — try again, the next call is faster.'
        : 'Could not reach PyBot: ' + String((e && e.message) || e).slice(0, 120),
      elapsedMs: Date.now() - started,
    });
  }

  const raw = await upstream.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (e) { data = null; }

  if (!upstream.ok || !data) {
    return res.status(200).json({
      success: false,
      message: 'PyBot returned ' + upstream.status + ': ' + raw.slice(0, 200),
      elapsedMs: Date.now() - started,
    });
  }

  return res.status(200).json({
    success: !!data.success,
    reply: data.reply || '',
    module: data.module || '',
    seconds: data.seconds || 0,
    message: data.message || '',
    elapsedMs: Date.now() - started,
  });
}

export default wrapHandler(handler, { gate: false });
export const config = { maxDuration: 300 };
