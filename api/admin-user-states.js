// api/admin-user-states.js —— 答题状态管理（仅 root）
//
// 用途：管理员直接修改某个用户在任意题目的状态。
// 这是修复数据的手段（OCR 错题、误判、历史遗留），不是日常操作，
// 所以：
//   - 只有 root 能用（admin 不能）
//   - 每次保存都写审计日志，记录改了哪些题、从什么改成什么
//   - 保存时同步清掉 rating 缓存，避免改完 rating 还是旧的
//
// actions:
//   GET  ?action=users              -> 用户列表（含 solved 数）
//   GET  ?action=states&username=x  -> 该用户的状态表 + 题目难度
//   POST ?action=save               -> { username, changes: { pid: 'passed'|'failed'|null } }

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { wrapHandler } from '../lib/errors.js';
import { invalidateUserRating } from '../lib/userRating.js';

const VALID_STATES = new Set(['passed', 'failed', 'not_started']);

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  // 只有 root。admin 也不够 —— 这是直接改判分数据。
  if (decoded.role !== 'root') {
    return res.status(403).json({
      success: false,
      code: 'ROOT_ONLY',
      message: 'Only root can modify answer states',
    });
  }

  const db = await connectToDatabase();
  const action = req.query.action;

  // ── 用户列表 ──
  if (action === 'users') {
    const [users, statsList] = await Promise.all([
      db.collection('users')
        .find({}, { projection: { username: 1, displayName: 1, realName: 1, role: 1, banned: 1, _id: 0 } })
        .sort({ username: 1 })
        .toArray(),
      db.collection('userstats')
        .find({}, { projection: { username: 1, states: 1, _id: 0 } })
        .toArray(),
    ]);

    const countMap = {};
    for (const s of statsList) {
      const states = s.states || {};
      let passed = 0, failed = 0;
      for (const v of Object.values(states)) {
        if (v === 'passed') passed++;
        else if (v === 'failed') failed++;
      }
      countMap[s.username] = { passed, failed, total: passed + failed };
    }

    const list = users.map(u => ({
      username: u.username,
      displayName: u.displayName || u.username,
      realName: u.realName || '',
      role: u.role || 'student',
      banned: !!u.banned,
      passed: countMap[u.username]?.passed || 0,
      failed: countMap[u.username]?.failed || 0,
    }));

    return res.status(200).json({ success: true, users: list });
  }

  // ── 单个用户的状态 ──
  if (action === 'states') {
    const username = String(req.query.username || '').trim();
    if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

    const [user, stats] = await Promise.all([
      db.collection('users').findOne({ username }, { projection: { displayName: 1, realName: 1, role: 1, _id: 0 } }),
      db.collection('userstats').findOne({ username }, { projection: { states: 1, _id: 0 } }),
    ]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const states = stats?.states || {};
    const pids = Object.keys(states);

    // 难度表（走 60s 缓存）
    const { getDifficultyMap } = await import('../lib/problemCache.js');
    const diffMap = await getDifficultyMap(db);

    const rows = pids.map(pid => ({
      problemId: pid,
      state: states[pid] === 'passed' ? 'passed' : states[pid] === 'failed' ? 'failed' : 'not_started',
      difficulty: diffMap[pid] ?? null,
      exists: diffMap[pid] !== undefined,
    }));

    // 按难度降序，便于先看难题
    rows.sort((a, b) => (b.difficulty ?? -1) - (a.difficulty ?? -1));

    return res.status(200).json({
      success: true,
      username,
      displayName: user.displayName || username,
      realName: user.realName || '',
      role: user.role || 'student',
      rows,
    });
  }

  // ── 保存 ──
  if (action === 'save') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { username, changes } = req.body || {};
    if (!username || !changes || typeof changes !== 'object') {
      return res.status(400).json({ success: false, message: 'Missing username or changes' });
    }

    const target = await db.collection('users').findOne({ username }, { projection: { _id: 1 } });
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    const statsCol = db.collection('userstats');
    const before = await statsCol.findOne({ username }, { projection: { states: 1, _id: 0 } });
    const beforeStates = before?.states || {};

    const setOps = {};
    const unsetOps = {};
    const log = [];

    for (const [pid, raw] of Object.entries(changes)) {
      if (!pid || pid.length > 64) continue;
      const next = String(raw);
      if (!VALID_STATES.has(next)) continue;

      const prev = beforeStates[pid] || 'not_started';
      if (prev === next) continue;                    // 没变就不写

      if (next === 'not_started') {
        unsetOps[`states.${pid}`] = '';
      } else {
        setOps[`states.${pid}`] = next;
      }
      log.push({ problemId: pid, from: prev, to: next });
    }

    if (log.length === 0) {
      return res.status(200).json({ success: true, changed: 0, message: 'Nothing to save' });
    }

    const update = {};
    if (Object.keys(setOps).length) update.$set = setOps;
    if (Object.keys(unsetOps).length) update.$unset = unsetOps;

    await statsCol.updateOne(
      { username },
      { ...update, $setOnInsert: { username } },
      { upsert: true }
    );

    // 状态变了，rating 必须重算
    invalidateUserRating(username);

    await auditLog(db, 'user_state_override', {
      username,
      changed: log,
      count: log.length,
    }, decoded.username, 'warn').catch(() => {});

    return res.status(200).json({ success: true, changed: log.length, log });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

export default wrapHandler(handler);
