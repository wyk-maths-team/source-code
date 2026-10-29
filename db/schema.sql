-- =====================================================================
-- db/schema.sql —— 题目域（problems / tags / problem_tags）PostgreSQL 结构
-- =====================================================================
--
-- 本轮范围：只把「题目数据」从 MongoDB 搬到 PostgreSQL。
--   ✅ problems            ← Mongo collection: problems
--   ✅ tags                ← problems.tags[] 去重后的标签名
--   ✅ problem_tags        ← problems.tags[] 的多对多关联
--   ✅ app_settings        ← Mongo collection: metadata（只有 problemsVersion 一个键）
--
-- 其余集合（users / userstats / submissions / contests / pk_* / messages ...）
-- 本轮不动，继续留在 MongoDB。详见文件末尾「后续轮次」。
--
-- ---------------------------------------------------------------------
-- 执行顺序
-- ---------------------------------------------------------------------
--   1) 首次执行：db/reset.sql      （清掉上一版迁移遗留的表）
--   2) 建表：    db/schema.sql     （本文件，幂等，可重复执行）
--   3) 灌数据：  node db/import-problems.mjs
--
-- 本文件不含 DROP 数据表的语句 —— 那是 db/reset.sql 的职责，
-- 避免误跑一次把生产数据清空。
--
-- ---------------------------------------------------------------------
-- 设计说明
-- ---------------------------------------------------------------------
-- 1) problem_no 是数据库内部的自增主键（BIGSERIAL）。
--    problem_id（'HA0012'）仍然是业务主键：它出现在 URL、竞赛配置、
--    用户提交里，必须保持稳定。内部用数字主键是为了让外键更小、更快，
--    也让「按插入顺序」有确定含义 —— 这是你要求的「内置升序 id」。
--
-- 2) id_prefix / id_num 是生成列，用来复刻 Mongo 版本里的自然序排序：
--    Mongo 用 $regexFind 把 'HA0012' 拆成 ('ha', 12) 再排序，
--    这里交给数据库在写入时算一次并建索引，排序直接走索引。
--    等价关系（与 api/problem.js 原实现一致）：
--      'HA0012' → prefix 'ha', num 12
--      'DP0007' → prefix 'dp', num 7
--      不匹配 ^[A-Za-z]*[0-9]+$ 的 id → prefix '', num 0
--
-- 3) difficulty 用 NUMERIC(5,2)：业务取值 1.00–10.00，两位小数足够。
--    「难度自动调整」功能已决定舍弃，所以不再保留
--    manualDifficulty / difficultyLocked / difficultyLastAdjustedAt 三列。
--
-- 4) answer 与 logic（自定义判题脚本）都是长文本，用 TEXT。
--    接口层负责剥离：任何面向学生的响应都不能带这两列。
--
-- 5) 标签走 3NF：tags 存名字（唯一），problem_tags 只存 id。
--    改一个标签名只 UPDATE 一行。
--
-- 6) 所有时间列都是 TIMESTAMPTZ，会话时区固定 Asia/Hong_Kong
--    （见 api/_pg.js）。DATE 直接比较不需要再做 +8 小时的偏移。
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. problems —— 题目
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS problems (
  problem_no   BIGSERIAL   PRIMARY KEY,
  problem_id   TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL DEFAULT '',
  statement    TEXT        NOT NULL DEFAULT '',
  answer       TEXT        NOT NULL DEFAULT '',
  difficulty   NUMERIC(5,2),
  is_public    BOOLEAN     NOT NULL DEFAULT FALSE,
  force_steps  BOOLEAN     NOT NULL DEFAULT FALSE,
  logic        TEXT,

  -- 自然序排序键，写入时由数据库计算，应用层不必关心
  id_prefix    TEXT        NOT NULL
    GENERATED ALWAYS AS (
      CASE WHEN problem_id ~ '^[A-Za-z]*[0-9]+$'
           THEN lower(regexp_replace(problem_id, '[0-9]+$', ''))
           ELSE '' END
    ) STORED,
  id_num       BIGINT      NOT NULL
    GENERATED ALWAYS AS (
      CASE WHEN problem_id ~ '^[A-Za-z]*[0-9]+$'
           THEN regexp_replace(problem_id, '^[A-Za-z]*', '')::BIGINT
           ELSE 0 END
    ) STORED,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  problems IS '题库。problem_id 是业务主键，problem_no 是内部自增主键。';
COMMENT ON COLUMN problems.answer      IS '参考答案。绝对不可返回给非管理员。';
COMMENT ON COLUMN problems.logic       IS '自定义判题脚本（QuickJS 沙箱执行）。绝对不可返回给非管理员。';
COMMENT ON COLUMN problems.force_steps IS '强制分步/图片作答（原 Mongo 的 FS 字段）。';

-- 列表页最高频的两种访问：
--   ① 非管理员：where is_public order by id_prefix, id_num  （走这个索引）
--   ② 管理员：  order by id_prefix, id_num                  （同上，只是不带 is_public）
CREATE INDEX IF NOT EXISTS idx_problems_public_sort
  ON problems (is_public, id_prefix, id_num);

-- 难度筛选/排序
CREATE INDEX IF NOT EXISTS idx_problems_difficulty
  ON problems (difficulty) WHERE difficulty IS NOT NULL;

-- 题目名搜索（api/search.js）
-- 默认用 ILIKE '%kw%'，题量小可以直接走顺序扫描；
-- 若题库继续增长，取消下面两行注释启用 trigram 索引：
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_problems_name_trgm ON problems USING gin (name gin_trgm_ops);


-- ---------------------------------------------------------------------
-- 2. tags —— 标签名（每个名字只有一行）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
  tag_no  SERIAL PRIMARY KEY,
  name    TEXT   NOT NULL UNIQUE
);

COMMENT ON TABLE tags IS '标签字典。改名只影响一行，不会留下大小写变体。';


-- ---------------------------------------------------------------------
-- 3. problem_tags —— 题目与标签的多对多
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id  TEXT NOT NULL REFERENCES problems (problem_id) ON DELETE CASCADE,
  tag_no      INT  NOT NULL REFERENCES tags (tag_no)         ON DELETE CASCADE,
  PRIMARY KEY (problem_id, tag_no)
);

-- 反查「这个标签下有哪些题」→ similarProblems / 标签筛选
CREATE INDEX IF NOT EXISTS idx_problem_tags_tag
  ON problem_tags (tag_no, problem_id);


-- ---------------------------------------------------------------------
-- 4. app_settings —— 键值设置（承接 Mongo 的 metadata 集合）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT        PRIMARY KEY,
  value       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE app_settings IS '泛用键值表。当前只存 problemsVersion。';

-- 初始值：版本号 0 表示「还没有任何题目变更」
INSERT INTO app_settings (key, value)
VALUES ('problemsVersion', '{"version": 0}'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------------
-- 5. 视图：题目列表页需要的全部列（不含答案/脚本）
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_problem_list AS
SELECT
  p.problem_id,
  p.name,
  p.difficulty,
  p.is_public,
  p.force_steps,
  p.id_prefix,
  p.id_num,
  COALESCE(
    (SELECT array_agg(t.name ORDER BY t.name)
       FROM problem_tags pt
       JOIN tags t ON t.tag_no = pt.tag_no
      WHERE pt.problem_id = p.problem_id),
    '{}'::text[]
  ) AS tags
FROM problems p;

COMMENT ON VIEW v_problem_list IS '只读视图，供排查/人工核对使用；接口不直接查它。';


-- =====================================================================
-- 2. 用户域
-- =====================================================================
--
-- 对应 MongoDB 的三份文档：users / userstats / userdata。
-- 拆法（与题目域一致：数组和嵌套对象一律拆表）：
--
--   users.token            -> user_tokens        （可选属性，高频单独读写）
--   users.achievements[]   -> user_achievements  （数组，改 $addToSet 为复合主键）
--   users.lastActiveDate   -> user_stats.last_active_date
--   users.streakDays/maxStreak/activeDaysTotal
--                          -> user_stats         （原来在 users 和 userstats 各存一份，
--                                                 这里合并到一张表，消除双写）
--   userstats.states{}     -> user_problem_status（把题目 id 当字段名是 1NF 违规）
--   userstats.rating*      -> user_ratings       （物化缓存，可重建）
--   userdata.favorites[]   -> user_favorites     （数组，可反查）
--   userdata.theme/wallpaper -> user_preferences
--   userdata.desktopIcons  -> 已废弃，不迁
--
-- 注意 user_stats 不再叫 cache：它现在同时承担 streak / 今日集合 / 首次 AC 计数，
-- 这些值虽然可重建，但重建代价高，属于「权威缓存」。表名去掉 cache 避免误解。
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
  username        TEXT PRIMARY KEY,
  password        TEXT,                          -- bcrypt 哈希；SSO 账号为 NULL
  role            TEXT NOT NULL DEFAULT 'student'
                    CHECK (role IN ('student', 'admin', 'root', 'team')),
  email           TEXT,
  real_name       TEXT,                          -- 实名，profile 始终显示
  display_name    TEXT,                          -- 展示名，可改
  pfp             TEXT,                          -- 头像 URL
  banned          BOOLEAN NOT NULL DEFAULT FALSE,
  pfp_updated_at  TIMESTAMPTZ,
  last_rename_at  TIMESTAMPTZ,
  rename_count    INT NOT NULL DEFAULT 0,
  yellow_cards    INT NOT NULL DEFAULT 0,   -- 黄牌次数（管理端展示用）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role      ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_created   ON users (created_at DESC);
-- api/search.js?action=search_user 用 ILIKE 前缀匹配 realName / displayName
CREATE INDEX IF NOT EXISTS idx_users_display   ON users (lower(display_name));
CREATE INDEX IF NOT EXISTS idx_users_real_name ON users (lower(real_name));

COMMENT ON TABLE  users IS '账号与身份。username 是业务主键，全站用它做外键。';
COMMENT ON COLUMN users.password IS 'bcrypt 哈希。NULL 表示只能走 SSO 登录。';


-- ---------------------------------------------------------------------
-- 2.1 user_tokens —— 钱包
-- ---------------------------------------------------------------------
-- daily          每日重置的额度，花完才动 global_balance
-- global_balance 永久资产，奖励进这里；扣款后允许为负（历史行为，见 lib/token.js）
CREATE TABLE IF NOT EXISTS user_tokens (
  username             TEXT PRIMARY KEY REFERENCES users (username) ON UPDATE CASCADE ON DELETE CASCADE,
  daily                BIGINT NOT NULL DEFAULT 30000,
  global_balance       BIGINT NOT NULL DEFAULT 100000,
  last_reset           DATE NOT NULL DEFAULT CURRENT_DATE,
  daily_login_claimed  BOOLEAN NOT NULL DEFAULT FALSE,
  daily_quest_claimed  BOOLEAN NOT NULL DEFAULT FALSE,
  total_used           BIGINT NOT NULL DEFAULT 0
);

COMMENT ON COLUMN user_tokens.global_balance IS '允许为负：pk-bet 扣款后可能透支，次日用 daily 偿还。';


-- ---------------------------------------------------------------------
-- 2.2 user_stats —— 派生统计（合并了原来 users 与 userstats 上的重复字段）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_stats (
  username           TEXT PRIMARY KEY REFERENCES users (username) ON UPDATE CASCADE ON DELETE CASCADE,
  streak_days        INT  NOT NULL DEFAULT 0,
  max_streak         INT  NOT NULL DEFAULT 0,
  active_days_total  INT  NOT NULL DEFAULT 0,
  last_active_date   DATE,
  heartbeat_count    BIGINT NOT NULL DEFAULT 0,
  last_seen_at       TIMESTAMPTZ,
  explicitly_offline BOOLEAN NOT NULL DEFAULT FALSE,
  first_try_count    INT  NOT NULL DEFAULT 0,
  today_date         DATE,
  today_tried        TEXT[] NOT NULL DEFAULT '{}',
  today_ac           TEXT[] NOT NULL DEFAULT '{}',
  stats_version      INT  NOT NULL DEFAULT 0
);

COMMENT ON COLUMN user_stats.today_tried IS '今日尝试过的题号（跨天清空）。数组而非关联表：只用于计数，不需要反查。';
COMMENT ON COLUMN user_stats.today_ac    IS '今日 AC 过的题号（跨天清空）。';


-- ---------------------------------------------------------------------
-- 2.3 user_achievements —— 已解锁成就
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_achievements (
  username        TEXT NOT NULL REFERENCES users (username) ON UPDATE CASCADE ON DELETE CASCADE,
  achievement_id  TEXT NOT NULL,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reward          BIGINT NOT NULL DEFAULT 0,   -- 解锁当时的发放额，历史事实
  PRIMARY KEY (username, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_ua_achievement ON user_achievements (achievement_id);


-- ---------------------------------------------------------------------
-- 2.4 user_problem_status —— 用户在某题上的状态
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_problem_status (
  username    TEXT NOT NULL REFERENCES users (username)      ON DELETE CASCADE,
  problem_id  TEXT NOT NULL REFERENCES problems (problem_id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('passed', 'failed')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_ups_problem_status ON user_problem_status (problem_id, status);
CREATE INDEX IF NOT EXISTS idx_ups_username_solved ON user_problem_status (username) WHERE status = 'passed';


-- ---------------------------------------------------------------------
-- 2.5 user_ratings —— rating 物化缓存（可随时重建）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_ratings (
  username     TEXT PRIMARY KEY REFERENCES users (username) ON UPDATE CASCADE ON DELETE CASCADE,
  rating       NUMERIC(7,2) NOT NULL,
  solved_count INT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta         JSONB
);

COMMENT ON TABLE user_ratings IS 'rating 缓存。solved_count 对不上就重算，见 lib/userRating.js。';


-- ---------------------------------------------------------------------
-- 2.6 user_favorites —— 收藏
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_favorites (
  username   TEXT NOT NULL REFERENCES users (username)      ON DELETE CASCADE,
  problem_id TEXT NOT NULL REFERENCES problems (problem_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_fav_problem ON user_favorites (problem_id);


-- ---------------------------------------------------------------------
-- 2.7 user_preferences —— 界面设置
-- ---------------------------------------------------------------------
-- desktopIcons 已废弃，不建列。
CREATE TABLE IF NOT EXISTS user_preferences (
  username             TEXT PRIMARY KEY REFERENCES users (username) ON UPDATE CASCADE ON DELETE CASCADE,
  theme                TEXT,
  wallpaper            TEXT,
  wallpaper_updated_at TIMESTAMPTZ
);


-- =====================================================================
-- 3. submissions —— 提交记录（关系表）
-- =====================================================================
-- subid 改为自增整数：第一次提交是 1，第二次是 2。
-- 旧的随机串保留在 legacy_subid 里，方便对照旧日志，但不再是主键。
CREATE TABLE IF NOT EXISTS submissions (
  subid         BIGSERIAL PRIMARY KEY,
  legacy_subid  TEXT,
  username      TEXT NOT NULL REFERENCES users (username) ON UPDATE CASCADE ON DELETE CASCADE,
  problem_id    TEXT NOT NULL REFERENCES problems (problem_id) ON DELETE CASCADE,
  answer        TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'text'
                  CHECK (type IN ('text', 'image', 'steps')),
  image         TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correct       BOOLEAN,
  score         INT,
  system_error  BOOLEAN NOT NULL DEFAULT FALSE,
  marked        BOOLEAN NOT NULL DEFAULT FALSE,
  comment       TEXT,
  contest_id    TEXT,
  paper_id      TEXT,
  marked_at     TIMESTAMPTZ,
  ai_graded     BOOLEAN,
  handled_by    TEXT,
  used_model    TEXT,
  judging_ms    INT,
  token_usage   INT,
  task_id       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sub_user_time    ON submissions (username, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_problem      ON submissions (problem_id);
CREATE INDEX IF NOT EXISTS idx_sub_contest      ON submissions (contest_id) WHERE contest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sub_user_problem ON submissions (username, problem_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_time         ON submissions (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_unmarked     ON submissions (type, marked) WHERE type = 'image';
-- 同理：import-rest.mjs 用 ON CONFLICT (legacy_subid)，必须是普通唯一索引
DROP INDEX IF EXISTS idx_sub_legacy;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_legacy ON submissions (legacy_subid);

COMMENT ON TABLE submissions IS '提交记录。subid 自增；legacy_subid 保存迁移前的随机串（仅供查证）。';


-- =====================================================================
-- 4. 文档型表（JSONB）
-- =====================================================================
-- 剩下的集合（竞赛、PK、讨论区、站内信、审计日志……）都是「整体读写的文档」：
-- 查询条件简单、字段经常变、没有跨表关联需求。把它们逐字段拆成关系表
-- 收益很低、改动面却很大，所以统一用：
--
--     seq      BIGSERIAL   内部主键
--     doc_id   TEXT         原来的 _id 或业务 id（字符串形式）
--     data     JSONB        完整文档
--
-- 应用层通过 lib/docStore.js 用与 Mongo 相同的方法名访问，
-- 所有 SQL 收在那一个文件里。
-- =====================================================================
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contests','contest_results','teams',
    'pkproblems','pksubmissions','pk_rooms','pk_invitations',
    'pk_bet_rooms','pk_bet_invitations','pk_bet_results',
    'discussions','reports','submission_reports',
    'messages','updates','calendar_tasks',
    'steps_grading_tasks',
    'audit_logs','achievements_log','ai_grade_logs',
    'igem_reports','tr_problems',
    'port_problems','port_submissions','port_userstats',
    'port_tasks','port_drafts','port_settings'
  ] LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (' ||
      '  seq        BIGSERIAL PRIMARY KEY,' ||
      '  doc_id     TEXT,' ||
      '  data       JSONB NOT NULL DEFAULT ''{}''::jsonb,' ||
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),' ||
      '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())', t);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I USING gin (data jsonb_path_ops)',
      t || '_data_gin', t);
    -- ON CONFLICT (doc_id) 需要「非部分」唯一索引才能被推断出来。
    -- PostgreSQL 的唯一索引允许多个 NULL，所以不需要 WHERE 子句。
    EXECUTE format('DROP INDEX IF EXISTS %I', t || '_doc_id_uniq');
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (doc_id)', t || '_doc_id_uniq', t);
  END LOOP;
END $do$;


-- ---------------------------------------------------------------------
-- 2.8 视图：一眼看全一个账号
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_user_overview AS
SELECT
  u.username,
  u.display_name,
  u.role,
  u.banned,
  COALESCE(t.daily, 0)          AS daily_tokens,
  COALESCE(t.global_balance, 0) AS global_tokens,
  COALESCE(k.streak_days, 0)    AS streak_days,
  COALESCE(s.solved, 0)         AS solved_count,
  COALESCE(s.attempted, 0)      AS attempted_count,
  COALESCE(a.cnt, 0)            AS achievement_count,
  k.last_seen_at
FROM users u
LEFT JOIN user_tokens t ON t.username = u.username
LEFT JOIN user_stats  k ON k.username = u.username
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE status = 'passed')::int AS solved,
    COUNT(*)::int                                  AS attempted
  FROM user_problem_status
  WHERE username = u.username
) s ON TRUE
LEFT JOIN (
  SELECT username, COUNT(*)::int AS cnt FROM user_achievements GROUP BY username
) a ON a.username = u.username;



COMMIT;


-- =====================================================================
--                            查询清单
-- =====================================================================
-- 下面每一条都与 lib/pgStore.js 里的实现逐字对应（改动时两边一起改）。
-- 参数占位符 $1..$n，全部参数化；ORDER BY 走白名单，不拼接用户输入。
-- 标记 [JS] 的排序片段由 sortClause() 生成。
-- =====================================================================


-- ─────────────────────────────────────────────────────────────
-- A. 单题 / 多题读取
-- ─────────────────────────────────────────────────────────────

-- A1 学生端：永不含 answer / logic          【pgStore.getProblem(id)】
SELECT problem_id, name, statement, difficulty, is_public, force_steps
FROM problems
WHERE problem_id = $1
LIMIT 1;

-- A2 判题 / 管理端：需要 answer 与 logic     【pgStore.getProblem(id, {withAnswer:true})】
SELECT problem_id, name, statement, answer, difficulty, is_public, force_steps, logic
FROM problems
WHERE problem_id = $1
LIMIT 1;

-- A3 批量取（判题、试卷、收藏夹、竞赛）      【pgStore.getProblemsByIds(ids, ...)】
--     把 A1 或 A2 的 WHERE 换成：
WHERE problem_id = ANY($1::text[]);

-- A4 存在性检查（举报、新建查重）            【pgStore.problemExists(id)】
SELECT 1 FROM problems WHERE problem_id = $1 LIMIT 1;


-- ─────────────────────────────────────────────────────────────
-- B. 列表（api/problem.js 无 action 的分页列表）
-- ─────────────────────────────────────────────────────────────

-- B1 分页列表 + 标签聚合                     【pgStore.listProblemsPage(...)】
--     $1 = 是否只看公开题；$2 = 标签数组（空数组 = 不筛选）
--     $3 = limit；$4 = offset
--     ORDER BY 由 sortClause() 生成：[JS] 见 B1' 与 B2'
SELECT p.problem_id AS id,
       p.name,
       p.difficulty,
       p.is_public AS "public",
       p.force_steps AS "FS",
       COALESCE(array_agg(t.name ORDER BY t.name)
                FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
FROM problems p
LEFT JOIN problem_tags pt ON pt.problem_id = p.problem_id
LEFT JOIN tags t          ON t.tag_no = pt.tag_no
WHERE ($1::boolean = FALSE OR p.is_public)
  AND (cardinality($2::text[]) = 0 OR p.problem_id IN (
        SELECT pt2.problem_id
          FROM problem_tags pt2
          JOIN tags t2 ON t2.tag_no = pt2.tag_no
         WHERE t2.name = ANY($2::text[])
      ))
GROUP BY p.problem_id
ORDER BY p.id_prefix ASC, p.id_num ASC, p.problem_id ASC
LIMIT $3 OFFSET $4;

-- B1' 排序片段（sortClause 白名单，只有这四种）
--      id asc         : p.id_prefix ASC,  p.id_num ASC,  p.problem_id ASC
--      id desc        : p.id_prefix DESC, p.id_num DESC, p.problem_id DESC
--      difficulty asc : COALESCE(p.difficulty,0) ASC,  p.id_prefix ASC,  p.id_num ASC
--      difficulty desc: COALESCE(p.difficulty,0) DESC, p.id_prefix DESC, p.id_num DESC

-- B2 总数（与 B1 同条件）                    【pgStore.listProblemsPage 内部 / countProblems】
SELECT COUNT(*)::int AS n
FROM problems p
WHERE ($1::boolean = FALSE OR p.is_public)
  AND (cardinality($2::text[]) = 0 OR p.problem_id IN (
        SELECT pt.problem_id
          FROM problem_tags pt JOIN tags t ON t.tag_no = pt.tag_no
         WHERE t.name = ANY($2::text[])
      ));

-- B3 收藏夹 / 竞赛题目表（指定 id 集合）      【pgStore.listProblemsByIds(ids, ...)】
--     B1 的 WHERE 换成：
WHERE p.problem_id = ANY($1::text[]) AND ($2::boolean = FALSE OR p.is_public)

-- B4 全量（api/problem.js?all=1）             【pgStore.getAllProblems(...)】
--     $1 = 是否只看公开题；withStatement 时额外选出 p.statement
SELECT p.problem_id AS id,
       p.name,
       p.difficulty,
       p.is_public AS "public",
       p.force_steps AS "FS",
       COALESCE(array_agg(t.name ORDER BY t.name)
                FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
FROM problems p
LEFT JOIN problem_tags pt ON pt.problem_id = p.problem_id
LEFT JOIN tags t          ON t.tag_no = pt.tag_no
WHERE ($1::boolean = FALSE OR p.is_public)
GROUP BY p.problem_id
ORDER BY p.id_prefix, p.id_num, p.problem_id;

-- B5 轻量 id 列表（api/problem.js?ids=1）     【pgStore.getAllProblemIds({publicOnly})】
SELECT problem_id
FROM problems
WHERE ($1::boolean = FALSE OR is_public)
ORDER BY id_prefix, id_num, problem_id;

-- B6 标签字典（列表页筛选条）                 【pgStore.listTagNames({publicOnly})】
SELECT DISTINCT t.name
FROM tags t
JOIN problem_tags pt ON pt.tag_no = t.tag_no
JOIN problems p      ON p.problem_id = pt.problem_id
WHERE ($1::boolean = FALSE OR p.is_public)
ORDER BY t.name;


-- ─────────────────────────────────────────────────────────────
-- C. 标签
-- ─────────────────────────────────────────────────────────────

-- C1 单题标签                                【pgStore.getProblemTags(id)】
SELECT t.name
FROM problem_tags pt
JOIN tags t ON t.tag_no = pt.tag_no
WHERE pt.problem_id = $1
ORDER BY t.name;

-- C2 批量标签（列表渲染，避免 N+1）           【pgStore.getTagsForProblems(ids)】
SELECT pt.problem_id, t.name
FROM problem_tags pt
JOIN tags t ON t.tag_no = pt.tag_no
WHERE pt.problem_id = ANY($1::text[])
ORDER BY pt.problem_id, t.name;

-- C3 确保标签存在                            【replaceProblemTags 内部】
INSERT INTO tags (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING;

-- C4 重建某题标签（先删后插，幂等）           【replaceProblemTags 内部】
DELETE FROM problem_tags WHERE problem_id = $1;
INSERT INTO problem_tags (problem_id, tag_no)
SELECT $1, tag_no FROM tags WHERE name = ANY($2::text[])
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────
-- D. 相似题（api/problem.js?action=similar）
-- ─────────────────────────────────────────────────────────────

-- D1 共同标签数优先，其次难度接近             【pgStore.similarProblems】
SELECT p.problem_id AS id, p.name, p.difficulty, COUNT(*)::int AS shared
FROM problem_tags target
JOIN problem_tags other ON other.tag_no = target.tag_no
JOIN problems p         ON p.problem_id = other.problem_id
WHERE target.problem_id = $1
  AND other.problem_id <> $1
  AND p.is_public
GROUP BY p.problem_id, p.name, p.difficulty
ORDER BY shared DESC, ABS(COALESCE(p.difficulty, 0) - COALESCE($2::numeric, 0))
LIMIT $3;

-- D2 无标签时的退化路径：纯难度接近           【pgStore.nearestByDifficulty】
SELECT problem_id AS id, name, difficulty
FROM problems
WHERE is_public AND problem_id <> $1
ORDER BY ABS(COALESCE(difficulty, 0) - COALESCE($2::numeric, 0)), id_prefix, id_num
LIMIT $3;


-- ─────────────────────────────────────────────────────────────
-- E. 难度映射 / 搜索 / 抽题池
-- ─────────────────────────────────────────────────────────────

-- E1 难度映射（成就、评分、排行榜）           【pgStore.getDifficultyMap】
SELECT problem_id, difficulty FROM problems
WHERE ($1::boolean = FALSE OR is_public);

-- E2 轻量元数据（lib/problemCache.js）        【pgStore.listProblemDifficultyRows】
SELECT problem_id AS id, difficulty FROM problems
WHERE ($1::boolean = FALSE OR is_public)
ORDER BY id_prefix, id_num, problem_id;

-- E3 题目搜索（api/search.js?action=search_prob）【pgStore.searchProblems】
SELECT problem_id AS id, name FROM problems
WHERE problem_id ILIKE '%' || $1 || '%' OR name ILIKE '%' || $1 || '%'
ORDER BY id_prefix, id_num, problem_id
LIMIT $2;

-- E4 PK 抽题池（api/pk-bet.js）               【pgStore.pickProblemPool】
SELECT p.problem_id AS id, p.difficulty
FROM problems p
WHERE p.is_public
  AND ($1::numeric IS NULL OR p.difficulty >= $1)
  AND ($2::numeric IS NULL OR p.difficulty <= $2)
  AND NOT EXISTS (
        SELECT 1 FROM problem_tags pt JOIN tags t ON t.tag_no = pt.tag_no
         WHERE pt.problem_id = p.problem_id AND t.name = ANY($3::text[]))
ORDER BY random()
LIMIT $4;   -- limit 为空时不加 LIMIT


-- ─────────────────────────────────────────────────────────────
-- F. 管理端写入（api/problem.js?action=admin*）
-- ─────────────────────────────────────────────────────────────

-- F1 新建                                    【pgStore.createProblem】
INSERT INTO problems (problem_id, name, statement, answer, difficulty,
                      is_public, force_steps, logic)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- F2 单题部分更新（NULL = 该字段不改）        【pgStore.updateProblem】
--     注意：清空 logic 请传空字符串，不能传 NULL
UPDATE problems SET
  name        = COALESCE($2, name),
  statement   = COALESCE($3, statement),
  answer      = COALESCE($4, answer),
  difficulty  = COALESCE($5, difficulty),
  is_public   = COALESCE($6, is_public),
  force_steps = COALESCE($7, force_steps),
  logic       = COALESCE($8, logic),
  updated_at  = NOW()
WHERE problem_id = $1
RETURNING problem_no;

-- F3 批量改公开状态                          【pgStore.setProblemsPublic】
UPDATE problems
SET is_public = $2, updated_at = NOW()
WHERE problem_id = ANY($1::text[])
RETURNING problem_id;

-- F4 批量删除（标签关联由外键 CASCADE 清）    【pgStore.deleteProblems】
DELETE FROM problems
WHERE problem_id = ANY($1::text[])
RETURNING problem_id;

-- F5 只改难度（api/admin.js?action=setDifficulty）【pgStore.setDifficulty】
UPDATE problems SET difficulty = $2, updated_at = NOW()
WHERE problem_id = $1
RETURNING problem_no;

-- F6 试卷子题 upsert                         【pgStore.upsertPaperQuestions】
--     先判断存在：
SELECT 1 FROM problems WHERE problem_id = $1 LIMIT 1;
--     存在 → UPDATE（字段为 NULL 时保留原值）
UPDATE problems SET
  answer     = COALESCE($2, answer),
  difficulty = COALESCE($3, difficulty),
  is_public  = COALESCE($4, is_public),
  updated_at = NOW()
WHERE problem_id = $1;
--     不存在 → INSERT（name = id、statement 为空、difficulty 默认 5）
INSERT INTO problems (problem_id, name, statement, answer, difficulty,
                      is_public, force_steps, logic)
VALUES ($1, $1, '', $2, $3, $4, FALSE, NULL);

-- F7 管理端读全量（含 answer / logic / tags）【pgStore.listAllForAdmin】
SELECT p.problem_id AS id, p.name, p.statement, p.answer AS ans,
       p.difficulty, p.is_public AS "public", p.force_steps AS "FS", p.logic,
       COALESCE(array_agg(t.name ORDER BY t.name)
                FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
FROM problems p
LEFT JOIN problem_tags pt ON pt.problem_id = p.problem_id
LEFT JOIN tags t          ON t.tag_no = pt.tag_no
GROUP BY p.problem_id
ORDER BY p.id_prefix, p.id_num, p.problem_id;


-- ─────────────────────────────────────────────────────────────
-- G. 版本号（对应 Mongo 的 metadata.problemsVersion）
-- ─────────────────────────────────────────────────────────────

-- G1 读取                                    【pgStore.getProblemsVersion】
SELECT value->>'version' AS v FROM app_settings WHERE key = 'problemsVersion';

-- G2 递增（任何题目变更后调用）               【pgStore.bumpProblemsVersion】
UPDATE app_settings
SET value = jsonb_set(value, '{version}',
            to_jsonb((EXTRACT(EPOCH FROM NOW()) * 1000)::bigint)),
    updated_at = NOW()
WHERE key = 'problemsVersion'
RETURNING (value->>'version')::bigint AS v;


-- ─────────────────────────────────────────────────────────────
-- H. 备份（api/cron.js?action=dailyBackup）
-- ─────────────────────────────────────────────────────────────
-- 表名来自白名单常量 ['problems','tags','problem_tags','app_settings']，不是用户输入：
SELECT * FROM problems;
SELECT * FROM tags;
SELECT * FROM problem_tags;
SELECT * FROM app_settings;


-- ═════════════════════════════════════════════════════════════
--                 用户域（lib/userStore.js）
-- ═════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- J. 账号
-- ─────────────────────────────────────────────────────────────

-- J1 登录 / 鉴权（含 password）              【userStore.getUserForAuth】
SELECT username, password, role, email, real_name, display_name, pfp, banned,
       created_at, pfp_updated_at, last_rename_at, rename_count, yellow_cards
FROM users WHERE username = $1 LIMIT 1;

-- J2 公开资料（不含 password）                【userStore.getUser】
SELECT username, role, email, real_name, display_name, pfp, banned,
       created_at, pfp_updated_at, last_rename_at, rename_count, yellow_cards
FROM users WHERE username = $1 LIMIT 1;

-- J3 批量资料                                【userStore.getUsersByNames】
SELECT username, role, real_name, display_name, pfp, banned, created_at
FROM users WHERE username = ANY($1::text[]);

-- J4 批量头像                                【userStore.getBatchPfps】
SELECT username, pfp FROM users WHERE username = ANY($1::text[]);

-- J5 管理端全量（不含 password）              【userStore.listUsersForAdmin】
SELECT username, role, email, real_name, display_name, pfp, banned,
       created_at, pfp_updated_at, last_rename_at, rename_count, yellow_cards
FROM users ORDER BY username;

-- J6 建账号（事务：users + user_tokens + user_stats）【userStore.createUser】
INSERT INTO users (username, password, role, email, real_name, display_name, pfp)
VALUES ($1, $2, $3, $4, $5, $6, $7);
INSERT INTO user_tokens (username, daily, global_balance, last_reset)
VALUES ($1, $2, $3, CURRENT_DATE);
INSERT INTO user_stats (username) VALUES ($1);

-- J7 部分更新（列名由白名单映射生成，值全部参数化）【userStore.updateUser】
UPDATE users SET <col> = $2, ... WHERE username = $1 RETURNING username;

-- J8 改名（子表靠 ON UPDATE CASCADE 自动跟随）  【userStore.renameUser】
UPDATE users SET username = $2 WHERE username = $1 RETURNING username;

-- J9 删除（子表靠 ON DELETE CASCADE）          【userStore.deleteUser】
DELETE FROM users WHERE username = $1 RETURNING username;

-- J10 用户名占用                             【userStore.usernameExists】
SELECT 1 FROM users WHERE username = $1 LIMIT 1;

-- J11 展示名占用（排除自己）                   【userStore.displayNameTaken】
SELECT 1 FROM users WHERE display_name = $1 AND username <> $2 LIMIT 1;

-- J12 用户搜索                               【userStore.searchUsers】
SELECT username, real_name, display_name FROM users
WHERE username      ILIKE '%' || $1 || '%'
   OR real_name     ILIKE '%' || $1 || '%'
   OR display_name  ILIKE '%' || $1 || '%'
ORDER BY username LIMIT $2;

-- J13 黄牌 +1                                【userStore.incYellowCard】
UPDATE users SET yellow_cards = yellow_cards + 1 WHERE username = $1;


-- ─────────────────────────────────────────────────────────────
-- K. 钱包
-- ─────────────────────────────────────────────────────────────

-- K1 读余额                                  【userStore.getTokens / ensureTokens】
SELECT daily, global_balance, last_reset, daily_login_claimed,
       daily_quest_claimed, total_used
FROM user_tokens WHERE username = $1;

INSERT INTO user_tokens (username, daily, global_balance, last_reset)
VALUES ($1, 30000, 100000, CURRENT_DATE) ON CONFLICT (username) DO NOTHING;

-- K2 跨天重置（先还 global 的负值，再补满 daily）【userStore.resetDailyIfNeeded】
UPDATE user_tokens SET
  global_balance = CASE WHEN global_balance < 0
                        THEN global_balance + LEAST(30000, -global_balance)
                        ELSE global_balance END,
  daily = CASE WHEN global_balance < 0
               THEN 30000 - LEAST(30000, -global_balance)
               ELSE 30000 END,
  last_reset = CURRENT_DATE,
  daily_login_claimed = FALSE, daily_quest_claimed = FALSE
WHERE username = $1 AND last_reset < CURRENT_DATE;

-- K3 扣费（判题用；global 允许为负）          【userStore.consumeTokens】
UPDATE user_tokens SET
  daily = GREATEST(0, daily - $2),
  global_balance = global_balance - GREATEST(0, $2 - daily),
  total_used = total_used + $2
WHERE username = $1
RETURNING daily, global_balance;

-- K4 下注扣费（事务内 SELECT FOR UPDATE 后写回，返回 taken 供按原路退款）
--    【userStore.deductTokensWithTaken】
SELECT daily, global_balance FROM user_tokens WHERE username = $1 FOR UPDATE;
--   JS 里判断余额、算出 fromDaily/fromGlobal
UPDATE user_tokens SET daily = $2, global_balance = $3, total_used = total_used + $4
WHERE username = $1;

-- K5 加币（奖励一律进 global，不占每日额度）  【userStore.addTokens】
UPDATE user_tokens SET global_balance = global_balance + $2
WHERE username = $1 RETURNING daily, global_balance;

-- K6 按原路退款                              【userStore.refundTokens / refundTokensByTaken】
UPDATE user_tokens SET daily = daily + $2, global_balance = global_balance + $3
WHERE username = $1 RETURNING daily, global_balance;

-- K7 直接设置两个桶（管理端）                 【userStore.setTokens】
UPDATE user_tokens SET daily = $2, global_balance = $3
WHERE username = $1 RETURNING daily, global_balance;

-- K8 领取每日奖励（条件写在 WHERE，重复点击只成功一次）【userStore.claimDaily】
UPDATE user_tokens SET
  global_balance = global_balance + $2,
  daily_login_claimed = CASE WHEN $3 = 'login' THEN TRUE ELSE daily_login_claimed END,
  daily_quest_claimed = CASE WHEN $3 = 'quest' THEN TRUE ELSE daily_quest_claimed END
WHERE username = $1
  AND (($3 = 'login' AND daily_login_claimed = FALSE)
    OR ($3 = 'quest' AND daily_quest_claimed = FALSE))
RETURNING daily, global_balance;

-- K9 余额不足则不扣（买主题）                 【userStore.spendTokens】
UPDATE user_tokens SET
  daily = daily - LEAST(daily, $2),
  global_balance = global_balance - ($2 - LEAST(daily, $2)),
  total_used = total_used + $2
WHERE username = $1 AND daily + global_balance >= $2
RETURNING daily, global_balance;

-- K10 管理端列表（JOIN + 搜索 + 白名单排序）  【userStore.listUsersWithTokens】
SELECT u.username, u.display_name, u.real_name,
       COALESCE(t.daily, 30000)          AS daily,
       COALESCE(t.global_balance, 100000) AS global_balance,
       COALESCE(t.total_used, 0)          AS total_used
FROM users u LEFT JOIN user_tokens t ON t.username = u.username
WHERE ($1::text IS NULL
    OR u.username     ILIKE '%' || $1 || '%'
    OR u.display_name ILIKE '%' || $1 || '%'
    OR u.real_name    ILIKE '%' || $1 || '%')
ORDER BY <col> <dir>;   -- col ∈ {u.username, t.total_used, t.global_balance, t.daily}

-- K11 累计消耗 / last_reset 回填              【userStore.setTotalUsed / setLastResetToday】
UPDATE user_tokens SET total_used = $2 WHERE username = $1;
UPDATE user_tokens SET last_reset = CURRENT_DATE WHERE username = $1;


-- ─────────────────────────────────────────────────────────────
-- L. 统计 / 心跳 / 连续打卡
-- ─────────────────────────────────────────────────────────────

-- L1 读统计                                  【userStore.getUserStats】
SELECT streak_days, max_streak, active_days_total, last_active_date,
       heartbeat_count, last_seen_at, explicitly_offline, first_try_count,
       today_date, today_tried, today_ac, stats_version
FROM user_stats WHERE username = $1;

-- L2 心跳                                    【userStore.touchHeartbeat】
INSERT INTO user_stats (username, heartbeat_count, last_seen_at, explicitly_offline)
VALUES ($1, 1, NOW(), FALSE)
ON CONFLICT (username) DO UPDATE SET
  heartbeat_count = user_stats.heartbeat_count + 1,
  last_seen_at = NOW(), explicitly_offline = FALSE;

-- L3 显式下线                                【userStore.markOffline】
INSERT INTO user_stats (username, last_seen_at, explicitly_offline)
VALUES ($1, NOW(), TRUE)
ON CONFLICT (username) DO UPDATE SET last_seen_at = NOW(), explicitly_offline = TRUE;

-- L4 连续打卡（同一天不重复计数）             【userStore.updateStreak】
SELECT streak_days, last_active_date FROM user_stats WHERE username = $1 FOR UPDATE;
SELECT CURRENT_DATE::text AS d, (CURRENT_DATE - 1)::text AS y;
UPDATE user_stats SET
  streak_days = $2, last_active_date = CURRENT_DATE,
  active_days_total = active_days_total + 1,
  max_streak = GREATEST(max_streak, $2)
WHERE username = $1;

-- L5 老账号回填                              【userStore.setStatsBackfill】
UPDATE user_stats SET
  first_try_count = $2, today_date = CURRENT_DATE,
  today_tried = $3, today_ac = $4, stats_version = $5
WHERE username = $1;

-- L6 在线快照（api/cron.js）                  【userStore.listUsersOnline】
SELECT u.username, u.display_name, u.real_name, u.role, u.banned,
       COALESCE(s.heartbeat_count, 0) AS heartbeat_count, s.last_seen_at
FROM users u LEFT JOIN user_stats s ON s.username = u.username;


-- ─────────────────────────────────────────────────────────────
-- M. 做题状态（user_problem_status）
-- ─────────────────────────────────────────────────────────────

-- M1 全部状态（返回对象）                     【userStore.getStates】
SELECT problem_id, status FROM user_problem_status WHERE username = $1;

-- M2 单题状态                                【userStore.getProblemState】
SELECT status FROM user_problem_status
WHERE username = $1 AND problem_id = $2 LIMIT 1;

-- M3 写状态（passed 永不被覆盖）              【userStore.setProblemState】
INSERT INTO user_problem_status (username, problem_id, status, updated_at)
VALUES ($1, $2, $3, NOW())
ON CONFLICT (username, problem_id) DO UPDATE SET
  status = CASE WHEN user_problem_status.status = 'passed' THEN 'passed'
                ELSE EXCLUDED.status END,
  updated_at = NOW();

-- M4 删除单条状态                            【userStore.removeProblemState】
DELETE FROM user_problem_status WHERE username = $1 AND problem_id = $2;

-- M5 题目删除时全库清理                       【userStore.deleteProblemStatesEverywhere】
DELETE FROM user_problem_status WHERE problem_id = $1;

-- M6 profile 状态列表（可选只看公开题）        【userStore.getStatusList】
SELECT s.problem_id, s.status, p.difficulty
FROM user_problem_status s JOIN problems p ON p.problem_id = s.problem_id
WHERE s.username = $1 AND ($2::boolean = FALSE OR p.is_public)
ORDER BY s.problem_id;

-- M7 已解题目难度                            【userStore.getSolvedDifficulties】
SELECT p.difficulty FROM user_problem_status s
JOIN problems p ON p.problem_id = s.problem_id
WHERE s.username = $1 AND s.status = 'passed' AND p.difficulty IS NOT NULL;

-- M8 单用户计数                              【userStore.getUserSolveCounts】
SELECT COUNT(*) FILTER (WHERE status = 'passed')::int AS passed,
       COUNT(*)::int                                   AS attempted
FROM user_problem_status WHERE username = $1;

-- M9 全量用户计数（管理端）                    【userStore.getStatusCountsByUser】
SELECT username,
       COUNT(*) FILTER (WHERE status = 'passed')::int AS passed,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
FROM user_problem_status GROUP BY username;

-- M10 提交后的统计更新（事务 + FOR UPDATE）    【userStore.updateStatsForSubmission】
INSERT INTO user_stats (username) VALUES ($1) ON CONFLICT (username) DO NOTHING;
SELECT today_date::text AS today_date, today_tried, today_ac, first_try_count
FROM user_stats WHERE username = $1 FOR UPDATE;
SELECT CURRENT_DATE::text AS d;
SELECT status FROM user_problem_status WHERE username = $1 AND problem_id = $2;
UPDATE user_stats SET
  today_date = CURRENT_DATE, today_tried = $2, today_ac = $3,
  first_try_count = first_try_count + $4
WHERE username = $1;
-- 然后按 correct 写 passed / failed（见 M3）

-- M11 solves（题目列表的通过人数）             【userStore.getSolvesCountMap】
SELECT problem_id, COUNT(*)::int AS n
FROM user_problem_status WHERE status = 'passed' GROUP BY problem_id;


-- ─────────────────────────────────────────────────────────────
-- N. 成就
-- ─────────────────────────────────────────────────────────────

-- N1 已解锁列表                              【userStore.getAchievements】
SELECT achievement_id, unlocked_at, reward
FROM user_achievements WHERE username = $1 ORDER BY unlocked_at;

-- N2 解锁（ON CONFLICT DO NOTHING = 原 $addToSet）【userStore.unlockAchievements】
INSERT INTO user_achievements (username, achievement_id, reward)
VALUES ($1, $2, $3)
ON CONFLICT (username, achievement_id) DO NOTHING
RETURNING achievement_id;

-- N3 成就计数（一条 SQL 拿齐）                 【userStore.getAchievementCounters】
SELECT COUNT(*) FILTER (WHERE s.status = 'passed')::int AS solved,
       COUNT(*)::int                                     AS tried,
       COALESCE(MAX(p.difficulty) FILTER (WHERE s.status = 'passed'), 0) AS max_diff
FROM user_problem_status s JOIN problems p ON p.problem_id = s.problem_id
WHERE s.username = $1;

SELECT first_try_count, streak_days, today_date::text AS today_date,
       today_ac, today_tried
FROM user_stats WHERE username = $1;

-- N4 全站解锁统计                             【userStore.getAchievementUnlockCounts】
SELECT ua.achievement_id, COUNT(*)::int AS count
FROM user_achievements ua JOIN users u ON u.username = ua.username
WHERE u.banned = FALSE
GROUP BY ua.achievement_id ORDER BY count DESC;

SELECT COUNT(*)::int AS n FROM users WHERE banned = FALSE;


-- ─────────────────────────────────────────────────────────────
-- O. rating 缓存
-- ─────────────────────────────────────────────────────────────

-- O1 读取                                    【userStore.getRatingRow】
SELECT rating, solved_count, updated_at, meta
FROM user_ratings WHERE username = $1;

-- O2 写回                                    【userStore.saveRating】
INSERT INTO user_ratings (username, rating, solved_count, updated_at, meta)
VALUES ($1, $2, $3, NOW(), $4)
ON CONFLICT (username) DO UPDATE SET
  rating = EXCLUDED.rating, solved_count = EXCLUDED.solved_count,
  updated_at = NOW(), meta = EXCLUDED.meta;

-- O3 批量（排行榜）                            【userStore.getRatingRows】
SELECT username, rating, solved_count, updated_at, meta
FROM user_ratings WHERE username = ANY($1::text[]);
