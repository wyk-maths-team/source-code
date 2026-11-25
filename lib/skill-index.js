// lib/skill-index.js
//
// 题目相似度：用「技能向量」而不是 tag 字符串交集。
//
// 为什么不用 Atlas 的 $vectorSearch：它要求集群是 7.0+ 并且要在 Atlas 控制台
// 手工建 Search Index，脚本建不了。所以这里做的是应用层向量检索 ——
// 向量存 Mongo（problem_vectors），索引常驻进程内存，冷启动读一次，
// 10 分钟过期。3246 题 × 十几个稀疏维度，一次全量点积是毫秒级。
//
// 向量怎么来：一道题的技能 id 展开成「叶子 1.0 / 父级 0.55 / 祖父 0.3」，
// 这样「同属 algebra.inequality」和「同样是 AM-GM」都能被算出来，
// 不必把层级关系硬编码进相似度公式。

const TTL_MS = 10 * 60_000;
const W_LEAF = 1;
const W_PARENT = 0.55;
const W_ANCESTOR = 0.3;

let _cache = null;      // { at, items: [{ id, vec: Map, norm, tags, difficulty, public, hx }] }
let _loading = null;

/** 技能 id 的祖先链：a.b.c -> ['a.b.c', 'a.b', 'a'] */
function ancestors(skillId) {
  const parts = String(skillId || '').split('.').filter(Boolean);
  const out = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('.'));
  return out;
}

/** 把一组技能 id 展成带权重的稀疏向量 */
export function toVector(skillIds) {
  const vec = new Map();
  for (const raw of Array.isArray(skillIds) ? skillIds : []) {
    const id = String(raw || '').trim();
    if (!id) continue;
    const chain = ancestors(id);
    chain.forEach((node, depth) => {
      const w = depth === 0 ? W_LEAF : (depth === 1 ? W_PARENT : W_ANCESTOR);
      const prev = vec.get(node) || 0;
      if (w > prev) vec.set(node, w);
    });
  }
  return vec;
}

function normOf(vec) {
  let s = 0;
  for (const v of vec.values()) s += v * v;
  return Math.sqrt(s) || 1;
}

/** 余弦相似度。两个范数都由调用方算好传进来，避免每题重复求范数。 */
function cosine(a, aNorm, b, bNorm) {
  let dot = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) {
    const w = big.get(k);
    if (w) dot += v * w;
  }
  return dot / (aNorm * bNorm || 1);
}

function buildItem(doc, tagToSkill) {
  const rawSkills = Array.isArray(doc.skills) && doc.skills.length
    ? doc.skills
    : (Array.isArray(doc.tags) ? doc.tags.map((t) => tagToSkill[String(t)] || String(t)) : []);
  const vec = toVector(rawSkills);
  if (vec.size === 0) return null;
  return {
    id: String(doc.id || doc.problemId || ''),
    vec,
    norm: normOf(vec),
    // 原始技能 id（不含展开出来的祖先），用来解释「为什么这两道题相似」
    skills: rawSkills.map(String),
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    difficulty: Number(doc.difficulty) || 0,
    public: doc.public !== false,
    hx: /^HX/i.test(String(doc.id || doc.problemId || '')),
  };
}

async function readAll(db, collection, projection) {
  return db.collection(collection).find({}, { projection }).toArray();
}

/**
 * 载入（或复用）索引。
 * 优先用 problem_vectors（分类结果），没有就用 problems.tags + skills 里的 tagMap 现建。
 */
export async function getIndex(db, { force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && now - _cache.at < TTL_MS) return _cache;
  if (_loading) return _loading;

  _loading = (async () => {
    let tagToSkill = {};
    try {
      const skillDocs = await readAll(db, 'skills', { id: 1, aliases: 1, _id: 0 });
      for (const s of skillDocs) {
        if (!s || !s.id) continue;
        tagToSkill[s.id] = s.id;
        for (const alias of (s.aliases || [])) tagToSkill[String(alias)] = s.id;
      }
    } catch (e) { /* skills 集合不存在时忽略 */ }

    let items = [];
    try {
      const vecDocs = await readAll(db, 'problem_vectors', {
        problemId: 1, skills: 1, tags: 1, difficulty: 1, public: 1, _id: 0,
      });
      items = vecDocs.map((d) => buildItem({ ...d, id: d.problemId }, tagToSkill)).filter(Boolean);
    } catch (e) { /* 集合不存在 */ }

    let source = 'problem_vectors';
    if (items.length === 0) {
      const probs = await readAll(db, 'problems', { id: 1, tags: 1, difficulty: 1, public: 1, _id: 0 });
      items = probs.map((d) => buildItem(d, tagToSkill)).filter(Boolean);
      source = 'problems.tags';
    }

    _cache = { at: Date.now(), items, source, tagToSkill };
    return _cache;
  })();

  try {
    return await _loading;
  } finally {
    _loading = null;
  }
}

/** 诊断用：索引规模与来源 */
export async function indexStats(db) {
  const idx = await getIndex(db);
  let dims = 0;
  for (const it of idx.items) dims += it.vec.size;
  return {
    source: idx.source,
    problems: idx.items.length,
    avgDims: idx.items.length ? +(dims / idx.items.length).toFixed(2) : 0,
    ageMs: Date.now() - idx.at,
  };
}

/**
 * 找相似题。
 * @param {object} db
 * @param {object} current 当前题（至少含 id / tags / difficulty）
 * @param {object} opts { limit, allowNonPublic, blockHX, difficultyWeight }
 * @returns {Promise<Array|null>} 索引不可用时返回 null，让调用方回落到旧逻辑
 */
export async function findSimilar(db, current, opts = {}) {
  const idx = await getIndex(db);
  if (!idx.items.length) return null;

  const limit = Math.max(1, Math.min(50, Number(opts.limit) || 15));
  const diffWeight = opts.difficultyWeight === undefined ? 0.15 : Number(opts.difficultyWeight);
  const allowNonPublic = !!opts.allowNonPublic;
  const blockHX = !!opts.blockHX;

  const selfId = String(current.id || '');

  // 当前题的向量优先取索引里的分类结果 —— 索引里存的是 LLM 打好的技能，
  // 比 problems.tags（混着 HKMO / bug / need-img 这类非技能标签）准得多。
  // 只有这道题还没进索引时，才退回用 tags 现算。
  const selfItem = idx.items.find((it) => it.id === selfId);
  const curVec = selfItem
    ? selfItem.vec
    : toVector(
      Array.isArray(current.tags) && current.tags.length
        ? current.tags.map((t) => idx.tagToSkill[String(t)] || String(t))
        : []
    );
  const curNorm = selfItem ? selfItem.norm : normOf(curVec);
  const curDiff = Number(current.difficulty) || 0;

  // 当前题没有技能信息：退化成「难度最接近」，但仍然是向量索引给的候选
  if (curVec.size === 0) {
    return idx.items
      .filter((it) => it.id !== selfId && (allowNonPublic || it.public) && !(blockHX && it.hx))
      .sort((a, b) => Math.abs(a.difficulty - curDiff) - Math.abs(b.difficulty - curDiff))
      .slice(0, limit)
      .map((it) => ({ id: it.id, tags: it.tags, difficulty: it.difficulty, score: 0, cosine: 0 }));
  }

  const scored = [];
  for (const it of idx.items) {
    if (it.id === selfId) continue;
    if (!allowNonPublic && !it.public) continue;
    if (blockHX && it.hx) continue;
    const cos = cosine(curVec, curNorm, it.vec, it.norm);
    const diffBonus = 1 - Math.min(1, Math.abs(it.difficulty - curDiff) / 9);
    const score = cos * (1 - diffWeight) + diffBonus * diffWeight;
    scored.push({ it, cos, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const selfSkills = selfItem ? selfItem.skills : [];
  const selfSet = new Set(selfSkills);

  return scored.slice(0, limit).map(({ it, cos, score }) => ({
    id: it.id,
    difficulty: it.difficulty,
    // 只留精确共享的叶技能，用来给前端一句「凭什么相似」
    shared: it.skills.filter((s) => selfSet.has(s)).slice(0, 3),
    cosine: +cos.toFixed(4),
    score: +score.toFixed(4),
  }));
}

/** 测试/运维：丢弃内存索引 */
export function resetIndex() {
  _cache = null;
  _loading = null;
}
