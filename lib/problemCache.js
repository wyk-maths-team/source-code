// lib/problemCache.js —— 题库元数据的共享缓存
//
// 题库（id + difficulty）是全站共享、几乎不变的数据，但以前每个 profile 请求
// 都要把全部题目拉一遍（public 约 2400 行，全量约 2700 行）。
// 这里是 O(M) → 摊销 O(1) 的那一步。
//
// 60 秒 TTL：管理员改难度/公开状态后最多 1 分钟生效，足够。
// serverless 下每个实例各有一份，冷启动第一次仍是 O(M)，之后复用。

const TTL = 60_000;

const _cache = {
  public:  { data: null, expireAt: 0, version: null },
  all:     { data: null, expireAt: 0, version: null },
};

// 数据库里的 problemVersion：cron 在提交量高的时候会 +1，
// 各实例最多 10 秒内就能感知并重建缓存。
const VERSION_CHECK_MS = 10_000;
const _ver = { value: null, checkedAt: 0 };

async function currentProblemVersion(db) {
  const now = Date.now();
  if (_ver.value !== null && now - _ver.checkedAt < VERSION_CHECK_MS) return _ver.value;
  try {
    const doc = await db.collection('metadata').findOne({ key: 'problemVersion' }, { projection: { value: 1 } });
    _ver.value = doc ? (Number(doc.value) || 0) : 0;
    _ver.checkedAt = now;
  } catch (e) {
    if (_ver.value === null) _ver.value = 0;   // 读失败就沿用上次的值
  }
  return _ver.value;
}

function sortById(rows) {
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  return rows;
}

function build(rows) {
  const list = sortById(rows);
  return {
    list,
    ids: list.map(p => p.id),
    idSet: new Set(list.map(p => p.id)),
    diffMap: Object.fromEntries(list.map(p => [p.id, Number(p.difficulty) || 0])),
  };
}

async function load(db, key, filter) {
  const now = Date.now();
  const ver = await currentProblemVersion(db);
  const slot = _cache[key];
  if (slot.data && slot.expireAt > now && slot.version === ver) return slot.data;

  const rows = await db.collection('problems')
    .find(filter, { projection: { id: 1, difficulty: 1, _id: 0 } })
    .toArray();

  const data = build(rows);
  _cache[key] = { data, expireAt: now + TTL, version: ver };
  return data;
}

/**
 * public 题目。返回 { list, ids, idSet, diffMap }
 * list 已按 id 排序（自然序，HA0012 在 HA0100 之前）。
 */
export function getPublicProblems(db) {
  return load(db, 'public', { public: true });
}

/** 全量题目（含非 public），管理员 profile 用 */
export function getAllProblems(db) {
  return load(db, 'all', {});
}

/** 全量难度映射，成就系统用它算 maxDifficulty */
export async function getDifficultyMap(db) {
  const { diffMap } = await getAllProblems(db);
  return diffMap;
}

// 管理员改了题库就手动失效（可选，TTL 到点也会自然失效）
export function invalidateProblemCache() {
  _cache.public = { data: null, expireAt: 0, version: null };
  _cache.all = { data: null, expireAt: 0, version: null };
  _ver.value = null;
  _ver.checkedAt = 0;
}
