// api/temp/claude-grade.js
// 临时：同步调用 Claude 批改，直接返回结果（不走 bridge）
// 用完就删

import { connectToDatabase } from '../_db.js';
import { verifyToken } from '../../lib/auth.js';
import { applyRateLimit } from '../../lib/rateLimit.js';
import { auditLog } from '../../lib/audit.js';
import { askClaude } from '../../lib/temp/claude-api.js';
import { buildStepsPrompt } from '../../lib/grade-prompt.js';
import crypto from 'crypto';

const MAX_STEPS_LEN = 1000;
const VALID_MODELS  = new Set(['claude-sonnet', 'claude-opus']);

function genSubid() {
  return 'SGC' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

// 复用 bridge 的清洗逻辑
function cleanStatementForAI(raw) {
  let s = String(raw || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<div[^>]*\bdata-input\b[^>]*>[\s\S]*?<\/div>/gi, ' ');
  s = s.replace(/<([a-zA-Z][\w-]*)[^>]*\bdata-input\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<img[^>]*\balt=["']([^"']+)["'][^>]*>/gi, ' [FIGURE: $1] ');
  s = s.replace(/<img[^>]*>/gi, ' [FIGURE] ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ')
       .replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>')
       .replace(/&amp;/g, '&')
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// 复用 bridge 的 JSON 解析逻辑
function escapeControlCharsInJsonStrings(str) {
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);
    if (escaped) { out += ch; escaped = false; continue; }
    if (ch === '\\') { out += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && code < 0x20) {
      switch (ch) {
        case '\n': out += '\\n'; break;
        case '\r': out += '\\r'; break;
        case '\t': out += '\\t'; break;
        case '\b': out += '\\b'; break;
        case '\f': out += '\\f'; break;
        default:   out += '\\u' + code.toString(16).padStart(4, '0');
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function parseReply(raw) {
  if (!raw) return null;
  let s = String(raw);
  s = s.replace(/[\uFEFF\u200B-\u200D\u2028\u2029]/g, '');
  s = s.replace(/[\u201C\u201D]/g, '"')
       .replace(/\uFF1A/g, ':')
       .replace(/\uFF0C/g, ',')
       .replace(/\uFF5B/g, '{')
       .replace(/\uFF5D/g, '}');
  s = s.trim();
  s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  const first = s.indexOf('{');
  const last  = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return null;

  let jsonStr = s.slice(first, last + 1);
  jsonStr = escapeControlCharsInJsonStrings(jsonStr);
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.comment === 'string') {
      parsed.comment = parsed.comment.replace(/[ \t]+/g, ' ').trim();
    }
    return parsed;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const decoded = await verifyToken(req);
  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // ⭐ 临时：只有 root 和 admin 能用
  if (decoded.role !== 'root' && decoded.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Temporary feature — admin only' });
  }

  const { problemId, steps, model } = req.body || {};

  if (!problemId || typeof problemId !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing problemId' });
  }
  if (!steps || typeof steps !== 'string') {
    return res.status(400).json({ success: false, message: 'Missing steps' });
  }
  const trimmed = steps.trim();
  if (!trimmed || trimmed.length > MAX_STEPS_LEN) {
    return res.status(400).json({
      success: false,
      message: `Steps length invalid (1-${MAX_STEPS_LEN})`,
    });
  }

  const useModel = VALID_MODELS.has(model) ? model : 'claude-sonnet';

  const db = await connectToDatabase();
  const problem = await db.collection('problems').findOne(
    { id: String(problemId) },
    { projection: { id: 1, statement: 1, ans: 1, _id: 0 } }
  );
  if (!problem) {
    return res.status(404).json({ success: false, message: 'Problem not found' });
  }

  const statement = cleanStatementForAI(problem.statement);
  const prompt = buildStepsPrompt({
    statement,
    reference_answer: String(problem.ans ?? ''),
    student_steps: trimmed,
  });

  const t0 = Date.now();

  try {
    const reply = await askClaude(prompt, {
      model: useModel,
      timeoutMs: 280_000,
      maxTokens: 8192,
    });
    const elapsed = Date.now() - t0;

    const parsed = parseReply(reply);
    let scoreNum = NaN;
    if (parsed) {
      const v = parsed.score ?? parsed.Score ?? parsed.SCORE;
      scoreNum = typeof v === 'number' ? v : Number(v);
    }

    if (!parsed || !Number.isFinite(scoreNum)) {
      return res.status(500).json({
        success: false,
        message: 'Failed to parse Claude response',
        raw: reply.slice(0, 500),
      });
    }

    const score = Math.max(0, Math.min(100, Math.round(scoreNum)));
    const comment = String(parsed.comment || '').slice(0, 3000);
    const subid = genSubid();

    // 写入 submissions（标上 claude 来源，方便区分）
    try {
      await db.collection('submissions').insertOne({
        subid,
        username: decoded.username,
        problemId: String(problemId),
        type: 'steps',
        timestamp: new Date(),
        correct: score === 100,
        systemError: false,
        marked: true,
        score,
        comment,
        answer: trimmed,
        markedAt: new Date(),
        aiGraded: true,
        aiModel: useModel,
        handledBy: 'claude-api',
        elapsedMs: elapsed,
      });

      // 更新 userstats
      const statsCol = db.collection('userstats');
      await statsCol.updateOne(
        { username: decoded.username },
        { $setOnInsert: { username: decoded.username, states: {} } },
        { upsert: true }
      );
      if (score === 100) {
        await statsCol.updateOne(
          { username: decoded.username },
          { $set: { [`states.${problemId}`]: 'passed' } }
        );
      } else {
        await statsCol.updateOne(
          {
            username: decoded.username,
            [`states.${problemId}`]: { $ne: 'passed' },
          },
          { $set: { [`states.${problemId}`]: 'failed' } }
        );
      }
    } catch (e) {
      console.error('[claude-grade] write failed:', e);
    }

    auditLog(db, 'claude_grade', {
      problemId,
      score,
      model: useModel,
      elapsedMs: elapsed,
    }, decoded.username, 'info').catch(() => {});

    return res.status(200).json({
      success: true,
      result: { score, comment, details: parsed.details || null },
      subid,
      elapsedMs: elapsed,
      model: useModel,
    });

  } catch (err) {
    const elapsed = Date.now() - t0;
    console.error('[claude-grade] failed:', err.message);

    return res.status(500).json({
      success: false,
      message: String(err.message || err).slice(0, 300),
      elapsedMs: elapsed,
    });
  }
}

// Vercel Pro：最长 300 秒
export const config = {
  maxDuration: 300,
  regions: ['iad1'],
};