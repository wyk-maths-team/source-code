// =====================================================================
// db/import-rest.mjs —— 把 MongoDB 剩余的集合灌进 PostgreSQL
// =====================================================================
//
// 用法：node db/import-rest.mjs [--dry]
//
// 覆盖：
//   · submissions   -> submissions 关系表（subid 重新编号，原值存 legacy_subid）
//   · 文档型表       -> contests / pk_* / discussions / messages / audit_logs ...
//                       统一进「doc_id + data(JSONB)」表
//   · port_*        -> 从 chris 库导入
//
// 前置：import-problems.mjs、import-users.mjs 已经跑过（有外键）。
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import pg from 'pg';

const { Pool } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');

function loadEnv() {
  const p = path.join(ROOT, '.env.local');
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const MONGO_URI = process.env.MONGODB_URI || env.MONGODB_URI;
const MONGO_DB  = process.env.MONGODB_DB  || env.MONGO_DB || 'wyk_math';
const MONGO_CHRIS = process.env.MONGO_CHRIS_DB || 'chris';
const PG_URI    = process.env.DATABASE_URL || env.DATABASE_URL;

if (!MONGO_URI) { console.error('缺少 MONGODB_URI'); process.exit(1); }
if (!PG_URI && !DRY) { console.error('缺少 DATABASE_URL'); process.exit(1); }

// 文档型表：Mongo 集合名 -> PG 表名
const DOC_COLLECTIONS = {
  contests: 'contests',
  contest_results: 'contest_results',
  teams: 'teams',
  pkproblems: 'pkproblems',
  pksubmissions: 'pksubmissions',
  pk_rooms: 'pk_rooms',
  pk_invitations: 'pk_invitations',
  pk_bet_rooms: 'pk_bet_rooms',
  pk_bet_invitations: 'pk_bet_invitations',
  pk_bet_results: 'pk_bet_results',
  discussions: 'discussions',
  reports: 'reports',
  submission_reports: 'submission_reports',
  messages: 'messages',
  updates: 'updates',
  calendar_tasks: 'calendar_tasks',
  steps_grading_tasks: 'steps_grading_tasks',
  audit_logs: 'audit_logs',
  achievements_log: 'achievements_log',
  ai_grade_logs: 'ai_grade_logs',
  igem_reports: 'igem_reports',
  'tr-problems': 'tr_problems',
};

const PORT_COLLECTIONS = {
  port_problems: 'port_problems',
  port_submissions: 'port_submissions',
  port_userstats: 'port_userstats',
  port_tasks: 'port_tasks',
  port_drafts: 'port_drafts',
  port_settings: 'port_settings',
};

function docId(doc) {
  const raw = doc?._id ?? doc?.id ?? doc?._key ?? null;
  return raw == null ? null : String(raw);
}

async function main() {
  const mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 60000 });
  await mongo.connect();
  const mdb = mongo.db(MONGO_DB);
  const chris = mongo.db(MONGO_CHRIS);

  let pool = null;
  if (!DRY) pool = new Pool({ connectionString: PG_URI, max: 4, connectionTimeoutMillis: 15000 });
  const report = {};

  try {
    // ───────── 文档型表 ─────────
    for (const [coll, table] of Object.entries({ ...DOC_COLLECTIONS })) {
      const docs = await mdb.collection(coll).find({}).toArray();
      report[coll] = docs.length;
      if (DRY || docs.length === 0) continue;

      let done = 0;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const d of docs) {
          const id = docId(d);
          const json = JSON.stringify(d);
          if (id) {
            await client.query(
              'INSERT INTO ' + table + ' (doc_id, data) VALUES ($1, $2::jsonb) ' +
              'ON CONFLICT (doc_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
              [id, json]
            );
          } else {
            await client.query(
              'INSERT INTO ' + table + ' (data) VALUES ($1::jsonb)', [json]);
          }
          done++;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(coll + ': ' + e.message);
      } finally { client.release(); }
      console.log('✓ ' + coll.padEnd(22) + done);
    }

    // ───────── port_*（chris 库）─────────
    for (const [coll, table] of Object.entries(PORT_COLLECTIONS)) {
      const docs = await chris.collection(coll).find({}).toArray();
      report[coll] = docs.length;
      if (DRY || docs.length === 0) continue;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const d of docs) {
          const id = docId(d);
          const json = JSON.stringify(d);
          if (id) {
            await client.query(
              'INSERT INTO ' + table + ' (doc_id, data) VALUES ($1, $2::jsonb) ' +
              'ON CONFLICT (doc_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()',
              [id, json]
            );
          } else {
            await client.query('INSERT INTO ' + table + ' (data) VALUES ($1::jsonb)', [json]);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(coll + ': ' + e.message);
      } finally { client.release(); }
      console.log('✓ ' + coll.padEnd(22) + docs.length);
    }

    // ───────── submissions（关系表）─────────
    const subs = await mdb.collection('submissions')
      .find({}).sort({ timestamp: 1 }).toArray();
    report.submissions = subs.length;
    console.log('submissions: ' + subs.length + ' 条');

    if (!DRY && subs.length) {
      // 外键检查：用户名与题目必须已经存在
      const users = new Set((await pool.query('SELECT username FROM users')).rows.map(r => r.username));
      const probs = new Set((await pool.query('SELECT problem_id FROM problems')).rows.map(r => r.problem_id));

      let inserted = 0, orphanUser = 0, orphanProblem = 0;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const s of subs) {
          const username = String(s.username || '');
          const pid = String(s.problemId || '');
          if (!users.has(username)) { orphanUser++; continue; }
          if (!probs.has(pid)) { orphanProblem++; continue; }

          const type = ['text', 'image', 'steps'].includes(s.type) ? s.type : 'text';
          await client.query(
            'INSERT INTO submissions (legacy_subid, username, problem_id, answer, type, image, ' +
            'submitted_at, correct, score, system_error, marked, comment, contest_id, paper_id, ' +
            'marked_at, ai_graded, handled_by, used_model, judging_ms, token_usage, task_id) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ' +
            'ON CONFLICT (legacy_subid) DO NOTHING',
            [
              s.subid == null ? null : String(s.subid),
              username, pid,
              s.answer == null ? '' : String(s.answer),
              type,
              s.image || null,
              s.timestamp ? new Date(s.timestamp) : new Date(),
              typeof s.correct === 'boolean' ? s.correct : null,
              Number.isFinite(Number(s.score)) ? Math.round(Number(s.score)) : null,
              !!s.systemError,
              !!s.marked,
              s.comment ? String(s.comment) : null,
              s.contestId == null ? null : String(s.contestId),
              s.paperId == null ? null : String(s.paperId),
              s.markedAt ? new Date(s.markedAt) : null,
              typeof s.aiGraded === 'boolean' ? s.aiGraded : null,
              s.handledBy || null,
              s.usedModel || null,
              Number.isFinite(Number(s.judgingMs)) ? Math.round(Number(s.judgingMs)) : null,
              Number.isFinite(Number(s.tokenUsage)) ? Math.round(Number(s.tokenUsage)) : null,
              s.taskId || null,
            ]
          );
          inserted++;
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
      console.log('✓ submissions 写入 ' + inserted +
        '（跳过：用户不存在 ' + orphanUser + '，题目已删 ' + orphanProblem + '）');
    }

    console.log('\n=== 统计 ===');
    console.table(report);
    console.log('\n完成。');
  } finally {
    await mongo.close();
    if (pool) await pool.end();
  }
}

main().catch((e) => {
  console.error('导入失败：', e);
  process.exit(1);
});
