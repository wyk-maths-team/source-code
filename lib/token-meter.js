// lib/token-meter.js —— 全局 token 消耗计数
//
// 放在 metadata 集合的一条文档里：
//   { _id: 'globalTokens', totalTokensUsed: N, updatedAt: Date }
//
// 为什么不是每次统计都去聚合 submissions：那张表一万多条并且在长，
// 首页每来一个人就扫一遍不现实。累加值用 $inc 维护，读的时候直接取，
// 每小时由 cron 用真实值重算一次，把任何漂移纠正回来。

import { MongoClient } from 'mongodb';

const DOC_ID = 'globalTokens';

/**
 * 原子累加。必须用 $inc —— 读-改-写会在并发提交时丢计数。
 * 失败不影响提交本身，所以调用方可以 catch 掉。
 */
export async function addTokensUsed(db, amount) {
  const n = Math.round(Number(amount) || 0);
  if (n <= 0) return;

  await db.collection('metadata').updateOne(
    { _id: DOC_ID },
    {
      $inc: { totalTokensUsed: n },
      $set: { updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
}

/** 读当前值（首页用） */
export async function getTokensUsed(db) {
  const doc = await db.collection('metadata').findOne({ _id: DOC_ID });
  return {
    totalTokensUsed: Number(doc && doc.totalTokensUsed) || 0,
    updatedAt: (doc && doc.updatedAt) || null,
  };
}

/**
 * 从 submissions 重新算一遍真值并写回。
 * 以 tokenUsage 字段求和为准；老记录没有这个字段的自然不计。
 */
export async function recomputeTokensUsed(db) {
  const agg = await db.collection('submissions').aggregate([
    { $match: { tokenUsage: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: '$tokenUsage' } } },
  ]).toArray();

  const total = Math.round(Number(agg[0] && agg[0].total) || 0);

  await db.collection('metadata').updateOne(
    { _id: DOC_ID },
    {
      $set: { totalTokensUsed: total, updatedAt: new Date(), lastRecomputedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  return total;
}
