// api/image-grade.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { getTokenBalance, consumeTokens } from '../lib/token.js';
import { buildImageGradePrompt } from '../lib/grade-prompt.js';
import crypto from 'crypto';
import { wrapHandler } from '../lib/errors.js';

const TASK_TTL_MS  = 30 * 60_000;
const IMAGE_TOKEN_COST = 3000; // 固定消耗 3000

function genTaskId() { return 'IGT' + crypto.randomBytes(8).toString('hex'); }

// 尝试调用 DeepSeek 多模态
async function callDeepSeekVision(prompt, imageUrl) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const base = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
  
  const body = {
    model: 'deepseek-chat', // 或 deepseek-vl, 根据实际情况填
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ],
    stream: false,
    max_tokens: 4096,
  };

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response');
  
  return { content, usage: data.usage || {} };
}

// 解析 JSON 辅助函数
function parseJSONReply(raw) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {}
  return null;
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();

  if (req.method === 'POST') return handleCreate(req, res, db, decoded);
  if (req.method === 'GET')  return handlePoll(req, res, db, decoded);

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

async function handleCreate(req, res, db, decoded) {
  const { problemId, subid, imageUrl } = req.body || {};

  if (!problemId || !subid || !imageUrl) {
    return res.status(400).json({ success: false, message: 'Missing fields' });
  }
  if (!/^https:\/\//.test(imageUrl)) {
    return res.status(400).json({ success: false, message: 'Invalid imageUrl' });
  }

  const problem = await db.collection('problems').findOne({ id: String(problemId) });
  if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

  const sub = await db.collection('submissions').findOne({ subid, username: decoded.username, type: 'image' });
  if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

  const taskId = genTaskId();
  const now = new Date();

  // ⭐ 1. 前置 Token 校验
  const currentToken = await getTokenBalance(db, decoded.username);
  const available = (currentToken.daily || 0) + (currentToken.global || 0);
  if (available < IMAGE_TOKEN_COST && decoded.role !== 'root') {
    return res.status(400).json({ 
      success: false, 
      message: `Insufficient tokens. You need ${IMAGE_TOKEN_COST}, but only have ${available}.` 
    });
  }

  await db.collection('steps_grading_tasks').insertOne({
    taskId, type: 'image', username: decoded.username, problemId: String(problemId),
    subid, imageUrl, status: 'pending', createdAt: now, expiresAt: new Date(now.getTime() + TASK_TTL_MS),
  });

  // ⭐ 2. Root 用户走 Bridge（返回 pending 让前端轮询）
  if (decoded.role === 'root') {
    return res.status(202).json({ success: true, taskId, handledBy: 'bridge' });
  }

  // ⭐ 3. 非 Root 走同步 API
  try {
    const prompt = buildImageGradePrompt({ 
      statement: problem.statement, 
      reference_answer: String(problem.ans ?? '') 
    });
    
    const apiRes = await callDeepSeekVision(prompt, imageUrl);
    const parsed = parseJSONReply(apiRes.content);

    if (!parsed || typeof parsed.score !== 'number') throw new Error('AI parse error');

    const finalScore = Math.max(0, Math.min(100, Math.round(parsed.score)));
    const comment = String(parsed.comment || '').slice(0, 3000);
    const actualCost = apiRes.usage.total_tokens || IMAGE_TOKEN_COST; // 算精准用量

    // 更新数据库
    await db.collection('submissions').updateOne(
      { subid },
      { $set: { marked: true, score: finalScore, comment, correct: finalScore === 100, markedAt: new Date(), aiGraded: true, tokenUsage: actualCost } }
    );

    const statsCol = db.collection('userstats');
    await statsCol.updateOne({ username: decoded.username }, { $setOnInsert: { username: decoded.username, states: {} } }, { upsert: true });
    if (finalScore === 100) await statsCol.updateOne({ username: decoded.username }, { $set: { [`states.${problemId}`]: 'passed' } });
    else await statsCol.updateOne({ username: decoded.username, [`states.${problemId}`]: { $ne: 'passed' } }, { $set: { [`states.${problemId}`]: 'failed' } });

    await db.collection('steps_grading_tasks').updateOne({ taskId }, { $set: { status: 'done', result: { score: finalScore, comment }, completedAt: new Date() } });

    // 扣 Token
    const newTokens = await consumeTokens(db, decoded.username, actualCost);

    auditLog(db, 'image_grade', { problemId, score: finalScore, taskId, handledBy: 'api' }, decoded.username, 'info').catch(() => {});

    // 同步返回结果
    return res.status(200).json({ 
      success: true, 
      status: 'done', 
      result: { score: finalScore, comment }, 
      subid,
      tokens: newTokens // 直接返回余额给前端刷新
    });

  } catch (err) {
    console.error('[image-grade] Sync API failed:', err);
    // 失败则降级，让 Bridge 接盘
    await db.collection('steps_grading_tasks').updateOne({ taskId }, { $set: { apiError: err.message } });
    return res.status(202).json({ success: true, taskId, handledBy: 'bridge' });
  }
}

// ═══════════════ GET：輪詢（只给 Root/Bridge 兜底用）═══════════════
async function handlePoll(req, res, db, decoded) {
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ success: false, message: 'Missing taskId' });

  const task = await db.collection('steps_grading_tasks').findOne({ taskId });
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
  if (task.username !== decoded.username && decoded.role !== 'admin' && decoded.role !== 'root') {
    return res.status(403).json({ success: false, message: 'Not yours' });
  }

  if (task.status === 'pending' || task.status === 'processing') {
    return res.status(200).json({ success: true, status: task.status });
  }
  if (task.status === 'error') {
    return res.status(200).json({ success: true, status: 'error', message: task.error });
  }

  if (task.status === 'done') {
    if (task.consumed === true) {
      return res.status(200).json({ success: true, status: 'done', result: task.result, subid: task.subid });
    }

    const lockResult = await db.collection('steps_grading_tasks').updateOne(
      { taskId, status: 'done', consumed: { $ne: true } },
      { $set: { consumed: true, consumedAt: new Date() } }
    );

    if (lockResult.modifiedCount === 0) {
      await new Promise(r => setTimeout(r, 300));
      return res.status(200).json({ success: true, status: 'done', result: task.result, subid: task.subid });
    }

    const claimed = await db.collection('steps_grading_tasks').findOne({ taskId });
    const finalScore = Math.max(0, Math.min(100, Math.round(claimed.result.score)));
    const comment = String(claimed.result.comment || '').slice(0, 3000);
    const actualCost = claimed.result.tokenUsage || IMAGE_TOKEN_COST;

    if (claimed.subid) {
      await db.collection('submissions').updateOne(
        { subid: claimed.subid },
        { $set: { marked: true, score: finalScore, comment, correct: finalScore === 100, markedAt: new Date(), aiGraded: true, tokenUsage: actualCost } }
      );
      
      const statsCol = db.collection('userstats');
      await statsCol.updateOne({ username: claimed.username }, { $setOnInsert: { username: claimed.username, states: {} } }, { upsert: true });
      if (finalScore === 100) await statsCol.updateOne({ username: claimed.username }, { $set: { [`states.${claimed.problemId}`]: 'passed' } });
      else await statsCol.updateOne({ username: claimed.username, [`states.${claimed.problemId}`]: { $ne: 'passed' } }, { $set: { [`states.${claimed.problemId}`]: 'failed' } });
    }

    const newTokens = await consumeTokens(db, claimed.username, actualCost);

    return res.status(200).json({
      success: true,
      status: 'done',
      result: { score: finalScore, comment },
      subid: claimed.subid,
      tokens: newTokens
    });
  }

  return res.status(200).json({ success: true, status: 'unknown' });
}

export default wrapHandler(handler);