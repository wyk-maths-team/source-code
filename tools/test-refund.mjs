// tools/test-refund.mjs —— 验证「下注/取消」不再把每日额度洗成永久额度
//
// 这里复制了 api/pk-bet.js 里的 deductTokens / refundTokens 逻辑（函数未导出），
// 只为验证算法本身：扣多少回多少、品类不串。

function deductTokens(tokenObj, amount) {
  const t = {
    daily: Number(tokenObj?.daily) || 0,
    global: Number(tokenObj?.global) || 0,
  };
  if (t.daily + t.global < amount) return null;
  const fromDaily = Math.min(t.daily, amount);
  const fromGlobal = amount - fromDaily;
  t.daily -= fromDaily;
  t.global -= fromGlobal;
  return { token: t, taken: { daily: fromDaily, global: fromGlobal } };
}

function refundTokens(tokenObj, taken) {
  const t = {
    daily: Number(tokenObj?.daily) || 0,
    global: Number(tokenObj?.global) || 0,
  };
  t.daily += Number(taken?.daily) || 0;
  t.global += Number(taken?.global) || 0;
  return t;
}

// 旧实现：退款一律进 global —— 这就是漏洞本身，用来做对照
function oldRefund(tokenObj, amount) {
  const t = { daily: Number(tokenObj?.daily) || 0, global: Number(tokenObj?.global) || 0 };
  t.global += amount;
  return t;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${detail || ''}`); }
}

console.log('=== 场景 1：下注全额来自 daily，取消后应完全复原 ===');
{
  const before = { daily: 30000, global: 100000 };
  const r = deductTokens(before, 30000);
  const after = refundTokens(r.token, r.taken);
  check('daily 复原', after.daily === 30000, `got ${after.daily}`);
  check('global 未变', after.global === 100000, `got ${after.global}`);
  check('总量复原', after.daily + after.global === before.daily + before.global);

  const bad = oldRefund(r.token, 30000);
  console.log(`    旧实现对比：取消后 daily=${bad.daily} global=${bad.global}`
    + ` → 凭空多出 ${bad.global - before.global} 永久 token`);
}

console.log('\n=== 场景 2：daily 不够，跨扣 global ===');
{
  const before = { daily: 5000, global: 100000 };
  const r = deductTokens(before, 30000);
  check('扣 daily 5000', r.taken.daily === 5000, `got ${r.taken.daily}`);
  check('扣 global 25000', r.taken.global === 25000, `got ${r.taken.global}`);
  const after = refundTokens(r.token, r.taken);
  check('daily 复原', after.daily === 5000, `got ${after.daily}`);
  check('global 复原', after.global === 100000, `got ${after.global}`);
}

console.log('\n=== 场景 3：余额不足应拒绝 ===');
{
  const r = deductTokens({ daily: 1000, global: 2000 }, 10000);
  check('返回 null', r === null);
}

console.log('\n=== 场景 4：老记录没有 taken，退款只补 daily ===');
{
  // 老邀请是用旧逻辑扣的，没有 taken 字段
  const invite = { stake: 20000 };
  const taken = invite.taken && typeof invite.taken === 'object'
    ? { daily: Number(invite.taken.daily) || 0, global: Number(invite.taken.global) || 0 }
    : { daily: Number(invite.stake) || 0, global: 0 };
  const after = refundTokens({ daily: 0, global: 130000 }, taken);
  check('退回 daily 20000', after.daily === 20000, `got ${after.daily}`);
  check('global 不再增加', after.global === 130000, `got ${after.global}`);
}

console.log('\n=== 场景 5：反复横跳 100 次，总量与构成都不漂移 ===');
{
  const before = { daily: 30000, global: 100000 };
  let cur = { ...before };
  for (let i = 0; i < 100; i++) {
    const r = deductTokens(cur, 30000);
    if (!r) { check(`第 ${i} 次扣费`, false, 'unexpected null'); break; }
    cur = refundTokens(r.token, r.taken);
  }
  check('daily 仍是 30000', cur.daily === 30000, `got ${cur.daily}`);
  check('global 仍是 100000', cur.global === 100000, `got ${cur.global}`);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
