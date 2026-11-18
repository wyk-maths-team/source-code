// api/stats.js —— 首页的公开数字
//
// action=recent-ac   最近 10 条 AC 提交（只给题目、用户、分数、时间）
// action=tokens-used 累计消耗的 token（读 metadata，由提交时原子累加）

import { connectToDatabase } from './_db.js';
import { wrapHandler } from '../lib/errors.js';
import { labelOf } from '../lib/submission-status.js';
import { verifyToken } from '../lib/auth.js';

// 一分钟缓存：首页不需要毫秒级新鲜，10 条 AC 每分钟刷一次足够
const CACHE_MS = 60 * 1000;
const _cache = { recentAc: { at: 0, data: null } };

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const db = await connectToDatabase();
  const action = req.query.action || 'recent-ac';

  if (action === 'recent-ac') {
    const now = Date.now();
    // 未登录的访客走公共缓存；登录用户要按自己的进度打码，不能复用。
    // 只解析一次，后面判定打码直接用这个结果。
    const viewer = await verifyToken(req).catch(() => null);
    const canUseCache = !viewer;
    if (canUseCache && _cache.recentAc.data && now - _cache.recentAc.at < CACHE_MS) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({ success: true, items: _cache.recentAc.data, cached: true });
    }

    const rows = await db.collection('submissions').find(
      { status: 'AC' },
      { projection: { _id: 0, subid: 1, username: 1, problemId: 1, answer: 1, timestamp: 1, aiGraded: 1 } }
    ).sort({ timestamp: -1 }).limit(10).toArray();

    const pids = [...new Set(rows.map(r => r.problemId))];
    const users = [...new Set(rows.map(r => r.username))];
    const [probs, us] = await Promise.all([
      db.collection('problems').find({ id: { $in: pids } }, { projection: { id: 1, name: 1, _id: 0 } }).toArray(),
      db.collection('users').find({ username: { $in: users } }, { projection: { username: 1, displayName: 1, _id: 0 } }).toArray(),
    ]);
    const nameMap = Object.fromEntries(probs.map(p => [p.id, p.name]));
    const dispMap = Object.fromEntries(us.map(u => [u.username, u.displayName || u.username]));

    // 首页是公开的，答案不能直接摊开 —— 和题目页一样：
    // 管理员、本人、以及已经通过这道题的人才看得到原文，其余打码。
    let passed = new Set();
    let isAdmin = false;
    const myName = viewer && viewer.username;
    if (viewer) {
      isAdmin = viewer.role === 'admin' || viewer.role === 'root';
      if (!isAdmin) {
        const st = await db.collection('userstats').findOne(
          { username: myName }, { projection: { states: 1, _id: 0 } }
        );
        Object.entries((st && st.states) || {}).forEach(([pid, v]) => {
          if (v === 'passed') passed.add(String(pid));
        });
      }
    }

    const items = rows.map(r => {
      const canSee = isAdmin || r.username === myName || passed.has(String(r.problemId));
      const raw = String(r.answer == null ? '' : r.answer);
      return {
        subid: r.subid,
        username: r.username,
        displayName: dispMap[r.username] || r.username,
        problemId: r.problemId,
        problemName: nameMap[r.problemId] || ('Problem #' + r.problemId),
        answer: canSee ? raw.slice(0, 80) : '',
        answerHidden: !canSee,
        timestamp: r.timestamp,
        aiGraded: !!r.aiGraded,
        label: labelOf('AC'),
      };
    });

    if (canUseCache) _cache.recentAc = { at: now, data: items };
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ success: true, items, cached: false, ttl: CACHE_MS });
  }

  if (action === 'tokens-used') {
    const meta = await db.collection('metadata').findOne({ _id: 'globalTokens' });
    return res.status(200).json({
      success: true,
      totalTokensUsed: Number(meta && meta.totalTokensUsed) || 0,
      updatedAt: (meta && meta.updatedAt) || null,
    });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

export default wrapHandler(handler);
