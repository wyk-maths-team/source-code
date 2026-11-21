// lib/grading-history.js
//
// 批改历史：一份只存元数据、永远不会被清理的记录。
//
// 为什么单独一张表，而不是直接用 steps_grading_tasks 或 submissions：
//
//   steps_grading_tasks 是「任务队列」—— 有 expiresAt，会被 reaper 收尸，
//   条目本身还带着学生的完整作答（steps 字段）。它回答的是「这次批改做得怎么样了」，
//   不是「这类题通常要批多久」。
//
//   submissions 里有 judgingMs，但它同时存着答案、评语、图片 URL。
//   为了算一个平均值去扫一张存着学生答案的表，既慢也不该。
//
// 所以这张表只做一件事：记下「什么难度、什么模型、花了多久、得了多少分」。
// 没有 answer / steps / image / comment，因此它可以长期保留而不构成隐私负担。
//
// 永久性的保证来自三处，缺一不可：
//   1. 不写 expiresAt —— 没有东西会让它过期
//   2. reaper 只扫 steps_grading_tasks，不碰这里
//   3. 本文件不提供任何删除函数

export const COLLECTION = 'grading_history';

/** 允许的字段白名单：写入前逐字段挑选，杜绝把作答内容带进来 */
function pick(doc) {
  return {
    subid: String(doc.subid || ''),
    username: String(doc.username || ''),
    problemId: String(doc.problemId || ''),
    type: String(doc.type || 'steps'),
    difficulty: Number.isFinite(Number(doc.difficulty)) ? Number(doc.difficulty) : null,
    model: doc.model ? String(doc.model).slice(0, 60) : null,
    durationMs: Math.round(Number(doc.durationMs) || 0),
    score: Number.isFinite(Number(doc.score)) ? Number(doc.score) : null,
    status: doc.status ? String(doc.status).slice(0, 12) : null,
    tokenUsage: Math.round(Number(doc.tokenUsage) || 0),
    submittedAt: doc.submittedAt instanceof Date ? doc.submittedAt : null,
  };
}

/** 幂等索引。放一次性脚本里跑，不要放进请求路径。 */
export async function ensureIndexes(db) {
  const col = db.collection(COLLECTION);
  await col.createIndex({ subid: 1 }, { unique: true });
  await col.createIndex({ submittedAt: -1 });
  await col.createIndex({ difficulty: 1, durationMs: 1 });
  await col.createIndex({ type: 1, submittedAt: -1 });
  return col;
}

/**
 * 从 submissions 同步一批带耗时的 AI 批改记录。
 *
 * 只读元数据（projection 明确排除 answer / image / comment），
 * 按 subid upsert，所以可以反复跑。
 *
 * @returns {Promise<{scanned:number, upserted:number, modified:number}>}
 */
export async function syncFromSubmissions(db, { since = null, before = null, limit = 2000 } = {}) {
  const filter = { aiGraded: true, judgingMs: { $gt: 0 } };
  if (since instanceof Date) filter.timestamp = { ...(filter.timestamp || {}), $gte: since };
  if (before instanceof Date) filter.timestamp = { ...(filter.timestamp || {}), $lt: before };

  const rows = await db.collection('submissions')
    .find(filter, {
      projection: {
        _id: 0, subid: 1, username: 1, problemId: 1, type: 1,
        judgingMs: 1, usedModel: 1, judgingModel: 1, status: 1,
        tokenUsage: 1, timestamp: 1,
      },
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  if (!rows.length) return { scanned: 0, upserted: 0, modified: 0, oldest: null };

  // 难度不在 submissions 里，只有 problemId；单独查一次题目表补上
  const pids = [...new Set(rows.map(r => String(r.problemId)))];
  const probs = await db.collection('problems')
    .find({ id: { $in: pids } }, { projection: { id: 1, difficulty: 1, _id: 0 } })
    .toArray();
  const diffMap = Object.fromEntries(probs.map(p => [String(p.id), Number(p.difficulty) || 0]));

  const now = new Date();
  const ops = rows.map(r => {
    const doc = pick({
      subid: r.subid,
      username: r.username,
      problemId: r.problemId,
      type: r.type,
      difficulty: diffMap[String(r.problemId)],
      model: r.judgingModel || r.usedModel,
      durationMs: r.judgingMs,
      score: null,
      status: r.status,
      tokenUsage: r.tokenUsage,
      submittedAt: r.timestamp,
    });
    return {
      updateOne: {
        filter: { subid: doc.subid },
        update: { $set: { ...doc, recordedAt: now }, $setOnInsert: { firstSeenAt: now } },
        upsert: true,
      },
    };
  });

  const res = await db.collection(COLLECTION).bulkWrite(ops, { ordered: false });
  const oldest = rows.length ? new Date(rows[rows.length - 1].timestamp) : null;
  return {
    scanned: rows.length,
    upserted: res.upsertedCount || 0,
    modified: res.modifiedCount || 0,
    oldest,
  };
}

/**
 * 按难度给出概览，供前端估算「还要多久」。
 *
 * 默认只看 steps：图片批改的耗时也记录（type='image'），但两者的
 * 输入端不一样（一个是一段文字，一张是图片），混在一起算平均没有意义。
 * 传 type: null 可以拿到全部类型。
 *
 * 难度是浮点数（1.5 / 2.54 / 9.04），直接分组会得到两百多个桶 ——
 * 这里四舍五入到整数档位，学生关心的是「这题大概多久」，不是小数点后两位。
 */
export async function durationByDifficulty(db, { days = 30, type = 'steps' } = {}) {
  const since = new Date(Date.now() - days * 86400_000);
  const match = {
    submittedAt: { $gte: since },
    durationMs: { $gt: 0 },
    difficulty: { $ne: null },
  };
  if (type) match.type = String(type);

  const rows = await db.collection(COLLECTION).aggregate([
    { $match: match },
    { $group: {
        _id: { $round: ['$difficulty', 0] },
        n: { $sum: 1 },
        avgMs: { $avg: '$durationMs' },
        p50: { $percentile: { input: '$durationMs', p: [0.5], method: 'approximate' } },
        p90: { $percentile: { input: '$durationMs', p: [0.9], method: 'approximate' } },
    } },
    { $sort: { _id: 1 } },
  ]).toArray();

  return rows.map(r => ({
    difficulty: r._id,
    n: r.n,
    avgMs: Math.round(r.avgMs || 0),
    p50Ms: Math.round((r.p50 && r.p50[0]) || 0),
    p90Ms: Math.round((r.p90 && r.p90[0]) || 0),
  }));
}

/**
 * 按题目的**当前**难度刷新历史记录。
 *
 * 为什么需要它：difficulty 是写入那一刻从 problems 抄过来的快照。
 * 之后你手动改了题目难度，历史记录就留在旧值上 —— 按难度分档的统计
 * 会同时出现「同一道题被算进两个档位」，预期时间跟着失真。
 *
 * 题号已不存在（题目被删）的记录保持原样，只统计数量：
 * 抹掉它们的难度会让那部分数据变成无主孤儿，保留反而还能追溯。
 *
 * @returns {{scanned:number, changed:number, missing:number, updated:number}}
 */
export async function recalcDifficulty(db, { dryRun = false } = {}) {
  // 题号 → 当前难度。题目总共几千条，一次读进来的成本远低于逐条查询。
  const probs = await db.collection('problems')
    .find({}, { projection: { id: 1, difficulty: 1, _id: 0 } })
    .toArray();

  const latest = new Map();
  for (const p of probs) {
    const d = Number(p.difficulty);
    if (Number.isFinite(d)) latest.set(String(p.id), d);
  }

  const ops = [];
  let scanned = 0, missing = 0;

  const cursor = db.collection(COLLECTION).find({}, {
    projection: { _id: 1, problemId: 1, difficulty: 1 },
    batchSize: 500,
  });

  for await (const doc of cursor) {
    scanned++;
    const want = latest.get(String(doc.problemId));
    if (want === undefined) { missing++; continue; }

    const have = Number(doc.difficulty);
    // 浮点比较用容差：题目难度是两位小数，但存进来可能带浮点误差
    if (!Number.isFinite(have) || Math.abs(have - want) > 1e-9) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { difficulty: want, difficultySyncedAt: new Date() } },
        },
      });
    }
  }

  if (dryRun || !ops.length) {
    return { scanned, changed: ops.length, missing, updated: 0 };
  }

  let updated = 0;
  for (let i = 0; i < ops.length; i += 500) {
    const r = await db.collection(COLLECTION).bulkWrite(ops.slice(i, i + 500), { ordered: false });
    updated += r.modifiedCount || 0;
  }

  return { scanned, changed: ops.length, missing, updated };
}
