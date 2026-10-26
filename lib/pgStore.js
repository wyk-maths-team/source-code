// lib/pgStore.js —— PostgreSQL 数据访问层
//
// 为什么单独一层：
//   · 之前 MongoDB 的查询散在 30 个 api 文件里（353 处），换个库等于全文重写
//   · 这里把「核心三表」的所有读写收敛成函数，api 文件只负责 HTTP
//   · 每条 SQL 都对应 tools/queries.sql 里的一条，改动时两边一起改
//
// 已迁移的表：users / user_tokens / user_achievements / user_stats_cache
//            problems / tags / problem_tags / submissions / user_problem_status
// 未迁移的（仍走 MongoDB）：contests / messages / discussions / pk_* / userdata ...
//
// 约定：
//   · 所有值用参数化（$1, $2），禁止拼接
//   · 返回的字段名保持 camelCase，和原来的 Mongo 文档形状一致，
//     这样前端不用跟着改
//   · snake_case ↔ camelCase 的映射集中在这里做

import { getPgPool } from '../api/_pg.js';

// ═══════════════════════════════════════════════════════════
// 行 -> 对象 的映射
// ═══════════════════════════════════════════════════════════

function userRow(r) {
  if (!r) return null;
  return {
    username: r.username,
    password: r.password,
    role: r.role,
    email: r.email,
    realName: r.real_name,
    displayName: r.display_name,
    pfp: r.pfp,
    banned: r.banned,
    createdAt: r.created_at,
  };
}

function tokenRow(r) {
  if (!r) return null;
  return {
    daily: Number(r.daily),
    global: Number(r.global_balance),
    lastReset: r.last_reset,
    dailyLoginClaimed: r.daily_login_claimed,
    dailyQuestClaimed: r.daily_quest_claimed,
  };
}

function problemRow(r) {
  if (!r) return null;
  return {
    id: r.problem_id,
    name: r.name,
    statement: r.statement,
    ans: r.answer,
    difficulty: r.difficulty == null ? null : Number(r.difficulty),
    public: r.is_public,
    FS: r.force_steps,
    logic: r.logic,
  };
}

function submissionRow(r) {
  if (!r) return null;
  return {
    subid: r.subid,
    username: r.username,
    problemId: r.problem_id,
    answer: r.answer,
    type: r.type,
    image: r.image,
    timestamp: r.submitted_at,
    correct: r.correct,
    score: r.score,
    systemError: r.system_error,
    marked: r.marked,
    comment: r.comment,
    contestId: r.contest_id,
  };
}

// ═══════════════════════════════════════════════════════════
// 用户
// ═══════════════════════════════════════════════════════════

export async function getUser(username) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT username, password, role, email, real_name, display_name, pfp, banned, created_at
     FROM users WHERE username = $1 LIMIT 1`,
    [username]
  );
  return userRow(r.rows[0]);
}

export async function getUsersByNames(usernames) {
  if (!usernames?.length) return [];
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT username, password, role, email, real_name, display_name, pfp, banned, created_at
     FROM users WHERE username = ANY($1::text[])`,
    [usernames]
  );
  return r.rows.map(userRow);
}

export async function usernameExists(username) {
  const pool = getPgPool();
  const r = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [username]);
  return r.rowCount > 0;
}

/**
 * 建用户 + 建钱包，同一个事务。
 * 只建 user 不建 token 会让后续所有读余额的地方要处理 NULL，
 * 所以两者必须原子。
 */
export async function createUser({ username, password, role = 'student', email = null,
                                    realName = null, displayName = null, pfp = null,
                                    daily = 30000, global = 100000 }) {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO users (username, password, role, email, real_name, display_name, pfp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [username, password, role, email, realName, displayName || username, pfp]
    );

    await client.query(
      `INSERT INTO user_tokens (username, daily, global_balance, last_reset)
       VALUES ($1, $2, $3, CURRENT_DATE)`,
      [username, daily, global]
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function updateDisplayName(username, displayName) {
  const pool = getPgPool();
  const r = await pool.query(
    `UPDATE users SET display_name = $2
     WHERE username = $1 AND display_name IS DISTINCT FROM $2
     RETURNING username`,
    [username, displayName]
  );
  return r.rowCount > 0;
}

export async function updatePassword(username, hashed) {
  const pool = getPgPool();
  await pool.query('UPDATE users SET password = $2 WHERE username = $1', [username, hashed]);
}

// ═══════════════════════════════════════════════════════════
// 钱包
// ═══════════════════════════════════════════════════════════

export async function getTokens(username) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT daily, global_balance, last_reset, daily_login_claimed, daily_quest_claimed
     FROM user_tokens WHERE username = $1`,
    [username]
  );
  return tokenRow(r.rows[0]);
}

/**
 * 扣款：先扣 daily，不够再扣 global。
 * WHERE 里带余额判断 —— 并发两次扣款时第二次会匹配不到行，
 * rowCount 为 0 就表示余额不足，不需要额外加锁也不会扣成负数。
 */
export async function deductTokens(username, amount) {
  const pool = getPgPool();
  const r = await pool.query(
    `UPDATE user_tokens
     SET daily = daily - LEAST(daily, $2),
         global_balance = global_balance - ($2 - LEAST(daily, $2))
     WHERE username = $1
       AND daily + global_balance >= $2
     RETURNING daily, global_balance`,
    [username, amount]
  );
  return r.rowCount > 0 ? tokenRow(r.rows[0]) : null;
}

/** 加币：奖励一律进 global，不进 daily */
export async function addTokens(username, amount) {
  const pool = getPgPool();
  const r = await pool.query(
    `UPDATE user_tokens
     SET global_balance = global_balance + $2
     WHERE username = $1
     RETURNING daily, global_balance`,
    [username, amount]
  );
  return tokenRow(r.rows[0]);
}

/** 按原路退回：扣的是哪一类就退回哪一类 */
export async function refundTokens(username, { daily = 0, global = 0 }) {
  const pool = getPgPool();
  const r = await pool.query(
    `UPDATE user_tokens
     SET daily = daily + $2, global_balance = global_balance + $3
     WHERE username = $1
     RETURNING daily, global_balance`,
    [username, daily, global]
  );
  return tokenRow(r.rows[0]);
}

export async function resetDailyIfNeeded(username) {
  const pool = getPgPool();
  const r = await pool.query(
    `UPDATE user_tokens
     SET daily = 30000, last_reset = CURRENT_DATE,
         daily_login_claimed = FALSE, daily_quest_claimed = FALSE
     WHERE username = $1 AND last_reset < CURRENT_DATE
     RETURNING daily, global_balance, last_reset,
               daily_login_claimed, daily_quest_claimed`,
    [username]
  );
  return r.rowCount > 0 ? tokenRow(r.rows[0]) : null;
}

// ═══════════════════════════════════════════════════════════
// 用户统计缓存 / 在线状态
// ═══════════════════════════════════════════════════════════

export async function getUserStatsCache(username) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT streak_days, max_streak, active_days_total, heartbeat_count,
            last_seen_at, first_try_count, today_date, today_tried, today_ac
     FROM user_stats_cache WHERE username = $1`,
    [username]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    streakDays: row.streak_days,
    maxStreak: row.max_streak,
    activeDaysTotal: row.active_days_total,
    heartbeatCount: Number(row.heartbeat_count),
    lastSeenAt: row.last_seen_at,
    firstTryCount: row.first_try_count,
    todayDate: row.today_date,
    todayTried: row.today_tried || [],
    todayAC: row.today_ac || [],
  };
}

export async function touchHeartbeat(username) {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO user_stats_cache (username, heartbeat_count, last_seen_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (username)
     DO UPDATE SET heartbeat_count = user_stats_cache.heartbeat_count + 1,
                   last_seen_at = NOW()`,
    [username]
  );
}

// ═══════════════════════════════════════════════════════════
// 题目
// ═══════════════════════════════════════════════════════════

export async function getProblem(problemId, { withAnswer = false } = {}) {
  const pool = getPgPool();
  const cols = withAnswer
    ? 'problem_id, name, statement, answer, difficulty, is_public, force_steps, logic'
    : 'problem_id, name, statement, difficulty, is_public, force_steps';
  const r = await pool.query(`SELECT ${cols} FROM problems WHERE problem_id = $1 LIMIT 1`, [problemId]);
  return problemRow(r.rows[0]);
}

export async function getPublicProblemIds() {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT problem_id FROM problems WHERE is_public ORDER BY problem_id'
  );
  return r.rows.map(x => x.problem_id);
}

export async function getAllProblemIds() {
  const pool = getPgPool();
  const r = await pool.query('SELECT problem_id FROM problems ORDER BY problem_id');
  return r.rows.map(x => x.problem_id);
}

/**
 * 题目列表 / 搜索。
 * 用 (col IS NULL OR ...) 让同一个查询支持多种筛选组合，
 * 避免为每种组合写一条 SQL。
 */
export async function listProblems({ search = null, minDiff = null, maxDiff = null,
                                     limit = 50, offset = 0 } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT problem_id, name, difficulty, is_public
     FROM problems
     WHERE is_public
       AND ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR statement ILIKE '%' || $1 || '%')
       AND ($2::numeric IS NULL OR difficulty >= $2)
       AND ($3::numeric IS NULL OR difficulty <= $3)
     ORDER BY difficulty DESC NULLS LAST, problem_id
     LIMIT $4 OFFSET $5`,
    [search, minDiff, maxDiff, limit, offset]
  );
  return r.rows.map(problemRow);
}

export async function getProblemTags(problemId) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT t.name FROM problem_tags pt
     JOIN tags t ON t.tag_id = pt.tag_id
     WHERE pt.problem_id = $1
     ORDER BY t.name`,
    [problemId]
  );
  return r.rows.map(x => x.name);
}

/** 相似题目：共享标签数优先，其次难度接近 */
export async function similarProblems(problemId, difficulty, limit = 15) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT p.problem_id, p.name, p.difficulty, COUNT(*)::int AS shared
     FROM problem_tags target
     JOIN problem_tags other ON other.tag_id = target.tag_id
     JOIN problems p         ON p.problem_id = other.problem_id
     WHERE target.problem_id = $1
       AND other.problem_id <> $1
       AND p.is_public
     GROUP BY p.problem_id, p.name, p.difficulty
     ORDER BY shared DESC,
              ABS(COALESCE(p.difficulty, 0) - COALESCE($2::numeric, 0))
     LIMIT $3`,
    [problemId, difficulty, limit]
  );
  return r.rows.map(x => ({
    id: x.problem_id,
    name: x.name,
    difficulty: x.difficulty == null ? null : Number(x.difficulty),
    commonTags: x.shared,
  }));
}

/**
 * 没有标签时的退化路径：纯按难度接近程度排。
 * 原来 MongoDB 里是用 $abs($subtract(...)) 排序，这里等价。
 */
export async function nearestByDifficulty(problemId, difficulty, limit = 15) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT problem_id, name, difficulty
     FROM problems
     WHERE is_public AND problem_id <> $1
     ORDER BY ABS(COALESCE(difficulty, 0) - COALESCE($2::numeric, 0)),
              problem_id
     LIMIT $3`,
    [problemId, difficulty, limit]
  );
  return r.rows.map(x => ({
    id: x.problem_id,
    name: x.name,
    difficulty: x.difficulty == null ? null : Number(x.difficulty),
    commonTags: 0,
  }));
}

/** 批量取多道题的标签 —— 列表页用，避免 N+1 */
export async function getTagsForProblems(problemIds) {
  if (!problemIds?.length) return {};
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT pt.problem_id, t.name
     FROM problem_tags pt
     JOIN tags t ON t.tag_id = pt.tag_id
     WHERE pt.problem_id = ANY($1::text[])
     ORDER BY pt.problem_id, t.name`,
    [problemIds]
  );
  const out = {};
  for (const x of r.rows) {
    (out[x.problem_id] ||= []).push(x.name);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// 用户答题状态
// ═══════════════════════════════════════════════════════════

/**
 * 某用户的答题状态。publicOnly=true 时只返回公开题（普通用户视角）。
 */
export async function getUserProblemStatus(username, { publicOnly = true } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT s.problem_id, s.status, p.difficulty
     FROM user_problem_status s
     JOIN problems p ON p.problem_id = s.problem_id
     WHERE s.username = $1
       AND ($2::boolean IS FALSE OR p.is_public)
     ORDER BY s.problem_id`,
    [username, publicOnly]
  );
  return r.rows.map(x => ({
    id: x.problem_id,
    state: x.status,
    difficulty: x.difficulty == null ? null : Number(x.difficulty),
  }));
}

/**
 * 写状态。AC 过就永远是 passed，不会被后来的 WA 覆盖。
 * ON CONFLICT 对应 MongoDB 的 $set 语义。
 */
export async function setProblemStatus(username, problemId, status) {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO user_problem_status (username, problem_id, status, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (username, problem_id)
     DO UPDATE SET
       status = CASE
                  WHEN user_problem_status.status = 'passed' THEN 'passed'
                  ELSE EXCLUDED.status
                END,
       updated_at = NOW()`,
    [username, problemId, status]
  );
}

export async function isPassed(username, problemId) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT 1 FROM user_problem_status
     WHERE username = $1 AND problem_id = $2 AND status = 'passed' LIMIT 1`,
    [username, problemId]
  );
  return r.rowCount > 0;
}

/**
 * 单题状态 —— 题目详情页用。
 * 返回 'passed' | 'failed' | 'not_started'，和前端原来的取值一致。
 * 不要用 getUserProblemStatus 代替：那会把用户几千条状态全拉回来。
 */
export async function getProblemState(username, problemId) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT status FROM user_problem_status
     WHERE username = $1 AND problem_id = $2 LIMIT 1`,
    [username, problemId]
  );
  return r.rows[0]?.status || 'not_started';
}

// ═══════════════════════════════════════════════════════════
// 提交
// ═══════════════════════════════════════════════════════════

export async function insertSubmission({
  subid, username, problemId, answer = '', type = 'text',
  image = null, contestId = null,
}) {
  const pool = getPgPool();
  const r = await pool.query(
    `INSERT INTO submissions
       (subid, username, problem_id, answer, type, image, submitted_at, contest_id)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     RETURNING subid, submitted_at`,
    [subid, username, problemId, answer, type, image, contestId]
  );
  return r.rows[0];
}

export async function finalizeSubmission(subid, { correct, score, systemError, marked, comment }) {
  const pool = getPgPool();
  await pool.query(
    `UPDATE submissions
     SET correct = $2, score = $3, system_error = $4, marked = $5, comment = $6
     WHERE subid = $1`,
    [subid, correct, score, systemError, marked, comment]
  );
}

export async function getSubmission(subid) {
  const pool = getPgPool();
  const r = await pool.query('SELECT * FROM submissions WHERE subid = $1 LIMIT 1', [subid]);
  return submissionRow(r.rows[0]);
}

export async function listSubmissions({ username = null, problemId = null,
                                        limit = 50, offset = 0 } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT subid, username, problem_id, answer, type, image, submitted_at,
            correct, score, system_error, marked, comment, contest_id
     FROM submissions
     WHERE ($1::text IS NULL OR username = $1)
       AND ($2::text IS NULL OR problem_id = $2)
     ORDER BY submitted_at DESC
     LIMIT $3 OFFSET $4`,
    [username, problemId, limit, offset]
  );
  return r.rows.map(submissionRow);
}

export async function countSubmissions({ username = null, problemId = null } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM submissions
     WHERE ($1::text IS NULL OR username = $1)
       AND ($2::text IS NULL OR problem_id = $2)`,
    [username, problemId]
  );
  return r.rows[0].n;
}

/**
 * PK 结算 / first-try 统计用：某项在时间窗口内的最后一次提交。
 * 返回 null 表示没有提交（不是错误）。
 */
export async function lastSubmissionInWindow(username, problemId, from, to) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT submitted_at, correct, score
     FROM submissions
     WHERE username = $1 AND problem_id = $2
       AND submitted_at >= $3 AND submitted_at <= $4
     ORDER BY submitted_at DESC
     LIMIT 1`,
    [username, problemId, from, to]
  );
  return r.rows[0] || null;
}

// ═══════════════════════════════════════════════════════════
// 成就
// ═══════════════════════════════════════════════════════════

export async function getUserAchievements(username) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT achievement_id, unlocked_at, reward
     FROM user_achievements WHERE username = $1 ORDER BY unlocked_at`,
    [username]
  );
  return r.rows.map(x => ({
    id: x.achievement_id,
    unlockedAt: x.unlocked_at,
    reward: Number(x.reward),
  }));
}

/** 解锁成就。返回这次真正新解锁的 id 列表。 */
export async function unlockAchievements(username, ids, rewardOf) {
  if (!ids?.length) return [];
  const pool = getPgPool();
  const granted = [];
  for (const id of ids) {
    const r = await pool.query(
      `INSERT INTO user_achievements (username, achievement_id, unlocked_at, reward)
       VALUES ($1, $2, NOW(), $3)
       ON CONFLICT (username, achievement_id) DO NOTHING
       RETURNING achievement_id`,
      [username, id, rewardOf(id)]
    );
    if (r.rowCount > 0) granted.push(id);
  }
  return granted;
}

// ═══════════════════════════════════════════════════════════
// 统计（profile / 排行榜 / 成就共用）
// ═══════════════════════════════════════════════════════════

/**
 * 一条查询拿齐成就系统需要的计数。
 * 替代原来 4 个 distinct + 1 个聚合扫 submissions 的做法。
 */
export async function getAchievementCounters(username) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE s.status = 'passed')                        AS solved_count,
       COALESCE(MAX(p.difficulty) FILTER (WHERE s.status = 'passed'), 0)  AS max_difficulty,
       COUNT(*)                                                            AS all_tried,
       COALESCE(c.first_try_count, 0)                                      AS first_try_count,
       COALESCE(c.streak_days, 0)                                          AS streak_days,
       CASE WHEN c.today_date = CURRENT_DATE
            THEN COALESCE(array_length(c.today_ac, 1), 0) ELSE 0 END       AS today_ac,
       CASE WHEN c.today_date = CURRENT_DATE
            THEN COALESCE(array_length(c.today_tried, 1), 0) ELSE 0 END    AS today_tried
     FROM user_problem_status s
     JOIN problems p              ON p.problem_id = s.problem_id
     LEFT JOIN user_stats_cache c ON c.username = s.username
     WHERE s.username = $1
     GROUP BY c.first_try_count, c.streak_days, c.today_date, c.today_ac, c.today_tried`,
    [username]
  );
  const row = r.rows[0];
  if (!row) {
    return {
      solvedCount: 0, maxDifficulty: 0, allTried: 0, allSolved: 0,
      firstTryCount: 0, streakDays: 0, accuracy: 0, todayAC: 0, todayTried: 0,
    };
  }
  const solved = Number(row.solved_count);
  const tried = Number(row.all_tried);
  return {
    solvedCount: solved,
    maxDifficulty: Number(row.max_difficulty),
    allTried: tried,
    allSolved: solved,
    firstTryCount: Number(row.first_try_count),
    streakDays: Number(row.streak_days),
    accuracy: tried > 0 ? solved / tried : 0,
    todayAC: Number(row.today_ac),
    todayTried: Number(row.today_tried),
  };
}

/** 已解题目及其难度 —— rating 计算用 */
export async function getSolvedDifficulties(username) {
  const pool = getPgPool();
  const r = await pool.query(
    `SELECT p.difficulty
     FROM user_problem_status s
     JOIN problems p ON p.problem_id = s.problem_id
     WHERE s.username = $1 AND s.status = 'passed' AND p.difficulty IS NOT NULL
     ORDER BY p.difficulty DESC`,
    [username]
  );
  return r.rows.map(x => Number(x.difficulty));
}

/**
 * 排行榜：总榜。
 * 带用户资料和在线状态，省掉「先查榜再查人」的第二次往返。
 */
export async function getLeaderboardOverall(limit = 50, offset = 0) {
  const pool = getPgPool();
  const r = await pool.query(
    `WITH solved AS (
       SELECT username, COUNT(*)::int AS solved
       FROM user_problem_status
       WHERE status = 'passed'
       GROUP BY username
     )
     SELECT s.username, u.display_name, u.real_name, u.pfp, u.role, u.banned,
            c.last_seen_at, s.solved,
            RANK() OVER (ORDER BY s.solved DESC) AS rank
     FROM solved s
     JOIN users u                 ON u.username = s.username
     LEFT JOIN user_stats_cache c ON c.username = s.username
     WHERE u.banned = FALSE
       AND u.role <> 'team'
     ORDER BY rank, s.username
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return r.rows.map(mapLeaderboardRow);
}

/**
 * 排行榜：周期榜。
 *
 * AC 判定沿用原来的两套条件（别合并成一套，图片题和文本题的判法不同）：
 *   · 图片题：老师手动批阅过且满分 → marked = TRUE AND score = 100
 *   · 其他题：判题器给 correct = TRUE 且没有系统错误
 *
 * COUNT(DISTINCT problem_id) 而不是 COUNT(*)：同一题交十次只算一次，
 * 否则反复提交就能刷榜。
 */
export async function getLeaderboardPeriod(days, limit = 50, offset = 0) {
  const pool = getPgPool();
  const r = await pool.query(
    `WITH solved AS (
       SELECT username, COUNT(DISTINCT problem_id)::int AS solved
       FROM submissions
       WHERE submitted_at >= NOW() - ($1 || ' days')::interval
         AND (
               (type = 'image' AND marked = TRUE AND score = 100)
            OR (type <> 'image' AND correct = TRUE AND system_error = FALSE)
             )
       GROUP BY username
     )
     SELECT s.username, u.display_name, u.real_name, u.pfp, u.role, u.banned,
            c.last_seen_at, s.solved
     FROM solved s
     JOIN users u                 ON u.username = s.username
     LEFT JOIN user_stats_cache c ON c.username = s.username
     WHERE u.banned = FALSE
       AND u.role <> 'team'
     ORDER BY s.solved DESC, s.username
     LIMIT $2 OFFSET $3`,
    [days, limit, offset]
  );
  return r.rows.map(mapLeaderboardRow);
}

/** 排行榜行 -> 前端用的形状（keep camelCase） */
function mapLeaderboardRow(x) {
  return {
    username: x.username,
    displayName: x.display_name || x.username,
    realName: x.real_name || '',
    pfp: x.pfp || '',
    role: x.role,
    solves: x.solved,
    solved: x.solved,
    rank: x.rank == null ? null : Number(x.rank),
    lastSeenAt: x.last_seen_at,
  };
}

export { getPgPool };
