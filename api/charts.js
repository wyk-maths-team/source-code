// api/charts.js
import { connectToDatabase } from './_db.js';
import { auditLog } from '../lib/audit.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import * as U from '../lib/userStore.js';

// 24 小時緩存：聚合一次約 3 秒，避免頻繁觸發
let _chartCache = { data: null, expireAt: 0 };
const CHART_CACHE_TTL = 24 * 60 * 60_000;

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  // 命中緩存
  if (_chartCache.data && _chartCache.expireAt > Date.now()) {
    return res.status(200).json({ success: true, data: _chartCache.data, cached: true });
  }

  try {
    const db = await connectToDatabase();

    // 聚合：每位用戶對每題的最早 AC 時間 → 按日期累計
    const pipeline = [
      { $match: { correct: true, systemError: false } },
      {
        $group: {
          _id: { username: '$username', problemId: '$problemId' },
          firstCorrect: { $min: '$timestamp' },
        },
      },
      {
        $addFields: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$firstCorrect' } },
        },
      },
      {
        $group: {
          _id: { username: '$_id.username', date: '$date' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1 } },
    ];

    const dailyData = await db.collection('submissions').aggregate(pipeline).toArray();

    // 收集所有日期
    const dateSet = new Set();
    dailyData.forEach(d => dateSet.add(d._id.date));
    const datesArray = Array.from(dateSet).sort();

    // 真空數據：回傳空結果，且**不**寫入緩存
    // 這樣萬一某次查詢異常，不會鎖死 24 小時
    if (datesArray.length === 0) {
      return res.status(200).json({ success: true, data: { dates: [], users: [] } });
    }

    // 補齊日期（從開服第一天到今天）
    const startDate = new Date(datesArray[0] + 'T00:00:00Z');
    const endDate = new Date();
    const allDates = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().split('T')[0]);
    }

    // 按 user 重組
    const userMap = {};
    dailyData.forEach(d => {
      const username = d._id.username;
      const date = d._id.date;
      if (!userMap[username]) userMap[username] = {};
      userMap[username][date] = d.count;
    });

    const usernames = Object.keys(userMap);

    // 一次性拉 realName（避免前端顯示時還要再打 API）
    const userDocs = await U.getUsersByNames(usernames);
    const nameMap = Object.fromEntries(
      userDocs.map(u => [u.username, { realName: u.realName || '', displayName: u.displayName || '' }])
    );

    // 構建累計序列
    const users = usernames.map(username => {
      const dailyMap = userMap[username];
      let cumulative = 0;
      const daily = allDates.map(date => {
        cumulative += (dailyMap[date] || 0);
        return cumulative;
      });
      const meta = nameMap[username] || {};
      return {
        username,
        realName: meta.realName || '',
        displayName: meta.displayName || '',
        daily,
      };
    });

    users.sort((a, b) => a.username.localeCompare(b.username));

    const payload = { dates: allDates, users };
    _chartCache = { data: payload, expireAt: Date.now() + CHART_CACHE_TTL };
    return res.status(200).json({ success: true, data: payload });
  } catch (err) {
    console.error('Charts API error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

// 统一错误兜底：未捕获异常 -> { success:false, code, message, detail, requestId }
export default wrapHandler(handler);