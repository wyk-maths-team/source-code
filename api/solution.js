// api/solution.js —— 题解（AC 后才能看 / 写）
//
// 规则：
//   - 只有 AC 过这道题的人能看题解、写题解（管理员例外，方便审阅）
//   - 写一篇消耗 10,000 token
//   - 点赞每人每篇一次、不能取消；被赞的作者每天结算 +1,000 token
//     （结算在 api/cron.js?action=settleSolutionLikes）

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { guestBlockedFromProblem } from '../lib/guestGuard.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { sanitizeHTML } from '../lib/sanitize.js';
import { deductTokens } from '../lib/wallet.js';
import { getTokenBalance } from '../lib/token.js';
import { ObjectId } from 'mongodb';
import { auditLog } from '../lib/audit.js';

const POST_COST = 10000;
const LIKE_REWARD = 1000;
const MAX_CONTENT = 20000;
const PAGE_SIZE = 50;
/** 管理页一次最多取多少条，避免把整个集合读进内存。 */
const ADMIN_PAGE = 200;

function isAdmin(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

// 成就检查（题解 / 点赞会解锁社区类成就）
async function fireAchievements(db, username) {
  try {
    const { checkAchievements } = await import('../lib/achievements.js');
    await checkAchievements(db, username, { trigger: 'action' });
  } catch (e) {
    console.error('[achievements]', e);
  }
}

async function hasSolved(db, username, problemId) {
  const stats = await db.collection('userstats').findOne(
    { username },
    { projection: { [`states.${problemId}`]: 1 } }
  );
  return stats?.states?.[problemId] === 'passed';
}

async function charge(db, username, amount, label) {
  const balance = await getTokenBalance(db, username);
  const res = deductTokens(balance, amount);
  if (!res) return { ok: false, balance };

  const upd = await db.collection('users').updateOne(
    { username, 'token.daily': balance.daily, 'token.global': balance.global },
    { $set: { 'token.daily': res.token.daily, 'token.global': res.token.global } }
  );
  // 乐观锁：余额刚被别人改过 → 让调用方重试，不会重复扣
  if (!upd || upd.modifiedCount === 0) return { ok: false, balance, retry: true };

  return { ok: true, tokens: { daily: res.token.daily, global: res.token.global } };
}

async function listSolutions(db, problemId, username, { includeHidden = false } = {}) {
  const filter = includeHidden ? { problemId } : { problemId, hidden: { $ne: true } };
  const rows = await db.collection('solutions')
    .find(filter)
    .sort({ likes: -1, createdAt: -1 })
    .limit(PAGE_SIZE)
    .toArray();

  if (!rows.length) return [];

  const ids = rows.map((r) => r._id);
  const authors = [...new Set(rows.map((r) => r.username))];

  const [likes, authorDocs] = await Promise.all([
    db.collection('solutionLikes')
      .find({ username, solutionId: { $in: ids.map(String) } }, { projection: { solutionId: 1 } })
      .toArray(),
    db.collection('users')
      .find({ username: { $in: authors } }, { projection: { username: 1, pfp: 1 } })
      .toArray(),
  ]);

  const liked = new Set(likes.map((x) => x.solutionId));
  const pfpMap = new Map(authorDocs.map((u) => [u.username, u.pfp || '']));

  return rows.map((r) => ({
    _id: String(r._id),
    username: r.username,
    displayName: r.displayName || r.username,
    pfp: pfpMap.get(r.username) || '',
    content: r.content,
    likes: Number(r.likes) || 0,
    createdAt: r.createdAt,
    liked: liked.has(String(r._id)),
    mine: r.username === username,
    hidden: r.hidden === true,
  }));
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const user = await verifyToken(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const username = user.username;

  try {
    // ── 管理页：全站题解列表（只有管理员）──
    if (req.method === 'GET' && String(req.query.action || '') === 'adminList') {
      if (!isAdmin(user)) return res.status(403).json({ success: false, message: 'Admin only' });

      const userFilter = String(req.query.username || '').trim();
      const problemFilter = String(req.query.problemId || '').trim();
      const hiddenFilter = String(req.query.hidden || 'all');

      const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const filter = {};
      if (userFilter) filter.username = { $regex: '^' + esc(userFilter), $options: 'i' };
      if (problemFilter) filter.problemId = { $regex: '^' + esc(problemFilter), $options: 'i' };
      if (hiddenFilter === 'visible') filter.hidden = { $ne: true };
      else if (hiddenFilter === 'hidden') filter.hidden = true;

      const limit = Math.min(ADMIN_PAGE, Math.max(1, Number(req.query.limit) || ADMIN_PAGE));
      const skip = Math.max(0, Number(req.query.skip) || 0);

      const [rows, total] = await Promise.all([
        db.collection('solutions').find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        db.collection('solutions').countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        total,
        skip,
        limit,
        solutions: rows.map((r) => ({
          id: String(r._id),
          problemId: r.problemId,
          username: r.username,
          displayName: r.displayName || r.username,
          likes: Number(r.likes) || 0,
          hidden: r.hidden === true,
          createdAt: r.createdAt,
          excerpt: String(r.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160),
          length: String(r.content || '').length,
        })),
      });
    }

    // ── 列表 ──
    if (req.method === 'GET') {
      const problemId = String(req.query.problemId || '').trim();
      if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });

      // 访客不能看华夏杯（HX）的题解
      if (guestBlockedFromProblem({ username: user.username, role: user.role }, problemId)) {
        return res.status(404).json({ success: false, message: 'Problem not found' });
      }

      const solved = isAdmin(user) || await hasSolved(db, username, problemId);
      if (!solved) {
        return res.status(403).json({ success: false, message: 'Solve this problem first to view solutions' });
      }

      // 管理员可以看到被隐藏的题解（方便恢复）
      const solutions = await listSolutions(db, problemId, username, { includeHidden: isAdmin(user) });
      return res.status(200).json({
        success: true,
        solutions,
        solved: true,
        isAdmin: isAdmin(user),
        postCost: POST_COST,
        likeReward: LIKE_REWARD,
        canPost: !isAdmin(user) || true,
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const body = req.body || {};

    // ── 删除（管理员）──
    // 物理删除，但先把被删的那条完整记进 audit_logs：
    // 题解是学生花 token 写的，删错了要能从审计里还原出来。
    if (body.action === 'delete') {
      if (!isAdmin(user)) return res.status(403).json({ success: false, message: 'Admin only' });

      let oid;
      try { oid = new ObjectId(String(body.solutionId || '')); }
      catch { return res.status(400).json({ success: false, message: 'Bad solution id' }); }

      const sol = await db.collection('solutions').findOne({ _id: oid });
      if (!sol) return res.status(404).json({ success: false, message: 'Solution not found' });

      // 点赞记录一起清掉，否则结算任务会去找一个不存在的题解
      const likeResult = await db.collection('solutionLikes').deleteMany({ solutionId: String(oid) });
      await db.collection('solutions').deleteOne({ _id: oid });

      await auditLog(db, 'solution_delete', {
        solutionId: String(oid),
        problemId: sol.problemId,
        author: sol.username,
        likes: Number(sol.likes) || 0,
        likesRemoved: likeResult.deletedCount || 0,
        createdAt: sol.createdAt,
        // 存全文，删错了可以照着重建
        content: String(sol.content || '').slice(0, 20000),
        reason: String(body.reason || '').slice(0, 500),
      }, username, 'warn');

      return res.status(200).json({
        success: true,
        deleted: true,
        likesRemoved: likeResult.deletedCount || 0,
        message: 'Solution deleted and logged',
      });
    }

    // ── 隐藏 / 恢复（管理员）──
    if (body.action === 'hide') {
      if (!isAdmin(user)) return res.status(403).json({ success: false, message: 'Admin only' });

      let oid;
      try { oid = new ObjectId(String(body.solutionId || '')); }
      catch { return res.status(400).json({ success: false, message: 'Bad solution id' }); }

      const hidden = body.hidden === true || body.hidden === 'true';
      const upd = await db.collection('solutions').updateOne(
        { _id: oid },
        { $set: { hidden, hiddenAt: new Date(), hiddenBy: username } }
      );
      if (!upd.matchedCount) return res.status(404).json({ success: false, message: 'Solution not found' });

      return res.status(200).json({
        success: true,
        hidden,
        message: hidden ? 'Solution hidden' : 'Solution restored',
      });
    }

    // ── 点赞（不可取消）──
    if (body.action === 'like') {
      const sid = String(body.solutionId || '');
      let oid;
      try { oid = new ObjectId(sid); } catch { return res.status(400).json({ success: false, message: 'Bad solution id' }); }

      const sol = await db.collection('solutions').findOne({ _id: oid });
      if (!sol) return res.status(404).json({ success: false, message: 'Solution not found' });

      if (!isAdmin(user) && !(await hasSolved(db, username, sol.problemId))) {
        return res.status(403).json({ success: false, message: 'Solve this problem first' });
      }
      if (sol.username === username) {
        return res.status(400).json({ success: false, message: 'You cannot like your own solution' });
      }

      // _id 组合键天然保证「一人一篇只能赞一次」
      const likeId = sid + ':' + username;
      try {
        await db.collection('solutionLikes').insertOne({
          _id: likeId,
          solutionId: sid,
          problemId: sol.problemId,
          username,                 // 点赞的人
          author: sol.username,     // 被赞的人（结算时给这个人发币）
          createdAt: new Date(),
          settled: false,
        });
      } catch (e) {
        if (e && e.code === 11000) {
          return res.status(400).json({ success: false, message: 'Already liked' });
        }
        throw e;
      }

      const updated = await db.collection('solutions').findOneAndUpdate(
        { _id: oid },
        { $inc: { likes: 1 } },
        { returnDocument: 'after' }
      );

      // 点赞者可能解锁 Patron，作者可能解锁 Well Liked
      await Promise.all([fireAchievements(db, username), fireAchievements(db, sol.username)]);

      const doc = updated && (updated.value !== undefined ? updated.value : updated);
      return res.status(200).json({
        success: true,
        likes: Number(doc?.likes) || 0,
        message: 'Liked',
        reward: LIKE_REWARD,
      });
    }

    // ── 写题解 ──
    const problemId = String(body.problemId || '').trim();
    const raw = String(body.content || '').trim();
    if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });
    if (raw.length < 10) return res.status(400).json({ success: false, message: 'Solution is too short (min 10 chars)' });
    if (raw.length > MAX_CONTENT) return res.status(400).json({ success: false, message: 'Solution is too long' });

    if (!isAdmin(user) && !(await hasSolved(db, username, problemId))) {
      return res.status(403).json({ success: false, message: 'Solve this problem first' });
    }

    const paid = await charge(db, username, POST_COST, 'solution');
    if (!paid.ok) {
      return res.status(paid.retry ? 409 : 400).json({
        success: false,
        message: paid.retry ? 'Balance changed, please retry' : 'Not enough tokens (needs ' + POST_COST + ')',
        cost: POST_COST,
      });
    }

    const doc = {
      problemId,
      username,
      displayName: user.displayName || username,
      content: sanitizeHTML(raw),
      likes: 0,
      createdAt: new Date(),
    };
    const result = await db.collection('solutions').insertOne(doc);
    await fireAchievements(db, username);

    return res.status(201).json({
      success: true,
      message: 'Solution posted',
      tokens: paid.tokens,
      solution: {
        _id: String(result.insertedId),
        username,
        displayName: doc.displayName,
        pfp: (await db.collection('users').findOne({ username }, { projection: { pfp: 1 } }))?.pfp || '',
        content: doc.content,
        likes: 0,
        createdAt: doc.createdAt,
        liked: false,
        mine: true,
      },
    });
  } catch (err) {
    console.error('[solution]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default wrapHandler(handler);
