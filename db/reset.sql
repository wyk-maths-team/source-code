  -- =====================================================================
  -- db/reset.sql —— 一次性清理，回到「只有题目表」之前的状态
  -- =====================================================================
  --
  -- ⚠️ 破坏性操作，**只跑一次**。schema.sql 不会执行这些 DROP。
  --
  -- 用途：上一版迁移（tools/migrate-pg.mjs）建过的表、或本文件上一轮建的
  -- 用户域表，全部清掉，保证从空库开始。
  --
  -- 跑完之后执行：db/schema.sql → node db/import-problems.mjs → node db/import-users.mjs
  -- =====================================================================

  BEGIN;

  -- 视图依赖表，先删视图
  DROP VIEW  IF EXISTS v_user_overview;
  DROP VIEW  IF EXISTS v_problem_list;

  -- 用户域（先子表后主表）
  DROP TABLE IF EXISTS user_favorites        CASCADE;
  DROP TABLE IF EXISTS user_problem_status   CASCADE;
  DROP TABLE IF EXISTS user_achievements     CASCADE;
  DROP TABLE IF EXISTS user_ratings          CASCADE;
  DROP TABLE IF EXISTS user_preferences      CASCADE;
  DROP TABLE IF EXISTS user_stats            CASCADE;
  DROP TABLE IF EXISTS user_tokens           CASCADE;
  DROP TABLE IF EXISTS users                 CASCADE;

  -- 题目域
  DROP TABLE IF EXISTS problem_tags          CASCADE;
  DROP TABLE IF EXISTS tags                  CASCADE;
  DROP TABLE IF EXISTS problems              CASCADE;
  DROP TABLE IF EXISTS app_settings          CASCADE;

  -- 上一版迁移遗留、本轮不参与的表（如果存在）
  DROP TABLE IF EXISTS user_stats_cache      CASCADE;
  DROP TABLE IF EXISTS submissions           CASCADE;

  COMMIT;

  -- 确认结果：应该只剩 0 张业务表
  -- SELECT table_name FROM information_schema.tables
  --  WHERE table_schema = 'public' ORDER BY 1;
