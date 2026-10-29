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
import * as U from '../lib/userStore.js';

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
    // ⭐ 用户列表与状态计数都在 PostgreSQL，一条 GROUP BY 取代全量拉取
    const [users, countMap] = await Promise.all([
      U.listUsersForAdmin(),
      U.getStatusCountsByUser(),
    ]);

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

    const [user, states] = await Promise.all([
      U.getUser(username),
      U.getStates(username),
    ]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
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

    if (!(await U.getUser(username))) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // 差异计算与写入都在 userStore 的事务里，返回实际改动的条目
    const log = await U.bulkSetStates(username, changes);
    if (log.length === 0) {
      return res.status(200).json({ success: true, changed: 0, message: 'Nothing to save' });
    }

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