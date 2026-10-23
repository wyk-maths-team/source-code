// api/image-grade.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { getTokenBalance, consumeTokens } from '../lib/token.js';
import { buildImageGradePrompt } from '../lib/grade-prompt.js';
import crypto from 'crypto';
import { wrapHandler } from '../lib/errors.js';

// ⭐ 必须配置这个，否则 Vercel 免费版 10 秒后必断连！
export const config = { maxDuration: 300 };

const IMAGE_TOKEN_COST = 3000;
function genTaskId() { return 'IGT' + crypto.randomBytes(8).toString('hex'); }

async function callDeepSeekVision(prompt, imageUrl) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const base = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
  
  const body = {
    model: 'deepseek-flash', // 根据文档，这是 V4.1-Flash
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { 
            type: 'image_url', 
            image_url: { 
              url: imageUrl,
              detail: 'low' // ⭐ 核心：降低图片精度，极大加快处理速度，防超时
            } 
          }
        ]
      }
    ],
    stream: false,
    max_tokens: 204800,
    temperature: 0.1 // 评卷最好温度低点，保证稳定
  };

  // ⭐ 加超时控制，防止卡死
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(50000) // 50 秒超时
  });

  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response');
  
  return { content, usage: data.usage || {} };
}

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
  
  const problem = await db.collection('problems').findOne({ id: String(problemId) });
  if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

  const sub = await db.collection('submissions').findOne({ subid, username: decoded.username, type: 'image' });
  if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

  const taskId = genTaskId();
  const now = new Date();

  // 1. Token 校验
  const currentToken = await getTokenBalance(db, decoded.username);
  const available = (currentToken.daily || 0) + (currentToken.global || 0);
  if (available < IMAGE_TOKEN_COST && decoded.role !== 'root') {
    return res.status(400).json({ success: false, message: `Insufficient tokens. You need ${IMAGE_TOKEN_COST}.` });
  }

  // 2. 记录任务
  await db.collection('steps_grading_tasks').insertOne({
    taskId, type: 'image', username: decoded.username, problemId: String(problemId),
    subid, imageUrl, status: 'pending', createdAt: now,
  });

  // 3. 非 Root 直接同步处理
  // if (decoded.role !== 'root') {
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
      const actualCost = apiRes.usage.total_tokens || IMAGE_TOKEN_COST;

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
      const newTokens = await consumeTokens(db, decoded.username, actualCost);

      auditLog(db, 'image_grade', { problemId, score: finalScore, taskId }, decoded.username, 'info').catch(() => {});

      // ⭐ 直接把结果塞给前端，绝不降级！
      return res.status(200).json({ 
        success: true, 
        status: 'done', 
        result: { score: finalScore, comment }, 
        subid,
        tokens: newTokens 
      });

    } catch (err) {
      console.error('[image-grade] Sync API failed:', err);
      // ⭐ 如果 API 失败，直接告诉前端失败，不要返回 taskId 让它去 poll
      await db.collection('steps_grading_tasks').updateOne({ taskId }, { $set: { status: 'error', error: err.message } });
      return res.status(500).json({ success: false, message: `AI 批改失败: ${err.message}. 请重新提交或联系管理员。` });
    }
  // }

  // 4. Root 用户走 Bridge
  return res.status(202).json({ success: true, taskId, handledBy: 'bridge' });
}

// GET 保留给 root / bridge 兜底
async function handlePoll(req, res, db, decoded) {
  // ... 保持你原来的 handlePoll 不变即可 ...
  // (因为如果非 root 在 handleCreate 里已经返回了，根本不会走到这里)
  return res.status(404).json({ success: false, message: 'Not supported for normal users' });
}

export default wrapHandler(handler);