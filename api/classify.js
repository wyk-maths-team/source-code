// api/classify.js
//
// 用 LLM 给题目打技能标签。管理员工具。
//
//   POST /api/classify  { mode, regex?, limit?, cursor? }
//     mode = missing  只处理 problem_vectors 里没有记录的题
//            all      全部重跑（技能体系换了才需要）
//            regex    只处理 id 匹配正则的题
//
// 一次调用处理 limit 道题（默认 20，上限 50），返回这一批的结果与花费。
// 前端循环调用，直到 done=true —— 这样不会撞上 serverless 的超时。
//
// 计费：**不扣用户额度**（后台批处理不该算在答疑次数里），
//       但消耗要累加进全局 token 计数（首页那个 total），账要对得上。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler, sendError } from '../lib/errors.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { askDeepSeekAPI } from '../lib/deepseek-api.js';
import { addTokensUsed } from '../lib/token-meter.js';
import { buildClassifyPrompt, parseClassifyReply, estimateCost } from '../lib/classify-prompt.js';

const MAX_LIMIT = 50;
const CONCURRENCY = 3;

function isAdmin(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

async function handler(req, res) {
  if (req.method !== 'POST') return sendError(req, res, 'BAD_REQUEST', 'Method not allowed');
  const user = await verifyToken(req);
  if (!user) return sendError(req, res, 'UNAUTHORIZED', 'Unauthorized');
  if (!isAdmin(user)) return sendError(req, res, 'FORBIDDEN', 'Admin only');
  if (!(await applyRateLimit(req, res, { name: 'classify', key: 'u:' + user.username, max: 200, windowMs: 60_000, banMs: 60_000 }))) return;

  const db = await connectToDatabase();
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const mode = String(body.mode || 'missing');
  const regexStr = String(body.regex || '').trim();
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit) || 20));

  // ── 技能清单（只取叶节点：有 parent 且没有子节点）──
  const [allSkills, vectors] = await Promise.all([
    db.collection('skills').find({ status: { $ne: 'retired' } }).toArray(),
    db.collection('problem_vectors').find({}, { projection: { problemId: 1, _id: 0 } }).toArray(),
  ]);
  const parents = new Set(allSkills.map((s) => s.parent).filter(Boolean));
  const taxonomy = allSkills.filter((s) => !parents.has(s.id));
  const allowedIds = taxonomy.map((s) => s.id);

  // ── 选题 ──
  const classified = new Set(vectors.map((v) => String(v.problemId)));
  const filter = {};
  if (mode === 'regex') {
    if (!regexStr) return sendError(req, res, 'BAD_REQUEST', 'regex required');
    try { filter.id = new RegExp(regexStr); } catch (e) { return sendError(req, res, 'BAD_REQUEST', 'invalid regex'); }
  }
  const candidates = await db.collection('problems')
    .find(filter, { projection: { _id: 0, id: 1, statement: 1, tags: 1 } })
    .sort({ id: 1 }).toArray();
  const pool = mode === 'missing' ? candidates.filter((p) => !classified.has(String(p.id))) : candidates;

  const cursor = String(body.cursor || '');
  const startAt = cursor ? pool.findIndex((p) => String(p.id) > cursor) : 0;
  const from = startAt < 0 ? pool.length : startAt;
  const batch = pool.slice(from, from + limit);

  if (!batch.length) {
    return res.status(200).json({ success: true, done: true, total: pool.length, mode, processed: 0, spent: 0, charged: 0 });
  }

  // ── 并发跑，最多 CONCURRENCY 道同时 ──
  let spent = 0, spentPrompt = 0, spentCompletion = 0, spentCached = 0, ok = 0, failed = 0;
  const results = [];
  const queue = batch.slice();

  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      if (!p) break;
      const text = String(p.statement || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
      if (!text) { failed++; continue; }
      try {
        const prompt = buildClassifyPrompt(taxonomy, text, p.tags);
        const out = await askDeepSeekAPI(prompt, { effort: 'low', timeoutMs: 60_000 });
        const usage = out.usage || {};
        spent += Number(usage.total) || 0;
        spentPrompt += Number(usage.prompt) || 0;
        spentCompletion += Number(usage.completion) || 0;
        spentCached += Number(usage.cached) || 0;
        const parsed = parseClassifyReply(out.content, allowedIds);
        if (!parsed) { failed++; results.push({ id: p.id, error: 'unparsable' }); continue; }

        const skills = parsed.map((x) => x.id);
        const depths = {};
        parsed.forEach((x) => { depths[x.id] = x.depth; });
        await db.collection('problem_vectors').updateOne(
          { problemId: p.id },
          { $set: { problemId: p.id, skills, depths, source: 'llm', model: 'deepseek-flash', tags: p.tags || [], updatedAt: new Date() } },
          { upsert: true }
        );
        ok++;
        results.push({ id: p.id, skills, depths });
      } catch (e) {
        failed++;
        results.push({ id: p.id, error: String(e && e.message || 'error').slice(0, 100) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));

  // 全局 token 计数：不加到任何用户名下，但要记进 total
  try { await addTokensUsed(db, spent); } catch (e) {}

  const nextCursor = batch.length === limit ? String(batch[batch.length - 1].id) : '';
  return res.status(200).json({
    success: true,
    mode,
    total: pool.length,
    processed: batch.length,
    ok, failed,
    spent,
    charged: 0,
    costUsd: +estimateCost({ prompt: spentPrompt, completion: spentCompletion, cached: spentCached }).toFixed(6),
    nextCursor,
    done: batch.length < limit,
    results: results.slice(0, 20),
  });
}

export default wrapHandler(handler, { gate: false });
export const config = { maxDuration: 300 };