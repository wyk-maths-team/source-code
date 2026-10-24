import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { calculateUserRating } from '../lib/rating.js'; // ⭐ 引入你的核心算法

const THEME_COST = 300000;
const AVAILABLE_THEMES = ['default', 'cyberpunk', 'sakura', 'matrix', 'scifi'];

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const username = decoded.username;

  const user = await db.collection('users').findOne({ username }, { projection: { token: 1, displayName: 1 } });
  const userdata = await db.collection('userdata').findOne({ username }, { projection: { theme: 1 } });
  const userstats = await db.collection('userstats').findOne({ username }, { projection: { states: 1 } });

  if (!user) return res.status(404).json({ success: false, message: 'User not found' });

  // ⭐ 实时计算真实 Rating 和 Solved Count
  const states = userstats?.states || {};
  const solvedPids = Object.entries(states).filter(([_, s]) => s === 'passed').map(([pid]) => pid);
  const probs = await db.collection('problems').find({ id: { $in: solvedPids } }).project({ id: 1, difficulty: 1 }).toArray();
  const diffMap = Object.fromEntries(probs.map(p => [p.id, p.difficulty]));
  const solvedDifficulties = solvedPids.map(pid => diffMap[pid]).filter(Number.isFinite);
  
  const ratingData = calculateUserRating({ solvedDifficulties });
  const rating = ratingData.rating;
  const solvedCount = solvedDifficulties.length;

  // 映射今日任务难度（Rating 1500->3, Rating 2500->6）
  const targetDifficulty = Math.max(1, Math.min(10, Math.floor((rating - 1000) / 300) + 2));

  const today = new Date(Date.now() + 8 * 3600000).toISOString().split('T')[0];
  let t = user.token || { daily: 30000, global: 100000, lastReset: today };

  if (t.lastReset !== today) {
    t.daily = 30000;
    t.lastReset = today;
    t.dailyLoginClaimed = false;
    t.dailyQuestClaimed = false;
  }

  if (req.method === 'GET') {
    let questCompleted = false;
    if (!t.dailyQuestClaimed) {
      const todayStart = new Date(`${today}T00:00:00+08:00`);
      const acRecords = await db.collection('submissions').find({
        username, correct: true, timestamp: { $gte: todayStart }
      }).project({ problemId: 1 }).toArray();

      if (acRecords.length > 0) {
        const pids = acRecords.map(r => r.problemId);
        const probsToday = await db.collection('problems').find({ id: { $in: pids }, difficulty: { $gte: targetDifficulty } }).toArray();
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
      theme: userdata?.theme || 'default'
    });
  }

  if (req.method === 'POST') {
    const { action, theme } = req.body || {};

    if (action === 'claim_login') {
      if (t.dailyLoginClaimed) return res.status(400).json({ success: false, message: 'Already claimed' });
      t.global = (t.global || 0) + 10000;
      t.dailyLoginClaimed = true;
      await db.collection('users').updateOne({ username }, { $set: { token: t } });
      return res.status(200).json({ success: true, message: '10,000 tokens claimed!' });
    }

    if (action === 'claim_quest') {
      if (t.dailyQuestClaimed) return res.status(400).json({ success: false, message: 'Already claimed' });
      t.global = (t.global || 0) + 30000;
      t.dailyQuestClaimed = true;
      await db.collection('users').updateOne({ username }, { $set: { token: t } });
      return res.status(200).json({ success: true, message: '30,000 tokens claimed!' });
    }

    if (action === 'buy_theme') {
      if (!AVAILABLE_THEMES.includes(theme)) return res.status(400).json({ success: false, message: 'Invalid theme' });
      const totalAvailable = (t.daily || 0) + (t.global || 0);
      if (totalAvailable < THEME_COST) {
        return res.status(400).json({ success: false, message: 'Not enough tokens (Requires 300k)' });
      }

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