// lib/difficulty-sweep.js
//
// 动态难度批量扫描：从 submissions 取「首次作答」观测，
// 计算参与用户 rating，再对每道题跑 adjustDifficulty 并写回。
//
// 供 cron 与 admin 手动触发共用。

import { calculateUserRating } from './rating.js';
import { adjustDifficulty } from './difficulty-adjust.js';

// 团队虚拟用户（纯数字 username）跳过，避免污染难度信号
function isTeamUser(username) {
  return /^\d+$/.test(String(username || ''));
}

/**
 * 批量调整全部题目的难度
 * @param {object} db          Mongo db 实例
 * @param {object} [opts]      透传给 adjustDifficulty 的 opts
 * @returns {Promise<{total:number, adjusted:number, skipped:number, results:Array}>}
 */
export async function sweepDifficulties(db, opts = {}) {
  // 1. 题目列表
  const problems = await db.collection('problems').find({}, {
    projection: {
      id: 1, difficulty: 1, manualDifficulty: 1, difficultyLocked: 1, public: 1, _id: 0,
    },
  }).toArray();

  // 2. 首次作答：每个 (username, problemId) 取最早一条提交
  const firstAttempts = await db.collection('submissions').aggregate([
    { $match: { systemError: { $ne: true } } },
    { $sort: { timestamp: 1 } },
    { $group: {
      _id: { username: '$username', problemId: '$problemId' },
      correct: { $first: '$correct' },
      score:   { $first: '$score' },
      marked:  { $first: '$marked' },
    } },
  ]).toArray();

  // 3. 按题目聚合首次作答结果
  const attemptsByProblem = new Map();
  const involvedUsers = new Set();
  for (const fa of firstAttempts) {
    const username  = fa._id.username;
    const problemId = String(fa._id.problemId);
    if (isTeamUser(username)) continue;
    const correct = fa.correct === true || (fa.marked === true && fa.score === 100);
    if (!attemptsByProblem.has(problemId)) attemptsByProblem.set(problemId, []);
    attemptsByProblem.get(problemId).push({ username, firstAttemptCorrect: correct });
    involvedUsers.add(username);
  }

  // 4. 题目难度映射（用于算用户 rating）
  const diffMap = Object.fromEntries(problems.map(p => [String(p.id), Number(p.difficulty) || 0]));

  // 5. 计算参与用户的 rating
  const ratingMap = new Map();
  if (involvedUsers.size > 0) {
    const statsDocs = await db.collection('userstats').find(
      { username: { $in: [...involvedUsers] } },
      { projection: { username: 1, states: 1, _id: 0 } }
    ).toArray();

    for (const s of statsDocs) {
      const solvedDiffs = [];
      for (const [pid, st] of Object.entries(s.states || {})) {
        if (st === 'passed' && diffMap[pid] !== undefined) {
          solvedDiffs.push(diffMap[pid]);
        }
      }
      const r = calculateUserRating({ solvedDifficulties: solvedDiffs });
      ratingMap.set(s.username, { rating: r.rating, solvedCount: solvedDiffs.length });
    }
  }

  // 6. 逐题调整
  const results = [];
  for (const p of problems) {
    const pid = String(p.id);

    if (p.difficultyLocked === true) {
      results.push({ problemId: pid, skipped: true, reason: 'locked' });
      continue;
    }

    const rawAttempts = attemptsByProblem.get(pid) || [];
    const attempts = rawAttempts.map(a => {
      const r = ratingMap.get(a.username);
      return {
        username: a.username,
        rating: r ? r.rating : 1000,
        solvedCount: r ? r.solvedCount : 0,
        firstAttemptCorrect: a.firstAttemptCorrect,
      };
    });

    const currentDifficulty = Number(p.difficulty) || 0;
    const manualDifficulty = p.manualDifficulty !== undefined
      ? Number(p.manualDifficulty)
      : undefined;

    const res = adjustDifficulty({ currentDifficulty, manualDifficulty, attempts, opts });

    if (res.delta !== 0 && res.newDifficulty !== currentDifficulty) {
      await db.collection('problems').updateOne(
        { id: p.id },
        { $set: { difficulty: res.newDifficulty, difficultyLastAdjustedAt: new Date() } }
      );
    }

    results.push({ problemId: pid, ...res });
  }

  return {
    total: problems.length,
    adjusted: results.filter(r => r.delta !== 0).length,
    skipped: results.filter(r => r.skipped).length,
    results,
  };
}
