// api/image-grade.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import { getTokenBalance, consumeTokens } from '../lib/token.js';
import { buildImageGradePrompt } from '../lib/grade-prompt.js';
import { effortForDifficulty } from '../lib/thinking.js';
import crypto from 'crypto';
import { wrapHandler } from '../lib/errors.js';
import { encodeStatus } from '../lib/submission-status.js';
import { cloudTier, TIERS } from '../lib/cloud-image.js';
import {
  GIVE_UP_MESSAGE,
  AUTH_FAIL_MESSAGE,
  RETRY_DELAY_MS,
  sleep,
  markTaskFailed,
} from '../lib/ai-fallback.js';

// ⭐ 必须配置这个，否则 Vercel 免费版 10 秒后必断连！
export const config = { maxDuration: 300 };

const IMAGE_TOKEN_COST = 3000;
// 视觉批改用的模型：批改历史里要按它分组，所以抽成常量而不是散落的字面量
const IMAGE_MODEL_LABEL = 'deepseek-flash';
function genTaskId() { return 'IGT' + crypto.randomBytes(8).toString('hex'); }

// 只允许来自自己图床的图片；校验在 handleCreate 里做，这里再兜一层。
const ALLOWED_IMAGE_HOSTS = ['https://res.cloudinary.com/', 'https://cdn.jsdelivr.net/'];

function isAllowedImageUrl(url) {
  const s = String(url || '');
  return ALLOWED_IMAGE_HOSTS.some((prefix) => s.startsWith(prefix));
}

async function callDeepSeekVision(prompt, imageUrl, effort) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const base = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
  if (!isAllowedImageUrl(imageUrl)) {
    throw new Error('Invalid image source');
  }
  const body = {
    model: IMAGE_MODEL_LABEL,
    ...(effort ? { reasoning_effort: effort } : {}),
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
    signal: AbortSignal.timeout(500000) // 50 秒超时
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

  // 图片校验放在这里（调 AI 之前），而不是藏在内部函数里
  if (!isAllowedImageUrl(imageUrl)) {
    return res.status(400).json({ success: false, message: 'Invalid image source.' });
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

  // 3. 同步批改：失败重试一次，再失败就放弃。
  // 以前这里失败会留个 pending 任务让本地 grader 接手；现在不走了 ——
  // 学生早就离开页面了，几分钟后算出来的分没人看。
  let lastErr = null;
  let authRejected = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const prompt = buildImageGradePrompt({ 
        statement: problem.statement, 
        reference_answer: String(problem.ans ?? '') 
      });
      
      // 只计模型这一段 —— 和 steps 那边记 result.elapsed 的口径保持一致，
      // 否则「批改要多久」在两种题型之间没有可比性。
      const modelStart = Date.now();
      // 压到 1200px 宽再送给模型：原图平均 200 KB，压完 60–90 KB，
      // 笔迹的清晰度肉眼无差，但上传给模型的 payload 小一半。
      const apiRes = await callDeepSeekVision(prompt, cloudTier(imageUrl, TIERS.grade), effortForDifficulty(problem.difficulty));
      const judgingMs = Date.now() - modelStart;

      const parsed = parseJSONReply(apiRes.content);

      if (!parsed || typeof parsed.score !== 'number') throw new Error('AI parse error');

      const finalScore = Math.max(0, Math.min(100, Math.round(parsed.score)));
      const comment = String(parsed.comment || '').slice(0, 3000);
      const actualCost = apiRes.usage.total_tokens || IMAGE_TOKEN_COST;

      // 更新数据库
      await db.collection('submissions').updateOne(
        { subid },
        { $set: {
            status: encodeStatus({ score: finalScore }), comment, markedAt: new Date(),
            aiGraded: true, tokenUsage: actualCost,
            // 图片批改也留耗时：它会进 grading_history，但不会参与
            // 「预期时间」的计算（那套只吃 steps 的数据）。
            judgingMs,
            judgingModel: apiRes.model || IMAGE_MODEL_LABEL,
        } }
      );

      // 判分走这里就结束了，所以计数和成就必须在这一步补上 ——
      // 提交那一刻答案还是 pending，根本不知道对错。
      const { updateUserStats, rewardFirstAC, runPostSubmit } = await import('../lib/submission.js');
      const isAC = finalScore === 100;
      let achOut = null;
      try {
        const firstAC = await updateUserStats(db, decoded.username, String(problemId), isAC);
        if (firstAC) await rewardFirstAC(db, { username: decoded.username, rawUsername: decoded.username, problem });
        achOut = await runPostSubmit(db, decoded.username, {
          justAC: isAC,
          problemId: String(problemId),
        });
      } catch (e) {
        console.error('[image-grade] post-grade side effects failed:', e);
      }

      await db.collection('steps_grading_tasks').updateOne({ taskId }, { $set: { status: 'done', result: { score: finalScore, comment }, completedAt: new Date() } });
      const newTokens = await consumeTokens(db, decoded.username, actualCost);

      // 全局 token 计数（图片批改这条路径也要算上）
      try {
        const { addTokensUsed } = await import('../lib/token-meter.js');
        await addTokensUsed(db, actualCost);
      } catch (e) { console.error('[image-grade] token meter failed:', e); }

      auditLog(db, 'image_grade', { problemId, score: finalScore, taskId }, decoded.username, 'info').catch(() => {});

      // ⭐ 直接把结果塞给前端，绝不降级！
      return res.status(200).json({
        success: true,
        status: 'done',
        result: { score: finalScore, comment },
        subid,
        tokens: newTokens,
        ...(achOut && achOut.unlocked && achOut.unlocked.length
          ? { unlockedAchievements: achOut.expand(achOut.unlocked), achievementReward: achOut.rewarded }
          : {}),
      });

    } catch (err) {
      lastErr = err;
      console.error(`[image-grade] sync attempt ${attempt}/2 failed:`, err && err.message);
      if (err && err.permanent) { authRejected = true; break; }   // 凭据被判死，重试没意义
      if (attempt < 2) await sleep(RETRY_DELAY_MS);
    }
  }

  // 两次都失败：把任务标成 error（bridge 只扫 pending），然后明确告诉用户
  const detail = await markTaskFailed(db, taskId, [String((lastErr && lastErr.message) || lastErr || 'unknown')], { apiAttempts: 2 });
  console.warn(`[image-grade] gave up on ${taskId}: ${detail}`);

  return res.status(200).json({
    success: false,
    status: 'error',
    code: 'AI_UNAVAILABLE',
    message: authRejected ? AUTH_FAIL_MESSAGE : GIVE_UP_MESSAGE,
    attempts: 2,
  });
}

// GET 保留给 root / bridge 兜底
async function handlePoll(req, res, db, decoded) {
  // ... 保持你原来的 handlePoll 不变即可 ...
  // (因为如果非 root 在 handleCreate 里已经返回了，根本不会走到这里)
  return res.status(404).json({ success: false, message: 'Not supported for normal users' });
}

// 图片批改要等视觉模型返回，单张可能十几秒：不参与并发闸门。
export default wrapHandler(handler, { gate: false });