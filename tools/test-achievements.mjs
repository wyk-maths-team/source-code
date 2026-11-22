// tools/test-achievements.mjs —— 成就系统 v4 的纯函数验证
//
// 覆盖：定义完整性、进度计算边界、奖励金额、以及「进度 100% 必然解锁」
// 这个不变量（进度和判定共用 progressOf，不能自相矛盾）。

import {
  ACHIEVEMENTS, ACHIEVEMENT_COUNT, RARITY,
  progressOf, rewardOf, publicDefinitions,
} from '../lib/achievements.js';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ''}`); }
}

console.log('=== 1. 定义完整性 ===');
{
  const ids = Object.keys(ACHIEVEMENTS);
  check('成就数量 = 37（删掉 curious/voyeur 后）', ids.length === 37, `got ${ids.length}`);
  check('ACHIEVEMENT_COUNT 一致', ACHIEVEMENT_COUNT === ids.length);

  const bad = [];
  for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
    if (!a.name) bad.push(`${id}: no name`);
    if (!a.desc) bad.push(`${id}: no desc`);
    if (!a.icon) bad.push(`${id}: no icon`);
    if (!a.rarity || !RARITY[a.rarity]) bad.push(`${id}: bad rarity`);
    // icon 必须是不带前缀的裸名
    if (a.icon && a.icon.startsWith('fa-solid ')) bad.push(`${id}: icon has prefix`);
  }
  check('所有字段齐全且 icon 无前缀', bad.length === 0, bad.slice(0, 3).join('; '));
  check('curious 已删除', !ACHIEVEMENTS['curious']);
  check('voyeur 不存在', !ACHIEVEMENTS['voyeur']);

  const withMetric = ids.filter(id => ACHIEVEMENTS[id].metric);
  const noMetric = ids.filter(id => !ACHIEVEMENTS[id].metric);
  console.log(`    有进度: ${withMetric.length}  无进度(事件触发): ${noMetric.length} → ${noMetric.join(', ')}`);
}

console.log('\n=== 2. 奖励金额 ===');
{
  check('common = 5000', RARITY.common.reward === 5000);
  check('legendary = 250000', RARITY.legendary.reward === 250000);
  check('rewardOf 未知 id 返回 0', rewardOf('nope') === 0);
  check('rewardOf solved-100 (rare) = 40000', rewardOf('solved-100') === 40000);

  const total = Object.keys(ACHIEVEMENTS).reduce((s, id) => s + rewardOf(id), 0);
  const themes = Math.floor(total / 300000);
  console.log(`    全解锁总额: ${total.toLocaleString()} token ≈ ${themes} 个主题（300k/个）`);
}

console.log('\n=== 3. 进度计算 ===');
{
  const stats = { solvedCount: 63, maxDifficulty: 5.4, firstTryCount: 12, streak: 5, todayAC: 3, todayTried: 4, allTried: 80, allSolved: 63, accuracy: 0.7875 };

  const p50 = progressOf(ACHIEVEMENTS['solved-50'], stats);
  check('solved-50: 63/50 → pct 封顶 1', p50.pct === 1 && p50.current === 63);

  const p100 = progressOf(ACHIEVEMENTS['solved-100'], stats);
  check('solved-100: 63/100 = 0.63', Math.abs(p100.pct - 0.63) < 1e-9, `got ${p100.pct}`);

  const p200 = progressOf(ACHIEVEMENTS['solved-200'], stats);
  check('solved-200: 63/200 ≈ 0.315', Math.abs(p200.pct - 0.315) < 1e-9);

  const hard5 = progressOf(ACHIEVEMENTS['hard-5'], stats);
  check('hard-5: maxDiff 5.4/5 → 1', hard5.pct === 1);

  const hard7 = progressOf(ACHIEVEMENTS['hard-7'], stats);
  check('hard-7: 5.4/7 ≈ 0.771', Math.abs(hard7.pct - 0.7714285714) < 1e-6);

  const acc = progressOf(ACHIEVEMENTS['accuracy-70'], stats);
  check('accuracy-70: 0.7875/0.70 → 1', acc.pct === 1);
  check('accuracy-70 门槛已过', acc.gated === false);

  const daily = progressOf(ACHIEVEMENTS['daily-10'], stats);
  check('daily-10: 3/10 = 0.3', Math.abs(daily.pct - 0.3) < 1e-9);

  const none = progressOf(ACHIEVEMENTS['night-owl'], stats);
  check('事件触发成就无进度', none === null);
}

console.log('\n=== 4. 门槛（accuracy 系列需要先尝试 20 题）===');
{
  const lowTried = { allTried: 8, allSolved: 8, accuracy: 1.0, solvedCount: 8 };
  const p = progressOf(ACHIEVEMENTS['accuracy-90'], lowTried);
  check('尝试不足时 gated = true', p.gated === true);
  check('显示的是门槛进度 8/20', p.current === 8 && p.target === 20);
  check('pct = 0.4 而不是 1', Math.abs(p.pct - 0.4) < 1e-9, `got ${p.pct}`);
  check('即使 accuracy 已达 1.0 也不能解锁', p.pct < 1);

  const ok = { allTried: 20, allSolved: 20, accuracy: 1.0, solvedCount: 20 };
  const p2 = progressOf(ACHIEVEMENTS['accuracy-90'], ok);
  check('尝试到 20 后 gate 解除', p2.gated === false && p2.pct === 1);
}

console.log('\n=== 5. 不变量：进度 100% ⟺ 判定解锁 ===');
{
  // 对每个有 metric 的成就，构造一个刚好达标的 stats，确认 pct >= 1
  const bad = [];
  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    if (!def.metric) continue;
    const stats = { allTried: 100, allSolved: 100, accuracy: 1.0 };
    stats[def.metric] = def.target;
    if (def.gate) stats[def.gate.metric] = def.gate.min;
    const p = progressOf(def, stats);
    if (!p || p.pct < 1) bad.push(`${id} pct=${p?.pct}`);
  }
  check('所有阈值成就达标即 100%', bad.length === 0, bad.slice(0, 3).join('; '));
}

console.log('\n=== 6. publicDefinitions 输出 ===');
{
  const defs = publicDefinitions();
  check('数量一致', Object.keys(defs).length === ACHIEVEMENT_COUNT);
  check('含 reward', defs['solved-100'].reward === 40000);
  check('含 hasProgress', defs['solved-100'].hasProgress === true);
  check('事件成就 hasProgress = false', defs['night-owl'].hasProgress === false);
  check('不泄露 metric/target 内部字段', defs['solved-100'].metric === undefined);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
