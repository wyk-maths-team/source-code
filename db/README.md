# db/ —— PostgreSQL 数据层

当前已迁移：**题库**（problems / tags / problem_tags）+ **用户域**
（users / user_tokens / user_stats / user_achievements / user_problem_status /
user_ratings / user_favorites / user_preferences）。

其余集合（submissions、contests、pk_*、messages、discussions…）仍在 MongoDB。

## 文件

| 文件 | 作用 |
| --- | --- |
| schema.sql | 建表 + 索引 + 视图 + **全部 SQL 查询清单**（要检查的就是这个） |
| reset.sql | 一次性清空所有表。破坏性，只跑一次 |
| import-problems.mjs | Mongo → PG 灌题库，幂等 |
| import-users.mjs | Mongo → PG 灌用户域，幂等 |

## 执行顺序

```bash
# 1) 只在第一次、或要彻底重来时跑（会删表，破坏性）
psql "$DATABASE_URL" -f db/reset.sql

# 2) 建表（幂等）
psql "$DATABASE_URL" -f db/schema.sql

# 3) 灌数据 —— 顺序不能反：用户状态与收藏有外键指向 problems
node db/import-problems.mjs
node db/import-users.mjs

# 可选：用 achievements_log 补成就奖励金额
node db/import-users.mjs --with-log
```

先 `--dry` 看统计再真灌。

## 时区

数据库会话时区固定 Asia/Hong_Kong（api/_pg.js 建连时下发）。
DATE 列原样返回 YYYY-MM-DD 字符串，应用层不再手工 +8 小时。

## 为什么放在 db/ 而不是 tools/

.gitignore 第 82 行忽略了整个 tools/ 目录，放在那里的 SQL 不会进仓库。
本目录不被忽略。

## 注意

- problems.answer / problems.logic 是答案与判题脚本，**任何返回给学生的
  响应都不能带这两列**。
- users.password 为 NULL 表示该账号只能走 SSO。
- user_tokens.global_balance 允许为负（PK 下注历史行为），不要加 CHECK。
- 改名依赖外键的 ON UPDATE CASCADE；直接 UPDATE users.username 即可。
- import-users 会跳过「题目已删」的 user_problem_status 与 user_favorites，
  跳过条数会打印出来。
