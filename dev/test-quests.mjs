// temp/quests-test.mjs —— 用内存 mock 跑 lib/quests.js + lib/token.js 的核心判定
import assert from 'node:assert/strict';

import { ensureDailyReset } from '../lib/token.js';
import { invalidateProblemCache } from '../lib/problemCache.js';
import {
  computeQuests, invalidateQuestCache, submissionPassed,
  targetDifficultyFor, levelMultiplier, levelReward, hktToday,
} from '../lib/quests.js';

// ───────── 内存 DB ─────────
function setPath(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}
function unsetPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]];
    if (!cur || typeof cur !== 'object') return;
  }
  delete cur[parts[parts.length - 1]];
}
function getPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}
function matchOne(doc, filter = {}) {
  for (const [k, v] of Object.entries(filter)) {
    if (k === '$or') {
      if (!v.some((f) => matchOne(doc, f))) return false;
      continue;
    }
    const cur = getPath(doc, k);
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('$in' in v) { if (!v.$in.includes(cur)) return false; }
      else if ('$gte' in v) { if (!(cur != null && cur >= v.$gte)) return false; }
      else if ('$ne' in v) { if (cur === v.$ne) return false; }
      else if ('$lt' in v) { if (!(cur != null && cur < v.$lt)) return false; }
      else if ('$exists' in v) { if ((cur !== undefined) !== v.$exists) return false; }
      else return false;
    } else if (cur !== v) return false;
  }
  return true;
}
function applyUpdate(doc, update) {
  if (update.$set) for (const [p, v] of Object.entries(update.$set)) setPath(doc, p, v);
  if (update.$unset) for (const p of Object.keys(update.$unset)) unsetPath(doc, p);
  if (update.$inc) for (const [p, v] of Object.entries(update.$inc)) {
    setPath(doc, p, (Number(doc[p]) || 0) + v);
  }
  if (update.$push) for (const [p, v] of Object.entries(update.$push)) {
    const arr = Array.isArray(doc[p]) ? doc[p] : [];
    if (!arr.includes(v)) setPath(doc, p, [...arr, v]);
  }
  if (update.$addToSet) for (const [p, v] of Object.entries(update.$addToSet)) {
    const arr = Array.isArray(doc[p]) ? doc[p] : [];
    if (!arr.includes(v)) setPath(doc, p, [...arr, v]);
  }
}

function makeDb(collections) {
  return {
    collection(name) {
      const rows = collections[name] || (collections[name] = []);
      return {
        findOne: async (filter) => rows.find((r) => matchOne(r, filter)) || null,
        find: (filter = {}) => ({
          sort: () => ({ toArray: async () => rows.filter((r) => matchOne(r, filter)) }),
          toArray: async () => rows.filter((r) => matchOne(r, filter)),
        }),
        updateOne: async (filter, update) => {
          const row = rows.find((r) => matchOne(r, filter));
          if (!row) return { modifiedCount: 0 };
          applyUpdate(row, update);
          return { modifiedCount: 1 };
        },
        findOneAndUpdate: async (filter, update) => {
          const row = rows.find((r) => matchOne(r, filter));
          if (!row) return { value: null };
          applyUpdate(row, update);
          return { value: row };
        },
        // 只实现 computeQuests 用到的那两步：$match + $group _id
        aggregate: (pipeline = []) => ({
          toArray: async () => {
            let out = rows;
            for (const st of pipeline) {
              if (st.$match) out = out.filter((r) => matchOne(r, st.$match));
              if (st.$group && st.$group._id) {
                const field = String(st.$group._id).replace(/^\$/, '');
                const seen = new Set();
                const grouped = [];
                for (const r of out) {
                  const v = getPath(r, field);
                  if (seen.has(v)) continue;
                  seen.add(v);
                  grouped.push({ _id: v });
                }
                out = grouped;
              }
            }
            return out;
          },
        }),
      };
    },
  };
}

const YESTERDAY = new Date(Date.now() + 8 * 3600_000 - 86400_000).toISOString().slice(0, 10);
const SUB = (pid, correct, extra = {}) => ({
  username: 'alice', problemId: pid, correct,
  systemError: false, type: 'text', timestamp: new Date(),
  ...extra,
});

// ① 原 bug：昨晚领过，今天先做题（submit 触发 getTokenBalance 重置），
//    然后才打开 Token Hub —— 旧代码这里永远显示「已领取」。
async function testDayResetAfterSolving() {
  const db = makeDb({
    users: [{
      username: 'alice', displayName: 'Alice', streakDays: 0,
      token: {
        daily: 0, global: 120000, lastReset: YESTERDAY,
        dailyLoginClaimed: true, dailyQuestClaimed: true,
      },
    }],
    userstats: [{ username: 'alice', states: {} }],
    problems: [],
    submissions: [],
  });

  const before = await ensureDailyReset(db, 'alice');
  assert.equal(before.token.lastReset, hktToday(), 'lastReset 应刷新到今天');
  assert.equal(before.token.daily, 30000, 'daily 应补满');
  assert.equal(before.token.dailyLoginClaimed, false, '领取标记必须清掉');
  assert.equal(before.token.dailyQuestClaimed, false, '领取标记必须清掉');
  assert.equal(before.dailyQuests.date, hktToday());
  assert.deepEqual(before.dailyQuests.claimed, []);

  const again = await ensureDailyReset(db, 'alice');
  assert.equal(again.token.daily, 30000, '重复调用不能把 daily 再加一次');
  console.log('ok  - 跨天重置（先做题再开页面也能领）');
}

// ② token 已被别处重置成今天，但任务状态还停在昨天
async function testDailyQuestsStaleNextToFreshToken() {
  const db = makeDb({
    users: [{
      username: 'bob', token: { daily: 30000, global: 0, lastReset: hktToday() },
      dailyQuests: { date: YESTERDAY, claimed: ['login'], pid: 'OLD1' },
    }],
    userstats: [], problems: [], submissions: [],
  });

  const u = await ensureDailyReset(db, 'bob');
  assert.equal(u.dailyQuests.date, hktToday());
  assert.deepEqual(u.dailyQuests.claimed, []);
  assert.equal(u.dailyQuests.pid, undefined, '旧选题必须清掉');
  console.log('ok  - token 与 dailyQuests 不同步时也清干净');
}

// ③ 任务判定：5 次提交 / 一眼 AC / 突破 / 多面手（含图片 AC）
async function testQuestCompletion() {
  const db = makeDb({
    users: [{ username: 'carol', token: { daily: 30000, global: 0, lastReset: hktToday() }, streakDays: 9 }],
    userstats: [{
      username: 'carol',
      states: { P1: 'passed', P2: 'passed', P3: 'failed' },
    }],
    problems: [
      { id: 'P1', difficulty: 3, tags: ['Algebra'], public: true, name: 'P1' },
      { id: 'P2', difficulty: 4, tags: ['Geometry', 'Algebra'], public: true, name: 'P2' },
      { id: 'P3', difficulty: 5, tags: ['Number Theory'], public: true, name: 'P3' },
      { id: 'Q1', difficulty: 3, tags: ['Geometry'], public: true, name: 'Q1' },
      { id: 'Q2', difficulty: 6, tags: ['Combinatorics'], public: true, name: 'Q2' },
    ],
    submissions: [
      SUB('Q1', false, { username: 'carol' }),
      SUB('Q1', true, { username: 'carol' }),   // Q1 首次提交是错的 → 不算一眼 AC
      SUB('Q2', true, { username: 'carol' }),   // 首次提交就 AC，难度 6 > 历史最高 4
      SUB('P3', false, { username: 'carol', type: 'image', marked: false, score: 0 }),
      SUB('P3', true, { username: 'carol', type: 'image', marked: true, score: 100 }),
    ],
  });
  invalidateProblemCache();
  invalidateQuestCache('carol');

  const st = await computeQuests(db, 'carol', { rating: 1000, fresh: true });
  const byId = Object.fromEntries(st.quests.map((q) => [q.id, q]));

  assert.equal(st.stats.submitCount, 5, '5 次提交');
  assert.equal(st.stats.acCount, 3, 'AC 了 Q1 / Q2 / P3 三题');
  assert.equal(st.stats.maxBefore, 4, '历史最高 4（P2）');
  assert.equal(byId.practice.completed, true, '5 次提交 → 练手完成');
  assert.equal(byId.firstTry.completed, true, 'Q2 首提交 AC → 一眼 AC 完成');
  assert.equal(byId.breakthrough.completed, true, '难度 6 > 4 → 突破完成');
  assert.equal(byId.diverse.completed, true, '两个不同 tag → 多面手完成');
  assert.equal(byId.login.completed, true, '登入恒可领');
  assert.equal(byId.login.claimed, false);
  assert.equal(st.streak.days, 9);
  assert.equal(st.streak.milestones.find((m) => m.days === 7).reached, true);
  assert.equal(st.streak.milestones.find((m) => m.days === 14).reached, false);
  console.log('ok  - 任务判定（含 image 类型 AC、突破、多面手）');
}

// ④ 每日挑战选题稳定 + 落库
async function testDailyProblemStability() {
  const db = makeDb({
    users: [{ username: 'dave', dailyQuests: { date: hktToday(), claimed: [] } }],
    userstats: [{ username: 'dave', states: {} }],
    problems: [
      { id: 'A1', difficulty: 2, tags: [], public: true, name: 'A1' },
      { id: 'A2', difficulty: 2, tags: [], public: true, name: 'A2' },
      { id: 'A3', difficulty: 2, tags: [], public: true, name: 'A3' },
      { id: 'B1', difficulty: 5, tags: [], public: true, name: 'B1' },
    ],
    submissions: [],
  });
  invalidateProblemCache();
  invalidateQuestCache('dave');

  const first = await computeQuests(db, 'dave', { rating: 1000, fresh: true });
  assert.equal(first.dailyProblem.fallback, false);
  assert.ok(['A1', 'A2', 'A3'].includes(first.dailyProblem.id), '应挑目标难度那一档的题');
  const picked = first.dailyProblem.id;

  invalidateQuestCache('dave');
  const second = await computeQuests(db, 'dave', { rating: 1000, fresh: true });
  assert.equal(second.dailyProblem.id, picked, '刷新后题目必须固定');

  const row = await db.collection('users').findOne({ username: 'dave' });
  assert.equal(row.dailyQuests.pid, picked, '选题应落库固定');
  console.log('ok  - 每日挑战选题稳定并落库');
}

// ⑤ AC 之后题目不跳走，任务判定完成
async function testDailyProblemAfterAC() {
  const store = {
    users: [{ username: 'frank', dailyQuests: { date: hktToday(), claimed: [] } }],
    userstats: [{ username: 'frank', states: {} }],
    problems: [
      { id: 'A1', difficulty: 2, tags: [], public: true, name: 'A1' },
      { id: 'A2', difficulty: 2, tags: [], public: true, name: 'A2' },
      { id: 'A3', difficulty: 2, tags: [], public: true, name: 'A3' },
    ],
    submissions: [],
  };
  const db = makeDb(store);
  invalidateProblemCache();
  invalidateQuestCache('frank');

  const before = await computeQuests(db, 'frank', { rating: 1000, fresh: true });
  const picked = before.dailyProblem.id;

  store.userstats[0].states[picked] = 'passed';
  store.submissions.push({
    username: 'frank', problemId: picked, correct: true, systemError: false,
    type: 'text', timestamp: new Date(),
  });

  invalidateQuestCache('frank');
  const after = await computeQuests(db, 'frank', { rating: 1000, fresh: true });

  assert.equal(after.dailyProblem.id, picked, 'AC 之后题目不能变');
  assert.equal(after.quests.find((q) => q.id === 'daily').completed, true, '每日挑战应完成');
  console.log('ok  - AC 之后每日题不跳走，且任务判定完成');
}

// ⑥ 题库清完 → 退化模式（当天第一次就算不出题时）
async function testFallbackWhenEverythingSolved() {
  const store = {
    users: [{ username: 'gus', dailyQuests: { date: hktToday(), claimed: [] } }],
    userstats: [{ username: 'gus', states: { S1: 'passed' } }],
    problems: [{ id: 'S1', difficulty: 1, tags: [], public: true, name: 'S1' }],
    submissions: [],
  };
  const db = makeDb(store);
  invalidateProblemCache();
  invalidateQuestCache('gus');

  const st = await computeQuests(db, 'gus', { rating: 1000, fresh: true });
  assert.equal(st.dailyProblem.fallback, true, '题库清完了应进入退化模式');
  assert.equal(st.dailyProblem.id, null);
  assert.equal(st.quests.find((q) => q.id === 'daily').completed, false);

  // 退化模式下 AC 一道 ≥ 目标难度的题（这里只有 1 级题，不可能）——先确认不会误判
  store.submissions.push({ username: 'gus', problemId: 'S1', correct: true, systemError: false, type: 'text', timestamp: new Date() });
  invalidateQuestCache('gus');
  const st2 = await computeQuests(db, 'gus', { rating: 1000, fresh: true });
  assert.equal(st2.quests.find((q) => q.id === 'daily').completed, false, '难度不足目标不能算完成');
  console.log('ok  - 题库清完后的退化模式');
}

function testImageSubmissionOnly() {
  assert.equal(submissionPassed({ type: 'image', marked: true, score: 100 }), true);
  assert.equal(submissionPassed({ type: 'image', marked: true, score: 80 }), false);
  assert.equal(submissionPassed({ type: 'text', correct: true }), true);
  assert.equal(submissionPassed({ type: 'text', correct: true, systemError: true }), false);
  assert.equal(submissionPassed({ type: 'text', correct: false }), false);
  console.log('ok  - AC 口径（含图片作答 / 排除系统错误）');
}

function testDifficultyMapping() {
  assert.equal(targetDifficultyFor(1000), 2);
  assert.equal(targetDifficultyFor(1500), 3);
  assert.equal(targetDifficultyFor(2500), 7);
  assert.equal(targetDifficultyFor('abc'), 2);
  assert.equal(targetDifficultyFor(99999), 10);
  console.log('ok  - 难度映射');
}

// ⑦ Breakthrough: 复习旧题不算，做新题才算
async function testBreakthrough() {
  const dayMs = 86400_000;
  const yesterday = new Date(new Date(hktToday() + 'T00:00:00+08:00').getTime() - dayMs);
  const store = {
    users: [{ username: 'hal', dailyQuests: { date: hktToday(), claimed: [] } }],
    userstats: [{ username: 'hal', states: { H1: 'passed' } }],
    problems: [
      { id: 'H1', difficulty: 4, tags: [], public: true, name: 'H1' },
      { id: 'H2', difficulty: 5, tags: [], public: true, name: 'H2' },
    ],
    submissions: [
      { username: 'hal', problemId: 'H1', correct: true, systemError: false, type: 'text', timestamp: yesterday },
    ],
  };
  const db = makeDb(store);
  invalidateProblemCache();
  invalidateQuestCache('hal');

  store.submissions.push({ username: 'hal', problemId: 'H1', correct: true, systemError: false, type: 'text', timestamp: new Date() });
  invalidateQuestCache('hal');
  let st = await computeQuests(db, 'hal', { rating: 1000, fresh: true });
  assert.equal(st.quests.find((q) => q.id === 'breakthrough').completed, false, '复习旧题不算突破');

  store.submissions.push({ username: 'hal', problemId: 'H2', correct: true, systemError: false, type: 'text', timestamp: new Date() });
  invalidateQuestCache('hal');
  st = await computeQuests(db, 'hal', { rating: 1000, fresh: true });
  assert.equal(st.quests.find((q) => q.id === 'breakthrough').completed, true, '做够难度的新题算突破');
  console.log('ok  - 突破：复习不算、新题算');

  const store2 = {
    users: [{ username: 'ivy', dailyQuests: { date: hktToday(), claimed: [] } }],
    userstats: [{ username: 'ivy', states: {} }],
    problems: [
      { id: 'N1', difficulty: 2, tags: [], public: true, name: 'N1' },
      { id: 'N2', difficulty: 3, tags: [], public: true, name: 'N2' },
    ],
    submissions: [
      { username: 'ivy', problemId: 'N1', correct: true, systemError: false, type: 'text', timestamp: new Date() },
    ],
  };
  const db2 = makeDb(store2);
  invalidateProblemCache();
  invalidateQuestCache('ivy');
  const st2 = await computeQuests(db2, 'ivy', { rating: 1000, fresh: true });
  assert.equal(st2.quests.find((q) => q.id === 'breakthrough').completed, true, '新用户第一天也能完成突破');
  console.log('ok  - 突破：新用户第一天可达');
}

// ⑧ 等级加成
function testLevelBonus() {
  assert.equal(levelMultiplier(1000), 1.0);
  assert.equal(levelMultiplier(1250), 1.1);
  assert.equal(levelMultiplier(1500), 1.2);
  assert.equal(levelMultiplier(2000), 1.4);
  assert.equal(levelMultiplier(3000), 1.8);
  assert.equal(levelMultiplier(9999), 1.8);
  assert.equal(levelReward(30000, 1000), 30000);
  assert.equal(levelReward(30000, 1500), 36000);
  assert.equal(levelReward(5000, 1000), 5000);
  assert.equal(levelReward(5000, 1500), 6000);
  console.log('ok  - 等级加成（×1.0 ~ ×1.8）');
}

await testDayResetAfterSolving();
await testDailyQuestsStaleNextToFreshToken();
await testQuestCompletion();
await testDailyProblemStability();
await testDailyProblemAfterAC();
await testFallbackWhenEverythingSolved();
await testBreakthrough();
testImageSubmissionOnly();
testDifficultyMapping();
testLevelBonus();
console.log('\nALL PASS');