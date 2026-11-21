// lib/errors.js
//
// 统一的 API 错误处理与响应格式。
//
// 目标：任何一个 API 出错时，前端都能拿到「为什么错、错在哪、怎么复现」。
//
// 设计要点：
//   1. wrapHandler() 兜底所有未捕获异常 —— 每个 API 只改 3 行就能接入。
//   2. 包装器劫持 res.json，给所有 { success: false } 响应自动补 code / requestId，
//      因此**不需要逐个改写已有的 res.status(400).json(...) 调用**。
//   3. 响应仍然保留 message 字段，老前端不用改就能继续工作（向后兼容）。
//   4. detail（真实错误消息）只返回给 admin/root，其余人只看到 message——
//      必须在服务端拦截，前端隐藏无意义（F12 能看到响应体）。
//   5. stack 需 API_DEBUG=1。

import jwt from 'jsonwebtoken';
import { acquireSlot, releaseSlot, warmupState, getClient } from './mongo.js';

// ═══════════════ 错误码表 ═══════════════
// 每个码固定一个 HTTP 状态，避免同一个错误不同接口返回不同状态。
export const ERR = {
  BAD_REQUEST:  { status: 400, zh: '请求参数有误' },
  UNAUTHORIZED: { status: 401, zh: '未登录或登录已过期' },
  FORBIDDEN:    { status: 403, zh: '没有权限执行此操作' },
  NOT_FOUND:    { status: 404, zh: '请求的资源不存在' },
  CONFLICT:     { status: 409, zh: '数据冲突，请刷新后重试' },
  RATE_LIMITED: { status: 429, zh: '操作太频繁，请稍后再试' },
  BUSY:         { status: 503, zh: '服务器繁忙，请稍后重试' },
  CONFIG:       { status: 500, zh: '服务端缺少必要的配置' },
  DB_ERROR:     { status: 500, zh: '数据库操作失败' },
  GRADE_ERROR:  { status: 500, zh: '评分服务异常' },
  INTERNAL:     { status: 500, zh: '服务器内部错误' },
  UPSTREAM:     { status: 502, zh: '上游服务无响应' },
  TIMEOUT:      { status: 504, zh: '请求超时' },
};

const DEBUG = String(process.env.API_DEBUG || '') === '1';

// ═══════════════ 工具 ═══════════════

/**
 * 判断请求者是否为管理员（admin / root）。
 *
 * 只解析 JWT 里的 role，不查库——这里的目的不是鉴权（各接口自己会鉴权），
 * 而是决定「要不要把真实错误消息返回给客户端」。
 * 恶意用户最多伪造出更完整的错误提示，拿不到任何额外权限。
 */
function isPrivileged(req) {
  try {
    const raw = (req && req.headers && req.headers.authorization) || '';
    const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
    if (!token || !process.env.JWT_SECRET) return false;
    const d = jwt.verify(token, process.env.JWT_SECRET);
    return d && (d.role === 'admin' || d.role === 'root');
  } catch {
    return false;
  }
}

/** 生成或复用请求 ID，方便在日志里串联一次请求 */
export function requestId(req) {
  const h = req && req.headers && (req.headers['x-request-id'] || req.headers['x-vercel-id']);
  if (h) return String(h).slice(0, 40);
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 由 HTTP 状态码推断错误码（用于给旧代码的响应补 code） */
function inferCode(status, body) {
  // 配置缺失类，虽然状态是 500，但语义是部署问题，单独标出来
  const text = (body && (body.error || body.message)) || '';
  if (typeof text === 'string' && /not configured|is not defined|missing.*(env|secret)/i.test(text)) {
    return 'CONFIG';
  }
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 500) return 'INTERNAL';
  if (status === 502) return 'UPSTREAM';
  if (status === 503) return 'BUSY';  if (status === 504) return 'TIMEOUT';
  return status >= 500 ? 'INTERNAL' : 'BAD_REQUEST';
}

/** 把任意错误对象转成可展示的字符串 */
function errText(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  return String(err.message || err);
}

// ═══════════════ 主动返回错误 ═══════════════

/**
 * 统一发送错误响应。
 * @param {object} req
 * @param {object} res
 * @param {string} code    ERR 里的键，例如 'BAD_REQUEST'
 * @param {string} [message] 面向用户的说明；省略时用码表里的中文
 * @param {*}      [detail]  真实错误详情（仅用于诊断）
 */
export function sendError(req, res, code, message, detail) {
  const def = ERR[code] || ERR.INTERNAL;
  const body = {
    success: false,
    message: message || def.zh,
    code,
    requestId: requestId(req),
  };
  if (detail !== undefined && detail !== null && detail !== '') {
    body.detail = errText(detail).slice(0, 800);
  }
  if (DEBUG) {
    body.at = new URL(req.url || '/', 'http://x').pathname;
  }
  try {
    return res.status(def.status).json(body);
  } catch (e) {
    // 极端情况：响应已发出
    console.error('[errors] failed to send error response:', e);
    return undefined;
  }
}

/** catch 块专用：打印完整堆栈，返回脱敏后的错误 */
export function sendCatch(req, res, err, code = 'INTERNAL', message) {
  const tag = `[api:${requestId(req)}]`;
  console.error(`${tag} ${code}:`, err);
  if (res.headersSent) return undefined;

  const body = {
    success: false,
    message: message || (ERR[code] || ERR.INTERNAL).zh,
    code,
    requestId: requestId(req),
  };
  // 真实错误消息可能包含数据库主机名、内部路径等，只给 admin/root 看。
  // 注意：必须在这里（服务端）拦截——前端隐藏没有意义，F12 的 Network 面板照样能看到响应体。
  if (isPrivileged(req)) {
    body.detail = errText(err).slice(0, 800);
    if (DEBUG && err && err.stack) body.stack = String(err.stack).slice(0, 1500);
  }
  return res.status((ERR[code] || ERR.INTERNAL).status).json(body);
}

// ═══════════════ 包装器 ═══════════════

/**
 * 包装 API handler：
 *   - 捕获所有未处理的异常，转成统一错误响应
 *   - 劫持 res.json，为所有失败响应自动补上 code / requestId
 *   - 每实例并发闸门：同时进 DB 的请求数有上限，超出的排队或拿 503
 *
 * 用法（每个 api 文件只改 3 行）：
 *   import { wrapHandler } from '../lib/errors.js';
 *   async function handler(req, res) { ... }        // 去掉原来的 export default
 *   export default wrapHandler(handler);
 *
 * 闸门为什么放在这里：40 多个 API 全部经过 wrapHandler，一处改动即可覆盖，
 * 不必逐个文件改。池上限（lib/mongo.js）是硬约束，闸门是它前面的背压 ——
 * 没有背压时 1000 个请求会一起挤进驱动的等待队列，队列满才报错。
 *
 * 退出闸门的方式：wrapHandler(fn, { gate: false })。
 * 长耗时的 AI 端点要这样关掉，否则它们会占着槽位把所有人饿死。
 */
const MAX_HOLD_MS = (() => {
  const n = Number.parseInt(String(process.env.MONGODB_GATE_MAX_HOLD_MS ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 25_000;
})();

export function wrapHandler(fn, opts = {}) {
  // gate 可以是 false，也可以是一个 (req) => boolean 的判断函数。
  // 后者用于同一个文件里「普通查询要排队、AI 重判不该排队」这类情况。
  const gatePolicy = opts.gate;
  const shouldGate = typeof gatePolicy === 'function'
    ? gatePolicy
    : (gatePolicy === false ? () => false : () => true);

  return async function wrapped(req, res) {
    // ── 并发闸门 ──
    let slotHeld = false;
    let holdTimer = null;

    const release = () => {
      if (!slotHeld) return;
      slotHeld = false;
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      releaseSlot();
    };

    if (shouldGate(req)) {
      const state = warmupState();

      // 冷启动已经拖太久：不占槽位，直接告诉客户端「过两秒再来」。
      // 让 50 个请求排队等一个 10 秒的连接，比快速失败糟糕得多。
      if (state === 'expired') {
        res.setHeader('Retry-After', '2');
        return sendError(req, res, 'BUSY', 'Service is warming up, please retry in a moment');
      }

      // 连接还没好就在这里等，而不是把 DB_BUSY 漏进 handler ——
      // 很多 handler 有自己的 try/catch 会把它变成 500，用户就失去了
      // 「过两秒重试」这条信息。等在这里只花时间，不占闸门槽位。
      //
      // 只在 genuinely 'warming'（别人正在建连）时等待。
      // 'cold' 说明还没有人开始建 —— 这时不能主动去连，否则任何不碰数据库的
      // 调用（以及单测里的 mock）都会被迫触发一次握手。
      if (state === 'warming') {
        try {
          await getClient();
        } catch (err) {
          res.setHeader('Retry-After', '2');
          const isBusy = err && err.code === 'DB_BUSY';
          const isConfig = /not defined|missing/i.test(String((err && err.message) || ''));
          return sendError(
            req, res,
            isConfig ? 'CONFIG' : 'BUSY',
            isBusy ? 'Service is warming up, please retry in a moment' : 'Database is unavailable, please retry',
            err
          );
        }
      }

      try {
        await acquireSlot();
        slotHeld = true;
      } catch (err) {
        if (err && err.code === 'DB_BUSY') {
          res.setHeader('Retry-After', '2');
          return sendError(req, res, 'BUSY', 'Server is busy, please retry in a moment');
        }
        throw err;
      }

      // 兜底：万一某个 handler 卡在外部服务上，别让它永久占着槽位。
      holdTimer = setTimeout(() => {
        console.warn(`[gate] slot held > ${MAX_HOLD_MS}ms, force-releasing ${req.method} ${req.url}`);
        release();
      }, MAX_HOLD_MS);
      if (typeof holdTimer.unref === 'function') holdTimer.unref();
    }

    // ── 给响应补 code / requestId ──
    const originalJson = res.json.bind(res);
    let patched = false;
    res.json = function (body) {
      patched = true;
      // 两种情况都要补：显式的 { success:false }，以及任何 4xx/5xx 的响应体
      // （有些老接口只返回 { error: '...' }，没有 success 字段）
      if (body && typeof body === 'object' && !Array.isArray(body)
          && !body.code
          && (body.success === false || res.statusCode >= 400)) {
        body.code = inferCode(res.statusCode, body);
        if (!body.requestId) body.requestId = requestId(req);
      }
      return originalJson(body);
    };

    try {
      return await fn(req, res);
    } catch (err) {
      if (res.headersSent) {
        console.error(`[api:${requestId(req)}] error after headers sent:`, err);
        // 已经开流（SSE）时不能只记日志就返回：连接会一直挂着，
        // 客户端要等到平台把函数掐掉才会断。这里主动收尾。
        try {
          const ctype = String(res.getHeader && res.getHeader('content-type') || '');
          if (ctype.includes('text/event-stream') && !res.writableEnded) {
            res.write(`event: error\ndata: ${JSON.stringify({ message: 'Internal error during streaming' })}\n\n`);
            res.end();
          }
        } catch { /* 已经断了 */ }
        return undefined;
      }
      // 冷启动 / 池繁忙：这是可重试的背压，不是 500。
      if (err && err.code === 'DB_BUSY') {
        res.setHeader('Retry-After', '2');
        return sendError(req, res, 'BUSY', 'Server is busy, please retry in a moment', err);
      }
      return sendCatch(req, res, err, inferCode(500, { message: errText(err) }));
    } finally {
      release();
      // 恢复，避免影响同实例复用的对象（Vercel 每个请求独立，但保持干净）
      if (patched) res.json = originalJson;
    }
  };
}

/** 快捷：把 handler 里常见的 console.error + 500 合并成一行 */
export function fail(req, res, err, code) {
  return sendCatch(req, res, err, code);
}
