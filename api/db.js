// File: C:\moj\api\db.js
import { MongoClient } from 'mongodb';

let client = null;
let db = null;

export async function connectToDatabase() {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'wyk_math';
  if (!uri) throw new Error('MONGODB_URI not defined');
  client = new MongoClient(uri, {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 3000,
    socketTimeoutMS: 10000,
  });
  await client.connect();
  db = client.db(dbName);
  return db;
}

