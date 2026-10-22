// api/port/submit.js
import { connectToDatabase } from '../_pdb.js';
import { portAuth } from './_auth.js';
import crypto from 'crypto';
import { wrapHandler } from '../../lib/errors.js';
import { buildPortGradePrompt } from '../../lib/port-grade-prompt.js';

const MAX_STEPS = 10000;
const MAX_IMAGES = 10;

function genId(prefix) {
  return prefix + crypto.randomBytes(8).toString('hex');
}

async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { problemId, subject, steps = '', images = [] } = req.body || {};
  if (!problemId || !subject) return res.status(400).json({ success: false, message: 'Missing problemId or subject' });

  const stepsStr = String(steps).slice(0, MAX_STEPS);
  if (!stepsStr.trim() && images.length === 0) return res.status(400).json({ success: false, message: 'Provide steps or images' });

  const db = await connectToDatabase();
  const problem = await db.collection('port_problems').findOne({ id: String(problemId) }, { projection: { _id: 0 } });
  if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

  // ⭐ 修复：兼容 ans 字段
  const refAnswer = problem.ans || problem.answer || '';

  const submissionId = genId('PS');
  const now = new Date();

  // 1. 预生成 Submission 记录（处理中状态）
  await db.collection('port_submissions').insertOne({
    submissionId,
    username: decoded.username,
    subject: String(subject),
    problemId: String(problemId),
    steps: stepsStr,
    images: images.map(String),
    score: null,
    maxScore: problem.maxScore || 100,
    comment: 'AI 正在阅卷中...',
    warnings: [],
    status: 'grading',
    createdAt: now,
    gradedAt: null,
  });

  // 清除当前题目的草稿
  await db.collection('port_drafts').deleteOne({ username: decoded.username, problemId: String(problemId) });

  // 2. 构建 Prompt 并调用 DeepSeek API
  const prompt = buildPortGradePrompt({
    statement: problem.statement || '',
    referenceAnswer: refAnswer, // ⭐ 使用兼容后的变量
    studentSteps: stepsStr,
    maxScore: problem.maxScore || 100,
    subject: String(subject)
  });

  try {
    const apiRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(()=> '');
      throw new Error(`DeepSeek API error: ${apiRes.status} - ${errText.slice(0, 100)}`);
    }
    
    const aiData = await apiRes.json();
    const content = aiData.choices[0].message.content;
    const result = JSON.parse(content);

    const finalScore = Math.max(0, Math.min(problem.maxScore || 100, result.score || 0));
    
    // 3. 更新 Submission 结果
    await db.collection('port_submissions').updateOne(
      { submissionId },
      { 
        $set: { 
          score: finalScore, 
          comment: result.comment, 
          warnings: result.warnings || [],
          status: 'done', 
          gradedAt: new Date() 
        } 
      }
    );

    // 4. 更新用户状态
    const statsCol = db.collection('port_userstats');
    await statsCol.updateOne(
      { username: decoded.username, subject: String(subject) },
      { $setOnInsert: { username: decoded.username, subject: String(subject), states: {} } },
      { upsert: true }
    );
    
    // DSE 满分的 90% 以上算 passed
    if (finalScore >= (problem.maxScore || 100) * 0.9) {
      await statsCol.updateOne(
        { username: decoded.username, subject: String(subject) }, 
        { $set: { [`states.${problemId}`]: 'passed' } }
      );
    } else {
      await statsCol.updateOne(
        { username: decoded.username, subject: String(subject), [`states.${problemId}`]: { $ne: 'passed' } }, 
        { $set: { [`states.${problemId}`]: 'failed' } }
      );
    }

    return res.status(200).json({ success: true, submissionId, result: { score: finalScore, ...result } });

  } catch (err) {
    console.error('[port submit]', err);
    await db.collection('port_submissions').updateOne(
      { submissionId },
      { $set: { status: 'error', comment: '阅卷失败：' + err.message } }
    );
    return res.status(500).json({ success: false, message: 'AI 批改失败', detail: err.message });
  }
}

export const config = { maxDuration: 60 };
export default wrapHandler(handler);