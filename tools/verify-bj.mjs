// tools/verify-bj.mjs —— 数值核验北京卷第 9、10 题的答案
import { createHash } from 'node:crypto';

// ── 题 10：a1=1, a2=2, a(n+2)=a(n+1)+1/a(n)^2，求 [a_2026] ──
{
  let a1 = 1, a2 = 2;
  const N = 2026;
  // 用数组保存，需要 a_n 来算 a_{n+2}
  const a = [0, a1, a2];
  for (let n = 1; ; n++) {
    if (n + 2 > N) break;
    const nxt = a[n + 1] + 1 / (a[n] * a[n]);
    a[n + 2] = nxt;
  }
  const v = a[N];
  console.log(`题10: a_2026 = ${v.toFixed(6)}   floor = ${Math.floor(v)}`);
  // 渐进对照 (3n-2)^(1/3)
  console.log(`      渐进估计 (3*2026-2)^(1/3) = ${Math.cbrt(3 * 2026 - 2).toFixed(6)}`);
}

// ── 题 9：Σ a_i/(1+4a_{i+1}^2) 的最小值，n=2026, Σa_i=1, a_i≥0 ──
// 目标函数
function f9(a) {
  const n = a.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const nxt = a[(i + 1) % n];
    s += a[i] / (1 + 4 * nxt * nxt);
  }
  return s;
}

{
  const n = 2026;

  // 候选1：均匀
  const uni = new Array(n).fill(1 / n);
  console.log(`\n题9: 均匀分布 -> ${f9(uni).toFixed(9)}`);

  // 候选2：前两个 1/2
  const two = new Array(n).fill(0); two[0] = 0.5; two[1] = 0.5;
  console.log(`     两项 1/2 -> ${f9(two).toFixed(9)}`);

  // 候选3：三项 1/3
  const three = new Array(n).fill(0);
  three[0] = 1 / 3; three[1] = 1 / 3; three[2] = 1 / 3;
  console.log(`     三项 1/3 -> ${f9(three).toFixed(9)}`);

  // 网格搜索：非零项只放在开头 k 个，k=1..8，均匀
  for (let k = 1; k <= 8; k++) {
    const v = new Array(n).fill(0);
    for (let i = 0; i < k; i++) v[i] = 1 / k;
    console.log(`     k=${k} 均匀 -> ${f9(v).toFixed(9)}`);
  }

  // 随机搜索：dense 在开头 m 项上做随机 Dirichlet-ish
  let best = Infinity, bestA = null;
  for (const m of [2, 3, 4, 5]) {
    for (let iter = 0; iter < 200000; iter++) {
      // 随机生成 m 个非负数，归一化
      let w = [];
      let sum = 0;
      for (let i = 0; i < m; i++) { const x = Math.pow(Math.random(), 3); w.push(x); sum += x; }
      const a = new Array(n).fill(0);
      for (let i = 0; i < m; i++) a[i] = w[i] / sum;
      const val = f9(a);
      if (val < best) { best = val; bestA = a.slice(0, m); }
    }
  }
  console.log(`\n     随机搜索(m=2..5, 80万次) 最小 -> ${best.toFixed(9)}`);
  console.log(`     对应前几项: ${bestA.map(x => x.toFixed(4)).join(', ')}`);
  console.log(`     3/4 = ${(0.75).toFixed(9)}`);
}
