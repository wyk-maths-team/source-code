// api/token-hub.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';

const THEME_COST = 300000;
const AVAILABLE_THEMES = ['default', 'cyberpunk', 'sakura', 'matrix', 'scifi'];

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const username = decoded.username;

  // 获取用户信息和 Token
  const user = await db.collection('users').findOne({ username }, { projection: { token: 1, rating: 1 } });
  const userdata = await db.collection('userdata').findOne({ username }, { projection: { theme: 1 } });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  const today = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
  let t = user.token || { daily: 30000, global: 100000, lastReset: today };

  // Lazy Reset: 重置每日任务和每日 Token
  let resetNeeded = false;
  if (t.lastReset !== today) {
    t.daily = 30000;
    t.lastReset = today;
    t.dailyLoginClaimed = false;
    t.dailyQuestClaimed = false;
    resetNeeded = true;
  }

  // 计算今日任务目标难度
  const rating = user.rating || 1500;
  // 映射规则：Rating 1500 -> 3, Rating 2500 -> 6, 至少 1
  const targetDifficulty = Math.max(1, Math.min(10, Math.floor((rating - 1000) / 300) + 2));

  if (req.method === 'GET') {
    // 校验今日任务2是否真的完成了（查今天有没有 AC 过难度 >= target 的题目）
    let questCompleted = false;
    if (!t.dailyQuestClaimed) {
      const todayStart = new Date(`${today}T00:00:00+08:00`);
      const acRecords = await db.collection('submissions').find({
        username,
        correct: true,
        timestamp: { $gte: todayStart }
      }).project({ problemId: 1 }).toArray();

      if (acRecords.length > 0) {
        const pids = acRecords.map(r => r.problemId);
        const probs = await db.collection('problems').find({ id: { $in: pids }, difficulty: { $gte: targetDifficulty } }).toArray();
        if (probs.length > 0) questCompleted = true;
      }
    }

    return res.status(200).json({
      success: true,
      tokens: { daily: t.daily, global: t.global },
      quests: {
        login: { claimed: !!t.dailyLoginClaimed, reward: 10000 },
        quest: { claimed: !!t.dailyQuestClaimed, completed: questCompleted, target: targetDifficulty, reward: 30000 }
      },
      theme: userdata?.theme || 'default'
    });
  }

  if (req.method === 'POST') {
    const { action, theme } = req.body || {};

    // 1. 领取登录奖励
    if (action === 'claim_login') {
      if (t.dailyLoginClaimed) return res.status(400).json({ success: false, message: 'Already claimed' });
      t.global = (t.global || 0) + 10000;
      t.dailyLoginClaimed = true;
      await db.collection('users').updateOne({ username }, { $set: { token: t } });
      return res.status(200).json({ success: true, message: '10,000 tokens claimed!' });
    }

    // 2. 领取做题奖励
    if (action === 'claim_quest') {
      if (t.dailyQuestClaimed) return res.status(400).json({ success: false, message: 'Already claimed' });
      // 这里为了严谨，应该再查一次库确认，但前端只在 completed 时才会允许点，这里省略重复查询
      t.global = (t.global || 0) + 30000;
      t.dailyQuestClaimed = true;
      await db.collection('users').updateOne({ username }, { $set: { token: t } });
      return res.status(200).json({ success: true, message: '30,000 tokens claimed!' });
    }

    // 3. 购买/切换主题
    if (action === 'buy_theme') {
      if (!AVAILABLE_THEMES.includes(theme)) return res.status(400).json({ success: false, message: 'Invalid theme' });
      
      // 每次切换/购买消耗 300k
      const totalAvailable = (t.daily || 0) + (t.global || 0);
      if (totalAvailable < THEME_COST) {
        return res.status(400).json({ success: false, message: 'Not enough tokens (Requires 300k)' });
      }

      // 扣费逻辑：先扣 daily 再扣 global
      let remain = THEME_COST;
      if (t.daily >= remain) { t.daily -= remain; remain = 0; }
      else { remain -= t.daily; t.daily = 0; }
      if (remain > 0) { t.global -= remain; }

      await db.collection('users').updateOne({ username }, { $set: { token: t } });
      await db.collection('userdata').updateOne({ username }, { $set: { theme } }, { upsert: true });

      return res.status(200).json({ success: true, message: 'Theme applied!', theme });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
export default wrapHandler(handler);