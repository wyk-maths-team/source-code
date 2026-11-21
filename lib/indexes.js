// lib/indexes.js
//
// 高频查询需要的索引，集中定义一次。
//
// 两个入口共用这份定义：
//   - tools/ensure-indexes.mjs（本地 CLI，可以 --apply）
//   - POST /api/db-health?action=indexes（部署后由 admin 触发）
//
// 为什么不放在启动路径里：每次冷启动都 createIndex 会白白消耗 Atlas 的操作配额，
// 而索引是「建一次、长期生效」的东西。
//
// 每条都必须写清楚「为什么」—— 索引有写入成本，
// 没有真实查询形态支撑的索引只是让每次 insert 变慢。

export const INDEX_PLAN = [
  {
    collection: 'messages',
    keys: { username: 1, createdAt: -1 },
    why: 'messages 列表：按用户取、按时间倒序，此前该集合一个索引都没有',
  },
  {
    collection: 'messages',
    keys: { username: 1, read: 1 },
    why: '未读数：心跳每 30 秒执行 countDocuments({username, read:false})',
  },
  {
    collection: 'submissions',
    keys: { status: 1, timestamp: -1 },
    why: '提交列表按 status 过滤再按时间排序，现有索引不带 status',
  },
];

function keyString(keys) {
  return Object.entries(keys).map(([k, v]) => `${k}:${v}`).join(',');
}

/**
 * 幂等补齐索引。已存在的跳过，只返回本次真正创建的那些。
 * @returns {Promise<Array<{collection:string, keys:object, created:boolean, why:string}>>}
 */
export async function ensureIndexes(db) {
  const report = [];

  for (const spec of INDEX_PLAN) {
    const col = db.collection(spec.collection);
    const wanted = keyString(spec.keys);

    let existing = [];
    try {
      existing = await col.indexes();
    } catch {
      existing = [];
    }

    const already = existing.some(idx => keyString(idx.key || {}) === wanted);
    if (already) {
      report.push({ ...spec, created: false });
      continue;
    }

    await col.createIndex(spec.keys);
    report.push({ ...spec, created: true });
  }

  return report;
}
