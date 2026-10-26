// lib/difficulty-adjust.js
//
// 动态难度调整（重写版）
//
// 核心思想：
//   难度 d 定义为「一个 rating 为 PR 的学生，首次尝试就有约 50% 概率做对」，
//   其中 PR = difficultyToPR(d)（复用 rating.js，保证同一把尺子）。
//
//   用 Logistic 模型 + 置信度加权的牛顿步（带人工先验）反推 PR，
//   全程在 PR 空间计算、靠 Fisher 信息自动定步长，再配 EMA 平滑与截断防抖。
//
// 与旧版的关键区别：
//   - 旧版：delta = damp · bias · Scale（概率单位硬乘，单位混乱）
//   - 新版：PR 空间牛顿步，步长由 Fisher 信息 + 先验强度自动决定

import { difficultyToPR } from './rating.js';

const PR_ANCHORS = [1000, 1200, 1400, 1600, 1900, 2200, 2600, 3000, 3400];

// difficultyToPR 的逆映射（把估计出的 PR 还原成 1~10 的难度）
export function PRToDifficulty(pr) {
  pr = Number(pr);
  if (!Number.isFinite(pr)) return 1;
  if (pr <= PR_ANCHORS[0]) return 1;
  if (pr >= PR_ANCHORS[8]) return 9 + (pr - PR_ANCHORS[8]) / 400;
  for (let i = 0; i < PR_ANCHORS.length - 1; i++) {
    const lo = PR_ANCHORS[i];
    const hi = PR_ANCHORS[i + 1];
    if (pr >= lo && pr <= hi) {
      return (i + 1) + (pr - lo) / (hi - lo);
    }
  }
  return 1;
}

function clamp01(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 微调题目难度（牛顿步 + 高斯先验）
 *
 * @param {object} params
 * @param {number} params.currentDifficulty  当前 d 值
 * @param {number} [params.manualDifficulty] 人工设定的先验 d 值（缺省用 current）
 * @param {Array}  params.attempts            首次作答观测数组
 *        每个元素: { username, rating, firstAttemptCorrect, solvedCount }
 *        - rating:               该用户当前 rating
 *        - firstAttemptCorrect:  该用户此题首次提交是否做对（bool）
 *        - solvedCount:          该用户已通过的题数（用于算 rating 置信度）
 * @param {object} [params.opts]
 * @param {number} [params.opts.S=400]          Elo 尺度
 * @param {number} [params.opts.n0=5]           先验强度（等价于 n0 个在 50% 阈值处的虚拟观测）
 * @param {number} [params.opts.minSamples=3]   最小有效样本（Σ权重）
 * @param {number} [params.opts.maxDeltaPR=100] 单次最大 PR 调整（≈0.25 难度档）
 * @param {number} [params.opts.ema=0.5]        平滑系数（0~1，越小越保守）
 * @param {boolean}[params.opts.clampToPublic=true] 是否限制在 [1, 10]
 *
 * @returns {{
 *   newDifficulty:number, delta:number, sampleSize:number,
 *   effectiveSamples:number, confidence:number, bias:number, reason:string
 * }}
 */
export function adjustDifficulty({ currentDifficulty, manualDifficulty, attempts, opts = {} }) {
  const {
    S = 400,
    n0 = 5,
    minSamples = 3,
    maxDeltaPR = 100,
    ema = 0.5,
    clampToPublic = true,
  } = opts;

  const PR  = difficultyToPR(currentDifficulty);
  const PR0 = (manualDifficulty !== undefined && manualDifficulty !== null)
    ? difficultyToPR(Number(manualDifficulty))
    : PR;

  // 1. 去重：每个用户只取首次提交（调用方已按时间排序取最早，这里兜底去重）
  const seen = new Set();
  const unique = [];
  for (const a of attempts || []) {
    if (!a || !a.username) continue;
    if (seen.has(a.username)) continue;
    if (!Number.isFinite(a.rating) || a.rating < 1000) continue;
    seen.add(a.username);
    unique.push(a);
  }

  // 2. 观测权重 = rating 置信度 (solvedCount+2)/(solvedCount+5)
  //    解越多，该用户的 rating 越可靠，其 (rating, 作答) 观测越可信。
  //    ⚠ 不加「能力加权」(如 clip(rating/2000))：Fisher 信息已自动对
  //      低信息量观测（P≈0/1）降权；再按 rating 值降权会误伤简单题——
  //      因为简单题恰恰由低 rating 的新手作答，过度降权会让简单题永远
  //      凑不够有效样本。
  const obs = unique.map(a => {
    const conf = Number.isFinite(a.solvedCount)
      ? (a.solvedCount + 2) / (a.solvedCount + 5)
      : 0.5;
    return { ...a, w: conf };
  });

  const nEff = obs.reduce((s, o) => s + o.w, 0);

  // 3. 样本不足 → 不动
  if (nEff < minSamples) {
    return {
      newDifficulty: round2(currentDifficulty),
      delta: 0,
      sampleSize: unique.length,
      effectiveSamples: round3(nEff),
      confidence: round3(nEff / (nEff + n0)),
      bias: 0,
      reason: `insufficient samples (nEff=${nEff.toFixed(2)}, need≥${minSamples})`,
    };
  }

  const k = Math.log(10) / S;

  // 4. 梯度 g 与 Fisher 信息 I（异常观测截断，防单个怪用户带偏）
  let g = 0;
  let I = 0;
  for (const o of obs) {
    const P = 1 / (1 + Math.pow(10, (PR - o.rating) / S));
    let contrib = o.w * (P - (o.firstAttemptCorrect ? 1 : 0));
    contrib = clamp01(contrib, -0.5, 0.5);   // Winsorize
    g += contrib;
    I += o.w * P * (1 - P);
  }

  // 5. 牛顿步 + 高斯先验（把人工值当 n0 个虚拟观测，向 PR0 靠拢）
  //    对数似然梯度 = k·g；先验精度 = n0·k²·0.25（n0 个在 p=0.5 处的虚拟观测）
  //    ⚠ 先验必须换算到与 Fisher 信息一致的量纲（1/PR²），否则会压过数据
  const priorPrecision = n0 * k * k * 0.25;
  const grad = k * g - priorPrecision * (PR - PR0);
  const info = k * k * I + priorPrecision;
  let delta = grad / info;

  // 6. 单次调整上限
  delta = clamp01(delta, -maxDeltaPR, maxDeltaPR);

  // 7. EMA 平滑 + 应用
  const PRNew = PR + ema * delta;
  let newDifficulty = PRToDifficulty(PRNew);
  if (clampToPublic) newDifficulty = clamp01(newDifficulty, 1, 10);
  newDifficulty = round2(newDifficulty);

  // 报告用 bias（未截断前平均方向，仅供解释）
  const bias = I > 0 ? g / I : 0;

  return {
    newDifficulty,
    delta: round3(delta),
    sampleSize: unique.length,
    effectiveSamples: round3(nEff),
    confidence: round3(nEff / (nEff + n0)),
    bias: round3(bias),
    reason: bias > 0.05 ? 'too hard'
          : bias < -0.05 ? 'too easy'
          : 'well-calibrated',
  };
}

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }
