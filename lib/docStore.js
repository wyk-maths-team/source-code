// =====================================================================
// lib/docStore.js —— 文档型表的统一访问层（MongoDB 的替代品，建在 PG 上）
// =====================================================================
//
// 为什么需要它：
//   剩余集合（竞赛、PK、讨论区、站内信、审计日志……）都是「整体读写的文档」，
//   查询条件简单、字段经常变。把它们逐字段拆成关系表收益很低。
//   所以 db/schema.sql 里统一建了：
//
//       seq BIGSERIAL PRIMARY KEY, doc_id TEXT UNIQUE, data JSONB
//
//   这个文件用与 Mongo 相同的方法名（findOne / find / insertOne / updateOne /
//   deleteOne / countDocuments）操作这些表，让 API 代码几乎不用改。
//
// 边界（重要）：
//   · update 的语义在 JS 里实现（先 SELECT ... FOR UPDATE 读出来，改完写回），
//     因为这比在 SQL 里拼 jsonb_set 更准确、也更好读。并发低，代价可接受。
//   · filter 支持：相等、$in、$ne、$gt/$gte/$lt/$lte、$exists、$regex/RegExp、
//     点路径、顶层 $and / $or。**不支持 $expr** —— 用到它的地方要在 API 里改写。
//   · 返回的文档就是原本存进去的对象，_id 已变成字符串。
// =====================================================================

import { randomUUID } from 'node:crypto';
import { getPgPool } from '../api/_pg.js';

const TABLE_RE = /^[a-z][a-z0-9_]*$/;

/** 文档型表的完整清单（关系表 users/problems/submissions 等不在此列） */
export const DOC_TABLES = [
  'contests', 'contest_results', 'teams',
  'pkproblems', 'pksubmissions', 'pk_rooms', 'pk_invitations',
  'pk_bet_rooms', 'pk_bet_invitations', 'pk_bet_results',
  'discussions', 'reports', 'submission_reports',
  'messages', 'updates', 'calendar_tasks',
  'steps_grading_tasks',
  'audit_logs', 'achievements_log', 'ai_grade_logs',
  'igem_reports', 'tr_problems',
  'port_problems', 'port_submissions', 'port_userstats',
  'port_tasks', 'port_drafts', 'port_settings',
];

function table(name) {
  // Mongo 允许 '-'，PostgreSQL 不允许，统一换成 '_'（'tr-problems' -> 'tr_problems'）
  const n = String(name).replace(/-/g, '_');
  if (!TABLE_RE.test(n)) throw new Error('Invalid collection name: ' + name);
  return n;
}

// ─────────────────────────────────────────────────────────────
// filter -> SQL
// ─────────────────────────────────────────────────────────────

function pathParam(path, params) {
  params.push(path.split('.'));
  return 'data #> $' + params.length;
}

function valueParam(value, params) {
  params.push(JSON.stringify(value));
  return '$' + params.length + '::jsonb';
}

function compileField(key, cond, params) {
  // 正则直接给（Mongo 的 { field: /re/i }）
  if (cond instanceof RegExp) {
    const p = pathParam(key, params);
    params.push(cond.source);
    return '(' + p + ' #>> \'{}\') ~* $' + params.length;
  }

  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)
      && Object.keys(cond).some((k) => k.startsWith('$'))) {
    const parts = [];
    for (const [op, val] of Object.entries(cond)) {
      const p = pathParam(key, params);
      switch (op) {
        case '$in': {
          const list = (val || []).map((v) => valueParam(v, params));
          parts.push('(' + p + ' IN (' + list.join(', ') + '))');
          break;
        }
        case '$nin':
        case '$ne':
          parts.push('NOT (' + p + ' = ' + valueParam(val, params) + ')');
          break;
        case '$gt':
          parts.push('(' + p + ' > ' + valueParam(val, params) + ')');
          break;
        case '$gte':
          parts.push('(' + p + ' >= ' + valueParam(val, params) + ')');
          break;
        case '$lt':
          parts.push('(' + p + ' < ' + valueParam(val, params) + ')');
          break;
        case '$lte':
          parts.push('(' + p + ' <= ' + valueParam(val, params) + ')');
          break;
        case '$exists':
          parts.push(val ? '(' + p + ' IS NOT NULL)' : '(' + p + ' IS NULL)');
          break;
        case '$regex': {
          const flags = cond.$options || '';
          params.push(String(val));
          parts.push('((' + p + ' #>> \'{}\') ~' + (flags.includes('i') ? '*' : '') +
            ' $' + params.length + ')');
          break;
        }
        case '$size':
          params.push(Number(val));
          parts.push('(jsonb_array_length(' + p + ') = $' + params.length + ')');
          break;
        default:
          throw new Error('Unsupported operator ' + op + ' on ' + key);
      }
    }
    return '(' + parts.join(' AND ') + ')';
  }

  // 普通相等（null 特殊处理）
  const p = pathParam(key, params);
  if (cond === null) return '(' + p + ' = \'null\'::jsonb)';
  return '(' + p + ' = ' + valueParam(cond, params) + ')';
}

function compile(filter, params) {
  if (!filter || Object.keys(filter).length === 0) return 'TRUE';
  const parts = [];
  for (const [key, cond] of Object.entries(filter)) {
    if (key === '$and') {
      const subs = (cond || []).map((f) => compile(f, params));
      parts.push('(' + subs.join(' AND ') + ')');
      continue;
    }
    if (key === '$or') {
      const subs = (cond || []).map((f) => compile(f, params));
      parts.push('(' + subs.join(' OR ') + ')');
      continue;
    }
    if (key === '$expr') throw new Error('$expr is not supported by docStore');
    if (key.startsWith('$')) throw new Error('Unsupported top-level operator ' + key);
    parts.push(compileField(key, cond, params));
  }
  return '(' + parts.join(' AND ') + ')';
}

// ─────────────────────────────────────────────────────────────
// JS 侧：投影 / 排序 / update 应用
// ─────────────────────────────────────────────────────────────

function getPath(obj, path) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function unsetPath(obj, path) {
  const keys = path.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur == null) return;
    cur = cur[keys[i]];
  }
  if (cur && typeof cur === 'object') delete cur[keys[keys.length - 1]];
}

function applyProjection(doc, projection) {
  if (!projection) return doc;
  const keys = Object.keys(projection);
  const include = keys.filter((k) => projection[k]).length > 0;
  if (include && !projection._id) {
    const out = {};
    for (const k of keys) {
      if (!projection[k]) continue;
      const v = getPath(doc, k);
      if (v !== undefined) setPath(out, k, v);
    }
    return out;
  }
  const out = { ...doc };
  for (const k of keys) {
    if (!projection[k]) unsetPath(out, k);
  }
  return out;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function applyUpdate(doc, update) {
  const out = clone(doc) || {};
  for (const [op, payload] of Object.entries(update)) {
    switch (op) {
      case '$set':
        for (const [k, v] of Object.entries(payload)) setPath(out, k, v);
        break;
      case '$unset':
        for (const k of Object.keys(payload)) unsetPath(out, k);
        break;
      case '$inc':
        for (const [k, v] of Object.entries(payload)) {
          const old = Number(getPath(out, k) || 0);
          setPath(out, k, old + Number(v || 0));
        }
        break;
      case '$max':
        for (const [k, v] of Object.entries(payload)) {
          const old = getPath(out, k);
          if (old === undefined || v > old) setPath(out, k, v);
        }
        break;
      case '$addToSet':
        for (const [k, v] of Object.entries(payload)) {
          const arr = getPath(out, k);
          const list = Array.isArray(arr) ? arr : [];
          const values = (v && v.$each) ? v.$each : [v];
          for (const item of values) {
            const key = JSON.stringify(item);
            if (!list.some((x) => JSON.stringify(x) === key)) list.push(item);
          }
          setPath(out, k, list);
        }
        break;
      case '$push':
        for (const [k, v] of Object.entries(payload)) {
          const arr = getPath(out, k);
          const list = Array.isArray(arr) ? arr : [];
          const values = (v && v.$each) ? v.$each : [v];
          list.push(...values);
          setPath(out, k, list);
        }
        break;
      case '$pull':
        for (const [k, v] of Object.entries(payload)) {
          const arr = getPath(out, k);
          if (Array.isArray(arr)) {
            setPath(out, k, arr.filter((x) => JSON.stringify(x) !== JSON.stringify(v)));
          }
        }
        break;
      case '$setOnInsert':
        break;   // 只在 upsert 插入时生效，由调用方处理
      default:
        throw new Error('Unsupported update operator ' + op);
    }
  }
  return out;
}

function docIdOf(doc) {
  const raw = doc?._id ?? doc?.id ?? doc?._key ?? null;
  return raw == null ? null : String(raw);
}

// ─────────────────────────────────────────────────────────────
// Cursor
// ─────────────────────────────────────────────────────────────

class Cursor {
  constructor(name, filter, opts) {
    this.name = name;
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
    let sql = 'SELECT seq, data FROM ' + table(this.name) + ' WHERE ' + where;

    if (this._sort && Object.keys(this._sort).length) {
      const orders = Object.entries(this._sort).map(([k, dir]) => {
        const p = pathParam(k, params);
        const d = Number(dir) < 0 ? 'DESC' : 'ASC';
        // 数字按数值排，其余按文本排
        return 'CASE WHEN jsonb_typeof(' + p + ') = \'number\' ' +
          'THEN (' + p + ' #>> \'{}\')::numeric END ' + d + ' NULLS LAST, ' +
          '(' + p + ' #>> \'{}\') ' + d;
      });
      sql += ' ORDER BY ' + orders.join(', ');
    } else {
      sql += ' ORDER BY seq ASC';
    }
    if (this._limit) {
      sql += ' LIMIT ' + Number(this._limit);
      if (this._skip) sql += ' OFFSET ' + Number(this._skip);
    } else if (this._skip) {
      sql += ' OFFSET ' + Number(this._skip);
    }

    const r = await getPgPool().query(sql, params);
    return r.rows.map((row) => applyProjection(row.data, this.opts.projection));
  }
}

// ─────────────────────────────────────────────────────────────
// Collection
// ─────────────────────────────────────────────────────────────

class Collection {
  constructor(name) { this.name = table(name); }

  find(filter = {}, opts = {}) { return new Cursor(this.name, filter, opts); }

  async findOne(filter = {}, opts = {}) {
    const rows = await new Cursor(this.name, filter, opts).limit(1).toArray();
    return rows[0] || null;
  }

  async countDocuments(filter = {}) {
    const params = [];
    const where = compile(filter, params);
    const r = await getPgPool().query(
      'SELECT COUNT(*)::int AS n FROM ' + this.name + ' WHERE ' + where, params);
    return r.rows[0].n;
  }

  async insertOne(doc) {
    const data = clone(doc) || {};
    if (data._id === undefined) data._id = randomUUID();
    const r = await getPgPool().query(
      'INSERT INTO ' + this.name + ' (doc_id, data) VALUES ($1, $2::jsonb) RETURNING seq',
      [docIdOf(data), JSON.stringify(data)]
    );
    return { insertedId: data._id, seq: r.rows[0].seq };
  }

  async insertMany(docs) {
    const out = [];
    for (const doc of docs || []) out.push(await this.insertOne(doc));
    return { insertedCount: out.length, insertedIds: out.map((x) => x.insertedId) };
  }

  async _mutate(filter, update, opts, single) {
    const pool = getPgPool();
    const client = await pool.connect();
    const upsert = !!(opts && opts.upsert);
    try {
      await client.query('BEGIN');
      const params = [];
      const where = compile(filter || {}, params);
      // 锁住命中的行，避免读-改-写之间被别的请求插进来
      const sel = await client.query(
        'SELECT seq, data FROM ' + this.name + ' WHERE ' + where +
        ' ORDER BY seq ASC' + (single ? ' LIMIT 1' : '') + ' FOR UPDATE',
        params
      );

      if (sel.rowCount === 0) {
        if (!upsert) {
          await client.query('COMMIT');
          return { matchedCount: 0, modifiedCount: 0, upsertedId: null };
        }
        const base = {};
        const setOnInsert = update && update.$setOnInsert;
        if (setOnInsert) for (const [k, v] of Object.entries(setOnInsert)) setPath(base, k, v);
        const created = applyUpdate(base, update || {});
        if (created._id === undefined) created._id = randomUUID();
        const ins = await client.query(
          'INSERT INTO ' + this.name + ' (doc_id, data) VALUES ($1, $2::jsonb) RETURNING seq',
          [docIdOf(created), JSON.stringify(created)]
        );
        await client.query('COMMIT');
        return { matchedCount: 0, modifiedCount: 0, upsertedId: created._id, seq: ins.rows[0].seq };
      }

      let modified = 0;
      for (const row of sel.rows) {
        const next = applyUpdate(row.data, update || {});
        await client.query(
          'UPDATE ' + this.name + ' SET data = $2::jsonb, updated_at = NOW(), doc_id = $3 WHERE seq = $1',
          [row.seq, JSON.stringify(next), docIdOf(next)]
        );
        modified++;
      }
      await client.query('COMMIT');
      return { matchedCount: sel.rowCount, modifiedCount: modified, upsertedId: null };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  updateOne(filter, update, opts) { return this._mutate(filter, update, opts, true); }
  updateMany(filter, update, opts) { return this._mutate(filter, update, opts, false); }

  async _delete(filter, single) {
    const params = [];
    const where = compile(filter || {}, params);
    const sql = 'DELETE FROM ' + this.name + ' WHERE seq IN (' +
      'SELECT seq FROM ' + this.name + ' WHERE ' + where + ' ORDER BY seq' +
      (single ? ' LIMIT 1' : '') + ')';
    const r = await getPgPool().query(sql, params);
    return { deletedCount: r.rowCount };
  }

  deleteOne(filter) { return this._delete(filter, true); }
  deleteMany(filter) { return this._delete(filter, false); }

  /** 单表统计（api/status.js） */
  async stats() {
    const r = await getPgPool().query(
      'SELECT COUNT(*)::int AS n, pg_total_relation_size($1) AS size FROM ' + this.name,
      [this.name]);
    const count = r.rows[0].n;
    const size = Number(r.rows[0].size) || 0;
    return { count, storageSize: size, avgObjSize: count ? size / count : 0 };
  }

  /** 某字段的去重值（原 Mongo 的 distinct，JS 里实现） */
  async distinct(field, filter = {}) {
    const docs = await new Cursor(this.name, filter).toArray();
    const set = new Set();
    for (const d of docs) {
      const v = getPath(d, field);
      if (v !== undefined && v !== null) set.add(v);
    }
    return [...set];
  }
}

/** 竞赛是否在有效期内（原来靠 Mongo 的 $expr 计算，现在在 JS 里算） */
export function isContestActive(contest, now = new Date()) {
  if (!contest || !contest.startTime) return false;
  const start = new Date(contest.startTime).getTime();
  const dur = Number(contest.duration) || 0;
  const t = now instanceof Date ? now.getTime() : Number(now);
  return start <= t && start + dur * 60000 >= t;
}

/** 竞赛题目 id（problems 数组元素可能是对象或字符串） */
export function contestProblemIds(contest) {
  return (contest && contest.problems ? contest.problems : []).map((p) =>
    (typeof p === 'object' && p && p.problemId) ? String(p.problemId) : String(p));
}

class SqlDb {
  collection(name) { return new Collection(name); }

  /**
   * 列出「文档型」表（供 admin 备份 / 恢复 / 状态页遍历）。
   * 关系表（users / problems / submissions 等）由 api/cron.js 的 SQL 分支单独导出，
   * 这里刻意不返回，避免把关系表当成 JSONB 文档去读。
   */
  async listCollections() {
    return { toArray: async () => DOC_TABLES.map((name) => ({ name })) };
  }

  /** 整库大小 */
  async stats() {
    const r = await getPgPool().query(
      "SELECT pg_database_size(current_database()) AS size");
    return { storageSize: Number(r.rows[0].size) || 0 };
  }
}

let _db = null;
export function sqlDb() {
  if (!_db) _db = new SqlDb();
  return _db;
}

export { Collection, compile as compileFilter };