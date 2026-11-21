// api/_db.js
//
// 唯一的入口是 connectToDatabase()，但它本身不再持有 client ——
// 连接由 lib/mongo.js 统一管理（单例 + 并发去重 + 池上限 + 闸门）。
//
// 这样 api/port/* 那套 chris 库的代码也复用同一个 client，
// 同一个 URI 只握手一次，Atlas 配额只算一份。
import { getDb } from '../lib/mongo.js';

const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';

export async function connectToDatabase() {
  if (MAINTENANCE_MODE) {
    throw new Error('SERVICE_UNAVAILABLE: System is under maintenance.');
  }
  return getDb(process.env.MONGODB_DB || 'wyk_math');
}

export { closeClient } from '../lib/mongo.js';
