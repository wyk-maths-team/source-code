// db.js
const { MongoClient } = require('mongodb');
const config = require('./config');

let _client = null;
let _db = null;

async function connect() {
  if (_db) return _db;
  if (!config.MONGODB_URI) throw new Error('MONGODB_URI not set in .env');
  _client = new MongoClient(config.MONGODB_URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15000,
  });
  await _client.connect();
  _db = _client.db(config.MONGODB_DB);
  return _db;
}

function getDb() {
  if (!_db) throw new Error('DB not connected — call connect() first');
  return _db;
}

async function close() {
  if (_client) {
    try { await _client.close(); } catch {}
  }
  _client = null;
  _db = null;
}

module.exports = { connect, getDb, close };