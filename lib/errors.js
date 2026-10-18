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
//   4. detail（真实错误消息）与 stack 只给诊断用，可由 API_DEBUG=1 打开。

// ═══════════════ 错误码表 ═══════════════
// 每个码固定一个 HTTP 状态，避免同一个错误不同接口返回不同状态。
export const ERR = {
  BAD_REQUEST:  { status: 400, zh: '请求参数有误' },
  UNAUTHORIZED: { status: 401, zh: '未登录或登录已过期' },
  FORBIDDEN:    { status: 403, zh: '没有权限执行此操作' },
  NOT_FOUND:    { status: 404, zh: '请求的资源不存在' },
  CONFLICT:     { status: 409, zh: '数据冲突，请刷新后重试' },
  RATE_LIMITED: { status: 429, zh: '操作太频繁，请稍后再试' },
  CONFIG:       { status: 500, zh: '服务端缺少必要的配置' },
  DB_ERROR:     { status: 500, zh: '数据库操作失败' },
  GRADE_ERROR:  { status: 500, zh: '评分服务异常' },
  INTERNAL:     { status: 500, zh: '服务器内部错误' },
  UPSTREAM:     { status: 502, zh: '上游服务无响应' },
  TIMEOUT:      { status: 504, zh: '请求超时' },
};

const DEBUG = String(process.env.API_DEBUG || '') === '1';

// ═══════════════ 工具 ═══════════════

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
  if (status === 502 || status === 503) return 'UPSTREAM';
  if (status === 504) return 'TIMEOUT';
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
    detail: errText(err).slice(0, 800),
  };
  if (DEBUG && err && err.stack) {
    body.stack = String(err.stack).slice(0, 1500);
  }
  return res.status((ERR[code] || ERR.INTERNAL).status).json(body);
}

// ═══════════════ 包装器 ═══════════════

/**
 * 包装 API handler：
 *   - 捕获所有未处理的异常，转成统一错误响应
 *   - 劫持 res.json，为所有失败响应自动补上 code / requestId
 *
 * 用法（每个 api 文件只改 3 行）：
 *   import { wrapHandler } from '../lib/errors.js';
 *   async function handler(req, res) { ... }        // 去掉原来的 export default
 *   export default wrapHandler(handler);
 */
export function wrapHandler(fn) {
  return async function wrapped(req, res) {
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
        return undefined;
      }
      return sendCatch(req, res, err, inferCode(500, { message: errText(err) }));
    } finally {
      // 恢复，避免影响同实例复用的对象（Vercel 每个请求独立，但保持干净）
      if (patched) res.json = originalJson;
    }
  };
}

/** 快捷：把 handler 里常见的 console.error + 500 合并成一行 */
export function fail(req, res, err, code) {
  return sendCatch(req, res, err, code);
}
