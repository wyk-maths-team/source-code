// =====================================================================
// lib/submissionStore.js —— submissions 关系表（替代 db.collection('submissions')）
// =====================================================================
//
// 方法名刻意与 Mongo 一致，方便逐个替换：
//   findOne / find(...).sort().skip().limit().project().toArray()
//   insertOne / insertMany / updateOne / updateMany / deleteOne / deleteMany
//   countDocuments
//
// 字段映射（camelCase <-> snake_case）集中在 COLS，写回时自动转换。
// subid 是自增整数；为了兼容前端已有的 s._id 用法，返回对象里 _id = String(subid)。
// =====================================================================

import { getPgPool } from '../api/_pg.js';

const COLS = {
  subid: 'subid',
  legacySubid: 'legacy_subid',
  username: 'username',
  problemId: 'problem_id',
  answer: 'answer',
  type: 'type',
  image: 'image',
  timestamp: 'submitted_at',
  correct: 'correct',
  score: 'score',
  systemError: 'system_error',
  marked: 'marked',
  comment: 'comment',
  contestId: 'contest_id',
  paperId: 'paper_id',
  markedAt: 'marked_at',
  aiGraded: 'ai_graded',
  handledBy: 'handled_by',
  usedModel: 'used_model',
  judgingMs: 'judging_ms',
  tokenUsage: 'token_usage',
  taskId: 'task_id',
};

const SELECT_COLS =
  'subid, legacy_subid, username, problem_id, answer, type, image, submitted_at, ' +
  'correct, score, system_error, marked, comment, contest_id, paper_id, marked_at, ' +
  'ai_graded, handled_by, used_model, judging_ms, token_usage, task_id';

function rowToDoc(r) {
  if (!r) return null;
  return {
    _id: String(r.subid),
    subid: Number(r.subid),
    legacySubid: r.legacy_subid,
    username: r.username,
    problemId: r.problem_id,
    answer: r.answer,
    type: r.type,
    image: r.image,
    timestamp: r.submitted_at,
    correct: r.correct,
    score: r.score == null ? null : Number(r.score),
    systemError: r.system_error,
    marked: r.marked,
    comment: r.comment,
    contestId: r.contest_id,
    paperId: r.paper_id,
    markedAt: r.marked_at,
    aiGraded: r.ai_graded,
    handledBy: r.handled_by,
    usedModel: r.used_model,
    judgingMs: r.judging_ms == null ? null : Number(r.judging_ms),
    tokenUsage: r.token_usage == null ? null : Number(r.token_usage),
    taskId: r.task_id,
  };
}

function compile(filter, params) {
  if (!filter || Object.keys(filter).length === 0) return 'TRUE';
  const parts = [];
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$or') {
      const subs = (cond || []).map((f) => compile(f, params));
      parts.push('(' + subs.join(' OR ') + ')');
      continue;
    }
    if (key === '$and') {
      const subs = (cond || []).map((f) => compile(f, params));
      parts.push('(' + subs.join(' AND ') + ')');
      continue;
    }

    // _id 是前端的兼容别名，等同于 subid
    let col = COLS[key];
    if (key === '_id') col = 'subid';
    if (!col) throw new Error('submissions: unsupported filter field ' + key);

    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, val] of Object.entries(cond)) {
        const ph = () => {
          let v = val;
          if (col === 'subid') {
            const n = Number(String(v));
            if (Number.isFinite(n)) v = n;
          }
          params.push(v);
          return '$' + params.length;
        };
        switch (op) {
          case '$in': {
            const list = (val || []).map((v) => {
              let x = v;
              if (col === 'subid') {
                const n = Number(String(v));
                if (Number.isFinite(n)) x = n;
              }
              params.push(x);
              return '$' + params.length;
            });
            parts.push(col + ' IN (' + list.join(', ') + ')');
            break;
          }
          case '$ne': parts.push('NOT (' + col + ' = ' + ph() + ')'); break;
          case '$gt': parts.push(col + ' > ' + ph()); break;
          case '$gte': parts.push(col + ' >= ' + ph()); break;
          case '$lt': parts.push(col + ' < ' + ph()); break;
          case '$lte': parts.push(col + ' <= ' + ph()); break;
          case '$exists': parts.push(val ? col + ' IS NOT NULL' : col + ' IS NULL'); break;
          default: throw new Error('submissions: unsupported operator ' + op);
        }
      }
      continue;
    }

    let v = cond;
    if (col === 'subid') {
      const n = Number(String(v));
      if (Number.isFinite(n)) v = n;
    }
    params.push(v);
    parts.push(col + (v === null ? ' IS NULL' : ' = $' + params.length));
  }
  return '(' + parts.join(' AND ') + ')';
}

class Cursor {
  constructor(filter, opts) {
    this.filter = filter || {};
    this.opts = opts || {};
    this._sort = null;
    this._skip = 0;
    this._limit = null;
  }
  sort(spec) { this._sort = spec; return this; }
  skip(n) { this._skip = Number(n) || 0; return this; }
  limit(n) { this._limit = Number(n) || null; return this; }
  project(p) { this.opts = { ...this.opts, projection: p }; return this; }

  async toArray() {
    const params = [];
    const where = compile(this.filter, params);
    let sql = 'SELECT ' + SELECT_COLS + ' FROM submissions WHERE ' + where;

    if (this._sort && Object.keys(this._sort).length) {
      const order = Object.entries(this._sort).map(([k, dir]) => {
        const col = COLS[k] || (k === '_id' ? 'subid' : null);
        if (!col) throw new Error('submissions: unsupported sort field ' + k);
        return col + (Number(dir) < 0 ? ' DESC' : ' ASC');
      });
      sql += ' ORDER BY ' + order.join(', ');
    } else {
      sql += ' ORDER BY subid DESC';
    }
    if (this._limit) {
      sql += ' LIMIT ' + Number(this._limit);
      if (this._skip) sql += ' OFFSET ' + Number(this._skip);
    } else if (this._skip) {
      sql += ' OFFSET ' + Number(this._skip);
    }

    const r = await getPgPool().query(sql, params);
    let docs = r.rows.map(rowToDoc);
    const proj = this.opts.projection;
    if (proj) {
      const exclusive = Object.entries(proj).filter(([, v]) => !v).map(([k]) => k);
      docs = docs.map((d) => {
        const out = { ...d };
        for (const k of exclusive) delete out[k];
        return out;
      });
    }
    return docs;
  }
}

function columnValue(key, value) {
  const col = COLS[key];
  if (!col) throw new Error('submissions: unsupported field ' + key);
  return value;
}

export async function findOne(filter = {}, opts = {}) {
  const rows = await new Cursor(filter, opts).limit(1).toArray();
  return rows[0] || null;
}

export function find(filter = {}, opts = {}) {
  return new Cursor(filter, opts);
}

export async function countDocuments(filter = {}) {
  const params = [];
  const where = compile(filter, params);
  const r = await getPgPool().query(
    'SELECT COUNT(*)::int AS n FROM submissions WHERE ' + where, params);
  return r.rows[0].n;
}

/**
 * 插入一条提交。subid 由数据库生成（BIGSERIAL），不要传。
 * 返回 { subid, _id }。
 */
export async function insertOne(doc) {
  const cols = [];
  const values = [];
  const holders = [];
  let n = 0;
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'subid' || key === '_id') continue;      // 自增，不接受外部值
    const col = COLS[key];
    if (!col) continue;                                  // 忽略未知字段
    cols.push(col);
    values.push(value === undefined ? null : value);
    holders.push('$' + (++n));
  }
  if (!cols.includes('submitted_at')) {
    cols.push('submitted_at');
    holders.push('NOW()');
  }
  const sql = 'INSERT INTO submissions (' + cols.join(', ') + ') VALUES (' +
    holders.join(', ') + ') RETURNING subid, submitted_at';
  const r = await getPgPool().query(sql, values);
  return { subid: Number(r.rows[0].subid), _id: String(r.rows[0].subid) };
}

export async function insertMany(docs) {
  const out = [];
  for (const d of docs || []) out.push(await insertOne(d));
  return { insertedCount: out.length, insertedIds: out.map((x) => x._id) };
}

export async function updateOne(filter, update) {
  const sets = [];
  const values = [];
  let n = 0;
  const apply = (obj) => {
    for (const [key, value] of Object.entries(obj || {})) {
      const col = COLS[key];
      if (!col) continue;
      values.push(columnValue(key, value === undefined ? null : value));
      sets.push(col + ' = $' + (++n));
    }
  };
  if (update && update.$set) apply(update.$set);
  if (!sets.length) return { matchedCount: 0, modifiedCount: 0 };

  const params = [];
  const where = compile(filter || {}, params);
  // where 的参数排在 set 参数之后
  const shifted = sets.map((s) => s.replace(/\$(\d+)/, (_, i) => '$' + (Number(i) + params.length)));
  const sql = 'UPDATE submissions SET ' + shifted.join(', ') + ' WHERE ' + where;
  const r = await getPgPool().query(sql, [...params, ...values]);
  return { matchedCount: r.rowCount, modifiedCount: r.rowCount };
}

export async function updateMany(filter, update) {
  return updateOne(filter, update);
}

export async function deleteOne(filter) {
  const params = [];
  const where = compile(filter || {}, params);
  const r = await getPgPool().query(
    'DELETE FROM submissions WHERE subid IN (' +
    'SELECT subid FROM submissions WHERE ' + where + ' LIMIT 1)', params);
  return { deletedCount: r.rowCount };
}

export async function deleteMany(filter) {
  const params = [];
  const where = compile(filter || {}, params);
  const r = await getPgPool().query('DELETE FROM submissions WHERE ' + where, params);
  return { deletedCount: r.rowCount };
}

// ───────────── 聚合专用（原 aggregate 的等价 SQL） ─────────────

/** 用户 -> 已 AC 的不同题目数（窗口内） */
export async function solvedCountByUser(since) {
  const r = await getPgPool().query(
    'SELECT username, COUNT(DISTINCT problem_id)::int AS solved FROM submissions ' +
    'WHERE ($1::timestamptz IS NULL OR submitted_at >= $1) ' +
    "  AND ((type = 'image' AND marked = TRUE AND score = 100) " +
    "    OR (type <> 'image' AND correct = TRUE AND system_error = FALSE)) " +
    'GROUP BY username',
    [since || null]
  );
  return r.rows;
}

/** 按天统计每个用户首次 AC 的题目数（api/users charts、api/charts） */
export async function dailyFirstAC() {
  const r = await getPgPool().query(
    "WITH first_ac AS ( " +
    "  SELECT username, problem_id, MIN(submitted_at) AS first_at " +
    "  FROM submissions " +
    "  WHERE ((type = 'image' AND marked = TRUE AND score = 100) " +
    "      OR (type <> 'image' AND correct = TRUE AND system_error = FALSE)) " +
    "  GROUP BY username, problem_id " +
    ") " +
    "SELECT username, " +
    "       to_char(first_at AT TIME ZONE 'Asia/Hong_Kong', 'YYYY-MM-DD') AS date, " +
    "       COUNT(*)::int AS count " +
    "FROM first_ac GROUP BY 1, 2 ORDER BY 2"
  );
  return r.rows;
}

/** 每道题的首次提交（成就在回填 firstTryCount 时用） */
export async function firstAttemptsByUser(username) {
  const r = await getPgPool().query(
    'SELECT DISTINCT ON (problem_id) problem_id, type, correct, system_error, marked, score ' +
    'FROM submissions WHERE username = $1 ORDER BY problem_id, submitted_at ASC',
    [String(username)]
  );
  return r.rows;
}

/** 窗口内 AC 的不同题目（today/ac 回填） */
export async function distinctACSince(username, since) {
  const r = await getPgPool().query(
    'SELECT DISTINCT problem_id FROM submissions ' +
    'WHERE username = $1 AND submitted_at >= $2 ' +
    "  AND ((type = 'image' AND marked = TRUE AND score = 100) " +
    "    OR (type <> 'image' AND correct = TRUE AND system_error = FALSE))",
    [String(username), since]
  );
  return r.rows.map((x) => x.problem_id);
}

/** 窗口内尝试过的不同题目（today/tried 回填） */
export async function distinctTriedSince(username, since) {
  const r = await getPgPool().query(
    'SELECT DISTINCT problem_id FROM submissions ' +
    'WHERE username = $1 AND submitted_at >= $2',
    [String(username), since]
  );
  return r.rows.map((x) => x.problem_id);
}

/** tokenUsage 累计（api/admin-tokens initHistory） */
export async function sumTokenUsageByUser() {
  const r = await getPgPool().query(
    'SELECT username, COALESCE(SUM(token_usage), 0)::bigint AS total ' +
    'FROM submissions WHERE token_usage > 0 GROUP BY username'
  );
  return r.rows;
}

/** 某题的提交总数（成就 never-give-up） */
export async function countByUserProblem(username, problemId) {
  const r = await getPgPool().query(
    'SELECT COUNT(*)::int AS n FROM submissions WHERE username = $1 AND problem_id = $2',
    [String(username), String(problemId)]
  );
  return r.rows[0].n;
}