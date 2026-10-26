// api/_db.js
import { MongoClient } from 'mongodb';

let client = null;
let db = null;

export async function connectToDatabase() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'wyk_math';
  if (!uri) throw new Error('MONGODB_URI not defined');
  client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 1,              // ⭐ 保持至少 1 个热连接
    serverSelectionTimeoutMS: 20000,
    socketTimeoutMS: 30000,
  });
  await client.connect();
  db = client.db(dbName);
  return db;
}