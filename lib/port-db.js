// lib/port-db.js
import { MongoClient } from 'mongodb';

let _client = null;
let _db = null;

export async function connect() {
  if (_db) return _db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');
  _client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 15000 });
  await _client.connect();
  _db = _client.db('chris');
  return _db;
}

export function getDb() {
  if (!_db) throw new Error('chris DB not connected');
  return _db;
}

export async function close() {
  if (_client) { try { await _client.close(); } catch {} }
  _client = null;
  _db = null;
}

// module.exports = { connect, getDb, close };