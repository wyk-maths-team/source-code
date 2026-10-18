// api/ex-grade.js
// AI 批改代理 —— 把用戶答案轉發到 Cloudflare Tunnel 上的 FastAPI
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
const UPSTREAM_URL =
  process.env.EX_GRADE_UPSTREAM ||
  'https://laser-nextel-numerous-deborah.trycloudflare.com/grade';

const MAX_ANSWER_LEN   = 200;
const UPSTREAM_TIMEOUT = 300_000;        // 30 秒
const VALID_PATTERN    = /^CSB-(0[1-9]|1[0-9]|2[01])$/;

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = await verifyToken(req);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { question_id, answer } = req.body || {};

  if (!question_id || typeof question_id !== 'string') {
    return res.status(400).json({ error: 'Missing question_id' });
  }
  if (!VALID_PATTERN.test(question_id)) {
    return res.status(400).json({ error: 'Invalid question id' });
  }
  if (!answer || typeof answer !== 'string') {
    return res.status(400).json({ error: 'Missing answer' });
  }

  const trimmed = answer.trim();
  if (!trimmed) {
    return res.status(400).json({ error: 'Answer is empty' });
  }
  if (trimmed.length > MAX_ANSWER_LEN) {
    return res.status(400).json({
      error: `Answer too long (${trimmed.length}/${MAX_ANSWER_LEN})`,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT);

  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id, answer: trimmed }),
      signal: controller.signal,
    });

    const text = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: 'Upstream error',
        status: upstream.status,
        detail: text.slice(0, 500),
      });
    }

    // 上游可能回 JSON，也可能回純文字
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return res.status(200).json(data);

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream timeout' });
    }
    console.error('[ex-grade] fetch failed:', err);
    return res.status(500).json({
      error: 'Failed to reach upstream',
      message: err.message,
    });
  } finally {
    clearTimeout(timer);
  }
} 

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);