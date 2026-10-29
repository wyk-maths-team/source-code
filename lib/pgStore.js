// =====================================================================
// lib/pgStore.js —— 题目域（problems / tags / problem_tags）的数据访问层
// =====================================================================
//
// 本轮范围：只有题库。用户、提交、竞赛、PK 等仍在 MongoDB。
//
// 约定：
//   · 所有 SQL 集中在这里；api/*.js 只负责 HTTP。
//   · 全部参数化（$1, $2 ...），ORDER BY 走白名单映射，绝不拼接用户输入。
//   · 返回对象沿用原来的 camelCase 形状（id / ans / public / FS），
//     前端不需要改字段名。
//   · 面向学生的读取永远不带 answer / logic；需要它们时必须显式传 withAnswer。
//
// 与 db/schema.sql 末尾的查询清单一一对应，改一处要同步另一处。
// =====================================================================

import { getPgPool } from '../api/_pg.js';

// ═══════════════ 行映射 ═══════════════

function toNum(v) {
  return v == null ? null : Number(v);
}

/** 内部行 -> 前端形状。withAnswer=false 时不返回 ans / logic。 */
function problemRow(r, withAnswer = false) {
  if (!r) return null;
  const out = {
    id: r.problem_id,
    name: r.name,
    statement: r.statement,
    difficulty: toNum(r.difficulty),
    public: r.is_public,
    FS: r.force_steps,
  };
  if (withAnswer) {
    out.ans = r.answer;
    out.logic = r.logic;
  }
  return out;
}

/** 列表行（不带 statement） */
function listRow(r) {
  return {
    id: r.id,
    name: r.name,
    difficulty: toNum(r.difficulty),
    public: r.public,
    FS: r.FS,
    tags: r.tags || [],
  };
}

// ═══════════════ 排序白名单 ═══════════════
// id 用生成列 id_prefix/id_num 复刻 Mongo 的自然序（HA0012 < HA0100）
const SORT_SQL = {
  id: {
    asc:  'p.id_prefix ASC, p.id_num ASC, p.problem_id ASC',
    desc: 'p.id_prefix DESC, p.id_num DESC, p.problem_id DESC',
  },
  difficulty: {
    asc:  'COALESCE(p.difficulty, 0) ASC, p.id_prefix ASC, p.id_num ASC',
    desc: 'COALESCE(p.difficulty, 0) DESC, p.id_prefix DESC, p.id_num DESC',
  },
};

function sortClause(sortBy, order) {
  const key = SORT_SQL[sortBy] ? sortBy : 'id';
  const dir = order === 'desc' ? 'desc' : 'asc';
  return SORT_SQL[key][dir];
}

// ═══════════════ 单题 / 多题 ═══════════════

export async function getProblem(problemId, { withAnswer = false } = {}) {
  const pool = getPgPool();
  const cols = withAnswer
    ? 'problem_id, name, statement, answer, difficulty, is_public, force_steps, logic'
    : 'problem_id, name, statement, difficulty, is_public, force_steps';
  const r = await pool.query(
    'SELECT ' + cols + ' FROM problems WHERE problem_id = $1 LIMIT 1',
    [String(problemId)]
  );
  return problemRow(r.rows[0], withAnswer);
}

/** 批量取（判题、试卷、竞赛、收藏夹）。返回数组，顺序不保证。 */
export async function getProblemsByIds(ids, { withAnswer = false } = {}) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return [];
  const pool = getPgPool();
  const cols = withAnswer
    ? 'problem_id, name, statement, answer, difficulty, is_public, force_steps, logic'
    : 'problem_id, name, statement, difficulty, is_public, force_steps';
  const r = await pool.query(
    'SELECT ' + cols + ' FROM problems WHERE problem_id = ANY($1::text[])',
    [list]
  );
  return r.rows.map((x) => problemRow(x, withAnswer));
}

export async function problemExists(problemId) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT 1 FROM problems WHERE problem_id = $1 LIMIT 1', [String(problemId)]);
  return r.rowCount > 0;
}

// ═══════════════ 列表（分页 / 全量 / id 列表） ═══════════════

function tagFilterClause(tagIndex) {
  // 空数组表示不筛选
  return '(cardinality($' + tagIndex + '::text[]) = 0 OR p.problem_id IN (' +
    'SELECT pt.problem_id FROM problem_tags pt ' +
    'JOIN tags t ON t.tag_no = pt.tag_no ' +
    'WHERE t.name = ANY($' + tagIndex + '::text[])))';
}

/**
 * 分页列表。
 * @returns {{ problems: object[], total: number }}
 * 注意：solves（通过人数）不在 SQL 里 —— 用户状态还在 Mongo，
 *       调用方拿到 problems 之后自己合并 solves，再决定是否需要重排。
 */
export async function listProblemsPage({
  publicOnly = true, tags = [], sortBy = 'id', order = 'asc', page = 1, limit = 20,
} = {}) {
  const pool = getPgPool();
  const off = (Math.max(1, page) - 1) * Math.max(1, limit);
  const where = 'WHERE ($1::boolean = FALSE OR p.is_public) AND ' + tagFilterClause(2);

  // 标签用相关子查询聚合：避免 GROUP BY 与 JOIN 之间的函数依赖判定问题
  const sql =
    'SELECT p.problem_id AS id, p.name, p.difficulty, p.is_public AS "public", ' +
    '       p.force_steps AS "FS", ' +
    '       COALESCE((SELECT array_agg(t.name ORDER BY t.name) ' +
    '                   FROM problem_tags pt JOIN tags t ON t.tag_no = pt.tag_no ' +
    '                  WHERE pt.problem_id = p.problem_id), \'{}\') AS tags ' +
    'FROM problems p ' +
    where + ' ' +
    'ORDER BY ' + sortClause(sortBy, order) + ' ' +
    'LIMIT $3 OFFSET $4';

  const countSql =
    'SELECT COUNT(*)::int AS n FROM problems p ' + where;

  const [rows, count] = await Promise.all([
    pool.query(sql, [publicOnly, tags, limit, off]),
    pool.query(countSql, [publicOnly, tags]),
  ]);

  return { problems: rows.rows.map(listRow), total: count.rows[0].n };
}

/** 指定 id 的多题（收藏夹 / 竞赛题目表）。保持调用方给的顺序。 */
export async function listProblemsByIds(ids, {
  publicOnly = true, sortBy = 'id', order = 'asc',
} = {}) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return [];
  const pool = getPgPool();
  const sql =
    'SELECT p.problem_id AS id, p.name, p.difficulty, p.is_public AS "public", ' +
    '       p.force_steps AS "FS", ' +
    '       COALESCE((SELECT array_agg(t.name ORDER BY t.name) ' +
    '                   FROM problem_tags pt JOIN tags t ON t.tag_no = pt.tag_no ' +
    '                  WHERE pt.problem_id = p.problem_id), \'{}\') AS tags ' +
    'FROM problems p ' +
    'WHERE p.problem_id = ANY($1::text[]) AND ($2::boolean = FALSE OR p.is_public) ' +
    'ORDER BY ' + sortClause(sortBy, order);
  const r = await pool.query(sql, [list, publicOnly]);
  return r.rows.map(listRow);
}

/**
 * 全量题目（列表页 all=1，前端本地筛选）。
 * 题量约 2700，一次拉完比逐页请求更省。
 */
export async function getAllProblems({ publicOnly = true, withStatement = false } = {}) {
  const pool = getPgPool();
  const stmtCol = withStatement ? ', p.statement' : '';
  const sql =
    'SELECT p.problem_id AS id, p.name, p.difficulty, p.is_public AS "public", ' +
    '       p.force_steps AS "FS"' + stmtCol + ', ' +
    '       COALESCE((SELECT array_agg(t.name ORDER BY t.name) ' +
    '                   FROM problem_tags pt JOIN tags t ON t.tag_no = pt.tag_no ' +
    '                  WHERE pt.problem_id = p.problem_id), \'{}\') AS tags ' +
    'FROM problems p ' +
    'WHERE ($1::boolean = FALSE OR p.is_public) ' +
    'ORDER BY p.id_prefix, p.id_num, p.problem_id';
  const r = await pool.query(sql, [publicOnly]);
  return r.rows.map((x) => {
    const row = listRow(x);
    if (withStatement) row.statement = x.statement;
    return row;
  });
}

/** 轻量 id 列表 */
export async function getAllProblemIds({ publicOnly = false } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT problem_id FROM problems ' +
    'WHERE ($1::boolean = FALSE OR is_public) ' +
    'ORDER BY id_prefix, id_num, problem_id',
    [publicOnly]
  );
  return r.rows.map((x) => x.problem_id);
}

export async function getPublicProblemIds() {
  return getAllProblemIds({ publicOnly: true });
}

export async function countProblems({ publicOnly = true, tags = [] } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT COUNT(*)::int AS n FROM problems p ' +
    'WHERE ($1::boolean = FALSE OR p.is_public) AND ' + tagFilterClause(2),
    [publicOnly, tags]
  );
  return r.rows[0].n;
}

// ═══════════════ 标签 ═══════════════

/** 列表页左侧的标签字典（只统计当前可见范围内的题） */
export async function listTagNames({ publicOnly = true } = {}) {
  const pool = getPgPool();
  const sql =
    'SELECT DISTINCT t.name FROM tags t ' +
    'JOIN problem_tags pt ON pt.tag_no = t.tag_no ' +
    'JOIN problems p      ON p.problem_id = pt.problem_id ' +
    'WHERE ($1::boolean = FALSE OR p.is_public) ' +
    'ORDER BY t.name';
  const r = await pool.query(sql, [publicOnly]);
  return r.rows.map((x) => x.name);
}

export async function getProblemTags(problemId) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT t.name FROM problem_tags pt ' +
    'JOIN tags t ON t.tag_no = pt.tag_no ' +
    'WHERE pt.problem_id = $1 ORDER BY t.name',
    [String(problemId)]
  );
  return r.rows.map((x) => x.name);
}

/** 批量标签 —— 列表渲染用，避免 N+1 */
export async function getTagsForProblems(problemIds) {
  const list = (problemIds || []).map(String).filter(Boolean);
  if (!list.length) return {};
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT pt.problem_id, t.name FROM problem_tags pt ' +
    'JOIN tags t ON t.tag_no = pt.tag_no ' +
    'WHERE pt.problem_id = ANY($1::text[]) ' +
    'ORDER BY pt.problem_id, t.name',
    [list]
  );
  const out = {};
  for (const x of r.rows) {
    (out[x.problem_id] ||= []).push(x.name);
  }
  return out;
}

// ═══════════════ 相似题 ═══════════════

/** 共享标签数优先，其次难度接近 */
export async function similarProblems(problemId, difficulty, limit = 15) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT p.problem_id AS id, p.name, p.difficulty, COUNT(*)::int AS shared ' +
    'FROM problem_tags target ' +
    'JOIN problem_tags other ON other.tag_no = target.tag_no ' +
    'JOIN problems p         ON p.problem_id = other.problem_id ' +
    'WHERE target.problem_id = $1 AND other.problem_id <> $1 AND p.is_public ' +
    'GROUP BY p.problem_id, p.name, p.difficulty ' +
    'ORDER BY shared DESC, ABS(COALESCE(p.difficulty, 0) - COALESCE($2::numeric, 0)) ' +
    'LIMIT $3',
    [String(problemId), difficulty, limit]
  );
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    difficulty: toNum(x.difficulty),
    commonTags: x.shared,
  }));
}

/** 没有标签时的退化路径：纯难度接近 */
export async function nearestByDifficulty(problemId, difficulty, limit = 15) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT problem_id AS id, name, difficulty FROM problems ' +
    'WHERE is_public AND problem_id <> $1 ' +
    'ORDER BY ABS(COALESCE(difficulty, 0) - COALESCE($2::numeric, 0)), ' +
    '         id_prefix, id_num LIMIT $3',
    [String(problemId), difficulty, limit]
  );
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    difficulty: toNum(x.difficulty),
    commonTags: 0,
  }));
}

// ═══════════════ 难度映射（成就 / 评分系统） ═══════════════

export async function getDifficultyMap({ publicOnly = false } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT problem_id, difficulty FROM problems ' +
    'WHERE ($1::boolean = FALSE OR is_public)',
    [publicOnly]
  );
  const out = Object.create(null);
  for (const x of r.rows) out[x.problem_id] = toNum(x.difficulty) || 0;
  return out;
}

export async function getPublicDifficultyMap() {
  return getDifficultyMap({ publicOnly: true });
}

// ═══════════════ 管理端写入 ═══════════════

export async function createProblem({
  id, name, statement, ans, difficulty, tags = [], public: isPublic = true,
  logic = '', FS = false,
}) {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO problems (problem_id, name, statement, answer, difficulty, ' +
      'is_public, force_steps, logic) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [String(id), name, statement, String(ans ?? ''), Number(difficulty) || 0,
       isPublic !== false, FS === true, logic || null]
    );
    await replaceProblemTags(client, String(id), tags);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 部分更新。只更新传入的字段（undefined 表示不改）。
 * 注意：把 logic 清空请传 ''（不能传 null —— null 会被当作「不改」）。
 */
export async function updateProblem(problemId, patch = {}) {
  const pid = String(problemId);
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  const pick = (k) => (has(k) && patch[k] !== undefined ? patch[k] : null);

  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      'UPDATE problems SET ' +
      '  name        = COALESCE($2, name), ' +
      '  statement   = COALESCE($3, statement), ' +
      '  answer      = COALESCE($4, answer), ' +
      '  difficulty  = COALESCE($5, difficulty), ' +
      '  is_public   = COALESCE($6, is_public), ' +
      '  force_steps = COALESCE($7, force_steps), ' +
      '  logic       = COALESCE($8, logic), ' +
      '  updated_at  = NOW() ' +
      'WHERE problem_id = $1 RETURNING problem_no',
      [
        pid,
        has('name') ? pick('name') : null,
        has('statement') ? pick('statement') : null,
        has('ans') ? String(pick('ans') ?? '') : null,
        has('difficulty') ? Number(pick('difficulty')) || 0 : null,
        has('public') ? pick('public') !== false : null,
        has('FS') ? pick('FS') === true : null,
        has('logic') ? String(pick('logic') || '') : null,
      ]
    );
    if (has('tags')) await replaceProblemTags(client, pid, patch.tags);
    await client.query('COMMIT');
    return r.rowCount > 0;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 重建某题的标签关联（先删后插；client 由调用方的事务持有） */
async function replaceProblemTags(client, problemId, tagNames) {
  await client.query('DELETE FROM problem_tags WHERE problem_id = $1', [problemId]);
  const names = [...new Set((tagNames || [])
    .map((t) => String(t == null ? '' : t).trim())
    .filter((t) => t && t.length <= 64))];
  if (!names.length) return;
  await client.query(
    'INSERT INTO tags (name) SELECT unnest($1::text[]) ' +
    'ON CONFLICT (name) DO NOTHING',
    [names]
  );
  await client.query(
    'INSERT INTO problem_tags (problem_id, tag_no) ' +
    'SELECT $1, tag_no FROM tags WHERE name = ANY($2::text[]) ' +
    'ON CONFLICT DO NOTHING',
    [problemId, names]
  );
}

/** 批量改公开状态 */
export async function setProblemsPublic(ids, isPublic) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return { updated: 0, problems: [] };
  const pool = getPgPool();
  const r = await pool.query(
    'UPDATE problems SET is_public = $2, updated_at = NOW() ' +
    'WHERE problem_id = ANY($1::text[]) RETURNING problem_id',
    [list, isPublic !== false]
  );
  return { updated: r.rowCount, problems: r.rows.map((x) => x.problem_id) };
}

/** 批量删除（problem_tags 由外键 ON DELETE CASCADE 清理） */
export async function deleteProblems(ids) {
  const list = (ids || []).map(String).filter(Boolean);
  if (!list.length) return [];
  const pool = getPgPool();
  const r = await pool.query(
    'DELETE FROM problems WHERE problem_id = ANY($1::text[]) RETURNING problem_id',
    [list]
  );
  return r.rows.map((x) => x.problem_id);
}

/** 只改难度（api/admin.js） */
export async function setDifficulty(problemId, difficulty) {
  const pool = getPgPool();
  const r = await pool.query(
    'UPDATE problems SET difficulty = $2, updated_at = NOW() ' +
    'WHERE problem_id = $1 RETURNING problem_no',
    [String(problemId), Number(difficulty)]
  );
  return r.rowCount > 0;
}

/**
 * 试卷子题批量 upsert。
 * @returns {{ created: number, updated: number }}
 */
export async function upsertPaperQuestions(questions) {
  const pool = getPgPool();
  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const q of questions) {
      const qid = String(q.id);
      const exists = await client.query(
        'SELECT 1 FROM problems WHERE problem_id = $1 LIMIT 1', [qid]);
      if (exists.rowCount > 0) {
        await client.query(
          'UPDATE problems SET ' +
          '  answer     = COALESCE($2, answer), ' +
          '  difficulty = COALESCE($3, difficulty), ' +
          '  is_public  = COALESCE($4, is_public), ' +
          '  updated_at = NOW() ' +
          'WHERE problem_id = $1',
          [qid, q.ans === undefined ? null : String(q.ans),
           q.difficulty === undefined ? null : Number(q.difficulty) || 0,
           q.public === undefined ? null : q.public !== false]
        );
        if (Array.isArray(q.tags)) await replaceProblemTags(client, qid, q.tags);
        updated++;
      } else {
        await client.query(
          'INSERT INTO problems (problem_id, name, statement, answer, difficulty, ' +
          'is_public, force_steps, logic) VALUES ($1,$2,$3,$4,$5,$6,FALSE,NULL)',
          [qid, qid, '', String(q.ans || ''), Number(q.difficulty) || 5,
           q.public !== false]
        );
        if (Array.isArray(q.tags)) await replaceProblemTags(client, qid, q.tags);
        created++;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { created, updated };
}

// ═══════════════ 版本号 ═══════════════

export async function getProblemsVersion() {
  const pool = getPgPool();
  const r = await pool.query(
    "SELECT value->>'version' AS v FROM app_settings WHERE key = 'problemsVersion'");
  return Number(r.rows[0]?.v || 0);
}

export async function bumpProblemsVersion() {
  const pool = getPgPool();
  const r = await pool.query(
    "UPDATE app_settings " +
    "SET value = jsonb_set(value, '{version}', " +
    "      to_jsonb((EXTRACT(EPOCH FROM NOW()) * 1000)::bigint)), " +
    "    updated_at = NOW() " +
    "WHERE key = 'problemsVersion' " +
    "RETURNING (value->>'version')::bigint AS v");
  return Number(r.rows[0]?.v || 0);
}

// ═══════════════ 轻量元数据 / 搜索 ═══════════════

/** 只要 id + difficulty 的元数据（lib/problemCache.js 用） */
export async function listProblemDifficultyRows({ publicOnly = false } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT problem_id AS id, difficulty FROM problems ' +
    'WHERE ($1::boolean = FALSE OR is_public) ' +
    'ORDER BY id_prefix, id_num, problem_id',
    [publicOnly]
  );
  return r.rows.map((x) => ({ id: x.id, difficulty: toNum(x.difficulty) }));
}

/** 按 id 或标题模糊搜索（api/search.js?action=search_prob） */
export async function searchProblems(keyword, limit = 6) {
  const pool = getPgPool();
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const r = await pool.query(
    'SELECT problem_id AS id, name FROM problems ' +
    "WHERE problem_id ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%' " +
    'ORDER BY id_prefix, id_num, problem_id LIMIT $2',
    [kw, limit]
  );
  return r.rows;
}

// ═══════════════ 抽题池（api/pk-bet.js） ═══════════════

/**
 * 按难度区间随机取公开题，排除指定标签（CHAIN_WARNING）。
 * 对应原来的 Mongo filter: { public: true, tags: { $ne: 'CHAIN_WARNING' }, difficulty: { $gte, $lte } }
 */
export async function pickProblemPool({
  minDiff = null, maxDiff = null, limit = null, excludeTags = [],
} = {}) {
  const pool = getPgPool();
  const lim = limit ? ' LIMIT ' + (Number(limit) || 0) : '';
  const r = await pool.query(
    'SELECT p.problem_id AS id, p.difficulty FROM problems p ' +
    'WHERE p.is_public ' +
    '  AND ($1::numeric IS NULL OR p.difficulty >= $1) ' +
    '  AND ($2::numeric IS NULL OR p.difficulty <= $2) ' +
    '  AND NOT EXISTS ( ' +
    '        SELECT 1 FROM problem_tags pt JOIN tags t ON t.tag_no = pt.tag_no ' +
    '         WHERE pt.problem_id = p.problem_id AND t.name = ANY($3::text[])) ' +
    'ORDER BY random()' + lim,
    [minDiff, maxDiff, excludeTags]
  );
  return r.rows.map((x) => ({ id: x.id, difficulty: toNum(x.difficulty) }));
}

// ═══════════════ 管理端读取（含答案与脚本） ═══════════════

/** 单题完整文档：含 answer / logic / tags。仅限管理员路径调用。 */
export async function getProblemForAdmin(problemId) {
  const p = await getProblem(problemId, { withAnswer: true });
  if (!p) return null;
  p.tags = await getProblemTags(problemId);
  return p;
}

/** 全量题目：含 answer / logic / tags。仅限管理员路径调用。 */
export async function listAllForAdmin() {
  const pool = getPgPool();
  const sql =
    'SELECT p.problem_id AS id, p.name, p.statement, p.answer AS ans, ' +
    '       p.difficulty, p.is_public AS "public", p.force_steps AS "FS", p.logic, ' +
    '       COALESCE((SELECT array_agg(t.name ORDER BY t.name) ' +
    '                   FROM problem_tags pt JOIN tags t ON t.tag_no = pt.tag_no ' +
    '                  WHERE pt.problem_id = p.problem_id), \'{}\') AS tags ' +
    'FROM problems p ' +
    'ORDER BY p.id_prefix, p.id_num, p.problem_id';
  const r = await pool.query(sql);
  return r.rows.map((x) => ({
    id: x.id,
    name: x.name,
    statement: x.statement,
    ans: x.ans,
    difficulty: toNum(x.difficulty),
    public: x.public,
    FS: x.FS,
    logic: x.logic,
    tags: x.tags || [],
  }));
}