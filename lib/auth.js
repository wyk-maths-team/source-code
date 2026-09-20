// libhttps://cdn.jsdelivr.net/gh/wyk-math-team/resources/script/auth.js
import jwt from 'jsonwebtoken';
import { MongoClient } from 'mongodb';

let client = null;
let db = null;

async function getDB() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'wyk_math';
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  return db;
}
const userCache = new Map(); // username -> { user, expireAt }
const USER_CACHE_TTL = 5000;
export async function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const database = await getDB();
    const user = await database.collection('users').findOne({ username: decoded.username });
    if (!user || user.banned) return null;
    return decoded;
  } catch {
    return null;
  }
}