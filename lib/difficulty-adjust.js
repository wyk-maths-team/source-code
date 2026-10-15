// lib/difficulty-adjust.js
// 根据提交数据和用户 rating，微调题目难度

const PR_ANCHORS = [1000, 1200, 1400, 1600, 1900, 2200, 2600, 3000, 3400];

function difficultyToPR(d) {
  d = Number(d) || 0;
  if (d <= 1) return PR_ANCHORS[0];
  if (d >= 9) return PR_ANCHORS[8] + Math.round((d - 9) * 400);
  const lo = Math.floor(d) - 1;
  const hi = Math.min(8, lo + 1);
  const t = d - Math.floor(d);
  return Math.round(PR_ANCHORS[lo] * (1 - t) + PR_ANCHORS[hi] * t);
}

/**
 * 微调题目难度
 *
 * @param {object} params
 * @param {number} params.currentDifficulty  当前 d 值
 * @param {Array}  params.attempts           提交数组
 *        每个元素: { username, rating, firstAttemptCorrect }
 * @param {object} [params.opts]
 * @param {number} [params.opts.S=400]         Elo scale
 * @param {number} [params.opts.n0=5]          样本阻尼常数
 * @param {number} [params.opts.Scale=2.0]     调整幅度尺度
 * @param {number} [params.opts.maxDelta=0.5]  单次最大调整
 * @param {number} [params.opts.minSamples=3]  最少样本数
 * @param {boolean}[params.opts.clampToPublic=true]  是否限制在 [1, 10]
 *
 * @returns {{
 *   newDifficulty: number,
 *   delta: number,
 *   sampleSize: number,
 *   bias: number,
 *   reason: string
 * }}
 */
export function adjustDifficulty({ currentDifficulty, attempts, opts = {} }) {
  const {
    S = 400,
    n0 = 5,
    Scale = 2.0,
    maxDelta = 0.5,
    minSamples = 3,
    clampToPublic = true,
  } = opts;

  const PR = difficultyToPR(currentDifficulty);

  // 1. 去重：每个用户只取首次提交
  const seen = new Set();
  const unique = [];
  for (const a of attempts || []) {
    if (!a || !a.username) continue;
    if (seen.has(a.username)) continue;
    if (!Number.isFinite(a.rating) || a.rating < 1000) continue;
    seen.add(a.username);
    unique.push(a);
  }

  const n = unique.length;

  // 2. 样本不足 → 不动
  if (n < minSamples) {
    return {
      newDifficulty: currentDifficulty,
      delta: 0,
      sampleSize: n,
      bias: 0,
      reason: `insufficient samples (n=${n}, need≥${minSamples})`,
    };
  }

  // 3. 计算加权 Bias
  //    权重：rating 越高的用户，其表现越能反映题目真实难度
  //    低 rating 用户（<1000）已过滤
  let weightedSum = 0;
  let weightSum = 0;
  for (const a of unique) {
    const P = 1 / (1 + Math.pow(10, (PR - a.rating) / S));
    const S_actual = a.firstAttemptCorrect ? 1 : 0;
    const w = Math.min(1, a.rating / 2000);
    weightedSum += w * (P - S_actual);
    weightSum += w;
  }
  const bias = weightSum > 0 ? weightedSum / weightSum : 0;

  // 4. 阻尼：样本越多，越信任数据
  const damp = n / (n + n0);

  // 5. 计算 Δd
  let delta = damp * bias * Scale;

  // 6. 单次上限
  if (delta > maxDelta) delta = maxDelta;
  if (delta < -maxDelta) delta = -maxDelta;

  // 7. 应用
  let newDifficulty = currentDifficulty + delta;
  if (clampToPublic) {
    newDifficulty = Math.max(1, Math.min(10, newDifficulty));
  }
  newDifficulty = Math.round(newDifficulty * 100) / 100;

  return {
    newDifficulty,
    delta: Math.round(delta * 1000) / 1000,
    sampleSize: n,
    bias: Math.round(bias * 1000) / 1000,
    reason: bias > 0.05 ? 'too hard'
          : bias < -0.05 ? 'too easy'
          : 'well-calibrated',
  };
}