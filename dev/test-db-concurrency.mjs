// dev/test-db-concurrency.mjs
//
// e2e 并发压测：验证「100 个用户同时用」时连接池不失控。
//
//   node dev/test-db-concurrency.mjs
//   node dev/test-db-concurrency.mjs --base http://127.0.0.1:3000
//
// 默认自己拉起 tools/serve.mjs（真实 API + 真实 MongoDB），跑完再关掉。
//
// 三个阶段：
//   A. 冷启动竞态 —— server 刚起来、池还没建立，立刻并发打 50 个请求。
//      旧代码在这里会 new 出几十个 MongoClient（每个 10 条连接），
//      新代码必须 clientsCreated === 1。
//   B. 满载 —— 100 并发持续打混合端点，看延迟分布与 5xx。
//   C. 背压 —— 并发推到闸门之上，确认它给出可预期的 503 而不是雪崩。
//
// 判定失败会以非 0 退出，可以直接挂 CI。

import { spawn } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';

// 让 `node dev/test-db-concurrency.mjs` 直接能跑，不必记 --env-file
dotenv.config({ path: ['.env.local', '.env'], override: false });

const args = process.argv.slice(2);
const baseArgIdx = args.indexOf('--base');
const EXTERNAL_BASE = baseArgIdx !== -1 ? args[baseArgIdx + 1] : process.env.TEST_BASE_URL || null;
const PORT = Number(process.env.TEST_PORT || 3124);
const BASE = EXTERNAL_BASE || `http://127.0.0.1:${PORT}`;

const CONCURRENCY = Number(process.env.TEST_CONCURRENCY || 100);
const ROUNDS = Number(process.env.TEST_ROUNDS || 4);

// 只打 GET：压测不该写入任何数据。
// 需要登录的端点用临时签发的只读 token（见 bootstrapTokens）。
const ENDPOINTS = [
  '/api/updates',                    // 有进程内缓存的轻端点
  '/api/db-health',                  // 完全不碰库
  '/api/stats',                      // 公开，最近 AC
  '/api/submissions?limit=20',       // 重：投影 + 排序，真正压 DB
  '/api/messages',                   // 按 username 查
];

let TOKENS = [];

const failures = [];
function fail(msg) { failures.push(msg); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════ 服务器生命周期 ═══════════════

let serverProc = null;

async function waitForServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(BASE + '/api/db-health', { signal: AbortSignal.timeout(4000) });
      if (r.ok) return true;
    } catch { /* 还没起 */ }
    await sleep(400);
  }
  return false;
}

async function startServer() {
  if (EXTERNAL_BASE) {
    console.log(`[setup] 使用外部服务 ${BASE}`);
    return;
  }
  console.log(`[setup] 启动本地服务 :${PORT} …`);
  serverProc = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], {
    cwd: process.cwd(),
    // SERVE_NO_RELOAD=1：缓存 API 模块，行为接近 Vercel。
    // 默认的热重载是每请求重新 import，压测会把编译时间算进延迟里。
    env: { ...process.env, SERVE_NO_RELOAD: '1' },
    stdio: 'ignore',          // 不捕获输出：Windows 上管道受限，也不需要
  });
  serverProc.on('error', e => console.error('[setup] spawn failed:', e.message));
}

function stopServer() {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill(); } catch { /* 已退出 */ }
  }
}

// ═══════════════ 工具 ═══════════════

/**
 * 给需要登录的端点准备只读 token。
 * 用真实存在的普通学生账号签，但不写入任何东西 —— 全程 GET。
 * 拿不到账号就退回「只打公开端点」，压测仍然有效，只是覆盖面小一点。
 */
async function bootstrapTokens(count = 10) {
  const uri = process.env.MONGODB_URI;
  if (!uri || !process.env.JWT_SECRET) {
    console.log('[tokens] 缺少 MONGODB_URI / JWT_SECRET，只压公开端点');
    return;
  }
  // 本地到 Atlas 的握手可能十几秒，给足时间，否则压测还没开始就先超时了
  const client = new MongoClient(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 30_000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'wyk_math');
    const users = await db.collection('users')
      .find({ banned: { $ne: true }, role: { $nin: ['admin', 'root'] } },
            { projection: { username: 1, role: 1, tokenVersion: 1 } })
      .limit(count).toArray();
    TOKENS = users.map(u => jwt.sign(
      { username: u.username, role: u.role || 'student', tv: Number(u.tokenVersion) || 0 },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    ));
    console.log(`[tokens] 用 ${TOKENS.length} 个学生账号签发只读 token`);
  } catch (e) {
    console.log('[tokens] 取账号失败，只压公开端点:', e.message);
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
}

async function getJSON(pathname) {
  const r = await fetch(BASE + pathname, { signal: AbortSignal.timeout(10_000) });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200), status: r.status }; }
}

/** 反复探一个真正查库的端点，直到连接建立完成 */
async function waitWarm(timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(BASE + '/api/stats', { signal: AbortSignal.timeout(6000) });
      await r.arrayBuffer();
      if (r.ok) return true;
    } catch { /* 还在建连 */ }
    await sleep(1000);
  }
  return false;
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function summarize(results) {
  const ms = results.map(r => r.ms).sort((a, b) => a - b);
  const byStatus = {};
  for (const r of results) byStatus[r.status || 'ERR'] = (byStatus[r.status || 'ERR'] || 0) + 1;
  const errors = results.filter(r => r.err);
  return {
    n: results.length,
    p50: +pct(ms, 50).toFixed(1),
    p90: +pct(ms, 90).toFixed(1),
    p95: +pct(ms, 95).toFixed(1),
    p99: +pct(ms, 99).toFixed(1),
    max: +(ms[ms.length - 1] || 0).toFixed(1),
    byStatus,
    errors: errors.slice(0, 3).map(e => `${e.ep} ${e.status || ''} ${e.err}`),
    errorCount: errors.length,
  };
}

/** 固定并发度跑 total 次请求，轮转端点 */
async function load({ concurrency, total, label }) {
  const results = [];
  const endpoints = TOKENS.length
    ? ENDPOINTS
    : ENDPOINTS.filter(e => !/\/(submissions|messages)/.test(e));
  let seq = 0;

  async function worker(w) {
    for (;;) {
      const i = seq++;
      if (i >= total) return;
      const ep = endpoints[i % endpoints.length];
      const token = TOKENS.length ? TOKENS[i % TOKENS.length] : null;
      // 每个虚拟用户一个独立 IP：本地全走 127.0.0.1 会撞上 rateLimit 的 30 次/秒，
      // 那样量到的是限流器，不是连接池。
      const ip = `10.${(w >> 8) & 255}.${w & 255}.${(i % 250) + 1}`;
      const headers = { 'x-load-test': label, 'x-forwarded-for': ip };
      if (token) headers.authorization = 'Bearer ' + token;

      const t0 = performance.now();
      let status = 0, err = null, retryAfter = null;
      try {
        const r = await fetch(BASE + ep, { signal: AbortSignal.timeout(30_000), headers });
        status = r.status;
        retryAfter = r.headers.get('retry-after');
        await r.arrayBuffer();        // 读完 body，才算真正结束
        if (r.status >= 500) err = `HTTP ${r.status}`;
      } catch (e) {
        err = e.message;
      }
      results.push({ ms: performance.now() - t0, status, err, ep, retryAfter });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, w) => worker(w + 1)));
  return results;
}

// ═══════════════ 主流程 ═══════════════

async function main() {
  const t0 = Date.now();
  await startServer();

  if (!(await waitForServer())) {
    console.error('[setup] 服务没有就绪，放弃');
    stopServer();
    process.exit(1);
  }
  console.log(`[setup] 就绪，用时 ${Date.now() - t0}ms\n`);

  await bootstrapTokens(10);

  const health0 = await getJSON('/api/db-health');
  console.log('[health:before]', JSON.stringify({
    clientsCreated: health0.clientsCreated,
    pool: health0.pool,
    gate: health0.gate,
  }));

  // ── 阶段 A：冷启动竞态 ──
  // 关键在「第一批请求几乎同时到达」。旧实现在这里会每个请求各建一个 client。
  // 新实现里，第一个请求负责建连，其余的在宽限期后快速 503 + Retry-After，
  // 而不是一起排队等一个可能十几秒的握手。
  console.log('\n═══ A. 冷启动竞态：50 个请求同时涌入空的连接池 ═══');
  const coldStart = await load({ concurrency: 50, total: 50, label: 'cold' });
  const a = summarize(coldStart);
  console.log('  ', JSON.stringify(a));
  const healthA = await getJSON('/api/db-health');
  console.log('   health.clientsCreated =', healthA.clientsCreated);

  if (healthA.clientsCreated > 1) {
    fail(`冷启动竞态：clientsCreated=${healthA.clientsCreated}，应当恰好为 1（并发去重失效）`);
  }

  // 冷启动允许「背压式 503」——那是有意的快速失败，不是故障。
  // 但它必须是干净的：只有 503、必须带 Retry-After，绝不能是 500 或超时。
  const hardFail = coldStart.filter(r => r.status === 0 || [500, 502, 504].includes(r.status));
  if (hardFail.length) {
    fail(`冷启动出现 ${hardFail.length} 个硬故障（500/502/504/网络错误）：${hardFail.slice(0, 3).map(r => `${r.ep} ${r.status} ${r.err || ''}`).join(' | ')}`);
  }
  const softFail = coldStart.filter(r => r.status === 503);
  const noRetryAfter = softFail.filter(r => !r.retryAfter);
  if (noRetryAfter.length) {
    fail(`${noRetryAfter.length} 个 503 没有 Retry-After 头，客户端无法知道该等多久`);
  }
  console.log(`   背压: ${softFail.length}/${coldStart.length} 个 503（均带 Retry-After），${a.byStatus[200] || 0} 个 200`);

  // ── 阶段 A2：连接就绪后重试，必须全部成功 ──
  console.log('\n═══ A2. 等连接就绪，重试这 50 个请求 ═══');
  const warmed = await waitWarm(90_000);
  if (!warmed) {
    fail('连接在 90 秒内没有就绪');
  } else {
    const retry = await load({ concurrency: 50, total: 50, label: 'cold-retry' });
    const ar = summarize(retry);
    console.log('   ', JSON.stringify(ar));
    if ((ar.byStatus[200] || 0) !== ar.n) {
      fail(`连接就绪后重试仍有失败：${JSON.stringify(ar.byStatus)}`);
    }
  }

  // ── 阶段 B：100 并发满载 ──
  console.log(`\n═══ B. 满载：${CONCURRENCY} 并发 × ${ROUNDS} 轮 ═══`);
  const batch = [];
  for (let r = 0; r < ROUNDS; r++) {
    const res = await load({ concurrency: CONCURRENCY, total: CONCURRENCY, label: `round${r}` });
    const s = summarize(res);
    console.log(`   round ${r + 1}: p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms 5xx=${(s.byStatus[500] || 0) + (s.byStatus[502] || 0) + (s.byStatus[503] || 0)}`);
    batch.push(...res);
  }
  const b = summarize(batch);
  console.log('   total:', JSON.stringify(b));

  const fiveXX = (b.byStatus[500] || 0) + (b.byStatus[502] || 0) + (b.byStatus[503] || 0) + (b.byStatus[504] || 0);
  if (fiveXX > 0) fail(`满载阶段出现 ${fiveXX} 个 5xx 响应：${JSON.stringify(b.byStatus)}`);
  if (b.errorCount > 0) fail(`满载阶段网络错误 ${b.errorCount} 个：${b.errors.join(' | ')}`);

  const healthB = await getJSON('/api/db-health');
  console.log('   health:', JSON.stringify({
    clientsCreated: healthB.clientsCreated,
    gatePeak: healthB.gate && healthB.gate.peak,
    gateRejected: healthB.gate && healthB.gate.rejected,
    connectFailures: healthB.connectFailures,
    retries: healthB.retries,
  }));

  if (healthB.clientsCreated > 1) {
    fail(`满载后 clientsCreated=${healthB.clientsCreated}，连接被建了不止一次`);
  }
  if (healthB.connectFailures > 0) {
    fail(`满载后 connectFailures=${healthB.connectFailures}`);
  }
  // 每实例连接数不得超过池上限 + 握手中的连接
  const worst = (healthB.pool && healthB.pool.worstCaseConnections) || 0;
  const driverTotal = Array.isArray(healthB.driver)
    ? healthB.driver.reduce((n, d) => n + (d.total || 0), 0)
    : null;
  if (driverTotal !== null) {
    console.log(`   驱动实际连接数 = ${driverTotal}（上限 ${worst}）`);
    if (driverTotal > worst) fail(`驱动连接数 ${driverTotal} 超过池上限 ${worst}`);
  }

  // ── 阶段 C：背压 ──
  // 并发推到闸门之上：允许 503，但必须是干净的 503（有 Retry-After），
  // 不能是 500、不能是超时、更不能把进程拖死。
  console.log(`\n═══ C. 背压：${CONCURRENCY * 2} 并发灌入 ═══`);
  const c = summarize(await load({ concurrency: CONCURRENCY * 2, total: CONCURRENCY * 2, label: 'burst' }));
  console.log('   ', JSON.stringify(c));

  const c500 = (c.byStatus[500] || 0) + (c.byStatus[502] || 0) + (c.byStatus[504] || 0);
  if (c500 > 0) fail(`背压阶段出现 ${c500} 个非预期 5xx：${JSON.stringify(c.byStatus)}`);

  const healthC = await getJSON('/api/db-health');
  console.log('   health:', JSON.stringify({
    clientsCreated: healthC.clientsCreated,
    gate: healthC.gate,
    warnings: healthC.warnings,
  }));
  if (healthC.clientsCreated > 1) {
    fail(`背压后 clientsCreated=${healthC.clientsCreated}`);
  }

  const gateMax = (healthC.pool && healthC.pool.maxInflight) || Infinity;
  if (healthC.gate && healthC.gate.peak > gateMax) {
    fail(`闸门峰值 ${healthC.gate.peak} 超过上限 ${gateMax}`);
  }

  // ── 报告 ──
  console.log('\n══════════ 结果 ══════════');
  const all = [...coldStart, ...batch];
  const overall = summarize(all);
  console.log('请求总数 :', overall.n);
  console.log('状态码   :', JSON.stringify(overall.byStatus));
  console.log(`延迟     : p50=${overall.p50}ms p95=${overall.p95}ms p99=${overall.p99}ms max=${overall.max}ms`);
  console.log('每个实例 : clientsCreated =', healthC.clientsCreated, '(必须为 1)');
  console.log('连接上限 : maxPoolSize =', healthC.pool && healthC.pool.maxPoolSize,
              '+ maxConnecting =', healthC.pool && healthC.pool.maxConnecting,
              `= ${worst}`);

  // 100 个用户 → 需要多少实例？按每实例最坏连接数反推 Atlas 的连接预算
  const budget500 = Math.floor(500 / (worst || 1));
  console.log(`\nAtlas 预算: 500 连接 / 每实例 ${worst} = ${budget500} 个实例可同时存活`);
  if (budget500 < 10) {
    fail(`每实例连接过多：${worst} 条，超过 500 连接预算下 10 个实例的容量`);
  }

  if (failures.length) {
    console.error('\n❌ 失败项:');
    for (const f of failures) console.error('   -', f);
    stopServer();
    process.exit(1);
  }

  console.log('\n✅ 全部通过');
  stopServer();
  process.exit(0);
}

process.on('SIGINT', () => { stopServer(); process.exit(130); });

main().catch(err => {
  console.error('测试本身崩了:', err);
  stopServer();
  process.exit(1);
});
