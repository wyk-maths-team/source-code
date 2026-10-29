// =====================================================================
// db/import-users.mjs —— 把 MongoDB 的用户域灌进 PostgreSQL
// =====================================================================
//
// 用法：
//   node db/import-users.mjs                 # 真灌
//   node db/import-users.mjs --dry           # 只统计
//   node db/import-users.mjs --with-log      # 顺带从 achievements_log 补 reward
//   node db/import-users.mjs --prune         # 灌完删掉 PG 里 Mongo 已不存在的账号
//
// 前置：
//   1) db/reset.sql → db/schema.sql
//   2) node db/import-problems.mjs      （user_problem_status / user_favorites 有外键指向 problems）
//
// 数据来源：
//   users       -> users / user_tokens / user_achievements / user_stats(部分)
//   userstats   -> user_problem_status / user_stats / user_ratings
//   userdata    -> user_preferences / user_favorites
//   achievements_log -> user_achievements.reward（可选）
//
// 迁移期间不删除 Mongo 数据。
// =====================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import pg from 'pg';

const { Pool } = pg;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const PRUNE = process.argv.includes('--prune');
const WITH_LOG = process.argv.includes('--with-log');
const CHUNK = 500;
const ROLES = new Set(['student', 'admin', 'root', 'team']);

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
const MONGO_DB  = process.env.MONGODB_DB  || env.MONGODB_DB || 'wyk_math';
const PG_URI    = process.env.DATABASE_URL || env.DATABASE_URL;

if (!MONGO_URI) { console.error('缺少 MONGODB_URI'); process.exit(1); }
if (!PG_URI && !DRY) { console.error('缺少 DATABASE_URL'); process.exit(1); }

const chunks = (arr, n = CHUNK) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

function str(v) {
  return v == null ? null : String(v);
}

function dateOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 多行 upsert，返回受影响行数 */
async function upsertMany(client, table, cols, rows, conflictCols, setClause) {
  let n = 0;
  for (const part of chunks(rows)) {
    const values = [];
    let i = 0;
    const tuples = part.map(r => {
      const ph = r.map(v => { values.push(v); return '$' + (++i); });
      return '(' + ph.join(', ') + ')';
    });
    const sql = 'INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES ' +
      tuples.join(', ') + ' ON CONFLICT (' + conflictCols.join(', ') + ') DO UPDATE SET ' +
      setClause;
    const res = await client.query(sql, values);
    n += res.rowCount;
  }
  return n;
}

async function main() {
  const mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 60000 });
  await mongo.connect();
  const mdb = mongo.db(MONGO_DB);

  let pool = null;
  if (!DRY) pool = new Pool({ connectionString: PG_URI, max: 4, connectionTimeoutMillis: 15000 });

  const stats = {};

  try {
    // ────────── 1. users ──────────
    const users = await mdb.collection('users').find({}).toArray();
    console.log('users: ' + users.length + ' 条');

    const userRows = [];
    const tokenRows = [];
    const statsRows = [];
    const achRows = [];
    const knownUsers = new Set();

    for (const u of users) {
      if (!u || !u.username) continue;
      const username = String(u.username);
      if (knownUsers.has(username)) continue;
      knownUsers.add(username);

      userRows.push([
        username,
        str(u.password),
        ROLES.has(u.role) ? u.role : 'student',
        str(u.email),
        str(u.realName),
        str(u.displayName) || username,
        str(u.pfp),
        !!u.banned,
        dateOrNull(u.pfpUpdatedAt),
        dateOrNull(u.lastRenameAt),
        Number(u.renameCount) || 0,
        Number(u.yellowCards) || 0,
        dateOrNull(u.createdAt) || new Date(),
      ]);

      // 钱包：没有 token 的老账号给默认额度（与 lib/token.js 一致）
      const tk = (u.token && typeof u.token === 'object') ? u.token : {};
      tokenRows.push([
        username,
        Math.round(Number(tk.daily ?? 30000) || 0),
        Math.round(Number(tk.global ?? 100000) || 0),
        tk.lastReset || new Date().toISOString().slice(0, 10),
        !!tk.dailyLoginClaimed,
        !!tk.dailyQuestClaimed,
        Math.round(Number(tk.totalUsed) || 0),
      ]);

      // 统计：users 上的那份优先（原来 users 与 userstats 各存一份）
      statsRows.push({
        username,
        streak: Number(u.streakDays) || 0,
        maxStreak: Number(u.maxStreak) || 0,
        activeDays: Number(u.activeDaysTotal) || 0,
        lastActiveDate: u.lastActiveDate || null,
        heartbeat: Number(u.heartbeatCount) || 0,
        lastSeenAt: dateOrNull(u.lastSeenAt),
        offline: !!u.explicitlyOffline,
      });

      if (Array.isArray(u.achievements)) {
        for (const id of new Set(u.achievements)) {
          if (typeof id === 'string' && id) achRows.push([username, id, 0]);
        }
      }
    }

    // ────────── 2. userstats ──────────
    const statsDocs = await mdb.collection('userstats').find({}).toArray();
    console.log('userstats: ' + statsDocs.length + ' 条');

    const statusRows = [];
    const ratingRows = [];
    const statsByUser = new Map();

    for (const s of statsDocs) {
      if (!s || !s.username) continue;
      const username = String(s.username);
      if (!knownUsers.has(username)) continue;

      const st = s.states && typeof s.states === 'object' ? s.states : {};
      for (const [pid, v] of Object.entries(st)) {
        if (v !== 'passed' && v !== 'failed') continue;
        statusRows.push([username, String(pid), v]);
      }

      statsByUser.set(username, s);

      if (s.rating != null && Number.isFinite(Number(s.rating))) {
        ratingRows.push([
          username,
          Number(s.rating),
          Number(s.ratingSolvedCount) || 0,
          dateOrNull(s.ratingUpdatedAt) || new Date(),
          s.ratingMeta ? JSON.stringify(s.ratingMeta) : null,
        ]);
      }
    }

    // userstats 里也有 heartbeat/lastSeen/streak 的一份，users 上没有时用它兜底
    for (const row of statsRows) {
      const s = statsByUser.get(row.username);
      if (!s) continue;
      if (!row.heartbeat && Number(s.heartbeatCount)) row.heartbeat = Number(s.heartbeatCount);
      if (!row.lastSeenAt && s.lastSeenAt) row.lastSeenAt = dateOrNull(s.lastSeenAt);
      if (!row.streak && Number(s.streakDays)) row.streak = Number(s.streakDays);
      if (!row.maxStreak && Number(s.maxStreak)) row.maxStreak = Number(s.maxStreak);
      if (!row.activeDays && Number(s.activeDaysTotal)) row.activeDays = Number(s.activeDaysTotal);
    }

    // ────────── 3. userdata ──────────
    const userdataDocs = await mdb.collection('userdata').find({}).toArray();
    console.log('userdata: ' + userdataDocs.length + ' 条');

    const prefRows = [];
    const favRows = [];
    for (const d of userdataDocs) {
      if (!d || !d.username) continue;
      const username = String(d.username);
      if (!knownUsers.has(username)) continue;

      if (d.theme || d.wallpaper) {
        prefRows.push([
          username,
          str(d.theme),
          str(d.wallpaper),
          dateOrNull(d.wallpaperUpdatedAt),
        ]);
      }
      if (Array.isArray(d.favorites)) {
        for (const pid of new Set(d.favorites)) {
          if (typeof pid === 'string' && pid) favRows.push([username, pid]);
        }
      }
    }

    // ────────── 4. 可选：成就奖励 ──────────
    let logRows = 0;
    if (WITH_LOG) {
      const log = await mdb.collection('achievements_log').find({}).toArray();
      const rewardMap = new Map();
      for (const e of log) {
        if (!e || !e.username || !e.achievementId) continue;
        rewardMap.set(e.username + '|' + e.achievementId, Number(e.reward) || 0);
      }
      for (const row of achRows) {
        const r = rewardMap.get(row[0] + '|' + row[1]);
        if (r) row[2] = r;
      }
      logRows = log.length;
      console.log('achievements_log: ' + log.length + ' 条（用于补 reward）');
    }

    stats.users = userRows.length;
    stats.tokens = tokenRows.length;
    stats.achievements = achRows.length;
    stats.statuses = statusRows.length;
    stats.ratings = ratingRows.length;
    stats.favorites = favRows.length;

    console.log('待写入：users ' + userRows.length +
      ' / tokens ' + tokenRows.length +
      ' / stats ' + statsRows.length +
      ' / achievements ' + achRows.length +
      ' / status ' + statusRows.length +
      ' / ratings ' + ratingRows.length +
      ' / preferences ' + prefRows.length +
      ' / favorites ' + favRows.length);

    if (DRY) {
      console.log('\n[--dry] 未写库。');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // users
      await upsertMany(client, 'users',
        ['username', 'password', 'role', 'email', 'real_name', 'display_name',
         'pfp', 'banned', 'pfp_updated_at', 'last_rename_at', 'rename_count',
         'yellow_cards', 'created_at'],
        userRows, ['username'],
        'password = EXCLUDED.password, role = EXCLUDED.role, email = EXCLUDED.email, ' +
        'real_name = EXCLUDED.real_name, display_name = EXCLUDED.display_name, ' +
        'pfp = EXCLUDED.pfp, banned = EXCLUDED.banned, ' +
        'pfp_updated_at = EXCLUDED.pfp_updated_at, last_rename_at = EXCLUDED.last_rename_at, ' +
        'rename_count = EXCLUDED.rename_count, yellow_cards = EXCLUDED.yellow_cards');
      console.log('✓ users');

      // tokens
      await upsertMany(client, 'user_tokens',
        ['username', 'daily', 'global_balance', 'last_reset',
         'daily_login_claimed', 'daily_quest_claimed', 'total_used'],
        tokenRows, ['username'],
        'daily = EXCLUDED.daily, global_balance = EXCLUDED.global_balance, ' +
        'last_reset = EXCLUDED.last_reset, ' +
        'daily_login_claimed = EXCLUDED.daily_login_claimed, ' +
        'daily_quest_claimed = EXCLUDED.daily_quest_claimed, total_used = EXCLUDED.total_used');
      console.log('✓ user_tokens');

      // stats（含 userstats 的 today 集合）
      const statsFinal = statsRows.map(r => {
        const s = statsByUser.get(r.username);
        const todayDate = s && s.todayDate ? s.todayDate : null;
        return [
          r.username, r.streak, r.maxStreak, r.activeDays, r.lastActiveDate,
          r.heartbeat, r.lastSeenAt, r.offline,
          Number(s && s.firstTryCount) || 0,
          todayDate,
          Array.isArray(s && s.todayTried) ? s.todayTried.map(String) : [],
          Array.isArray(s && s.todayAC) ? s.todayAC.map(String) : [],
          Number(s && s.statsVersion) || 0,
        ];
      });
      await upsertMany(client, 'user_stats',
        ['username', 'streak_days', 'max_streak', 'active_days_total', 'last_active_date',
         'heartbeat_count', 'last_seen_at', 'explicitly_offline',
         'first_try_count', 'today_date', 'today_tried', 'today_ac', 'stats_version'],
        statsFinal, ['username'],
        'streak_days = EXCLUDED.streak_days, max_streak = EXCLUDED.max_streak, ' +
        'active_days_total = EXCLUDED.active_days_total, last_active_date = EXCLUDED.last_active_date, ' +
        'heartbeat_count = EXCLUDED.heartbeat_count, last_seen_at = EXCLUDED.last_seen_at, ' +
        'explicitly_offline = EXCLUDED.explicitly_offline, ' +
        'first_try_count = EXCLUDED.first_try_count, today_date = EXCLUDED.today_date, ' +
        'today_tried = EXCLUDED.today_tried, today_ac = EXCLUDED.today_ac, ' +
        'stats_version = EXCLUDED.stats_version');
      console.log('✓ user_stats');

      // achievements
      await upsertMany(client, 'user_achievements',
        ['username', 'achievement_id', 'reward'], achRows, ['username', 'achievement_id'],
        'reward = GREATEST(user_achievements.reward, EXCLUDED.reward)');
      console.log('✓ user_achievements');

      // 状态：跳过题目不存在的（外键会拒绝）
      const knownPids = new Set(
        (await client.query('SELECT problem_id FROM problems')).rows.map(r => r.problem_id));
      const goodStatus = statusRows.filter(r => knownPids.has(r[1]));
      const orphanStatus = statusRows.length - goodStatus.length;
      await upsertMany(client, 'user_problem_status',
        ['username', 'problem_id', 'status'], goodStatus, ['username', 'problem_id'],
        'status = CASE WHEN user_problem_status.status = \'passed\' THEN \'passed\' ' +
        'ELSE EXCLUDED.status END, updated_at = NOW()');
      console.log('✓ user_problem_status（跳过题目已删的 ' + orphanStatus + ' 条）');

      // rating
      if (ratingRows.length) {
        await upsertMany(client, 'user_ratings',
          ['username', 'rating', 'solved_count', 'updated_at', 'meta'],
          ratingRows, ['username'],
          'rating = EXCLUDED.rating, solved_count = EXCLUDED.solved_count, ' +
          'updated_at = EXCLUDED.updated_at, meta = EXCLUDED.meta');
      }
      console.log('✓ user_ratings');

      // preferences
      if (prefRows.length) {
        await upsertMany(client, 'user_preferences',
          ['username', 'theme', 'wallpaper', 'wallpaper_updated_at'],
          prefRows, ['username'],
          'theme = EXCLUDED.theme, wallpaper = EXCLUDED.wallpaper, ' +
          'wallpaper_updated_at = EXCLUDED.wallpaper_updated_at');
      }
      console.log('✓ user_preferences');

      // favorites：跳过题目已删的
      const goodFav = favRows.filter(r => knownPids.has(r[1]));
      const orphanFav = favRows.length - goodFav.length;
      if (goodFav.length) {
        await upsertMany(client, 'user_favorites',
          ['username', 'problem_id'], goodFav, ['username', 'problem_id'], 'created_at = NOW()');
      }
      console.log('✓ user_favorites（跳过题目已删的 ' + orphanFav + ' 条）');

      // 可选 prune
      if (PRUNE) {
        const list = [...knownUsers];
        const del = await client.query(
          'DELETE FROM users WHERE NOT (username = ANY($1::text[])) RETURNING username', [list]);
        console.log('prune: 删除 PG 独有的账号 ' + del.rowCount + ' 个');
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    // ────────── 核对 ──────────
    const checks = [
      ['users', 'SELECT COUNT(*)::int AS n FROM users'],
      ['user_tokens', 'SELECT COUNT(*)::int AS n FROM user_tokens'],
      ['user_stats', 'SELECT COUNT(*)::int AS n FROM user_stats'],
      ['user_achievements', 'SELECT COUNT(*)::int AS n FROM user_achievements'],
      ['user_problem_status', 'SELECT COUNT(*)::int AS n FROM user_problem_status'],
      ['user_ratings', 'SELECT COUNT(*)::int AS n FROM user_ratings'],
      ['user_favorites', 'SELECT COUNT(*)::int AS n FROM user_favorites'],
      ['user_preferences', 'SELECT COUNT(*)::int AS n FROM user_preferences'],
    ];
    console.log('\n=== 核对 ===');
    for (const [label, sql] of checks) {
      const r = await pool.query(sql);
      console.log('  ' + label.padEnd(22) + ' ' + r.rows[0].n);
    }
    const sample = await pool.query(
      'SELECT * FROM v_user_overview ORDER BY username LIMIT 3');
    console.log('\nv_user_overview 前 3 行：');
    console.table(sample.rows);

    console.log('\n导入完成。');
  } finally {
    await mongo.close();
    if (pool) await pool.end();
  }
}

main().catch(err => {
  console.error('\n导入失败：', err);
  process.exit(1);
});