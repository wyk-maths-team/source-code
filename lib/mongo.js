// lib/mongo.js
//
// 全站唯一的 MongoDB 连接工厂。
//
// 为什么要有这个文件（而不是继续在每个 api 里 new MongoClient）：
//
//   1. **连接去重**。旧版 connectToDatabase() 是
//        if (db) return db;  const c = new MongoClient(...);  await c.connect();
//      单线程里 await 会让出，于是同一实例上并发的 N 个首请求都看到 db === null，
//      各自造一个池。Vercel 冷启动 + 瞬时并发时，一个实例就能开十个池，
//      叠上多实例很容易顶穿 Atlas 免费层的 500 连接上限。
//      这里用 _connecting 这个 in-flight promise 把它压成「永远只有一个」。
//
//   2. **一个 client 服务所有库**。旧代码 wyk_math 一个池、chris 又开一个池，
//      同一个 URI 握手两次，配额算两遍。client.db(name) 本来就能切库。
//
//   3. **池参数按 serverless 调**。minPoolSize=0（实例冻结后不该占着连接）、
//      maxIdleTimeMS 主动归还、maxConnecting 限制握手洪峰、waitQueueTimeoutMS
//      让排队有上限而不是无限等待。
//
//   4. **每实例并发闸门**。池再小，请求也可以无限制地挤进驱动的等待队列。
//      闸门把「同时进 DB 的请求数」钉死，多出来的在应用层排队，超时快速失败。
//
//   5. **可观测**。metrics() 暴露连接尝试、池错误、闸门峰值，e2e 靠它断言。

import { MongoClient } from 'mongodb';

// ═══════════════ 配置 ═══════════════
// 全部可用环境变量覆盖：不必改代码就能按 Atlas 套餐调整。
// 默认值针对 Vercel serverless + Atlas 免费/共享层。

function intEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const POOL_LIMITS = {
  get maxPoolSize()       { return intEnv('MONGODB_MAX_POOL', 5, 1, 100); },
  get minPoolSize()       { return intEnv('MONGODB_MIN_POOL', 0, 0, 50); },
  get maxConnecting()     { return intEnv('MONGODB_MAX_CONNECTING', 2, 1, 20); },
  get maxIdleTimeMS()     { return intEnv('MONGODB_MAX_IDLE_MS', 30_000, 1_000, 600_000); },
  get waitQueueTimeoutMS(){ return intEnv('MONGODB_WAIT_QUEUE_MS', 8_000, 100, 120_000); },
  get serverSelectionMS() { return intEnv('MONGODB_SERVER_SELECTION_MS', 8_000, 500, 60_000); },
  get socketTimeoutMS()   { return intEnv('MONGODB_SOCKET_TIMEOUT_MS', 30_000, 1_000, 300_000); },
  get connectTimeoutMS()  { return intEnv('MONGODB_CONNECT_TIMEOUT_MS', 10_000, 500, 60_000); },
  get maxInflight()       { return intEnv('MONGODB_MAX_INFLIGHT', 16, 1, 1_000); },
  get gateTimeoutMS()     { return intEnv('MONGODB_GATE_TIMEOUT_MS', 10_000, 100, 120_000); },
  get connectRetries()    { return intEnv('MONGODB_CONNECT_RETRIES', 2, 0, 5); },
  // 冷启动时「不是第一个」的请求最多等连接多久。
  // 超过就立刻 503 + Retry-After，而不是陪着排队 —— 排队 10 秒再报错
  // 对用户和网关都是最坏的结果。
  get connectGraceMS()    { return intEnv('MONGODB_CONNECT_GRACE_MS', 4_000, 0, 60_000); },
};

/** 摘要，日志/健康检查里直接打印 */
export function poolSummary() {
  return {
    maxPoolSize: POOL_LIMITS.maxPoolSize,
    minPoolSize: POOL_LIMITS.minPoolSize,
    maxConnecting: POOL_LIMITS.maxConnecting,
    maxIdleTimeMS: POOL_LIMITS.maxIdleTimeMS,
    waitQueueTimeoutMS: POOL_LIMITS.waitQueueTimeoutMS,
    maxInflight: POOL_LIMITS.maxInflight,
    // 单实例最坏情况下的连接占用：池上限 + 握手中的连接
    worstCaseConnections: POOL_LIMITS.maxPoolSize + POOL_LIMITS.maxConnecting,
  };
}

function clientOptions() {
  return {
    maxPoolSize: POOL_LIMITS.maxPoolSize,
    minPoolSize: POOL_LIMITS.minPoolSize,
    maxConnecting: POOL_LIMITS.maxConnecting,
    maxIdleTimeMS: POOL_LIMITS.maxIdleTimeMS,
    waitQueueTimeoutMS: POOL_LIMITS.waitQueueTimeoutMS,
    serverSelectionTimeoutMS: POOL_LIMITS.serverSelectionMS,
    socketTimeoutMS: POOL_LIMITS.socketTimeoutMS,
    connectTimeoutMS: POOL_LIMITS.connectTimeoutMS,
    // 写操作自动重试；读操作也重试一次再放弃（网络抖动不该让用户看到 500）
    retryWrites: true,
    retryReads: true,
    // 让 Atlas 侧能看到是哪个应用在连
    appName: 'wyk-math-team',
  };
}

// ═══════════════ 单例状态 ═══════════════

let _client = null;
let _connecting = null;          // in-flight connect，用来压并发
let _warmupStartedAt = 0;
const _dbs = new Map();          // dbName -> Db

const metrics = {
  startedAt: Date.now(),
  connectAttempts: 0,            // 调用过多少次 getClient()
  clientsCreated: 0,             // 真正 new 过几个 MongoClient —— 正常应恒为 1
  connectFailures: 0,
  connectRetries: 0,
  lastError: null,
  lastErrorAt: null,
  gateWaited: 0,                 // 排过队的请求数
  gateRejected: 0,               // 排队超时、被拒的请求数
  gatePeak: 0,
};

function noteError(err) {
  metrics.lastError = err && err.message ? String(err.message).slice(0, 300) : String(err);
  metrics.lastErrorAt = Date.now();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ═══════════════ 连接 ═══════════════

/**
 * 拿到（或建立）唯一的 MongoClient。
 * 并发调用共享同一个 in-flight promise；失败时清空引用并 close 半开的 client，
 * 绝不把「连了一半」的池留在内存里等 GC。
 *
 * 冷启动细节：第一个请求负责建连，它愿意等满 serverSelectionTimeoutMS；
 * 后面的请求最多等 connectGraceMS，然后拿 503 + Retry-After。
 * 没有这条限制时，一次冷启动会把 100 个请求全部拖到 10 秒后一起报错。
 */
export async function getClient() {
  if (_client) return _client;

  const inflight = _connecting;
  if (inflight) {
    const grace = POOL_LIMITS.connectGraceMS;
    if (grace <= 0) return inflight;

    let timer = null;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('Database connection is still warming up');
        err.code = 'DB_BUSY';
        reject(err);
      }, grace);
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      return await Promise.race([inflight, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not defined');

  _warmupStartedAt = Date.now();
  metrics.connectAttempts++;
  metrics.clientsCreated++;

  const attempt = (async () => {
    let lastErr = null;
    const total = 1 + POOL_LIMITS.connectRetries;

    for (let i = 0; i < total; i++) {
      const candidate = new MongoClient(uri, clientOptions());
      try {
        await candidate.connect();
        _client = candidate;
        return candidate;
      } catch (err) {
        lastErr = err;
        noteError(err);
        try { await candidate.close(); } catch { /* 半开状态，尽力 */ }
        if (i < total - 1) {
          metrics.connectRetries++;
          // 指数退避 + 抖动，避免所有实例在同一毫秒重试
          await sleep(60 * 2 ** i + Math.floor(Math.random() * 40));
        }
      }
    }
    metrics.connectFailures++;
    throw lastErr || new Error('MongoDB connect failed');
  })();

  _connecting = attempt;

  try {
    return await attempt;
  } finally {
    _connecting = null;
  }
}

/**
 * 取一个 Db。库名复用同一个 client —— 这是把「两个池」变成「一个池」的关键。
 */
export async function getDb(name) {
  const dbName = String(name || process.env.MONGODB_DB || 'wyk_math');
  const cached = _dbs.get(dbName);
  if (cached) return cached;

  const client = await getClient();
  const db = client.db(dbName);
  _dbs.set(dbName, db);
  return db;
}

/** 测试/关停用：真正释放连接 */
export async function closeClient() {
  const c = _client;
  _client = null;
  _connecting = null;
  _dbs.clear();
  if (c) { try { await c.close(); } catch { /* 已断开 */ } }
}

// ═══════════════ 每实例并发闸门 ═══════════════
//
// 池的大小是「能同时进 DB 的连接数」，闸门是「能同时进 DB 的请求数」。
// 没有闸门时，1000 个请求会一起挤进驱动的等待队列，队列满了才报错，
// 中间的时间全耗在无意义的排队上；有闸门，第 17 个请求就在应用层等，
// 要么等到槽位，要么超时拿到 503 —— 两者都是可预期的。

let _inflight = 0;
const _waiters = [];

function gateSnapshot() {
  return { inflight: _inflight, waiting: _waiters.length, peak: metrics.gatePeak };
}

/** 拿一个槽位。返回的 promise 被 reject 时 err.code === 'DB_BUSY'。 */
export function acquireSlot() {
  const max = POOL_LIMITS.maxInflight;
  if (_inflight < max) {
    _inflight++;
    if (_inflight > metrics.gatePeak) metrics.gatePeak = _inflight;
    return Promise.resolve();
  }

  metrics.gateWaited++;
  const timeoutMs = POOL_LIMITS.gateTimeoutMS;

  return new Promise((resolve, reject) => {
    const entry = { resolve: null, timer: null };

    entry.timer = setTimeout(() => {
      const i = _waiters.indexOf(entry);
      if (i !== -1) _waiters.splice(i, 1);
      metrics.gateRejected++;
      const err = new Error('Database is busy, retry shortly');
      err.code = 'DB_BUSY';
      reject(err);
    }, timeoutMs);

    // 槽位从释放者手里「转移」过来，_inflight 不变，所以这里不 ++
    entry.resolve = () => {
      clearTimeout(entry.timer);
      resolve();
    };

    _waiters.push(entry);
  });
}

/** 归还槽位：有排队者就转移，否则递减。 */
export function releaseSlot() {
  const next = _waiters.shift();
  if (next) {
    next.resolve();
    return;
  }
  if (_inflight > 0) _inflight--;
}

/**
 * 把一段 DB 操作包在槽位里。
 * 用法： const db = await withSlot(() => connectToDatabase());
 */
export async function withSlot(fn) {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

// ═══════════════ 可重试错误 ═══════════════

const RETRYABLE_CODES = new Set([
  6,      // HostUnreachable
  7,      // HostNotFound
  89,     // NetworkTimeout
  91,     // ShutdownInProgress
  189,    // PrimarySteppedDown
  262,    // ExceededTimeLimit
  9001,   // SocketException
  10107,  // NotWritablePrimary
  11600,  // InterruptedAtShutdown
  11602,  // InterruptedDueToReplStateChange
  13435,  // NotPrimaryNoSecondaryOk
  13436,  // NotPrimaryOrSecondary
  16500,  // RequestRateLimitExceeded —— Atlas 限流就是这个
]);

export function isRetryableDBError(err) {
  if (!err) return false;
  if (err.code === 'DB_BUSY') return false;
  if (typeof err.hasErrorLabel === 'function' &&
      (err.hasErrorLabel('RetryableWriteError') || err.hasErrorLabel('TransientTransactionError'))) {
    return true;
  }
  const name = err.name || '';
  if (name === 'MongoNetworkError' || name === 'MongoServerSelectionError'
      || name === 'MongoPoolClearedError' || name === 'MongoTopologyClosedError'
      || name === 'MongoNetworkTimeoutError') {
    return true;
  }
  return RETRYABLE_CODES.has(Number(err.code));
}

/**
 * 对一次 DB 调用做有界重试。
 * 只重试「可能自己好起来」的错误，逻辑错误（duplicate key / validation）原样抛出。
 */
export async function withRetry(fn, { retries = 2, label = 'db' } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === retries || !isRetryableDBError(err)) throw err;
      metrics.connectRetries++;
      console.warn(`[mongo] retry ${i + 1}/${retries} on ${label}: ${err.message}`);
      await sleep(50 * 2 ** i + Math.floor(Math.random() * 30));
    }
  }
  throw lastErr;
}

// ═══════════════ 可观测 ═══════════════

export function metricsSnapshot() {
  return {
    ...metrics,
    uptimeMs: Date.now() - metrics.startedAt,
    clientsCreated: metrics.clientsCreated,
    gate: gateSnapshot(),
    pool: poolSummary(),
    // 驱动内部的池状态，mongodb 4.x 有 _topology 时尽量读，读不到就省略
    driver: readDriverPoolState(),
  };
}

function readDriverPoolState() {
  try {
    const c = _client;
    if (!c) return null;
    const s = c.topology && c.topology.s;
    const servers = s && s.servers;
    if (!servers || typeof servers.values !== 'function') return null;
    const out = [];
    for (const srv of servers.values()) {
      const pool = srv && srv.pool;
      if (!pool || !pool.s) continue;
      out.push({
        address: srv.host || srv.name || '?',
        total: pool.s.totalConnectionCount,
        available: pool.s.availableConnectionCount,
        pending: pool.s.pendingConnectionCount,
        checkedOut: pool.s.checkedOutConnectionCount,
        queue: pool.s.waitQueueSize,
      });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** 测试用：清零计数，便于断言一段窗口内的行为 */
export function resetMetrics() {
  metrics.connectAttempts = 0;
  metrics.connectFailures = 0;
  metrics.connectRetries = 0;
  metrics.gateWaited = 0;
  metrics.gateRejected = 0;
  metrics.gatePeak = _inflight;
  metrics.lastError = null;
  metrics.lastErrorAt = null;
}

/**
 * 冷启动状态。给 wrapHandler 用：
 * 'ready'   —— 有连接，正常放行
 * 'cold'    —— 还没有人开始连，这个请求可以去建
 * 'warming' —— 正在建，还在宽限期内，可以等
 * 'expired' —— 建太久了，新请求直接 503，别占闸门槽位
 */
export function warmupState() {
  if (_client) return 'ready';
  if (!_connecting) return 'cold';
  return Date.now() - _warmupStartedAt > POOL_LIMITS.connectGraceMS ? 'expired' : 'warming';
}
