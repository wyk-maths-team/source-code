// api/_pg.js —— PostgreSQL 连接池
import pg from 'pg';

const { Pool, types } = pg;

// ⭐ 全站时区固定为香港（UTC+8）。
//    通过在连接建立时下发 timezone 参数，数据库里的 CURRENT_DATE / NOW()::date
//    都按香港日期走，应用层不再需要手工 +8 小时。
export const PG_TIMEZONE = 'Asia/Hong_Kong';

// ⭐ DATE 列（OID 1082）默认会被 node-postgres 解析成本地时区的 Date 对象，
//    香港+8 的环境里会变成「前一天 16:00」，按天比较就错位了。
//    这里原样返回 'YYYY-MM-DD' 字符串，比较和存储都用同一种表示。
types.setTypeParser(1082, (v) => v);

let _pool = null;

export function getPgPool() {
  if (_pool) return _pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not defined');

  _pool = new Pool({
    connectionString,
    // serverless 每个实例都会建池，配合托管商的连接池代理时不要开太大
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // startup parameter：第一条查询之前就生效
    options: '-c timezone=' + PG_TIMEZONE,
  });

  // 部分托管商的池化代理会丢弃 startup options，这里再兜一次底。
  _pool.on('connect', (client) => {
    client.query("SET TIME ZONE '" + PG_TIMEZONE + "'").catch(() => {});
  });

  // 空闲连接被服务端断开时不要把进程带崩
  _pool.on('error', (err) => {
    console.error('[pg] idle client error:', err.message);
  });

  return _pool;
}

/** 关池（本地脚本 / 测试用；serverless 进程不要调用） */
export async function closePgPool() {
  if (!_pool) return;
  const p = _pool;
  _pool = null;
  await p.end().catch(() => {});
}
