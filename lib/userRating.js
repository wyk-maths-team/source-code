// lib/userRating.js —— rating 的读写入口（带物化）
//
// rating 只依赖「用户已 AC 的题目及其难度」这一个集合。
// 这个集合只在 AC 新题时变化，所以没必要每次读都重算：
//
//   以前：每次 open Token Hub / profile / PK 开赛都跑一遍
//         map + sort + 加权 = O(n log n)，n 是已解题目数
//   现在：userstats 里存 rating + ratingSolvedCount，
//         只要 solvedCount 没变就直接返回，O(1)。
//
// 失效条件（任一即重算）：
//   - solvedCount 变了（AC 了新题，或者题目被移除）
//   - 从没算过
//   - 超过 RATING_MAX_AGE_MS（防止管理员调难度后长期不更新）
//
// 并发下可能重算两次，但写回是幂等的，不影响正确性。

import { calculateUserRating, getTier as tierOf } from './rating.js';
import { getDifficultyMap } from './problemCache.js';

const RATING_MAX_AGE_MS = 7 * 24 * 3600_000;   // 7 天
const MEM_TTL_MS = 60_000;                      // 进程内缓存

// 进程内缓存：DB 里的 ratingSolvedCount 能判断「该不该重算」，
// 但判断本身要读一次 userstats（Atlas 一个往返约 20ms）。
// 高频读的路径（profile / token-hub / PK 开赛两次算 rating）需要这层内存缓存，
// 否则物化反而比纯计算慢 —— benchmark 里实测过 0.34ms → 31ms。
const _memCache = new Map();   // username -> { result, expireAt }

/**
 * @returns {Promise<{rating, tier, effectiveMax, weightedAvg, trimmed, solvedCount, confidence, cached}>}
 */
export async function getUserRating(db, username) {
  const hit = _memCache.get(username);
  if (hit && hit.expireAt > Date.now()) return { ...hit.result, cached: true };

  const [doc, diffMap] = await Promise.all([
    db.collection('userstats').findOne(
      { username },
      { projection: { states: 1, rating: 1, ratingMeta: 1, ratingSolvedCount: 1, ratingUpdatedAt: 1, _id: 0 } }
    ),
    getDifficultyMap(db),
  ]);

  const states = doc?.states || {};

  // 已解题目及其难度
  const solvedDifficulties = [];
  for (const pid in states) {
    if (states[pid] === 'passed') solvedDifficulties.push(diffMap[pid] || 0);
  }
  const solvedCount = solvedDifficulties.length;

  const cached = doc?.rating;
  const cachedCount = doc?.ratingSolvedCount;
  const updatedAt = doc?.ratingUpdatedAt ? new Date(doc.ratingUpdatedAt).getTime() : 0;
  const fresh = updatedAt > 0 && (Date.now() - updatedAt) < RATING_MAX_AGE_MS;

  let result;

  // 命中 DB 缓存：O(1)
  if (cached != null && cachedCount === solvedCount && fresh && doc?.ratingMeta) {
    const meta = doc.ratingMeta;
    result = {
      rating: cached,
      tier: tierOf(cached),
      effectiveMax: meta.effectiveMax,
      weightedAvg: meta.weightedAvg,
      trimmed: !!meta.trimmed,
      solvedCount,
      confidence: meta.confidence,
    };
  } else {
    // 未命中：重算并写回
    const r = calculateUserRating({ solvedDifficulties });
    result = {
      rating: r.rating,
      tier: r.tier,
      effectiveMax: r.effectiveMax,
      weightedAvg: r.weightedAvg,
      trimmed: !!r.trimmed,
      solvedCount: r.solvedCount,
      confidence: r.confidence,
    };

    if (doc) {
      await db.collection('userstats').updateOne(
        { username },
        {
          $set: {
            rating: result.rating,
            ratingSolvedCount: solvedCount,
            ratingUpdatedAt: new Date(),
            ratingMeta: {
              effectiveMax: result.effectiveMax,
              weightedAvg: result.weightedAvg,
              trimmed: !!result.trimmed,
              confidence: result.confidence,
            },
          },
        }
      ).catch(() => {});
    }
  }

  _memCache.set(username, { result, expireAt: Date.now() + MEM_TTL_MS });
  return { ...result, cached: false };
}

/**
 * AC 之后调用：清掉该用户的内存缓存，让下一次读取立刻重算。
 * DB 里的 ratingSolvedCount 本来就能检测变化，这里只是让「刚交完卷马上看 profile」
 * 不会拿到 60 秒内的旧值。
 */
export function invalidateUserRating(username) {
  _memCache.delete(username);
}
