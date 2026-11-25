// lib/rejudge.js —— 单条提交的重判逻辑（批量重判也走这里）
//
// 三种提交形态各自的判分方式：
//   text  —— 数值比对或自定义 logic（lib/submission.js 的 judge）
//   steps —— 模型评分，和 steps-grade 同一套 prompt 与模型链
//   image —— 视觉模型直接看图片，和 image-grade 同一套 prompt
//
// 这里不碰 token 计量：管理员批量重判不该给被重判的学生扣额度。

import {
  judge,
  updateUserStats,
  rewardFirstAC,
  runPostSubmit,
} from './submission.js';
import { encodeStatus } from './submission-status.js';
import { effortForDifficulty } from './thinking.js';

/**
 * @returns {{ ok: boolean, status?: string, model?: string, error?: string }}
 */
export async function rejudgeOne(db, sub, problem, opts = {}) {
  const kind = sub.type === 'image' ? 'image' : (sub.type === 'steps' ? 'steps' : 'text');

  try {
    if (kind === 'text') {
      const jr = await judge({ problem, answer: sub.answer });
      const status = encodeStatus({ score: jr.score, correct: jr.correct, systemError: jr.systemError });
      await db.collection('submissions').updateOne(
        { subid: sub.subid },
        { $set: { status, comment: jr.comment || sub.comment || '', regradedAt: new Date(), regradedBy: opts.by || 'bulk' } }
      );
      await afterUpdate(db, sub, problem, jr.correct, status);
      return { ok: true, status };
    }

    if (kind === 'steps') {
      const score = await gradeSteps(problem, sub.answer);
      if (!score) return { ok: false, error: 'all models failed' };
      const status = encodeStatus({ score: score.score });
      await db.collection('submissions').updateOne(
        { subid: sub.subid },
        {
          $set: {
            status,
            comment: score.comment || sub.comment || '',
            usedModel: score.model,
            regradedAt: new Date(),
            regradedBy: opts.by || 'bulk',
          },
        }
      );
      await afterUpdate(db, sub, problem, score.score === 100, status);
      return { ok: true, status, model: score.model };
    }

    // image
    const score = await gradeImage(problem, sub.image);
    if (!score) return { ok: false, error: 'vision model failed' };
    const status = encodeStatus({ score: score.score });
    await db.collection('submissions').updateOne(
      { subid: sub.subid },
      { $set: { status, comment: score.comment || sub.comment || '', markedAt: new Date(), aiGraded: true, regradedAt: new Date(), regradedBy: opts.by || 'bulk' } }
    );
    await afterUpdate(db, sub, problem, score.score === 100, status);
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}

async function afterUpdate(db, sub, problem, isAC, status) {
  try {
    const { updateUserStats: uus } = await import('./submission.js');
    const first = await uus(db, sub.username, String(sub.problemId), !!isAC);
    if (first) {
      await rewardFirstAC(db, { username: sub.username, rawUsername: sub.username, problem });
    }
    await runPostSubmit(db, sub.username, { justAC: !!isAC, problemId: String(sub.problemId) });
  } catch (e) {
    console.error('[rejudge] side effects failed:', e);
  }
}

// ── steps ─────────────────────────────────────────────
async function gradeSteps(problem, steps) {
  const { buildStepsPrompt } = await import('./grade-prompt.js');
  const { getModelChain, getModelInfo, pickEffortForProblem } = await import('./model-router.js');
  const { askDeepSeekAPI } = await import('./deepseek-api.js');
  const { askClaude } = await import('./temp/claude-api.js');

  // 和 api/submissions.js 里的重判保持同一套解析：取第一个 { 到最后一个 }
  function parseReply(raw) {
    const t = String(raw || '');
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
      const o = JSON.parse(t.slice(a, b + 1));
      return o && typeof o === 'object' ? o : null;
    } catch (e) { return null; }
  }

  const prompt = buildStepsPrompt({
    statement: String(problem.statement || ''),
    reference_answer: String(problem.ans ?? ''),
    student_steps: String(steps || ''),
    difficulty: problem.difficulty,          // 重判也走同一套分档
  });

  const chain = getModelChain(problem.difficulty) || [];
  for (const modelKey of chain) {
    try {
      const info = getModelInfo(modelKey);
      let reply;
      if (info.provider === 'claude') {
        reply = await askClaude(prompt, { model: modelKey, timeoutMs: 280_000, maxTokens: 8192 });
      } else {
        reply = await askDeepSeekAPI(prompt, {
          model: info.id, timeoutMs: 50_000, effort: pickEffortForProblem(problem), maxTokens: 8000,
        });
      }
      const parsed = parseReply(reply.content || reply);
      if (!parsed) continue;
      const n = Number(parsed.score ?? parsed.Score);
      if (!Number.isFinite(n)) continue;
      return {
        score: Math.max(0, Math.min(100, Math.round(n))),
        comment: String(parsed.comment || '').slice(0, 3000),
        model: modelKey,
      };
    } catch (e) {
      console.error('[rejudge:steps] ' + modelKey + ' ' + String(e.message || e).slice(0, 80));
    }
  }
  return null;
}

// ── image ─────────────────────────────────────────────
async function gradeImage(problem, imageUrl) {
  const { buildImageGradePrompt } = await import('./grade-prompt.js');

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const base = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
  if (!apiKey || !imageUrl) return null;

  const prompt = buildImageGradePrompt({
    statement: problem.statement,
    reference_answer: String(problem.ans ?? ''),
  });

  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'deepseek-flash',
        reasoning_effort: effortForDifficulty(problem.difficulty),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
          ],
        }],
        stream: false,
        max_tokens: 204800,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(280_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) return null;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const n = Number(parsed.score);
    if (!Number.isFinite(n)) return null;
    return {
      score: Math.max(0, Math.min(100, Math.round(n))),
      comment: String(parsed.comment || '').slice(0, 3000),
    };
  } catch (e) {
    console.error('[rejudge:image]', e.message);
    return null;
  }
}
