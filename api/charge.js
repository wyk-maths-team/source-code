// api/charge.js —— 用 token 換「思考時間」
//
// 規則：
//   - 每 10,000 token 換 1 分鐘（基礎）
//   - 第 N 次兌換（N 從 0 開始，每次 +1）會乘上 0.9^N，越換越少
//   - 時間存在 users.charge = { seconds, count }
//   - 可以手動把時間減掉（取整到分鐘，向上取整）

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { getTokenBalance } from '../lib/token.js';

const COST_PER_MINUTE = 10000;
const DECAY = 0.9;

function readCharge(user) {
  const c = user?.charge || {};
  return {
    seconds: Math.max(0, Number(c.seconds) || 0),
    count: Math.max(0, Number(c.count) || 0),
  };
}

function snapshot(user, global) {
  const c = readCharge(user);
  return {
    seconds: c.seconds,
    count: c.count,
    global,
    costPerMinute: COST_PER_MINUTE,
    nextMultiplier: Math.pow(DECAY, c.count),
    nextSeconds: 60 * Math.pow(DECAY, c.count),
  };
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const user = await verifyToken(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const users = db.collection('users');
  const username = user.username;

  try {
    if (req.method === 'GET') {
      const [doc, balance] = await Promise.all([
        users.findOne({ username }, { projection: { charge: 1 } }),
        getTokenBalance(db, username),
      ]);
      return res.status(200).json({ success: true, ...snapshot(doc, balance.global) });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const body = req.body || {};

    // 兌換時間
    if (body.action === 'buy') {
      const tokens = Math.floor(Number(body.tokens) / COST_PER_MINUTE) * COST_PER_MINUTE;
      if (!Number.isFinite(tokens) || tokens < COST_PER_MINUTE) {
        return res.status(400).json({ success: false, message: 'Need at least ' + COST_PER_MINUTE + ' tokens' });
      }

      const balance = await getTokenBalance(db, username);
      if (balance.global < tokens) {
        return res.status(400).json({ success: false, message: 'Not enough global tokens', global: balance.global });
      }

      const doc = await users.findOne({ username }, { projection: { charge: 1 } });
      const c = readCharge(doc);

      const minutes = (tokens / COST_PER_MINUTE) * Math.pow(DECAY, c.count);
      const addedSeconds = minutes * 60;
      const nextSeconds = c.seconds + addedSeconds;

      // 樂觀鎖：global 餘額沒變才扣，避免連點重複扣
      const upd = await users.updateOne(
        { username, 'token.global': balance.global },
        {
          $inc: { 'token.global': -tokens },
          $set: { 'charge.seconds': nextSeconds, 'charge.count': c.count + 1 },
        }
      );
      if (!upd || upd.modifiedCount === 0) {
        return res.status(409).json({ success: false, message: 'Balance changed, please retry' });
      }

      const fresh = await users.findOne({ username }, { projection: { charge: 1 } });
      return res.status(200).json({
        success: true,
        message: '+' + Math.round(addedSeconds) + 's',
        addedSeconds,
        ...snapshot(fresh, balance.global - tokens),
      });
    }

    // 減少時間（向上取整到分鐘）
    if (body.action === 'reduce') {
      const minutes = Math.ceil(Number(body.minutes));
      if (!Number.isFinite(minutes) || minutes <= 0) {
        return res.status(400).json({ success: false, message: 'Minutes must be at least 1' });
      }

      const doc = await users.findOne({ username }, { projection: { charge: 1 } });
      const c = readCharge(doc);
      const delta = minutes * 60;

      if (delta > c.seconds + 1e-6) {
        return res.status(400).json({ success: false, message: 'Not enough time', seconds: c.seconds });
      }

      const upd = await users.updateOne(
        { username, 'charge.seconds': c.seconds },
        { $set: { 'charge.seconds': Math.max(0, c.seconds - delta) } }
      );
      if (!upd || upd.modifiedCount === 0) {
        return res.status(409).json({ success: false, message: 'Time changed, please retry' });
      }

      const [fresh, balance] = await Promise.all([
        users.findOne({ username }, { projection: { charge: 1 } }),
        getTokenBalance(db, username),
      ]);
      return res.status(200).json({
        success: true,
        message: '-' + minutes + ' min',
        removedSeconds: delta,
        ...snapshot(fresh, balance.global),   // 要把 global 一起带回去，否则前端会把余额覆盖成 null
      });
    }

    return res.status(400).json({ success: false, message: 'Unknown action' });
  } catch (err) {
    console.error('[charge]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default wrapHandler(handler);
