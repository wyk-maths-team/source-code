// tools/bj-answers.mjs —— 精确计算北京卷填空答案（保留 6 位小数）
const r = (x) => {
  const s = x.toFixed(6);
  return s;
};

const answers = {
  'CHSMLHBJ01': { expr: '0', val: 0 },
  'CHSMLHBJ02': { expr: '6√3+3', val: 6 * Math.sqrt(3) + 3 },
  'CHSMLHBJ03': { expr: '(6√46−√69)/69', val: (6 * Math.sqrt(46) - Math.sqrt(69)) / 69 },
  'CHSMLHBJ04': { expr: '√(9+6√3)', val: Math.sqrt(9 + 6 * Math.sqrt(3)) },
  'CHSMLHBJ05': { expr: '5/3', val: 5 / 3 },
  'CHSMLHBJ06': { expr: '63√7/25', val: 63 * Math.sqrt(7) / 25 },
  'CHSMLHBJ07': { expr: '2', val: 2 },
  'CHSMLHBJ08': { expr: '136800', val: 136800 },
  'CHSMLHBJ09': { expr: '3/4', val: 3 / 4 },
  'CHSMLHBJ10': { expr: '18', val: 18 },
  'CHSMLHBJ11': { expr: '−1/3', val: -1 / 3 },
};

for (const [id, a] of Object.entries(answers)) {
  console.log(`${id}  ${a.expr.padEnd(16)} = ${r(a.val)}   (raw ${a.val})`);
}

// 交叉验证几个关键值
console.log('\n--- 交叉验证 ---');
console.log('题3 用 r=3V/S 独立算:');
// V = √23/3, S = √3+6√2
const V = Math.sqrt(23) / 3;
const S = Math.sqrt(3) + 6 * Math.sqrt(2);
console.log('  3V/S =', (3 * V / S).toFixed(6));

console.log('题6 用仿射独立算:');
// 单位圆内接三角形，AB 过 (0, 2/5)，最大面积 S' = (1+d)√(1-d²) at d=2/5
const d = 2 / 5;
const Sp = (1 + d) * Math.sqrt(1 - d * d);
console.log('  3√3·S\' =', (3 * Math.sqrt(3) * Sp).toFixed(6));

console.log('题4 用多项式独立算:');
// 1 + 5√3? 检查 9+6√3 是否等于 (a+b√3)² 形式
const target = 9 + 6 * Math.sqrt(3);
console.log('  sqrt(target) =', Math.sqrt(target).toFixed(6));
console.log('  (1+3√3)² =', Math.pow(1 + 3 * Math.sqrt(3), 2).toFixed(6), '(不等于则无简单形式)');
