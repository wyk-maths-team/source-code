// api/token-hub.js
//
// 每日任务 + 主题商店。
//
// 这一版修掉的老问题：
//   1. 每日重置散在两处（这里 + lib/token.js），先做题再开页面就永远
//      领不到每日登入 —— 现在统一走 ensureDailyReset()。
//   2. GET 会把重置后的 token 只在内存里改掉、不落库，前端余额和 DB 对不上。
//   3. claim_quest 服务端完全不校验完成度，curl 一下就能白拿 30,000。
//   4. 领取不是原子的，双开/连点可以领两次 —— 现在用条件 findOneAndUpdate。
//   5. 直接 `t.global += ...` 再 `$set: { token: t }`，会顺手抹掉
//      token 里 normalize() 不认识的字段 —— 现在只 $inc 需要的字段。
//
// 任务定义与完成度判定在 lib/quests.js，这里只负责 HTTP 层。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { getUserRating } from '../lib/userRating.js';
import { ensureDailyReset } from '../lib/token.js';
import {
  computeQuests, invalidateQuestCache, hktToday, STREAK_MILESTONES,
} from '../lib/quests.js';

const THEME_COST = 300000;
const AVAILABLE_THEMES = [
  'default', 'sakura', 'ocean', 'forest', 'sunset',
  'cyberpunk', 'matrix', 'scifi', 'midnight', 'nord', 'mono',
];

function tokenSnapshot(token) {
  const t = token || {};
  return {
    daily: Number.isFinite(Number(t.daily)) ? Number(t.daily) : 0,
    global: Number.isFinite(Number(t.global)) ? Number(t.global) : 0,
  };
}

// findOneAndUpdate 在 mongodb v4 返回 { value }，v6 起直接返回文档。
// 两种都兼容，免得以后升 driver 又炸。
function unwrap(result) {
  if (!result) return null;
  return Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
}

async function buildHubState(db, user, username) {
  const ratingData = await getUserRating(db, username);
  const [quests, userdata] = await Promise.all([
    computeQuests(db, username, { rating: ratingData.rating, user }),
    db.collection('userdata').findOne({ username }, { projection: { theme: 1 } }),
  ]);

  return {
    success: true,
    displayName: user.displayName || username,
    rating: ratingData.rating,
    solvedCount: ratingData.solvedCount,
    tokens: tokenSnapshot(user.token),
    quests: quests.quests,
    level: quests.level,
    streak: quests.streak,
    daily: {
      date: quests.date,
      targetDifficulty: quests.targetDifficulty,
      problem: quests.dailyProblem,
    },
    stats: quests.stats,
    theme: userdata?.theme || 'default',
    shop: { cost: THEME_COST, themes: AVAILABLE_THEMES },
  };
}

// ── 领取每日任务 ──
async function claimQuest(db, username, questId) {
  const user = await ensureDailyReset(db, username);
  if (!user) return { status: 404, body: { success: false, message: 'User not found' } };

  // 关键：领取时强制 fresh 重算，绝不信前端说的「我完成了」
  const { rating } = await getUserRating(db, username);
  const quests = await computeQuests(db, username, { rating, user, fresh: true });
  const quest = quests.quests.find((q) => q.id === questId);

  if (!quest) {
    return { status: 400, body: { success: false, message: 'Unknown quest' } };
  }
  if (quest.claimed) {
    return { status: 400, body: { success: false, message: 'Already claimed today' } };
  }
  if (!quest.completed) {
    return { status: 400, body: { success: false, message: 'Quest not completed yet' } };
  }

  const today = hktToday();
  const update = {
    $push: { 'dailyQuests.claimed': questId },
    $inc: { 'token.global': quest.reward },
  };
  // 旧字段一起维护，避免还有别处按它们判断
  const set = {};
  if (questId === 'login') set['token.dailyLoginClaimed'] = true;
  if (questId === 'daily') set['token.dailyQuestClaimed'] = true;
  if (Object.keys(set).length) update.$set = set;

  const doc = unwrap(await db.collection('users').findOneAndUpdate(
    { username, 'dailyQuests.date': today, 'dailyQuests.claimed': { $ne: questId } },
    update,
    { returnDocument: 'after', projection: { token: 1, dailyQuests: 1 } }
  ));

  if (!doc) {
    // 另一个请求先领了，或者刚好跨天刷新了
    return { status: 409, body: { success: false, message: 'State changed — please refresh' } };
  }

  invalidateQuestCache(username);
  return {
    status: 200,
    body: {
      success: true,
      questId,
      reward: quest.reward,
      message: `+ ${quest.reward.toLocaleString('en-US')} tokens`,
      tokens: tokenSnapshot(doc.token),
    },
  };
}

// ── 领取连续学习里程碑 ──
async function claimStreak(db, username, days) {
  const milestone = STREAK_MILESTONES.find((m) => m.days === Number(days));
  if (!milestone) {
    return { status: 400, body: { success: false, message: 'Unknown milestone' } };
  }

  const doc = unwrap(await db.collection('users').findOneAndUpdate(
    {
      username,
      streakDays: { $gte: milestone.days },
      streakClaimed: { $ne: milestone.days },
    },
    {
      $addToSet: { streakClaimed: milestone.days },
      $inc: { 'token.global': milestone.reward },
    },
    { returnDocument: 'after', projection: { token: 1, streakClaimed: 1, streakDays: 1 } }
  ));

  if (!doc) {
    return { status: 400, body: { success: false, message: 'Not reached yet, or already claimed' } };
  }

  invalidateQuestCache(username);
  return {
    status: 200,
    body: {
      success: true,
      reward: milestone.reward,
      message: `连续学习 ${milestone.days} 天！+ ${milestone.reward.toLocaleString('en-US')} tokens`,
      tokens: tokenSnapshot(doc.token),
    },
  };
}

// ── 买主题（乐观锁，防止双开买两次）──
async function buyTheme(db, username, theme) {
  if (!AVAILABLE_THEMES.includes(theme)) {
    return { status: 400, body: { success: false, message: 'Invalid theme' } };
  }

  const user = await ensureDailyReset(db, username);
  if (!user) return { status: 404, body: { success: false, message: 'User not found' } };

  const t = tokenSnapshot(user.token);
  if (t.daily + t.global < THEME_COST) {
    return { status: 400, body: { success: false, message: 'Not enough tokens (Requires 300k)' } };
  }

  let daily = t.daily;
  let global = t.global;
  if (daily >= THEME_COST) {
    daily -= THEME_COST;
  } else {
    const remain = THEME_COST - daily;
    daily = 0;
    global -= remain;
  }

  const result = await db.collection('users').updateOne(
    { username, 'token.daily': t.daily, 'token.global': t.global },
    { $set: { 'token.daily': daily, 'token.global': global } }
  );

  if (!result || result.modifiedCount === 0) {
    return { status: 409, body: { success: false, message: '余额刚刚变了，请重试' } };
  }

  await db.collection('userdata').updateOne({ username }, { $set: { theme } }, { upsert: true });
  invalidateQuestCache(username);
  return {
    status: 200,
    body: { success: true, message: 'Theme applied!', theme, tokens: { daily, global } },
  };
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const username = decoded.username;

  if (req.method === 'GET') {
    const user = await ensureDailyReset(db, username);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const state = await buildHubState(db, user, username);
    return res.status(200).json(state);
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const action = String(body.action || '');

    if (action === 'claim' || action === 'claim_login' || action === 'claim_quest') {
      const questId = action === 'claim_login'
        ? 'login'
        : action === 'claim_quest'
          ? 'daily'
          : String(body.questId || '');
      if (!questId) return res.status(400).json({ success: false, message: 'Missing questId' });

      const out = await claimQuest(db, username, questId);
      return res.status(out.status).json(out.body);
    }

    if (action === 'claim_streak') {
      const out = await claimStreak(db, username, body.days);
      return res.status(out.status).json(out.body);
    }

    if (action === 'buy_theme') {
      const out = await buyTheme(db, username, String(body.theme || ''));
      return res.status(out.status).json(out.body);
    }

    return res.status(400).json({ success: false, message: 'Unknown action' });
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

export default wrapHandler(handler);
