// =====================================================================
// lib/userStore.js —— 用户域（users / token / stats / 状态 / 成就 / 收藏）
// =====================================================================
//
// 对应 MongoDB 的三份文档：users、userstats、userdata。
//
// 约定与 pgStore 一致：
//   · 所有 SQL 集中在这里，api/*.js 只负责 HTTP
//   · 全部参数化；动态列名走白名单映射
//   · 返回值保持原来的 camelCase 形状，前端不用改
//
// 时间：「今天」一律由数据库的 CURRENT_DATE 决定，会话时区已在 api/_pg.js
// 固定为 Asia/Hong_Kong，所以不需要在 JS 里做 +8 小时换算。
// =====================================================================

import { getPgPool } from '../api/_pg.js';

// ═══════════════ 行映射 ═══════════════

function toNum(v) {
  return v == null ? null : Number(v);
}

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
    pfpUpdatedAt: r.pfp_updated_at,
    lastRenameAt: r.last_rename_at,
    renameCount: r.rename_count,
    yellowCards: r.yellow_cards,
  };
}

function tokenRow(r) {
  if (!r) return null;
  return {
    daily: toNum(r.daily) || 0,
    global: toNum(r.global_balance) || 0,
    lastReset: r.last_reset,
    dailyLoginClaimed: r.daily_login_claimed,
    dailyQuestClaimed: r.daily_quest_claimed,
    totalUsed: toNum(r.total_used) || 0,
  };
}

function statsRow(r) {
  if (!r) return null;
  return {
    streakDays: r.streak_days,
    maxStreak: r.max_streak,
    activeDaysTotal: r.active_days_total,
    lastActiveDate: r.last_active_date,
    heartbeatCount: toNum(r.heartbeat_count) || 0,
    lastSeenAt: r.last_seen_at,
    explicitlyOffline: r.explicitly_offline,
    firstTryCount: r.first_try_count,
    todayDate: r.today_date,
    todayTried: r.today_tried || [],
    todayAC: r.today_ac || [],
    statsVersion: r.stats_version,
  };
}

const USER_COLS =
  'username, password, role, email, real_name, display_name, pfp, banned, ' +
  'created_at, pfp_updated_at, last_rename_at, rename_count, yellow_cards';

// 允许通过 updateUser 修改的列（白名单：JS 键 -> SQL 列）
const USER_PATCH_COLS = {
  password: 'password',
  role: 'role',
  email: 'email',
  realName: 'real_name',
  displayName: 'display_name',
  pfp: 'pfp',
  banned: 'banned',
  pfpUpdatedAt: 'pfp_updated_at',
  lastRenameAt: 'last_rename_at',
  renameCount: 'rename_count',
};

// ═══════════════ 账号 ═══════════════

/** 登录 / 鉴权用：需要 password 与 banned */
export async function getUserForAuth(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT ' + USER_COLS + ' FROM users WHERE username = $1 LIMIT 1',
    [String(username)]
  );
  return userRow(r.rows[0]);
}

/** 公开资料（不含 password） */
export async function getUser(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT username, role, email, real_name, display_name, pfp, banned, ' +
    'created_at, pfp_updated_at, last_rename_at, rename_count, yellow_cards ' +
    'FROM users WHERE username = $1 LIMIT 1',
    [String(username)]
  );
  const u = r.rows[0];
  if (!u) return null;
  return {
    username: u.username,
    role: u.role,
    email: u.email,
    realName: u.real_name,
    displayName: u.display_name,
    pfp: u.pfp,
    banned: u.banned,
    createdAt: u.created_at,
    pfpUpdatedAt: u.pfp_updated_at,
    lastRenameAt: u.last_rename_at,
    renameCount: u.rename_count,
    yellowCards: u.yellow_cards,
  };
}

export async function getUsersByNames(names) {
  const list = (names || []).map(String).filter(Boolean);
  if (!list.length) return [];
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT username, role, real_name, display_name, pfp, banned, created_at ' +
    'FROM users WHERE username = ANY($1::text[])',
    [list]
  );
  return r.rows.map((u) => ({
    username: u.username,
    role: u.role,
    realName: u.real_name,
    displayName: u.display_name,
    pfp: u.pfp,
    banned: u.banned,
    createdAt: u.created_at,
  }));
}

/** 批量取头像（列表渲染） */
export async function getBatchPfps(names) {
  const list = (names || []).map(String).filter(Boolean).slice(0, 100);
  const out = {};
  if (!list.length) return out;
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT username, pfp FROM users WHERE username = ANY($1::text[])', [list]);
  for (const x of r.rows) out[x.username] = x.pfp || '';
  return out;
}

export async function usernameExists(username) {
  const pool = getPgPool();
  const r = await pool.query('SELECT 1 FROM users WHERE username = $1 LIMIT 1', [String(username)]);
  return r.rowCount > 0;
}

/**
 * 建账号：users + user_tokens + user_stats 必须原子。
 * 缺任意一张都会让后续读余额/统计的代码要处理 NULL。
 */
export async function createUser({
  username, password = null, role = 'student', email = null,
  realName = null, displayName = null, pfp = null,
  daily = 30000, global = 100000,
}) {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO users (username, password, role, email, real_name, display_name, pfp) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [String(username), password, role, email, realName, displayName || username, pfp]
    );
    await client.query(
      'INSERT INTO user_tokens (username, daily, global_balance, last_reset) ' +
      'VALUES ($1,$2,$3,CURRENT_DATE)',
      [String(username), daily, global]
    );
    await client.query('INSERT INTO user_stats (username) VALUES ($1)', [String(username)]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 部分更新账号字段。patch 的键必须来自 USER_PATCH_COLS。
 * @returns {Promise<boolean>} 是否有行被更新
 */
export async function updateUser(username, patch = {}) {
  const sets = [];
  const values = [String(username)];
  for (const [key, col] of Object.entries(USER_PATCH_COLS)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    if (patch[key] === undefined) continue;
    values.push(patch[key]);
    sets.push(col + ' = $' + values.length);
  }
  if (!sets.length) return false;

  const pool = getPgPool();
  const r = await pool.query(
    'UPDATE users SET ' + sets.join(', ') + ' WHERE username = $1 RETURNING username',
    values
  );
  return r.rowCount > 0;
}

/**
 * 改名。外键都带 ON UPDATE CASCADE，子表会自动跟随。
 * MongoDB 里的 submissions 仍由调用方单独处理。
 */
export async function renameUser(oldName, newName) {
  const pool = getPgPool();
  const r = await pool.query(
    'UPDATE users SET username = $2 WHERE username = $1 RETURNING username',
    [String(oldName), String(newName)]
  );
  return r.rowCount > 0;
}

/** 删除账号（子表由 ON DELETE CASCADE 清理） */
export async function deleteUser(username) {
  const pool = getPgPool();
  const r = await pool.query('DELETE FROM users WHERE username = $1 RETURNING username', [String(username)]);
  return r.rowCount > 0;
}

/** 管理端全量列表（不含 password） */
export async function listUsersForAdmin() {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT username, role, email, real_name, display_name, pfp, banned, ' +
    'created_at, pfp_updated_at, last_rename_at, rename_count, yellow_cards ' +
    'FROM users ORDER BY username'
  );
  return r.rows.map((u) => ({
    username: u.username,
    role: u.role,
    email: u.email,
    realName: u.real_name,
    displayName: u.display_name,
    pfp: u.pfp,
    banned: u.banned,
    createdAt: u.created_at,
    pfpUpdatedAt: u.pfp_updated_at,
    lastRenameAt: u.last_rename_at,
    renameCount: u.rename_count,
  }));
}

/** 按 username / realName / displayName 模糊搜索 */
export async function searchUsers(keyword, limit = 6) {
  const pool = getPgPool();
  const kw = String(keyword || '').trim();
  if (!kw) return [];
  const r = await pool.query(
    'SELECT username, real_name, display_name FROM users ' +
    "WHERE username ILIKE '%' || $1 || '%' " +
    "   OR real_name ILIKE '%' || $1 || '%' " +
    "   OR display_name ILIKE '%' || $1 || '%' " +
    'ORDER BY username LIMIT $2',
    [kw, limit]
  );
  return r.rows.map((u) => ({
    username: u.username,
    realName: u.real_name,
    displayName: u.display_name,
  }));
}

/** 展示名是否已被别人占用 */
export async function displayNameTaken(name, exceptUsername) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT 1 FROM users WHERE display_name = $1 AND username <> $2 LIMIT 1',
    [name, String(exceptUsername)]
  );
  return r.rowCount > 0;
}

/** 黄牌 +1（管理端警告） */
export async function incYellowCard(username) {
  const pool = getPgPool();
  await pool.query(
    'UPDATE users SET yellow_cards = yellow_cards + 1 WHERE username = $1',
    [String(username)]
  );
}

/** 在线快照用的账号 + 心跳数据（api/cron.js） */
export async function listUsersOnline() {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT u.username, u.display_name, u.real_name, u.role, u.banned, ' +
    '       COALESCE(s.heartbeat_count, 0) AS heartbeat_count, s.last_seen_at ' +
    'FROM users u LEFT JOIN user_stats s ON s.username = u.username'
  );
  return r.rows.map((x) => ({
    username: x.username,
    displayName: x.display_name || x.username,
    realName: x.real_name || '',
    role: x.role,
    banned: x.banned,
    heartbeatCount: toNum(x.heartbeat_count) || 0,
    lastSeenAt: x.last_seen_at,
  }));
}

// ═══════════════ 钱包 ═══════════════

export async function getTokens(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT daily, global_balance, last_reset, daily_login_claimed, ' +
    'daily_quest_claimed, total_used FROM user_tokens WHERE username = $1',
    [String(username)]
  );
  return tokenRow(r.rows[0]);
}

/** 保证钱包行存在（老账号可能没有） */
export async function ensureTokens(username) {
  const pool = getPgPool();
  await pool.query(
    'INSERT INTO user_tokens (username, daily, global_balance, last_reset) ' +
    'VALUES ($1, 30000, 100000, CURRENT_DATE) ON CONFLICT (username) DO NOTHING',
    [String(username)]
  );
  return getTokens(username);
}

/**
 * 跨天重置：daily 补满；如果 global 是负数，先用新额度还债。
 * 用一条 UPDATE 完成，避免读-改-写的竞态。
 */
export async function resetDailyIfNeeded(username) {
  const pool = getPgPool();
  await pool.query(
    'UPDATE user_tokens SET ' +
    '  global_balance = CASE ' +
    '                     WHEN global_balance < 0 ' +
    '                     THEN global_balance + LEAST(30000, -global_balance) ' +
    '                     ELSE global_balance END, ' +
    '  daily = CASE ' +
    '            WHEN global_balance < 0 ' +
    '            THEN 30000 - LEAST(30000, -global_balance) ' +
    '            ELSE 30000 END, ' +
    '  last_reset = CURRENT_DATE, ' +
    '  daily_login_claimed = FALSE, daily_quest_claimed = FALSE ' +
    'WHERE username = $1 AND last_reset < CURRENT_DATE',
    [String(username)]
  );
  return getTokens(username);
}

/**
 * 扣款（判题、开赛）：先扣 daily，不够再扣 global；global 允许为负。
 * 与 lib/token.js 的 consumeTokens 语义一致，另记 total_used。
 */
export async function consumeTokens(username, amount) {
  const pool = getPgPool();
  const a = Math.max(0, Math.round(Number(amount) || 0));
  const r = await pool.query(
    'UPDATE user_tokens SET ' +
    '  daily = GREATEST(0, daily - $2), ' +
    '  global_balance = global_balance - GREATEST(0, $2 - daily), ' +
    '  total_used = total_used + $2 ' +
    'WHERE username = $1 ' +
    'RETURNING daily, global_balance',
    [String(username), a]
  );
  return tokenRow(r.rows[0]);
}

/** 奖励（AC、成就）：一律进 global，不占每日额度 */
export async function addTokens(username, amount) {
  const pool = getPgPool();
  const a = Math.max(0, Math.round(Number(amount) || 0));
  const r = await pool.query(
    'UPDATE user_tokens SET global_balance = global_balance + $2 ' +
    'WHERE username = $1 RETURNING daily, global_balance',
    [String(username), a]
  );
  return tokenRow(r.rows[0]);
}

/** 按原路退回：扣的是哪一类就退回哪一类 */
export async function refundTokens(username, { daily = 0, global = 0 } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    'UPDATE user_tokens SET daily = daily + $2, global_balance = global_balance + $3 ' +
    'WHERE username = $1 RETURNING daily, global_balance',
    [String(username), Math.round(Number(daily) || 0), Math.round(Number(global) || 0)]
  );
  return tokenRow(r.rows[0]);
}

/** 直接设置两个桶（管理端用） */
export async function setTokens(username, { daily, global }) {
  const pool = getPgPool();
  const r = await pool.query(
    'UPDATE user_tokens SET daily = $2, global_balance = $3 ' +
    'WHERE username = $1 RETURNING daily, global_balance',
    [String(username), Math.round(Number(daily) || 0), Math.round(Number(global) || 0)]
  );
  return tokenRow(r.rows[0]);
}

/** 批量取钱包：username -> token 对象 */
export async function getTokensMap(names) {
  const list = (names || []).map(String).filter(Boolean);
  const out = Object.create(null);
  if (!list.length) return out;
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT username, daily, global_balance, last_reset, daily_login_claimed, ' +
    'daily_quest_claimed, total_used FROM user_tokens WHERE username = ANY($1::text[])',
    [list]
  );
  for (const x of r.rows) out[x.username] = tokenRow(x);
  return out;
}

/**
 * 管理端的用户 + 钱包列表（api/admin-tokens.js）。
 * @param {{search?:string|null, sortBy?:string, order?:string}} opts
 */
export async function listUsersWithTokens({ search = null, sortBy = 'username', order = 'desc' } = {}) {
  const SORTS = {
    totalUsed: 't.total_used',
    global: 't.global_balance',
    daily: 't.daily',
  };
  const col = SORTS[sortBy] || 'u.username';
  const dir = SORTS[sortBy] ? (order === 'asc' ? 'ASC' : 'DESC') : 'ASC';

  const pool = getPgPool();
  // 排序片段来自上面的白名单，不是用户输入
  const sql =
    'SELECT u.username, u.display_name, u.real_name, ' +
    '       COALESCE(t.daily, 30000) AS daily, ' +
    '       COALESCE(t.global_balance, 100000) AS global_balance, ' +
    '       COALESCE(t.total_used, 0) AS total_used ' +
    'FROM users u LEFT JOIN user_tokens t ON t.username = u.username ' +
    'WHERE ($1::text IS NULL ' +
    "   OR u.username ILIKE '%' || $1 || '%' " +
    "   OR u.display_name ILIKE '%' || $1 || '%' " +
    "   OR u.real_name ILIKE '%' || $1 || '%') " +
    'ORDER BY ' + col + ' ' + dir;
  const r = await pool.query(sql, [search && String(search).trim() ? String(search).trim() : null]);
  return r.rows.map((x) => ({
    username: x.username,
    displayName: x.display_name || x.username,
    realName: x.real_name || '',
    daily: toNum(x.daily),
    global: toNum(x.global_balance),
    totalUsed: toNum(x.total_used) || 0,
  }));
}

/** 直接设置累计消耗（管理端初始化历史） */
export async function setTotalUsed(username, total) {
  const pool = getPgPool();
  await pool.query(
    'UPDATE user_tokens SET total_used = $2 WHERE username = $1',
    [String(username), Math.round(Number(total) || 0)]
  );
}

/**
 * 领取每日奖励（登录 / 任务）。
 * 条件写在 WHERE 里 —— 并发重复点击只会成功一次。
 * @returns {{ok:boolean, tokens?:object}}
 */
export async function claimDaily(username, kind) {
  const pool = getPgPool();
  const amount = kind === 'login' ? 10000 : 30000;
  const r = await pool.query(
    'UPDATE user_tokens SET ' +
    '  global_balance = global_balance + $2, ' +
    '  daily_login_claimed = CASE WHEN $3 = \'login\' THEN TRUE ELSE daily_login_claimed END, ' +
    '  daily_quest_claimed = CASE WHEN $3 = \'quest\' THEN TRUE ELSE daily_quest_claimed END ' +
    'WHERE username = $1 ' +
    '  AND (( $3 = \'login\' AND daily_login_claimed = FALSE) ' +
    '    OR ( $3 = \'quest\' AND daily_quest_claimed = FALSE)) ' +
    'RETURNING daily, global_balance',
    [String(username), amount, kind]
  );
  if (r.rowCount === 0) return { ok: false };
  return { ok: true, amount, tokens: tokenRow(r.rows[0]) };
}

/**
 * 花掉一笔钱（买主题等）：余额不足则不扣。
 * 先扣 daily，不够再扣 global。
 */
export async function spendTokens(username, amount) {
  const pool = getPgPool();
  const a = Math.max(0, Math.round(Number(amount) || 0));
  const r = await pool.query(
    'UPDATE user_tokens SET ' +
    '  daily = daily - LEAST(daily, $2), ' +
    '  global_balance = global_balance - ($2 - LEAST(daily, $2)), ' +
    '  total_used = total_used + $2 ' +
    'WHERE username = $1 AND daily + global_balance >= $2 ' +
    'RETURNING daily, global_balance',
    [String(username), a]
  );
  if (r.rowCount === 0) return { ok: false };
  return { ok: true, tokens: tokenRow(r.rows[0]) };
}

/** 把 last_reset 标成今天（管理端初始化历史用，不补 daily） */
export async function setLastResetToday(username) {
  const pool = getPgPool();
  await pool.query(
    'UPDATE user_tokens SET last_reset = CURRENT_DATE WHERE username = $1',
    [String(username)]
  );
}

/**
 * 下注扣款：返回每个桶实际扣了多少（taken），退款时按原路返回。
 *
 * 用一条 CTE 拿到「扣之前的余额」和「扣之后的余额」，两者相减就是 taken。
 * 不能先 SELECT 再 UPDATE —— 中间可能被别的请求插进来。
 *
 * @returns {{ok:true, tokens:object, taken:{daily:number,global:number}} | {ok:false}}
 */
export async function deductTokensWithTaken(username, amount) {
  const a = Math.max(0, Math.round(Number(amount) || 0));
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 行锁：同一账号的并发扣款必须串行，否则两笔都能通过余额检查
    const cur = await client.query(
      'SELECT daily, global_balance FROM user_tokens WHERE username = $1 FOR UPDATE',
      [String(username)]
    );
    if (cur.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false };
    }
    const oldDaily = Number(cur.rows[0].daily);
    const oldGlobal = Number(cur.rows[0].global_balance);
    if (oldDaily + oldGlobal < a) {
      await client.query('ROLLBACK');
      return { ok: false };
    }

    const fromDaily = Math.min(oldDaily, a);
    const fromGlobal = a - fromDaily;
    const newDaily = oldDaily - fromDaily;
    const newGlobal = oldGlobal - fromGlobal;

    await client.query(
      'UPDATE user_tokens SET daily = $2, global_balance = $3, ' +
      'total_used = total_used + $4 WHERE username = $1',
      [String(username), newDaily, newGlobal, a]
    );
    await client.query('COMMIT');
    return {
      ok: true,
      taken: { daily: fromDaily, global: fromGlobal },
      tokens: tokenRow({ daily: newDaily, global_balance: newGlobal }),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
/**
 * 按原路退款。老记录没有 taken 时，保守地把整笔当作 daily ——
 * 退进 global 就是「每日额度洗成永久额度」的口子。
 */
export async function refundTokensByTaken(username, taken, fallbackAmount = 0) {
  const d = (taken && typeof taken === 'object')
    ? Math.max(0, Math.round(Number(taken.daily) || 0))
    : Math.max(0, Math.round(Number(fallbackAmount) || 0));
  const g = (taken && typeof taken === 'object')
    ? Math.max(0, Math.round(Number(taken.global) || 0))
    : 0;
  return refundTokens(username, { daily: d, global: g });
}

// ═══════════════ 统计 ═══════════════

export async function getUserStats(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT streak_days, max_streak, active_days_total, last_active_date, ' +
    'heartbeat_count, last_seen_at, explicitly_offline, first_try_count, ' +
    'today_date, today_tried, today_ac, stats_version ' +
    'FROM user_stats WHERE username = $1',
    [String(username)]
  );
  return statsRow(r.rows[0]);
}

/** 心跳：计数 +1，刷新 last_seen，清掉显式下线标记 */
export async function touchHeartbeat(username) {
  const pool = getPgPool();
  await pool.query(
    'INSERT INTO user_stats (username, heartbeat_count, last_seen_at, explicitly_offline) ' +
    'VALUES ($1, 1, NOW(), FALSE) ' +
    'ON CONFLICT (username) DO UPDATE SET ' +
    '  heartbeat_count = user_stats.heartbeat_count + 1, ' +
    '  last_seen_at = NOW(), explicitly_offline = FALSE',
    [String(username)]
  );
}

/** 显式下线（登出按钮） */
export async function markOffline(username) {
  const pool = getPgPool();
  await pool.query(
    'INSERT INTO user_stats (username, last_seen_at, explicitly_offline) ' +
    'VALUES ($1, NOW(), TRUE) ' +
    'ON CONFLICT (username) DO UPDATE SET last_seen_at = NOW(), explicitly_offline = TRUE',
    [String(username)]
  );
}

/**
 * 连续打卡。同一天重复调用不改任何值。
 * @returns {{changed: boolean, streakDays: number}}
 */
export async function updateStreak(username) {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      'SELECT streak_days, last_active_date FROM user_stats WHERE username = $1 FOR UPDATE',
      [String(username)]
    );
    if (cur.rowCount === 0) {
      await client.query('ROLLBACK');
      return { changed: false, streakDays: 0 };
    }
    const last = cur.rows[0].last_active_date;   // 'YYYY-MM-DD' | null
    const todayRes = await client.query("SELECT CURRENT_DATE::text AS d, " +
      "(CURRENT_DATE - 1)::text AS y");
    const today = todayRes.rows[0].d;
    const yesterday = todayRes.rows[0].y;

    if (last === today) {
      await client.query('ROLLBACK');
      return { changed: false, streakDays: cur.rows[0].streak_days };
    }

    const newStreak = last === yesterday ? (cur.rows[0].streak_days || 0) + 1 : 1;
    await client.query(
      'UPDATE user_stats SET streak_days = $2, last_active_date = CURRENT_DATE, ' +
      '  active_days_total = active_days_total + 1, ' +
      '  max_streak = GREATEST(max_streak, $2) ' +
      'WHERE username = $1',
      [String(username), newStreak]
    );
    await client.query('COMMIT');
    return { changed: true, streakDays: newStreak };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 一次性回填老账号的物化计数（首次访问成就页时触发） */
export async function setStatsBackfill(username, { firstTryCount, todayTried, todayAC, statsVersion }) {
  const pool = getPgPool();
  await pool.query(
    'UPDATE user_stats SET ' +
    '  first_try_count = $2, today_date = CURRENT_DATE, ' +
    '  today_tried = $3, today_ac = $4, stats_version = $5 ' +
    'WHERE username = $1',
    [String(username), Number(firstTryCount) || 0,
     (todayTried || []).map(String), (todayAC || []).map(String),
     Number(statsVersion) || 0]
  );
}

// ═══════════════ 做题状态 ═══════════════

/** { problemId: 'passed'|'failed' } */
export async function getStates(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT problem_id, status FROM user_problem_status WHERE username = $1',
    [String(username)]
  );
  const out = Object.create(null);
  for (const x of r.rows) out[x.problem_id] = x.status;
  return out;
}

export async function getProblemState(username, problemId) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT status FROM user_problem_status WHERE username = $1 AND problem_id = $2 LIMIT 1',
    [String(username), String(problemId)]
  );
  return r.rows[0]?.status || 'not_started';
}

/** 写状态：AC 过就永远是 passed，不会被后来的 WA 覆盖 */
export async function setProblemState(username, problemId, status) {
  const pool = getPgPool();
  await pool.query(
    'INSERT INTO user_problem_status (username, problem_id, status, updated_at) ' +
    'VALUES ($1,$2,$3,NOW()) ' +
    'ON CONFLICT (username, problem_id) DO UPDATE SET ' +
    "  status = CASE WHEN user_problem_status.status = 'passed' THEN 'passed' " +
    '                ELSE EXCLUDED.status END, ' +
    '  updated_at = NOW()',
    [String(username), String(problemId), status]
  );
}

/** 删掉一条状态（admin 改成 not_started） */
export async function removeProblemState(username, problemId) {
  const pool = getPgPool();
  await pool.query(
    'DELETE FROM user_problem_status WHERE username = $1 AND problem_id = $2',
    [String(username), String(problemId)]
  );
}

/** 题目被删除时，全库清掉指向它的状态 */
export async function deleteProblemStatesEverywhere(problemId) {
  const pool = getPgPool();
  const r = await pool.query(
    'DELETE FROM user_problem_status WHERE problem_id = $1', [String(problemId)]);
  return r.rowCount;
}

/** 管理员批量改状态（changes: { pid: 'passed'|'failed'|'not_started' }） */
export async function bulkSetStates(username, changes) {
  const pool = getPgPool();
  const client = await pool.connect();
  const log = [];
  try {
    await client.query('BEGIN');
    const before = await client.query(
      'SELECT problem_id, status FROM user_problem_status WHERE username = $1',
      [String(username)]
    );
    const beforeMap = Object.create(null);
    for (const x of before.rows) beforeMap[x.problem_id] = x.status;

    for (const [pid, raw] of Object.entries(changes || {})) {
      if (!pid || pid.length > 64) continue;
      const next = String(raw);
      if (!['passed', 'failed', 'not_started'].includes(next)) continue;
      const prev = beforeMap[pid] || 'not_started';
      if (prev === next) continue;

      if (next === 'not_started') {
        await client.query(
          'DELETE FROM user_problem_status WHERE username = $1 AND problem_id = $2',
          [String(username), pid]
        );
      } else {
        await client.query(
          'INSERT INTO user_problem_status (username, problem_id, status, updated_at) ' +
          'VALUES ($1,$2,$3,NOW()) ' +
          'ON CONFLICT (username, problem_id) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()',
          [String(username), pid, next]
        );
      }
      log.push({ problemId: pid, from: prev, to: next });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return log;
}

/**
 * 提交后的统计更新（原 submit.js 的 updateUserStats）。
 *
 * 一个事务里完成：读旧状态 -> 更新 today 集合 -> 写状态 -> 可能 first_try_count + 1。
 * 用 FOR UPDATE 锁住 user_stats 行，避免并发提交把 todayAC 覆盖掉。
 *
 * @returns {{isNewAC:boolean, wasAttempted:boolean, wasPassed:boolean, firstTry:boolean}}
 */
export async function updateStatsForSubmission(username, problemId, correct) {
  const pool = getPgPool();
  const client = await pool.connect();
  const u = String(username);
  const pid = String(problemId);
  try {
    await client.query('BEGIN');

    // 保证行存在
    await client.query(
      'INSERT INTO user_stats (username) VALUES ($1) ON CONFLICT (username) DO NOTHING', [u]);

    const st = await client.query(
      'SELECT today_date::text AS today_date, today_tried, today_ac, first_try_count ' +
      'FROM user_stats WHERE username = $1 FOR UPDATE', [u]);
    const row = st.rows[0];

    const todayRes = await client.query('SELECT CURRENT_DATE::text AS d');
    const today = todayRes.rows[0].d;

    const sameDay = row.today_date === today;
    const todayTried = sameDay && Array.isArray(row.today_tried) ? [...row.today_tried] : [];
    const todayAC = sameDay && Array.isArray(row.today_ac) ? [...row.today_ac] : [];

    const s = await client.query(
      'SELECT status FROM user_problem_status WHERE username = $1 AND problem_id = $2',
      [u, pid]);
    const prevStatus = s.rows[0]?.status || null;
    const wasAttempted = prevStatus !== null;
    const wasPassed = prevStatus === 'passed';

    if (!todayTried.includes(pid)) todayTried.push(pid);
    if (correct && !todayAC.includes(pid)) todayAC.push(pid);

    const firstTry = correct && !wasAttempted;

    await client.query(
      'UPDATE user_stats SET today_date = CURRENT_DATE, today_tried = $2, today_ac = $3, ' +
      '  first_try_count = first_try_count + $4 ' +
      'WHERE username = $1',
      [u, todayTried, todayAC, firstTry ? 1 : 0]
    );

    if (correct) {
      await client.query(
        'INSERT INTO user_problem_status (username, problem_id, status, updated_at) ' +
        "VALUES ($1,$2,'passed',NOW()) " +
        'ON CONFLICT (username, problem_id) DO UPDATE SET ' +
        "  status = CASE WHEN user_problem_status.status = 'passed' THEN 'passed' " +
        "                ELSE 'passed' END, updated_at = NOW()",
        [u, pid]);
    } else if (!wasPassed) {
      await client.query(
        'INSERT INTO user_problem_status (username, problem_id, status, updated_at) ' +
        "VALUES ($1,$2,'failed',NOW()) " +
        'ON CONFLICT (username, problem_id) DO UPDATE SET ' +
        "  status = CASE WHEN user_problem_status.status = 'passed' THEN 'passed' " +
        "                ELSE 'failed' END, updated_at = NOW()",
        [u, pid]);
    }

    await client.query('COMMIT');
    return { isNewAC: correct && !wasPassed, wasAttempted, wasPassed, firstTry };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 单用户 passed 数 / 总尝试数 */
export async function getUserSolveCounts(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT COUNT(*) FILTER (WHERE status = \'passed\')::int AS passed, ' +
    '       COUNT(*)::int AS attempted ' +
    'FROM user_problem_status WHERE username = $1',
    [String(username)]
  );
  return { passed: r.rows[0].passed, attempted: r.rows[0].attempted };
}

/** 全量用户的 passed/failed 计数（管理员用户列表） */
export async function getStatusCountsByUser() {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT username, ' +
    "  COUNT(*) FILTER (WHERE status = 'passed')::int AS passed, " +
    "  COUNT(*) FILTER (WHERE status = 'failed')::int AS failed " +
    'FROM user_problem_status GROUP BY username'
  );
  const out = Object.create(null);
  for (const x of r.rows) out[x.username] = { passed: x.passed, failed: x.failed, total: x.passed + x.failed };
  return out;
}

/** profile 用的 = [{id, state, difficulty}]，可选只看公开题 */
export async function getStatusList(username, { publicOnly = true } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT s.problem_id, s.status, p.difficulty ' +
    'FROM user_problem_status s JOIN problems p ON p.problem_id = s.problem_id ' +
    'WHERE s.username = $1 AND ($2::boolean = FALSE OR p.is_public) ' +
    'ORDER BY s.problem_id',
    [String(username), publicOnly]
  );
  return r.rows.map((x) => ({
    id: x.problem_id,
    state: x.status,
    difficulty: toNum(x.difficulty),
  }));
}

/** 难度列表（rating 计算用，已解题目） */
export async function getSolvedDifficulties(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT p.difficulty FROM user_problem_status s ' +
    'JOIN problems p ON p.problem_id = s.problem_id ' +
    "WHERE s.username = $1 AND s.status = 'passed' AND p.difficulty IS NOT NULL",
    [String(username)]
  );
  return r.rows.map((x) => Number(x.difficulty));
}

/** 每道题的 AC 人数（题目列表的 solves 列） */
export async function getSolvesCountMap() {
  const pool = getPgPool();
  const r = await pool.query(
    "SELECT problem_id, COUNT(*)::int AS n FROM user_problem_status " +
    "WHERE status = 'passed' GROUP BY problem_id"
  );
  const out = Object.create(null);
  for (const x of r.rows) out[x.problem_id] = x.n;
  return out;
}

// ═══════════════ 成就 ═══════════════

export async function getAchievements(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT achievement_id, unlocked_at, reward FROM user_achievements ' +
    'WHERE username = $1 ORDER BY unlocked_at',
    [String(username)]
  );
  return r.rows.map((x) => ({
    id: x.achievement_id,
    unlockedAt: x.unlocked_at,
    reward: toNum(x.reward) || 0,
  }));
}

/** 已解锁的成就 id（前端展示 unlocks 用） */
export async function getAchievementIds(username) {
  const list = await getAchievements(username);
  return list.map((x) => x.id);
}

/**
 * 解锁成就。返回本次真正新解锁的 id。
 * ON CONFLICT DO NOTHING 等价于原来的 $addToSet。
 */
export async function unlockAchievements(username, ids, rewardOf) {
  if (!ids || !ids.length) return [];
  const pool = getPgPool();
  const granted = [];
  for (const id of ids) {
    const r = await pool.query(
      'INSERT INTO user_achievements (username, achievement_id, reward) ' +
      'VALUES ($1,$2,$3) ON CONFLICT (username, achievement_id) DO NOTHING ' +
      'RETURNING achievement_id',
      [String(username), String(id), Number(rewardOf ? rewardOf(id) : 0) || 0]
    );
    if (r.rowCount > 0) granted.push(id);
  }
  return granted;
}

/** 成就系统需要的计数，一次查询拿齐 */
export async function getAchievementCounters(username) {
  const pool = getPgPool();
  const [agg, st] = await Promise.all([
    pool.query(
      'SELECT COUNT(*) FILTER (WHERE s.status = \'passed\')::int AS solved, ' +
      '       COUNT(*)::int AS tried, ' +
      '       COALESCE(MAX(p.difficulty) FILTER (WHERE s.status = \'passed\'), 0) AS max_diff ' +
      'FROM user_problem_status s JOIN problems p ON p.problem_id = s.problem_id ' +
      'WHERE s.username = $1',
      [String(username)]
    ),
    pool.query(
      'SELECT first_try_count, streak_days, today_date::text AS today_date, ' +
      '       today_ac, today_tried FROM user_stats WHERE username = $1',
      [String(username)]
    ),
  ]);

  const a = agg.rows[0];
  const s = st.rows[0] || {};
  const todayRes = await pool.query('SELECT CURRENT_DATE::text AS d');
  const sameDay = s.today_date === todayRes.rows[0].d;

  const solved = Number(a.solved) || 0;
  const tried = Number(a.tried) || 0;
  return {
    solvedCount: solved,
    maxDifficulty: Number(a.max_diff) || 0,
    allTried: tried,
    allSolved: solved,
    firstTryCount: Number(s.first_try_count) || 0,
    streakDays: Number(s.streak_days) || 0,
    accuracy: tried > 0 ? solved / tried : 0,
    todayAC: sameDay ? (s.today_ac || []).length : 0,
    todayTried: sameDay ? (s.today_tried || []).length : 0,
  };
}

// ═══════════════ rating 缓存 ═══════════════

export async function getRatingRow(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT rating, solved_count, updated_at, meta FROM user_ratings WHERE username = $1',
    [String(username)]
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    rating: toNum(x.rating),
    solvedCount: x.solved_count,
    updatedAt: x.updated_at,
    meta: x.meta || null,
  };
}

export async function saveRating(username, { rating, solvedCount, meta }) {
  const pool = getPgPool();
  await pool.query(
    'INSERT INTO user_ratings (username, rating, solved_count, updated_at, meta) ' +
    'VALUES ($1,$2,$3,NOW(),$4) ' +
    'ON CONFLICT (username) DO UPDATE SET ' +
    '  rating = EXCLUDED.rating, solved_count = EXCLUDED.solved_count, ' +
    '  updated_at = NOW(), meta = EXCLUDED.meta',
    [String(username), Number(rating), Number(solvedCount),
     meta ? JSON.stringify(meta) : null]
  );
}

// ═══════════════ 收藏 / 设置 ═══════════════

export async function getFavorites(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT problem_id FROM user_favorites WHERE username = $1 ORDER BY created_at, problem_id',
    [String(username)]
  );
  return r.rows.map((x) => x.problem_id);
}

/** 切换收藏，返回切换后的完整列表 */
export async function toggleFavorite(username, problemId) {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const del = await client.query(
      'DELETE FROM user_favorites WHERE username = $1 AND problem_id = $2 RETURNING problem_id',
      [String(username), String(problemId)]
    );
    if (del.rowCount === 0) {
      await client.query(
        'INSERT INTO user_favorites (username, problem_id) VALUES ($1,$2) ' +
        'ON CONFLICT DO NOTHING',
        [String(username), String(problemId)]
      );
    }
    const all = await client.query(
      'SELECT problem_id FROM user_favorites WHERE username = $1 ORDER BY created_at, problem_id',
      [String(username)]
    );
    await client.query('COMMIT');
    return all.rows.map((x) => x.problem_id);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function getPreferences(username) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT theme, wallpaper, wallpaper_updated_at FROM user_preferences WHERE username = $1',
    [String(username)]
  );
  const x = r.rows[0];
  if (!x) return { theme: null, wallpaper: null, wallpaperUpdatedAt: null };
  return {
    theme: x.theme,
    wallpaper: x.wallpaper,
    wallpaperUpdatedAt: x.wallpaper_updated_at,
  };
}

export async function setPreference(username, { theme, wallpaper }) {
  const sets = [];
  const values = [String(username)];
  if (theme !== undefined) { values.push(theme); sets.push('theme = $' + values.length); }
  if (wallpaper !== undefined) {
    values.push(wallpaper);
    sets.push('wallpaper = $' + values.length);
    sets.push('wallpaper_updated_at = CASE WHEN $' + values.length + ' IS NULL THEN NULL ELSE NOW() END');
  }
  if (!sets.length) return;

  const pool = getPgPool();
  await pool.query(
    'INSERT INTO user_preferences (username) VALUES ($1) ON CONFLICT (username) DO NOTHING',
    [String(username)]
  );
  await pool.query(
    'UPDATE user_preferences SET ' + sets.join(', ') + ' WHERE username = $1',
    values
  );
}

// ═══════════════ 批量读取（排行榜 / 成就统计） ═══════════════

/** 批量 rating 缓存行：username -> {rating, solvedCount, updatedAt, meta} */
export async function getRatingRows(names) {
  const list = (names || []).map(String).filter(Boolean);
  const out = Object.create(null);
  if (!list.length) return out;
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT username, rating, solved_count, updated_at, meta FROM user_ratings ' +
    'WHERE username = ANY($1::text[])',
    [list]
  );
  for (const x of r.rows) {
    out[x.username] = {
      rating: toNum(x.rating),
      solvedCount: x.solved_count,
      updatedAt: x.updated_at,
      meta: x.meta || null,
    };
  }
  return out;
}

/** 批量：username -> [已解题目难度]（rating 计算用） */
export async function getSolvedDifficultyMapByUser(names) {
  const list = (names || []).map(String).filter(Boolean);
  const out = Object.create(null);
  if (!list.length) return out;
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT s.username, p.difficulty FROM user_problem_status s ' +
    'JOIN problems p ON p.problem_id = s.problem_id ' +
    "WHERE s.username = ANY($1::text[]) AND s.status = 'passed' AND p.difficulty IS NOT NULL",
    [list]
  );
  for (const x of r.rows) {
    (out[x.username] ||= []).push(Number(x.difficulty));
  }
  return out;
}

/** 全站成就解锁统计 */
export async function getAchievementUnlockCounts() {
  const pool = getPgPool();
  const [agg, total] = await Promise.all([
    pool.query(
      'SELECT ua.achievement_id, COUNT(*)::int AS count ' +
      'FROM user_achievements ua JOIN users u ON u.username = ua.username ' +
      'WHERE u.banned = FALSE GROUP BY ua.achievement_id ORDER BY count DESC'
    ),
    pool.query('SELECT COUNT(*)::int AS n FROM users WHERE banned = FALSE'),
  ]);
  const counts = Object.create(null);
  for (const x of agg.rows) counts[x.achievement_id] = x.count;
  return { totalUsers: total.rows[0].n, counts };
}

/** 未封禁账号数 */
export async function countUsers({ includeBanned = false } = {}) {
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT COUNT(*)::int AS n FROM users' + (includeBanned ? '' : ' WHERE banned = FALSE'));
  return r.rows[0].n;
}

// ═══════════════ 排行榜 ═══════════════

/** 总榜：passed 题目数降序。同分同名次（RANK 语义）。 */
export async function getLeaderboardOverall(limit = 200) {
  const pool = getPgPool();
  const r = await pool.query(
    'WITH solved AS ( ' +
    "  SELECT username, COUNT(*)::int AS solved FROM user_problem_status " +
    "  WHERE status = 'passed' GROUP BY username " +
    ') ' +
    'SELECT s.username, u.display_name, u.real_name, u.pfp, u.role, u.banned, ' +
    '       st.last_seen_at, st.explicitly_offline, s.solved, ' +
    '       RANK() OVER (ORDER BY s.solved DESC) AS rank ' +
    'FROM solved s ' +
    'JOIN users u            ON u.username = s.username ' +
    'LEFT JOIN user_stats st ON st.username = s.username ' +
    'WHERE u.banned = FALSE AND u.role <> \'team\' ' +
    'ORDER BY rank, s.username LIMIT $1',
    [limit]
  );
  return r.rows.map(mapLeaderboardRow);
}

/**
 * 周期榜：只负责「给一批 username 补资料并过滤」。
 * AC 计数来自 MongoDB 的 submissions（本轮没迁），由调用方算好后传进来。
 */
export async function getLeaderboardUsers(names) {
  const list = (names || []).map(String).filter(Boolean);
  if (!list.length) return [];
  const pool = getPgPool();
  const r = await pool.query(
    'SELECT u.username, u.display_name, u.real_name, u.pfp, u.role, u.banned, ' +
    '       u.pfp, st.last_seen_at, st.explicitly_offline ' +
    'FROM users u LEFT JOIN user_stats st ON st.username = u.username ' +
    'WHERE u.username = ANY($1::text[]) AND u.banned = FALSE AND u.role <> \'team\'',
    [list]
  );
  const out = Object.create(null);
  for (const x of r.rows) {
    out[x.username] = {
      username: x.username,
      displayName: x.display_name || x.username,
      realName: x.real_name || '',
      pfp: x.pfp || '',
      role: x.role,
      lastSeenAt: x.last_seen_at,
      explicitlyOffline: x.explicitly_offline,
    };
  }
  return out;
}

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
    explicitlyOffline: x.explicitly_offline,
  };
}