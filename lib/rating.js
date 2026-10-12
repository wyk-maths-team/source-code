// lib/rating.js

// ═══════════ 難度 → 題目 Rating（PR）═══════════
const PR_ANCHORS = [1000, 1200, 1400, 1600, 1900, 2200, 2600, 3000, 3400];
const PR_CEIL = 4000;   // ⭐ 新增：硬上限，防 d 超大時爆走

export function difficultyToPR(d) {
  d = Number(d) || 0;
  if (d <= 1) return PR_ANCHORS[0];
  if (d >= 9) {
    return Math.min(PR_CEIL, PR_ANCHORS[8] + Math.round((d - 9) * 400));
  }
  const lo = Math.floor(d) - 1;
  const hi = Math.min(8, lo + 1);
  const t = d - Math.floor(d);
  return Math.round(PR_ANCHORS[lo] * (1 - t) + PR_ANCHORS[hi] * t);
}

// ═══════════ 段位（不變）═══════════
export const TIERS = [
  { min: 2900, name: '', color: '#0F172A', glow: '#FBBF24' },  // 黑曜石 + 金
  { min: 2600, name: '', color: '#991B1B', glow: '#FCA5A5' },  // 深红
  { min: 2400, name: '', color: '#E11D48', glow: '#FB7185' },  // 宝石红
  { min: 2200, name: '', color: '#D946EF', glow: '#F0ABFC' },  // 品红
  { min: 2100, name: '', color: '#8B5CF6', glow: '#C4B5FD' },  // 紫罗兰
  { min: 1900, name: '', color: '#6366F1', glow: '#A5B4FC' },  // 靛蓝
  { min: 1600, name: 'DSE 5**', color: '#3B82F6', glow: '#93C5FD' },  // 天蓝
  { min: 1400, name: '', color: '#14B8A6', glow: '#5EEAD4' },  // 青绿
  { min: 1200, name: '', color: '#22C55E', glow: '#86EFAC' },  // 翡翠绿
  { min: 1000, name: '', color: '#94A3B8', glow: '#CBD5E1' },  // 石板灰
];

export function getTier(rating) {
  for (const t of TIERS) if (rating >= t.min) return t;
  return TIERS[TIERS.length - 1];
}

// ═══════════ 主計算 v3 ═══════════
/**
 * v3 相對 v2 的四個核心改動：
 *
 *   ① 指數衰減加權，取代 hard Top-13
 *      第 i 題權重 = 0.5^(i/8)，第 8 題佔第 1 題 50% 權重
 *      → 沒有階梯斷層，樣本越多越平滑
 *
 *   ② 軟削頂（指數壓縮），取代硬砍 +300
 *      extra = SCALE × (1 − e^(−gap/SCALE))
 *      → 超過 SOFT 的部分慢慢飽和，不會一刀切
 *
 *   ③ 置信度改用 (n+2)/(n+5)
 *      n=1→0.50  n=5→0.70  n=10→0.80  n=30→0.914  n=100→0.971
 *      → 漸近 1 但永遠不真的到 1，長期收斂到 core
 *
 *   ④ max/avg 混和比例 0.5 → 0.55，稍微偏重 max
 */

export function calculateUserRating({ solvedDifficulties }) {
  const diffs = Array.isArray(solvedDifficulties)
    ? solvedDifficulties.filter(Number.isFinite)
    : [];
  const n = diffs.length;

  if (n === 0) {
    return {
      rating: 1000,
      tier: getTier(1000),
      effectiveMax: 1000,
      weightedAvg: 1000,
      trimmed: false,
      solvedCount: 0,
      confidence: 0,
    };
  }

  // ── 1. 轉 PR、降序排序 ──
  const PRs = diffs.map(difficultyToPR).sort((a, b) => b - a);

  // ── 2. 加權平均（指數衰減） ──
  const HALFLIFE = 8;
  let wSum = 0, wPRSum = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.pow(0.5, i / HALFLIFE);
    wSum += w;
    wPRSum += PRs[i] * w;
  }
  const weightedAvg = wPRSum / wSum;

  // ── 3. 軟削頂 ──
  let effectiveMax = PRs[0];
  let trimmed = false;

  if (n >= 2) {
    // 用 p[1..min(5,n-1)] 的平均作參照（比只用 p[1..2] 更穩）
    const refEnd = Math.min(5, n);
    let refSum = 0;
    for (let i = 1; i < refEnd; i++) refSum += PRs[i];
    const refAvg = refSum / (refEnd - 1);

    const gap = effectiveMax - refAvg;
    const SOFT = 200;    // 差距超過 200 開始壓縮
    const SCALE = 250;   // 壓縮飽和值

    if (gap > SOFT) {
      effectiveMax =
        refAvg + SOFT + SCALE * (1 - Math.exp(-(gap - SOFT) / SCALE));
      trimmed = true;
    }
  }

  // ── 4. 核心值 ──
  const ALPHA = 0.55;
  const core = effectiveMax * ALPHA + weightedAvg * (1 - ALPHA);

  // ── 5. 置信度 ──
  const conf = (n + 2) / (n + 5);

  // ── 6. 最終 rating ──
  let rating = 1000 + (core - 1000) * conf;
  rating = Math.round(Math.max(1000, rating));

  return {
    rating,
    tier: getTier(rating),
    effectiveMax: Math.round(effectiveMax),
    weightedAvg: Math.round(weightedAvg),
    trimmed,
    solvedCount: n,
    confidence: +conf.toFixed(3),   // ⭐ 新增欄位，方便 debug / UI 顯示
  };
}