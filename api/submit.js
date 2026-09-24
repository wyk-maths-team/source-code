// api/submit.js
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { runCustomLogic } from '../lib/logic-runner.js';
import crypto from 'crypto';
// import vm from 'vm';

// ========== 用戶級限流 ==========
const submitRateLimit = new Map();
const MAX_SUBMITS_PER_MIN = 10;
const LIMIT_WINDOW = 60_000;

function checkUserRateLimit(username) {
  const t = Date.now();
  const rec = submitRateLimit.get(username);
  if (!rec) {
    submitRateLimit.set(username, { count: 1, firstTime: t });
    return true;
  }
  if (t - rec.firstTime > LIMIT_WINDOW) {
    rec.count = 1;
    rec.firstTime = t;
    return true;
  }
  if (rec.count >= MAX_SUBMITS_PER_MIN) return false;
  rec.count++;
  return true;
}

// ========== 工具函數 ==========
function generateSubid() {
  const ts = Date.now().toString(36);
  const rnd = crypto.randomBytes(6).toString('base64url').slice(0, 8);
  return ts + rnd;
}

function isValidNumericAnswer(value) {
  if (value === '' || value === null || value === undefined) return false;
  return Number.isFinite(Number(String(value).trim()));
}

function compareNumeric(ansStr, userAnswer) {
  const ans = Number(ansStr);
  if (!Number.isFinite(ans)) return { correct: false, systemError: true };
  const user = Number(userAnswer);
  if (!Number.isFinite(user)) return { correct: false, systemError: true };
  return { correct: Math.abs(user - ans) < 1e-6, systemError: false };
}

// function executeCustomLogic(logicStr, ans, userAnswer) {
//   try {
//     const result = vm.runInNewContext(
//       `(${logicStr})(${JSON.stringify(ans)}, ${JSON.stringify(userAnswer)})`
//     );
//     if (typeof result === 'number') {
//       return { score: Math.min(100, Math.max(0, result)), comment: '', systemError: false };
//     }
//     if (result && typeof result === 'object' && typeof result.score === 'number') {
//       return { score: Math.min(100, Math.max(0, result.score)), comment: result.comment || '', systemError: false };
//     }
//     return { score: 0, comment: 'Invalid logic return value', systemError: true };
//   } catch (err) {
//     return { score: 0, comment: 'Logic error: ' + err.message, systemError: true };
//   }
// }

async function updateUserStats(db, username, pid, correct) {
  const statsCol = db.collection('userstats');
  await statsCol.updateOne(
    { username },
    { $setOnInsert: { username, states: {} } },
    { upsert: true }
  );
  if (correct) {
    await statsCol.updateOne({ username }, { $set: { [`states.${pid}`]: 'passed' } });
  } else {
    await statsCol.updateOne(
      { username, [`states.${pid}`]: { $ne: 'passed' } },
      { $set: { [`states.${pid}`]: 'failed' } }
    );
  }
}

// ========== 主處理函數 ==========
export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = await verifyToken(req);
  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const { username, role } = decoded;
    // ⭐ 检测是否在特殊竞赛的队伍中
  const db = await connectToDatabase();
  const now = new Date();
  let teamContext = null;

  // 找所有进行中的 special contest
  const activeSpecials = await db.collection('contests').find({
    special: true,
    startTime: { $lte: now },
    $expr: { $gte: [{ $add: ['$startTime', { $multiply: ['$duration', 60000] }] }, now] }
  }, { projection: { id: 1, problems: 1, _id: 0 } }).toArray();

  for (const c of activeSpecials) {
    const t = await db.collection('teams').findOne({
      contestId: c.id,
      members: username
    });
    if (t) {
      const inContest = (c.problems || []).some(p => {
        const pid = (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p);
        return pid === String(req.body.problemId).trim();
      });
      teamContext = { team: t, contest: c, inContest };
      break;
    }
  }

  // 在特殊竞赛队伍中
  if (teamContext) {
    // 若在竞赛期间但提交的是非竞赛题 → 拒绝
    if (!teamContext.inContest) {
      return res.status(403).json({ success: false, message: 'You cannot submit other problems during a special contest' });
    }

    const team = teamContext.team;
    const contest = teamContext.contest;
    const teamUsername = String(team.id);
    const pid = String(req.body.problemId).trim();

    // 检查是否已锁定
    const locked = await db.collection('contest_results').findOne({
      contestId: contest.id, username: teamUsername, problemId: pid
    });
    if (locked && locked.locked) {
      return res.status(400).json({ success: false, message: 'Problem is WA-locked (0 pts permanent)' });
    }

    // Mode 1：成员提交建议，不入库
    if (team.mode === 1) {
      const answer = String(req.body.answer || '').trim();
      if (!answer) return res.status(400).json({ success: false, message: 'Empty answer' });

      const existing = (team.suggestions || []).findIndex(
        s => s.username === username && s.problemId === pid
      );
      const suggestion = { username, problemId: pid, answer, ts: now };
      if (existing >= 0) {
        await db.collection('teams').updateOne(
          { id: team.id },
          { $set: { [`suggestions.${existing}`]: suggestion } }
        );
      } else {
        await db.collection('teams').updateOne(
          { id: team.id },
          { $push: { suggestions: suggestion } }
        );
      }
      return res.status(200).json({ success: true, suggested: true, message: 'Suggestion sent' });
    }

    // Mode 2：直接以 team 名义提交
    // 队长本人可以直接提交（不论 mode）
    if (username !== team.captain) {
      // 队员在 mode 2 也直接提交
    }
    // 用 teamUsername 覆盖 username，继续走原有逻辑
    // 把 req.body 改一下然后走下面的流程
    req.body._teamContext = {
      teamUsername,
      contestId: contest.id,
      submittedBy: username,
    };
    // 覆盖 decoded.username（在下面用局部变量控制）
  }

  if (!['student', 'admin', 'root'].includes(role)) {
    return res.status(403).json({ success: false, message: 'Only students can submit' });
  }
    // ⭐ Batch 提交（試卷）
  if (req.query.action === 'batch') {
    const { paperId, answers } = req.body || {};
    if (!paperId || !answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: 'Missing paperId or answers' });
    }

    const answerIds = Object.keys(answers).slice(0, 100);
    if (answerIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No answers' });
    }

    try {
      const db = await connectToDatabase();

      // 確認主試卷存在
      const paper = await db.collection('problems').findOne(
        { id: String(paperId) },
        { projection: { id: 1, _id: 0 } }
      );
      if (!paper) {
        return res.status(404).json({ success: false, message: 'Paper not found' });
      }

      // 拿子題
      const problems = await db.collection('problems')
        .find({ id: { $in: answerIds } })
        .toArray();
      const problemMap = Object.fromEntries(problems.map(p => [p.id, p]));

      // 用戶狀態
      const userStatsDoc = await db.collection('userstats').findOne(
        { username },
        { projection: { states: 1, _id: 0 } }
      );
      const userStates = userStatsDoc?.states || {};

      const results = [];
      const inserts = [];
      const setObj = {};
      let submittedCount = 0;
      const now = new Date();

      for (const pid of answerIds) {
        const prob = problemMap[pid];
        if (!prob) {
          results.push({ problemId: pid, error: 'Problem not found', skipped: true });
          continue;
        }

        // 已 AC 不可重複交
        if (userStates[pid] === 'passed') {
          results.push({ problemId: pid, alreadyAC: true, skipped: true });
          continue;
        }

        const userAnswer = String(answers[pid] ?? '').trim();
        if (!userAnswer) {
          results.push({ problemId: pid, error: 'Empty answer', skipped: true });
          continue;
        }

        // 判分
        const hasLogic = typeof prob.logic === 'string' && prob.logic.trim() !== '';
        let correct = false;
        let systemError = false;
        let score = 0;
        let comment = '';

        if (hasLogic) {
          const r = await runCustomLogic(prob.logic, prob.ans, userAnswer);
          correct = !r.systemError && r.score === 100;
          systemError = r.systemError;
          score = r.score;
          comment = r.comment;
        } else {
          const ansStr = String(prob.ans ?? '').trim();
          if (!isValidNumericAnswer(ansStr)) {
            systemError = true;
          } else {
            const cmp = compareNumeric(ansStr, userAnswer);
            correct = cmp.correct;
            systemError = cmp.systemError;
            score = correct ? 100 : 0;
          }
        }

        const subid = generateSubid();
        inserts.push({
          username,
          problemId: pid,
          type: 'text',
          timestamp: now,
          correct,
          systemError,
          marked: true,
          score,
          comment,
          subid,
          answer: userAnswer,
          image: '',
          paperId: String(paperId),
        });

        if (!systemError) {
          if (correct) {
            setObj[`states.${pid}`] = 'passed';
          } else if (userStates[pid] !== 'passed') {
            setObj[`states.${pid}`] = 'failed';
          }
        }

        results.push({
          problemId: pid,
          subid,
          correct,
          systemError,
          score,
          comment,
        });
        submittedCount++;
      }

      // 寫入
      if (inserts.length > 0) {
        await db.collection('submissions').insertMany(inserts, { ordered: false });
      }
      if (Object.keys(setObj).length > 0) {
        const statsCol = db.collection('userstats');
        await statsCol.updateOne(
          { username },
          { $setOnInsert: { username, states: {} } },
          { upsert: true }
        );
        await statsCol.updateOne({ username }, { $set: setObj });
      }

      return res.status(200).json({
        success: true,
        results,
        submittedCount,
      });
    } catch (err) {
      console.error('Batch submit error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
  if (!checkUserRateLimit(username)) {
    return res.status(429).json({
      success: false,
      message: 'Too many submissions. Please wait a minute.',
    });
  }

  const { problemId, answer, type = 'text', image = '' } = req.body;
  if (!problemId) return res.status(400).json({ success: false, message: 'Missing problemId' });
  if (type === 'text' && answer === undefined) {
    return res.status(400).json({ success: false, message: 'Missing answer' });
  }
  if (type === 'image' && !image) {
    return res.status(400).json({ success: false, message: 'Missing image data' });
  }

  const pid = String(problemId).trim();
  if (!pid) return res.status(400).json({ success: false, message: 'Invalid problemId' });

  // const now = new Date();

  try {
    // const db = await connectToDatabase();
      // let { username, role } = decoded;
      // ⭐ 队伍上下文覆盖
      let teamSubmissionMeta = null;
      if (req.body._teamContext) {
        teamSubmissionMeta = req.body._teamContext;
        username = teamSubmissionMeta.teamUsername;  // 提交以 team 名义
      }

    // ========== 並行查詢：題目 + 活躍競賽 ==========
    const [problem, activeContests] = await Promise.all([
      db.collection('problems').findOne({ id: pid }),
      db.collection('contests')
        .find(
          {
            participants: username,
            startTime: { $lte: now },
            $expr: {
              $gte: [
                { $add: ['$startTime', { $multiply: ['$duration', 60000] }] },
                now,
              ],
            },
          },
          { projection: { id: 1, problems: 1 } }
        )
        .toArray(),
    ]);

    if (!problem) {
      return res.status(404).json({ success: false, message: 'Problem not found' });
    }

    // ========== 確定是否落在活躍競賽中 ==========
    let activeContest = null;
    let contestProblem = null;
    for (const c of activeContests) {
      const cp = c.problems?.find(p => p.problemId === pid);
      if (cp) {
        activeContest = c;
        contestProblem = cp;
        break;
      }
    }
    const inContest = !!activeContest;

    if (role === 'student' && !inContest && problem.public === false) {
      return res.status(404).json({ success: false, message: 'Problem not found' });
    }

    // ========== 構建提交對象 ==========
    const submissionData = {
      username,
      problemId: pid,
      type,
      timestamp: now,
      correct: false,
      systemError: false,
      marked: false,
      score: 0,
      comment: '',
      drawing: '',
      subid: generateSubid(),
      answer: type === 'text' ? String(answer) : '',
      image: '',
    };
        if (teamSubmissionMeta) {
      submissionData.submittedBy = teamSubmissionMeta.submittedBy;
      submissionData.approvedBy = teamSubmissionMeta.submittedBy;  // Mode 2 直接提交
    }

    if (type === 'image') {
      try {
        const { uploadImage } = await import('../lib/cloudinary.js');
        submissionData.image = await uploadImage(image);
      } catch {
        return res.status(500).json({ success: false, message: 'Image upload failed' });
      }
    }

        const hasLogic =
      typeof problem.logic === 'string' && problem.logic.trim() !== '';

        if (inContest) {
          const isSpecial = !!activeContest.special;
          // ---------- 競賽判分 ----------
          const evalType = contestProblem.evalType || 'numeric';

          if (evalType === 'numeric' && type !== 'text') {
            return res.status(400).json({ success: false, message: 'This problem requires a numeric answer' });
          }
          if (evalType === 'image_model' && type !== 'image') {
            return res.status(400).json({ success: false, message: 'This problem requires a photo answer' });
          }

          submissionData.contestId = activeContest.id;

          // 讀取現況（含 solved）
                    const resultDoc = await db
            .collection('contest_results')
            .findOne(
              { contestId: activeContest.id, username, problemId: pid },
              { projection: { wrongAttempts: 1, score: 1, solved: 1, locked: 1 } }
            );
                  // ⭐ WA 锁定检查（特殊竞赛）
            if (resultDoc && resultDoc.locked === true) {
              return res.status(400).json({ success: false, message: 'Problem is WA-locked' });
            }

          const alreadySolved = resultDoc?.solved === true;
          let currentScore = resultDoc?.score || 0;
          let isCorrect = false;
          let systemError = false;

          if (hasLogic) {
            // ---- 競賽 + 邏輯 ----
            const logicResult = await runCustomLogic(problem.logic, problem.ans, answer);

            if (logicResult.systemError) {
              submissionData.systemError = true;
              submissionData.comment = logicResult.comment;
              await db.collection('submissions').insertOne(submissionData);
              return res.status(200).json({
                success: true, subid: submissionData.subid,
                correct: false, systemError: true,
                message: 'Logic execution failed',
              });
            }

            const logicScore = logicResult.score;
            isCorrect = logicScore === 100;
            submissionData.marked = true;
            submissionData.correct = isCorrect;
            submissionData.comment = logicResult.comment;

            if (alreadySolved) {
              // 已 AC 過 → 分數不變
              currentScore = resultDoc.score;
              submissionData.score = currentScore;
              await db.collection('submissions').insertOne(submissionData);
              await db.collection('contest_results').updateOne(
                { contestId: activeContest.id, username, problemId: pid },
                { $set: { lastSubmissionTime: now } }
              );
            } else if (isCorrect) {
              // ⭐ 首次 AC：套用罰分
              const prevWrong = resultDoc?.wrongAttempts || 0;
              currentScore = Math.max(0, 100 * Math.pow(0.9, prevWrong));
              submissionData.score = currentScore;
              await db.collection('submissions').insertOne(submissionData);
              await db.collection('contest_results').updateOne(
                { contestId: activeContest.id, username, problemId: pid },
                { $set: { score: currentScore, solved: true, lastSubmissionTime: now } },
                { upsert: true }
              );
              await updateUserStats(db, username, pid, true);
            } else if (logicScore > 0) {
              // ⭐ Partial（logic 回傳部分分，未 solved）
              currentScore = Math.max(resultDoc?.score || 0, logicScore);
              submissionData.score = currentScore;
              await db.collection('submissions').insertOne(submissionData);
              await db.collection('contest_results').updateOne(
                { contestId: activeContest.id, username, problemId: pid },
                { $set: { score: currentScore, solved: false, lastSubmissionTime: now } },
                { upsert: true }
              );
                        } else {
              // ⭐ WA
              currentScore = resultDoc?.score || 0;
              submissionData.score = currentScore;
              await db.collection('submissions').insertOne(submissionData);
              const upd = {
                $inc: { wrongAttempts: 1 },
                $set: { lastSubmissionTime: now, solved: false },
                $setOnInsert: { score: 0 },
              };
              if (isSpecial) {
                upd.$set.score = 0;
                upd.$set.locked = true;
              }
              await db.collection('contest_results').updateOne(
                { contestId: activeContest.id, username, problemId: pid },
                upd,
                { upsert: true }
              );
            }

            return res.status(200).json({
              success: true, subid: submissionData.subid,
              correct: isCorrect, systemError: false,
              score: currentScore,
              message: 'Judged by custom logic',
            });
          }

          // ---- 競賽 + 無邏輯（數值比較）----
          if (evalType === 'numeric') {
            const ansStr = String(problem.ans).trim();
            if (!isValidNumericAnswer(ansStr)) {
              systemError = true;
            } else {
              const cmp = compareNumeric(ansStr, answer);
              isCorrect = cmp.correct;
              systemError = cmp.systemError;
            }

            if (!systemError) {
              if (alreadySolved) {
                currentScore = resultDoc.score;
                await db.collection('contest_results').updateOne(
                  { contestId: activeContest.id, username, problemId: pid },
                  { $set: { lastSubmissionTime: now } }
                );
              } else if (isCorrect) {
                // ⭐ 首次 AC：套用罰分
                const prevWrong = resultDoc?.wrongAttempts || 0;
                currentScore = Math.max(0, 100 * Math.pow(0.9, prevWrong));
                await db.collection('contest_results').updateOne(
                  { contestId: activeContest.id, username, problemId: pid },
                  { $set: { score: currentScore, solved: true, lastSubmissionTime: now } },
                  { upsert: true }
                );
              } else {
                // ⭐ WA
                currentScore = resultDoc?.score || 0;
                const upd = {
                  $inc: { wrongAttempts: 1 },
                  $set: { solved: false, lastSubmissionTime: now },
                  $setOnInsert: { score: 0 },
                };
                if (isSpecial) {
                  upd.$set.score = 0;
                  upd.$set.locked = true;
                }
                await db.collection('contest_results').updateOne(
                  { contestId: activeContest.id, username, problemId: pid },
                  upd,
                  { upsert: true }
                );
              }
            }
          }
          // evalType === 'image_model'：等人工批改

          submissionData.correct = isCorrect;
          submissionData.systemError = systemError;
          submissionData.score = currentScore;
        } else {
          // ---------- 非競賽判分（不變） ----------
          if (type === 'text') {
            let isCorrect = false;
            let systemError = false;

            if (hasLogic) {
              const logicResult = await runCustomLogic(problem.logic, problem.ans, answer);
              if (logicResult.systemError) {
                submissionData.systemError = true;
                submissionData.comment = logicResult.comment;
                await db.collection('submissions').insertOne(submissionData);
                return res.status(200).json({
                  success: true, subid: submissionData.subid,
                  correct: false, systemError: true,
                  message: 'Logic execution failed',
                });
              }
              submissionData.marked = true;
              submissionData.score = logicResult.score;
              submissionData.comment = logicResult.comment;
              submissionData.correct = logicResult.score === 100;
              submissionData.systemError = false;
              await db.collection('submissions').insertOne(submissionData);
              if (submissionData.correct) await updateUserStats(db, username, pid, true);
              return res.status(200).json({
                success: true, subid: submissionData.subid,
                correct: submissionData.correct, systemError: false,
                score: submissionData.score,
                message: 'Judged by custom logic',
              });
            }

            const ansStr = String(problem.ans).trim();
            if (!isValidNumericAnswer(ansStr)) {
              systemError = true;
            } else {
              const cmp = compareNumeric(ansStr, answer);
              isCorrect = cmp.correct;
              systemError = cmp.systemError;
            }
            submissionData.correct = isCorrect;
            submissionData.systemError = systemError;
          }
        }

    // ========== 統一入庫 ==========
    const writes = [db.collection('submissions').insertOne(submissionData)];
    if (type === 'text' && !submissionData.systemError) {
      writes.push(updateUserStats(db, username, pid, submissionData.correct));
    }
    await Promise.all(writes);

    return res.status(200).json({
      success: true,
      subid: submissionData.subid,
      correct: submissionData.correct,
      systemError: submissionData.systemError,
      message:
        type === 'image'
          ? inContest
            ? 'Image submitted'
            : 'Image submitted for marking'
          : undefined,
    });
  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}