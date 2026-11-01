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

/** 用户是否已经 AC 过这道题（states.<pid> === 'passed'） */
async function isSolved(db, username, problemId) {
  const stats = await db.collection('userstats').findOne(
    { username },
    { projection: { [`states.${problemId}`]: 1 } }
  );
  return stats?.states?.[problemId] === 'passed';
}

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

      // AC 过的题，hint 免费
      const solved = await isSolved(db, username, problemId);

      return res.status(200).json({
        success: true,
        freeForYou: solved,
        hints: hints.map((h) => ({
          id: h.id,
          price: solved ? 0 : h.price,
          originalPrice: h.price,
          freeForYou: solved,
          // 管理员也要先买（前端一致）；要绕过请直接看数据库
          purchased: owned.has(h.id),
          // 没买过就不发内容
          content: owned.has(h.id) ? h.content : null,
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

    // AC 过这道题之后，hint 免费；其余情况照价收费（管理员也一样）
    const solved = await isSolved(db, username, problemId);
    if (hint.price > 0 && !solved) {
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
        price: solved ? 0 : hint.price,   // AC 后是 0
        freeBecauseSolved: solved,
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
