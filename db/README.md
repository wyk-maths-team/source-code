# db/ —— PostgreSQL 数据层（MongoDB 已下线）

全部集合已迁移：题库、用户域、提交记录是关系表；竞赛、PK、讨论区、站内信、
审计日志等是「doc_id + JSONB」的文档型表（见 schema.sql 的 T / U 段）。

## 文件

| 文件 | 作用 |
| --- | --- |
| schema.sql | 建表 + 索引 + 视图 + 全部 SQL 清单（**要检查的是这个**） |
| reset.sql | 清空所有表。破坏性，只跑一次 |
| import-problems.mjs | 题库 |
| import-users.mjs | 用户域 |
| import-rest.mjs | submissions + 28 张文档表 + port_* |

## 上线顺序（不能反）

```bash
psql "$DATABASE_URL" -f db/reset.sql      # 只在首次 / 彻底重来时
psql "$DATABASE_URL" -f db/schema.sql
node db/import-problems.mjs
node db/import-users.mjs
node db/import-rest.mjs
```

**先跑迁移，再部署代码。** 新代码直接依赖这些表。

## 迁移脚本的依赖

`mongodb` 驱动只在 `db/*.mjs` 里用，已移到 devDependencies。
运行时源码里没有任何 `from "mongodb"`。

## 已知取舍

- `submissions.subid` 重新编号（1, 2, 3…）。迁移前的随机串存在 `legacy_subid`，
  旧链接会失效。
- 文档型表不做字段级拆解：filter 走 JSONB，update 在 JS 里应用。
- `$expr` 不支持，竞赛活跃判断改在应用层（`docStore.isContestActive`）。
- `_id` 统一变成字符串（原 ObjectId 的 hex）。
- 已下线：`tr-problems`、`oplog`（保留空接口避免前端 404）、`desktopIcons`、
  难度自动调整。
