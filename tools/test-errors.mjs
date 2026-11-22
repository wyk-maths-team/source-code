// tools/test-errors.mjs
// lib/errors.js 的行为测试（不需要数据库，纯函数级）。
// 运行： node tools/test-errors.mjs

import { wrapHandler, sendError, requestId } from '../lib/errors.js';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

// ── 假 req/res ──
function mkReq(overrides = {}) {
  return { method: 'GET', url: '/api/test?x=1', headers: {}, query: {}, body: {}, ...overrides };
}
function mkRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    _body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this._body = b; this.headersSent = true; return this; },
    setHeader() {},
    end() { this.headersSent = true; }
  };
  return res;
}

console.log('\n=== 1. 未捕获异常应变成统一错误响应 ===');
{
  const h = wrapHandler(async () => { throw new Error('boom: db down'); });
  const req = mkReq(); const res = mkRes();
  await h(req, res);
  ok('状态码 500', res.statusCode === 500, res.statusCode);
  ok('success=false', res._body?.success === false);
  ok('有 code', res._body?.code === 'INTERNAL', res._body?.code);
  ok('有 message（中文兜底）', typeof res._body?.message === 'string' && res._body.message.length > 0);
  ok('无 token 时不返回 detail（防 F12 窥探）', res._body?.detail === undefined, res._body?.detail);
  ok('有 requestId', typeof res._body?.requestId === 'string' && res._body.requestId.length > 4);
  ok('堆栈默认不暴露', res._body?.stack === undefined);
}

console.log('\n=== 1b. detail 只对 admin / root 返回 ===');
{
  const SECRET = process.env.JWT_SECRET || (process.env.JWT_SECRET = 'test-secret-for-unit');
  const jwt = (await import('jsonwebtoken')).default;
  const mk = (role) => jwt.sign({ username: 'u', role }, SECRET, { expiresIn: '1h' });

  // 无 token
  {
    const h = wrapHandler(async () => { throw new Error('boom'); });
    const res = mkRes();
    await h(mkReq(), res);
    ok('无 token -> 不返回 detail', res._body.detail === undefined);
  }
  // 学生
  {
    const h = wrapHandler(async () => { throw new Error('boom'); });
    const res = mkRes();
    await h(mkReq({ headers: { authorization: 'Bearer ' + mk('student') } }), res);
    ok('student -> 不返回 detail', res._body.detail === undefined);
  }
  // admin
  {
    const h = wrapHandler(async () => { throw new Error('boom: secret host db1.internal'); });
    const res = mkRes();
    await h(mkReq({ headers: { authorization: 'Bearer ' + mk('admin') } }), res);
    ok('admin -> 返回 detail', String(res._body.detail || '').includes('boom'), res._body.detail);
  }
  // root
  {
    const h = wrapHandler(async () => { throw new Error('boom root'); });
    const res = mkRes();
    await h(mkReq({ headers: { authorization: 'Bearer ' + mk('root') } }), res);
    ok('root -> 返回 detail', String(res._body.detail || '').includes('boom'), res._body.detail);
  }
  // 伪造 token
  {
    const h = wrapHandler(async () => { throw new Error('boom'); });
    const res = mkRes();
    await h(mkReq({ headers: { authorization: 'Bearer not.a.token' } }), res);
    ok('伪造 token -> 不返回 detail', res._body.detail === undefined);
    ok('伪造 token 仍返回统一格式', res._body.success === false && !!res._body.code);
  }
}

console.log('\n=== 2. 旧的 {success:false} 响应自动补 code ===');
{
  const cases = [
    [400, { success: false, message: 'Missing id' }, 'BAD_REQUEST'],
    [401, { success: false, message: 'Unauthorized' }, 'UNAUTHORIZED'],
    [403, { success: false, message: 'Admin only' }, 'FORBIDDEN'],
    [404, { success: false, message: 'Problem not found' }, 'NOT_FOUND'],
    [429, { success: false, message: 'Too many submissions' }, 'RATE_LIMITED'],
    [500, { success: false, message: 'Internal server error' }, 'INTERNAL'],
  ];
  for (const [status, body, expect] of cases) {
    const h = wrapHandler(async (req, res) => { res.status(status).json(body); });
    const req = mkReq(); const res = mkRes();
    await h(req, res);
    ok(`HTTP ${status} -> ${expect}`, res._body.code === expect, res._body.code);
    ok(`  HTTP ${status} 保留原 message`, res._body.message === body.message);
    ok(`  HTTP ${status} 附带 requestId`, !!res._body.requestId);
  }
}

console.log('\n=== 3. 成功响应不应被污染 ===');
{
  const h = wrapHandler(async (req, res) => { res.status(200).json({ success: true, items: [1, 2, 3] }); });
  const req = mkReq(); const res = mkRes();
  await h(req, res);
  ok('success:true 原样返回', res._body.success === true && res._body.items.length === 3);
  ok('没有塞入 code', res._body.code === undefined);
  ok('没有塞入 requestId', res._body.requestId === undefined);
}

console.log('\n=== 4. RATE_LIMITED 之外：{error: string} 形态也能补 code ===');
{
  const h = wrapHandler(async (req, res) => { res.status(500).json({ error: 'CRON_SECRET not configured' }); });
  const req = mkReq(); const res = mkRes();
  await h(req, res);
  ok('配置缺失识别为 CONFIG', res._body.code === 'CONFIG', res._body.code);
  ok('原 error 字段保留', res._body.error === 'CRON_SECRET not configured');
}

console.log('\n=== 5. sendError 主动返回 ===');
{
  const req = mkReq(); const res = mkRes();
  sendError(req, res, 'BAD_REQUEST', '缺少 problemId', 'id=空');
  ok('状态码按码表', res.statusCode === 400);
  ok('带 code', res._body.code === 'BAD_REQUEST');
  ok('用传入的 message', res._body.message === '缺少 problemId');
  ok('带 detail', res._body.detail === 'id=空');
}
{
  const req = mkReq(); const res = mkRes();
  sendError(req, res, 'DB_ERROR');
  ok('省略 message 时用中文兜底', res._body.message === '数据库操作失败', res._body.message);
  ok('DB_ERROR 状态 500', res.statusCode === 500);
}

console.log('\n=== 6. 已发响应后再抛错不应崩溃 ===');
{
  const h = wrapHandler(async (req, res) => { res.status(200).json({ success: true }); throw new Error('late'); });
  const req = mkReq(); const res = mkRes();
  let threw = false;
  try { await h(req, res); } catch { threw = true; }
  ok('不向上抛异常', !threw);
  ok('原响应保持不变', res._body.success === true && res._body.code === undefined);
}

console.log('\n=== 7. requestId 复用请求头 ===');
{
  const req = mkReq({ headers: { 'x-request-id': 'abc123' } });
  ok('复用 x-request-id', requestId(req) === 'abc123', requestId(req));
  const req2 = mkReq();
  ok('没有头时自动生成', requestId(req2).length > 4);
  ok('两次生成不同', requestId(req2) !== requestId(req2));
}

console.log('\n=== 8. 非对象响应（数组）不被改写 ===');
{
  const h = wrapHandler(async (req, res) => { res.status(200).json([{ id: 1 }]); });
  const req = mkReq(); const res = mkRes();
  await h(req, res);
  ok('数组原样返回', Array.isArray(res._body) && res._body[0].id === 1);
}

console.log(`\n${'='.repeat(46)}`);
console.log(`  通过 ${pass} / 失败 ${fail}`);
console.log(`${'='.repeat(46)}\n`);
process.exit(fail === 0 ? 0 : 1);
