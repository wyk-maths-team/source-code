// 临时验证脚本（用后删除）
import { adjustDifficulty, PRToDifficulty } from './lib/difficulty-adjust.js';
import { difficultyToPR } from './lib/rating.js';

// 1. 逆映射往返测试
let ok = true;
for (let d = 1; d <= 10; d += 0.25) {
  const rt = PRToDifficulty(difficultyToPR(d));
  if (Math.abs(rt - d) > 0.02) {
    ok = false;
    console.log(`roundtrip FAIL d=${d} -> PR=${difficultyToPR(d)} -> ${rt}`);
  }
}
console.log('roundtrip:', ok ? 'PASS' : 'FAIL');

// 2. 方向测试：题比预期更难（学生普遍做不对）→ 难度应上升
const base = { rating: 2000, solvedCount: 20, firstAttemptCorrect: false };
// 当前难度 d=3 (PR=1400)，2000 rating 的学生"预期"应该做对 (P高)，但他错了 → 应调难
const harder = adjustDifficulty({ currentDifficulty: 3, attempts: [
  { username: 'a', ...base },
  { username: 'b', ...base },
  { username: 'c', ...base },
  { username: 'd', ...base },
  { username: 'e', ...base },
]});
console.log('harder case:', harder.newDifficulty, 'deltaPR=', harder.delta, 'reason=', harder.reason);
if (harder.newDifficulty <= 3) { console.log('DIRECTION FAIL: should increase'); ok = false; }

// 3. 方向测试：题比预期简单（低 rating 学生都能做对）→ 难度应下降
const easier = adjustDifficulty({ currentDifficulty: 6, attempts: [
  { username: 'a', rating: 1100, solvedCount: 3, firstAttemptCorrect: true },
  { username: 'b', rating: 1200, solvedCount: 4, firstAttemptCorrect: true },
  { username: 'c', rating: 1300, solvedCount: 5, firstAttemptCorrect: true },
  { username: 'd', rating: 1150, solvedCount: 6, firstAttemptCorrect: true },
  { username: 'e', rating: 1250, solvedCount: 7, firstAttemptCorrect: true },
]});
console.log('easier case:', easier.newDifficulty, 'deltaPR=', easier.delta, 'reason=', easier.reason);
if (easier.newDifficulty >= 6) { console.log('DIRECTION FAIL: should decrease'); ok = false; }

// 4. 样本不足 → 不动
const few = adjustDifficulty({ currentDifficulty: 5, attempts: [{ username: 'a', rating: 1800, solvedCount: 5, firstAttemptCorrect: false }]});
console.log('insufficient:', few.newDifficulty, 'delta=', few.delta, few.reason);

// 5. 先验作用：手动难度存在时，样本少会向先验靠拢
const prior = adjustDifficulty({ currentDifficulty: 5, manualDifficulty: 3, attempts: [
  { username: 'a', rating: 1500, solvedCount: 10, firstAttemptCorrect: true },
  { username: 'b', rating: 1600, solvedCount: 12, firstAttemptCorrect: true },
  { username: 'c', rating: 1400, solvedCount: 9, firstAttemptCorrect: true },
]});
console.log('prior pull toward 3:', prior.newDifficulty, 'delta=', prior.delta);

console.log(ok ? '\nALL PASS' : '\nSOME FAIL');
