// api/paper-mc.js —— 选择题卷子的整卷提交与单题 check
//
// 单题 check 和整卷 submit 复用同一套判分：把题号 + 学生选的字母交给
// problem.logic（lib/logic-runner.js），拿回 {score, comment}。
//
//   action=check   单题；必填 problemId + pick
//   action=submit  整卷；必填 items:[{problemId, pick}]
//
// 两条路径都会把结果写进 submissions，status 用统一的编码，
// comment 就是 logic 返回的那句话。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { runCustomLogic } from '../lib/logic-runner.js';
import { encodeStatus } from '../lib/submission-status.js';
import { generateSubid, updateUserStats, rewardFirstAC, runPostSubmit } from '../lib/submission.js';
import { isMcq } from '../lib/mcq.js';
import { auditLog } from '../lib/audit.js';

const MAX_ITEMS = 80;

async function gradeOne(db, problem, pick) {
  const logic = String(problem.logic || '').trim();
  if (!logic) {
    return { score: 0, comment: 'This question has no grader configured.', systemError: true };
  }
  const r = await runCustomLogic(logic, String(problem.ans ?? ''), String(pick ?? ''));
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(r && r.score) || 0))),
    comment: String((r && r.comment) || '').slice(0, 2000),
    systemError: !!(r && r.systemError),
  };
}

async function recordSubmission(db, username, problem, pick, graded) {
  const subid = generateSubid();
  const now = new Date();
  const doc = {
    subid,
    username,
    problemId: String(problem.id),
    type: 'mc',
    timestamp: now,
    answer: String(pick || ''),
    image: '',
    status: encodeStatus({ score: graded.score, systemError: graded.systemError }),
    comment: graded.comment,
    markedAt: now,
  };
  await db.collection('submissions').insertOne(doc);

  let firstAC = false;
  try {
    firstAC = await updateUserStats(db, username, String(problem.id), graded.score === 100);
    if (firstAC) await rewardFirstAC(db, { username, rawUsername: username, problem });
  } catch (e) { console.error('[paper-mc] stats failed:', e); }

  return { subid: doc.subid, status: doc.status, score: graded.score, comment: graded.comment, firstAC };
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });
  const username = decoded.username;

  const db = await connectToDatabase();
  const action = req.query.action || 'check';
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  // ── 单题 check ────────────────────────────────────────
  if (action === 'check') {
    const problemId = String((req.body && req.body.problemId) || '').trim();
    const pick = String((req.body && req.body.pick) || '').trim().toUpperCase();
    if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });
    if (!pick) return res.status(400).json({ success: false, message: 'Pick an option first' });

    const problem = await db.collection('problems').findOne({ id: problemId });
    if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
    if (!isMcq(problem)) return res.status(400).json({ success: false, message: 'Not a multiple-choice question' });

    const graded = await gradeOne(db, problem, pick);
    const rec = await recordSubmission(db, username, problem, pick, graded);

    await runPostSubmit(db, username, {
      justAC: graded.score === 100,
      problemId: String(problemId),
    }).catch(() => {});

    auditLog(db, 'mcq_check', { problemId, pick, score: graded.score }, username, 'info').catch(() => {});

    return res.status(200).json({
      success: true,
      ...rec,
      correct: graded.score === 100,
      // 注意：绝不返回正确答案，学生只能看到自己选的那个圈变色
    });
  }

  // ── 整卷 submit ───────────────────────────────────────
  if (action === 'submit') {
    const rawItems = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    if (!rawItems.length) return res.status(400).json({ success: false, message: 'Nothing to submit' });
    if (rawItems.length > MAX_ITEMS) {
      return res.status(400).json({ success: false, message: 'Too many questions in one submit (max ' + MAX_ITEMS + ')' });
    }

    const ids = [...new Set(rawItems.map((x) => String((x && x.problemId) || '').trim()).filter(Boolean))];
    const problems = await db.collection('problems').find({ id: { $in: ids } }).toArray();
    const byId = new Map(problems.map((p) => [String(p.id), p]));

    const results = [];
    for (const raw of rawItems) {
      const pid = String((raw && raw.problemId) || '').trim();
      const pick = String((raw && raw.pick) || '').trim().toUpperCase();
      const problem = byId.get(pid);

      if (!pid) continue;
      if (!problem) { results.push({ problemId: pid, error: 'not found' }); continue; }
      if (!isMcq(problem)) { results.push({ problemId: pid, error: 'not multiple choice' }); continue; }
      if (!pick) { results.push({ problemId: pid, error: 'not attempted', attempted: false }); continue; }

      const graded = await gradeOne(db, problem, pick);
      const rec = await recordSubmission(db, username, problem, pick, graded);
      results.push({
        problemId: pid,
        pick,
        score: graded.score,
        correct: graded.score === 100,
        comment: graded.comment,
        subid: rec.subid,
        attempted: true,
      });
    }

    const attempted = results.filter((r) => r.attempted !== false && !r.error);
    const correct = attempted.filter((r) => r.correct).length;

    await runPostSubmit(db, username, { justAC: correct > 0 }).catch(() => {});
    auditLog(db, 'mcq_submit', { total: results.length, attempted: attempted.length, correct }, username, 'info').catch(() => {});

    return res.status(200).json({
      success: true,
      total: results.length,
      attempted: attempted.length,
      correct,
      results,
    });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

export default wrapHandler(handler);
