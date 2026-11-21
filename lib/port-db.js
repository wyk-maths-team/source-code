// lib/port-db.js
//
// chris 库的连接（port 系列表单 + grader 本地进程用）。
//
// 注意：这个文件被两个不同形态的进程使用 ——
//   - mode=ESM：api/port/* 走的是 api/_pdb.js，已复用 lib/mongo.js，不经过这里
//   - mode=CJS：grader/bridge.js 用 require() 加载，是独立的本地进程
// 所以它保留自己的 client，但池参数和 lib/mongo.js 对齐，
// 避免「一个进程 5 个池 × 10 条连接」这种悄悄发生的配额浪费。
import { MongoClient } from 'mongodb';

let _client = null;
let _db = null;
let _connecting = null;

const DB_NAME = process.env.PORT_DB_NAME || 'chris';

function intEnv(name, fallback) {
  const n = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function connect() {
  if (_db) return _db;
  if (_connecting) return _connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  _connecting = (async () => {
    const client = new MongoClient(uri, {
      maxPoolSize: intEnv('MONGODB_MAX_POOL', 5),
      minPoolSize: 0,
      maxConnecting: intEnv('MONGODB_MAX_CONNECTING', 2),
      maxIdleTimeMS: intEnv('MONGODB_MAX_IDLE_MS', 30_000),
      waitQueueTimeoutMS: intEnv('MONGODB_WAIT_QUEUE_MS', 8_000),
      serverSelectionTimeoutMS: intEnv('MONGODB_SERVER_SELECTION_MS', 8_000),
      socketTimeoutMS: intEnv('MONGODB_SOCKET_TIMEOUT_MS', 30_000),
      retryWrites: true,
      retryReads: true,
      appName: 'wyk-math-team-grader',
    });
    try {
      await client.connect();
    } catch (err) {
      try { await client.close(); } catch { /* 半开 */ }
      throw err;
    }
    _client = client;
    _db = client.db(DB_NAME);
    return _db;
  })();

  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

export function getDb() {
  if (!_db) throw new Error('chris DB not connected');
  return _db;
}

export async function close() {
  const c = _client;
  _client = null;
  _db = null;
  _connecting = null;
  if (c) { try { await c.close(); } catch { /* 已断开 */ } }
}
