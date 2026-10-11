// lib/rating.js

// ═══════════ 難度 → 題目 Rating（PR）═══════════
const PR_ANCHORS = [1000, 1200, 1400, 1600, 1900, 2200, 2600, 3000, 3400];

export function difficultyToPR(d) {
  d = Number(d) || 0;
  if (d <= 1) return PR_ANCHORS[0];
  if (d >= 9) return PR_ANCHORS[8] + Math.round((d - 9) * 400);

  const lo = Math.floor(d) - 1;
  const hi = Math.min(8, lo + 1);
  const t = d - Math.floor(d);
  return Math.round(PR_ANCHORS[lo] * (1 - t) + PR_ANCHORS[hi] * t);
}

// ═══════════ 段位 ═══════════
export const TIERS = [
  { min: 2900, name: '', color: '#FF0000', glow: '#FF4040' },
  { min: 2600, name: '', color: '#E01010', glow: '#FF3030' },
  { min: 2400, name: '', color: '#FF2020', glow: '#FF6060' },
  { min: 2200, name: '', color: '#FF5020', glow: '#FF8040' },
  { min: 2100, name: '', color: '#FFA020', glow: '#FFC060' },
  { min: 1900, name: '', color: '#C040FF', glow: '#D080FF' },
  { min: 1600, name: '', color: '#4080FF', glow: '#80B0FF' },
  { min: 1400, name: '', color: '#00E0D0', glow: '#40FFEF' },
  { min: 1200, name: '', color: '#00D000', glow: '#40FF40' },
  { min: 1000, name: '', color: '#A0A0A0', glow: '#C8C8C8' },
];

export function getTier(rating) {
  for (const t of TIERS) {
    if (rating >= t.min) return t;
  }
  return TIERS[TIERS.length - 1];
}

// ═══════════ 主計算 v2 ═══════════
/**
 * 優化版 Rating：
 *
 *   1. 排序 PR 降序
 *   2. 異常值削頂：p[0] 不能比 p[1..2] 均值高 300 以上
 *      （防止「1 題運氣好」拉高整體）
 *   3. 核心值 = 0.5 × effectiveMax + 0.5 × avg(Top 13)
 *   4. 樣本量置信度：
 *        conf = min(1, 0.5 + 0.5 × (n / 10)^0.7)
 *        n=1  → 0.60
 *        n=3  → 0.72
 *        n=6  → 0.87
 *        n=10 → 1.00
 *   5. rating = 1000 + (core - 1000) × conf
 *      下限 1000
 */

export function calculateUserRating({ solvedDifficulties }) {
  const diffs = Array.isArray(solvedDifficulties)
    ? solvedDifficulties.filter(d => Number.isFinite(d))
    : [];
  const n = diffs.length;

  if (n === 0) {
    return {
      rating: 1000,
      tier: getTier(1000),
      effectiveMax: 1000,
      avgTop13: 1000,
      trimmed: false,
      solvedCount: 0,
    };
  }

  // 1. 轉 PR，降序
  const PRs = diffs.map(difficultyToPR).sort((a, b) => b - a);

  // 2. 異常值削頂
  let effectiveMax = PRs[0];
  let trimmed = false;

  if (n >= 3) {
    const restAvg = (PRs[1] + PRs[2]) / 2;
    if (effectiveMax > restAvg + 300) {
      effectiveMax = restAvg + 300;
      trimmed = true;
    }
  } else if (n === 2) {
    // 只有兩題：用 p[1] 做參考
    if (effectiveMax > PRs[1] + 300) {
      effectiveMax = PRs[1] + 300;
      trimmed = true;
    }
  }
  // n === 1：無參照，不削頂

  // 3. Top 13 均值
  const top = PRs.slice(0, Math.min(13, n));
  const avgTop13 = top.reduce((s, x) => s + x, 0) / top.length;

  // 4. 核心值
  const core = effectiveMax * 0.5 + avgTop13 * 0.5;

  // 5. 樣本量置信度
  const conf = Math.min(1, 0.5 + 0.5 * Math.pow(n / 10, 0.7));

  // 6. 最終 rating
  let rating = 1000 + (core - 1000) * conf;
  rating = Math.round(Math.max(1000, rating));

  return {
    rating,
    tier: getTier(rating),
    effectiveMax: Math.round(effectiveMax),
    avgTop13: Math.round(avgTop13),
    trimmed,
    solvedCount: n,
  };
}