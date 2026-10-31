// api/hint.js —— 题目提示（hints）
//
// 管理员在编辑题目时写好 hints 和价格；学生答题前可以花 token 解锁。
// 未解锁的提示只返回价格，不返回内容。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { deductTokens } from '../lib/wallet.js';
import { getTokenBalance } from '../lib/token.js';

function isAdmin(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

function normalizeHints(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  raw.forEach((h, i) => {
    if (!h || typeof h !== 'object') return;
    const content = String(h.content || '').trim();
    if (!content) return;
    const price = Math.max(0, Math.round(Number(h.price) || 0));
    out.push({ id: String(h.id || 'h' + (i + 1)), content, price, order: i });
  });
  return out;
}

async function fireAchievements(db, username) {
  try {
    const { checkAchievements } = await import('../lib/achievements.js');
    await checkAchievements(db, username, { trigger: 'action' });
  } catch (e) {
    console.error('[achievements]', e);
  }
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const user = await verifyToken(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const username = user.username;

  try {
    if (req.method === 'GET') {
      const problemId = String(req.query.problemId || '').trim();
      if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });

      const problem = await db.collection('problems').findOne(
        { id: problemId }, { projection: { hints: 1, public: 1 } }
      );
      if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

      const hints = normalizeHints(problem.hints);
      if (!hints.length) return res.status(200).json({ success: true, hints: [] });

      const purchases = await db.collection('hintPurchases')
        .find({ username, problemId }, { projection: { hintId: 1 } })
        .toArray();
      const owned = new Set(purchases.map((p) => p.hintId));

      return res.status(200).json({
        success: true,
        hints: hints.map((h) => ({
          id: h.id,
          price: h.price,
          purchased: isAdmin(user) || owned.has(h.id),
          // 没买过就不发内容
          content: (isAdmin(user) || owned.has(h.id)) ? h.content : null,
        })),
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const { problemId: pid, hintId } = req.body || {};
    const problemId = String(pid || '').trim();
    if (!problemId || !hintId) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const problem = await db.collection('problems').findOne(
      { id: problemId }, { projection: { hints: 1 } }
    );
    if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

    const hint = normalizeHints(problem.hints).find((h) => h.id === String(hintId));
    if (!hint) return res.status(404).json({ success: false, message: 'Hint not found' });

    // 已经买过就直接给内容（不重复扣费）
    const already = await db.collection('hintPurchases').findOne(
      { username, problemId, hintId: hint.id }
    );
    if (already) {
      return res.status(200).json({
        success: true, already: true, content: hint.content, price: hint.price,
      });
    }

    if (hint.price > 0 && !isAdmin(user)) {
      const balance = await getTokenBalance(db, username);
      const charged = deductTokens(balance, hint.price);
      if (!charged) {
        return res.status(400).json({
          success: false,
          message: 'Not enough tokens (needs ' + hint.price + ')',
          price: hint.price,
        });
      }

      const upd = await db.collection('users').updateOne(
        { username, 'token.daily': balance.daily, 'token.global': balance.global },
        { $set: { 'token.daily': charged.token.daily, 'token.global': charged.token.global } }
      );
      if (!upd || upd.modifiedCount === 0) {
        return res.status(409).json({ success: false, message: 'Balance changed, please retry' });
      }
    }

    try {
      await db.collection('hintPurchases').insertOne({
        _id: `${problemId}:${hint.id}:${username}`,
        problemId,
        hintId: hint.id,
        username,
        price: hint.price,
        createdAt: new Date(),
      });
    } catch (e) {
      if (!(e && e.code === 11000)) throw e;   // 并发重复购买：当作已购买
    }

    await fireAchievements(db, username);

    return res.status(200).json({
      success: true,
      content: hint.content,
      price: hint.price,
      message: hint.price > 0 ? 'Unlocked' : 'Free hint',
    });
  } catch (err) {
    console.error('[hint]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default wrapHandler(handler);
