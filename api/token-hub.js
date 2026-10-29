import { sqlDb } from '../lib/docStore.js';
import * as S from '../lib/submissionStore.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import * as P from '../lib/pgStore.js';
import * as U from '../lib/userStore.js';
import { getTokenBalance } from '../lib/token.js';
import { todayHK } from '../lib/time.js';

const THEME_COST = 300000;
const AVAILABLE_THEMES = ['default', 'cyberpunk', 'sakura', 'matrix', 'scifi'];

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = sqlDb();   // 只为查 submissions（今日 AC）
  const username = decoded.username;

  // ⭐ 用户 / 钱包 / 主题都在 PostgreSQL。
  //    getTokenBalance 顺带做跨天重置（daily 补满、negative global 用新额度偿还）。
  const [user, prefs, t] = await Promise.all([
    U.getUser(username),
    U.getPreferences(username),
    getTokenBalance(db, username),
  ]);

  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  // Rating 走 lib/userRating.js 的物化缓存（O(1)，不再每次重算）
  const { getUserRating } = await import('../lib/userRating.js');
  const ratingData = await getUserRating(db, username);
  const rating = ratingData.rating;
  const solvedCount = ratingData.solvedCount;

  // 映射今日任务难度（Rating 1500->3, Rating 2500->6）
  const targetDifficulty = Math.max(1, Math.min(10, Math.floor((rating - 1000) / 300) + 2));

  const today = todayHK();

  if (req.method === 'GET') {
    let questCompleted = false;
    if (!t.dailyQuestClaimed) {
      // submissions 本轮仍在 MongoDB
      const todayStart = new Date(today + 'T00:00:00+08:00');
      const acRecords = await S.find({
        username, correct: true, timestamp: { $gte: todayStart }
      }).project({ problemId: 1 }).toArray();

      if (acRecords.length > 0) {
        const pids = acRecords.map(r => r.problemId);
        // 题库在 PostgreSQL
        const probsToday = (await P.getProblemsByIds(pids))
          .filter(p => (Number(p.difficulty) || 0) >= targetDifficulty);
        if (probsToday.length > 0) questCompleted = true;
      }
    }

    return res.status(200).json({
      success: true,
      displayName: user.displayName || username,
      rating,
      solvedCount,
      tokens: { daily: t.daily, global: t.global },
      quests: {
        login: { claimed: !!t.dailyLoginClaimed, reward: 10000 },
        quest: { claimed: !!t.dailyQuestClaimed, completed: questCompleted, target: targetDifficulty, reward: 30000 }
      },
      theme: prefs?.theme || 'default'
    });
  }

  if (req.method === 'POST') {
    const { action, theme } = req.body || {};

    // 领取奖励：条件写在 SQL 的 WHERE 里，重复点击只会成功一次
    if (action === 'claim_login') {
      const r = await U.claimDaily(username, 'login');
      if (!r.ok) return res.status(400).json({ success: false, message: 'Already claimed' });
      return res.status(200).json({ success: true, message: '10,000 tokens claimed!' });
    }

    if (action === 'claim_quest') {
      const r = await U.claimDaily(username, 'quest');
      if (!r.ok) return res.status(400).json({ success: false, message: 'Already claimed' });
      return res.status(200).json({ success: true, message: '30,000 tokens claimed!' });
    }

    if (action === 'buy_theme') {
      if (!AVAILABLE_THEMES.includes(theme)) {
        return res.status(400).json({ success: false, message: 'Invalid theme' });
      }

      // 余额不足时 SQL 不会命中任何行，天然防并发重复扣款
      const r = await U.spendTokens(username, THEME_COST);
      if (!r.ok) {
        return res.status(400).json({ success: false, message: 'Not enough tokens (Requires 300k)' });
      }

      await U.setPreference(username, { theme });
      return res.status(200).json({ success: true, message: 'Theme applied!', theme });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
export default wrapHandler(handler);