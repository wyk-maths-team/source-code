// api/_pdb.js —— port 系列用的 chris 库
//
// 以前这里自己 new 一个 maxPoolSize: 10 的 client，和 wyk_math 那个并行存在，
// 同一个 URI 握手两遍、配额算两份。现在复用 lib/mongo.js 的单例 client，
// 只是换库名 —— client.db('chris') 不会新建连接。
import { getDb } from '../lib/mongo.js';

const DB_NAME = process.env.PORT_DB_NAME || 'chris';

export async function connectToDatabase() {
  return getDb(DB_NAME);
}

export { closeClient } from '../lib/mongo.js';
