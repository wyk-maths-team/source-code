// config.js
require('dotenv').config();
const path = require('path');

module.exports = {
  // Mongo
  MONGODB_URI: process.env.MONGODB_URI,
  MONGODB_DB:  process.env.MONGODB_DB || 'wyk_math',

  // 輪詢與超時
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),
  TASK_TIMEOUT_MS:  parseInt(process.env.TASK_TIMEOUT_MS  || '60000', 10),

  // 鎖定超時（Bridge 崩潰後自動重拾任務）
  LOCK_TTL_MS: 5 * 60_000,

  // DeepSeek
  DEEPSEEK_URL: 'https://chat.deepseek.com',

  // 路徑
  CHROME_PROFILE_DIR: path.resolve(__dirname, '.chrome-profile'),
  LOG_DIR:    path.resolve(__dirname, 'logs'),
  FAILED_DIR: path.resolve(__dirname, 'logs', 'failed'),

  // Collection 名稱
  TASK_COLLECTION: 'steps_grading_tasks',
};