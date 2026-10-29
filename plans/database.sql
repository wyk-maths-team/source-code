CREATE TABLE users (
  username      TEXT PRIMARY KEY, --唯一识别
  password      TEXT,             --不是明文
  role          TEXT NOT NULL DEFAULT 'student'
                  CHECK (role IN ('student', 'admin', 'root')),
  email         TEXT,                          -- cloud地址
  real_name     TEXT,                          -- 实名，profile 上始终显示
  display_name  TEXT,                          -- 展示名，可改
  pfp           TEXT,                          -- 头像 URL
  banned        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--说明：日后加入role直接修改IN逻辑
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_created ON users (created_at DESC);
CREATE TABLE user_tokens (
  username             TEXT PRIMARY KEY REFERENCES users (username) ON DELETE CASCADE,--外键
  daily                BIGINT NOT NULL DEFAULT 30000 CHECK (daily >= 0),
  global_balance       BIGINT NOT NULL DEFAULT 100000 CHECK (global_balance >= 0),
  last_reset           DATE NOT NULL DEFAULT CURRENT_DATE,
  daily_login_claimed  BOOLEAN NOT NULL DEFAULT FALSE,
  daily_quest_claimed  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE user_achievements (
  username        TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,--外键
  achievement_id  TEXT NOT NULL,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reward          BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (username, achievement_id)
);
CREATE INDEX idx_ua_achievement ON user_achievements (achievement_id);
CREATE TABLE problems (
  problem_id    TEXT PRIMARY KEY,
  name          TEXT NOT NULL DEFAULT '',
  statement     TEXT NOT NULL DEFAULT '',      -- 含内联 LaTeX（$...$）
  answer        TEXT NOT NULL DEFAULT '',      -- 参考答案，可能是非数字
  difficulty    NUMERIC(4, 2),                 -- 1.00–10.00，0 = 未评级
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,
  force_steps   BOOLEAN NOT NULL DEFAULT FALSE,-- 强制走分步作答（原 FS 字段）
  logic         TEXT                           -- 自定义判题脚本，NULL = 无
);
CREATE INDEX idx_problems_public_diff ON problems (is_public, difficulty);
CREATE INDEX idx_problems_name ON problems (name);
CREATE TABLE tags (
  tag_id  SERIAL PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE
);
CREATE TABLE problem_tags (
  problem_id TEXT NOT NULL REFERENCES problems (problem_id) ON DELETE CASCADE,
  tag_id     INT  NOT NULL REFERENCES tags (tag_id)        ON DELETE CASCADE,
  PRIMARY KEY (problem_id, tag_id)
);
CREATE INDEX idx_problem_tags_tag ON problem_tags (tag_id);
CREATE TABLE submissions (
  subid         TEXT PRIMARY KEY,
  username      TEXT NOT NULL REFERENCES users (username) ON DELETE CASCADE,
  problem_id    TEXT NOT NULL REFERENCES problems (problem_id) ON DELETE CASCADE,
  answer        TEXT NOT NULL DEFAULT '',
  type          TEXT NOT NULL DEFAULT 'text'
                  CHECK (type IN ('text', 'image', 'steps')),
  image         TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  correct       BOOLEAN,
  score         INT,                           -- 0–100，部分分
  system_error  BOOLEAN NOT NULL DEFAULT FALSE,
  marked        BOOLEAN NOT NULL DEFAULT FALSE,
  comment       TEXT,
  contest_id    TEXT                           -- 暂不建外键，contests 表不在本轮范围
);