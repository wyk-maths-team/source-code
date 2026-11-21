// api/stats.js —— 首页的公开数字
//
// action=recent-ac   最近 10 条 AC 提交（只给题目、用户、分数、时间）
// action=tokens-used 累计消耗的 token（读 metadata，由提交时原子累加）
//
// 缓存策略（这是全站调用量最大的端点之一，值得说清楚）：
//
//   首页每 60 秒轮询一次 recent-ac。30 个人同时开着页面 = 每分钟 30 次回源。
//   这些人不是同一秒按下刷新的，请求均匀散在这一分钟里 —— 所以 CDN 缓存
//   60 秒能把「在线人数次/分钟」压成「1 次/分钟」，收益随并发线性放大。
//
//   安全性靠两件事：
//     1. 匿名响应本身不含任何个人数据（不查 users、答案全打码），可以共享；
//     2. 登录响应带打码结果，是因人而异的，必须 private/no-store，
//        并且两边都发 Vary: Authorization —— 否则 CDN 会把匿名那份
//        发给登录用户（内容不泄漏，但会退化成打码视图）。

import { connectToDatabase } from './_db.js';
import { wrapHandler } from '../lib/errors.js';
import { labelOf } from '../lib/submission-status.js';
import { verifyToken } from '../lib/auth.js';

// 进程内缓存：CDN 没命中时（比如首次请求）的最后一道
const CACHE_MS = 60 * 1000;
const _cache = { recentAc: { at: 0, data: null } };

// 共享缓存头和私有头分开写，避免哪天有人误用同一个常量
const PUBLIC_CACHE = 'public, max-age=30, s-maxage=60, stale-while-revalidate=600';
const PRIVATE_CACHE = 'private, no-store, max-age=0';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const db = await connectToDatabase();
  const action = req.query.action || 'recent-ac';

  // 任何情况下都按 Authorization 分区，匿名与登录不会串味
  res.setHeader('Vary', 'Authorization');

  if (action === 'recent-ac') {
    const now = Date.now();
    // 未登录的访客走公共缓存；登录用户要按自己的进度打码，不能复用。
    const viewer = await verifyToken(req).catch(() => null);
    const canUseCache = !viewer;

    // 登录用户的响应绝不能进共享缓存
    res.setHeader('Cache-Control', viewer ? PRIVATE_CACHE : PUBLIC_CACHE);

    if (canUseCache && _cache.recentAc.data && now - _cache.recentAc.at < CACHE_MS) {
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({ success: true, items: _cache.recentAc.data, cached: true });
    }

    const rows = await db.collection('submissions').find(
      { status: 'AC' },
      { projection: { _id: 0, subid: 1, username: 1, problemId: 1, answer: 1, timestamp: 1, aiGraded: 1 } }
    ).sort({ timestamp: -1 }).limit(10).toArray();

    const pids = [...new Set(rows.map(r => r.problemId))];
    // 未登入的访客不给任何身份信息，users 集合干脆不查。
    const anonymous = !viewer;
    const names = anonymous ? [] : [...new Set(rows.map(r => r.username))];
    const [probs, us] = await Promise.all([
      db.collection('problems').find({ id: { $in: pids } }, { projection: { id: 1, name: 1, _id: 0 } }).toArray(),
      names.length
        ? db.collection('users').find({ username: { $in: names } }, { projection: { username: 1, displayName: 1, _id: 0 } }).toArray()
        : Promise.resolve([]),
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
        // 首页是公开页：没登录就连提交者的 username / displayName 都不返回，
        // 登录后才按正常规则给（对象级资料越权是另一套策略，见 users.js）。
        username: anonymous ? null : r.username,
        displayName: anonymous ? 'Anonymous' : (dispMap[r.username] || r.username),
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
    // 全站累计数字，与看的人无关：任何人都可以共享同一份缓存
    res.setHeader('Cache-Control', PUBLIC_CACHE);
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
