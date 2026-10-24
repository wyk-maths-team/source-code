// api/pk-bet.js
//
// PK 下注模式（3 题 / 30 分钟 / 奖池结算）
//
// 流程：
//   1. invite   — 发起方输入 stake（≥10000），立即从余额扣除，进入奖池
//   2. accept   — 接受方扣除 stake，抽 3 题，开赛，抽 20% 手续费
//   3. submit   — 交卷（每题可重复提交，只保留最后一次）
//   4. room     — 查房间（含剩余时间、双方已交卷情况）
//   5. settle   — 30 分钟到点后结算，写永久结果
//   6. result   — 读结算结果（永久页）
//
// 分数：每题 (1800 - T) * score，T 是该题最后一次提交距开赛的秒数（1..1800）
// 总分：三题之和
//
// 结算：奖池 = pool * 0.8
//   弱者得  prize * ratio_weak * F
//   强者得  prize * (1 - ratio_weak * F)
//   F 为弱者补助比例（≥1，且受 1/ratio_weak 上限约束，保证强者为正）

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import crypto from 'crypto';
import { wrapHandler } from '../lib/errors.js';

const MIN_STAKE = 10000;
const FEE_RATE = 0.2;                 // 手续费 20%
const DURATION_MS = 30 * 60 * 1000;   // 30 分钟
const DURATION_SEC = 1800;
const INVITE_TTL_MS = 10 * 60 * 1000; // 邀请 10 分钟过期
const PROBLEM_COUNT = 3;

function genId(prefix, len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return prefix + s;
}

function totalTokens(t) {
  if (!t) return 0;
  return (Number(t.daily) || 0) + (Number(t.global) || 0);
}

// 先扣每日额度，再扣永久额度。返回新的 token 对象；余额不足返回 null。
function deductTokens(tokenObj, amount) {
  const t = {
    daily: Number(tokenObj?.daily) || 0,
    global: Number(tokenObj?.global) || 0,
    lastReset: tokenObj?.lastReset,
    dailyLoginClaimed: tokenObj?.dailyLoginClaimed,
    dailyQuestClaimed: tokenObj?.dailyQuestClaimed,
  };
  if (t.daily + t.global < amount) return null;
  let left = amount;
  const fromDaily = Math.min(t.daily, left);
  t.daily -= fromDaily;
  left -= fromDaily;
  if (left > 0) {
    const fromGlobal = Math.min(t.global, left);
    t.global -= fromGlobal;
    left -= fromGlobal;
  }
  return left === 0 ? t : null;
}

// 奖励一律进 global（每日额度是「日活奖励」，不该被比赛加成放大）
function addTokens(tokenObj, amount) {
  const t = {
    daily: Number(tokenObj?.daily) || 0,
    global: Number(tokenObj?.global) || 0,
    lastReset: tokenObj?.lastReset,
    dailyLoginClaimed: tokenObj?.dailyLoginClaimed,
    dailyQuestClaimed: tokenObj?.dailyQuestClaimed,
  };
  t.global += Math.max(0, Math.round(amount));
  return t;
}

// 由 rating 推目标难度：沿用 token-hub 的映射，保持全站一把尺
function ratingToDifficulty(rating) {
  return Math.max(1, Math.min(10, Math.floor((rating - 1000) / 300) + 2));
}

async function computeRating(db, username) {
  const userstats = await db.collection('userstats').findOne({ username }, { projection: { states: 1 } });
  const states = userstats?.states || {};
  const solvedPids = Object.entries(states).filter(([, s]) => s === 'passed').map(([pid]) => pid);
  if (solvedPids.length === 0) return 1000;
  const probs = await db.collection('problems')
    .find({ id: { $in: solvedPids } }, { projection: { id: 1, difficulty: 1 } })
    .toArray();
  const diffMap = Object.fromEntries(probs.map(p => [p.id, p.difficulty]));
  const { calculateUserRating } = await import('../lib/rating.js');
  const diffs = solvedPids.map(pid => diffMap[pid]).filter(Number.isFinite);
  return calculateUserRating({ solvedDifficulties: diffs }).rating;
}

// 按目标难度在附近抽 3 道 public 题，尽量不重复
async function pickProblems(db, targetDiff) {
  const band = 1.2;
  const lo = Math.max(1, targetDiff - band);
  const hi = Math.min(10, targetDiff + band);

  let pool = await db.collection('problems').find(
    { public: true, difficulty: { $gte: lo, $lte: hi } },
    { projection: { id: 1, difficulty: 1, _id: 0 } }
  ).toArray();

  // 附近题目不够就逐步放宽
  if (pool.length < PROBLEM_COUNT) {
    pool = await db.collection('problems').find(
      { public: true, difficulty: { $gte: Math.max(1, lo - 1.5), $lte: Math.min(10, hi + 1.5) } },
      { projection: { id: 1, difficulty: 1, _id: 0 } }
    ).toArray();
  }
  if (pool.length < PROBLEM_COUNT) {
    pool = await db.collection('problems').find(
      { public: true },
      { projection: { id: 1, difficulty: 1, _id: 0 } }
    ).limit(500).toArray();
  }
  if (pool.length === 0) return null;

  // 打乱后按难度距离排序，取最接近目标的 3 道互不相同
  for (let i = pool.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  pool.sort((a, b) => Math.abs(a.difficulty - targetDiff) - Math.abs(b.difficulty - targetDiff));

  const picked = [];
  const used = new Set();
  for (const p of pool) {
    if (used.has(p.id)) continue;
    used.add(p.id);
    picked.push(p);
    if (picked.length === PROBLEM_COUNT) break;
  }
  return picked.length === PROBLEM_COUNT ? picked : null;
}

/**
 * 弱者补助比例 F。
 * 输入两人的 token 总额与弱者分数占比，输出 ≥1 的系数。
 * token 差距越大补助越高，但不会高到让强者为负。
 */
function subsidyFactor(strongTokens, weakTokens, ratioWeak) {
  const st = Math.max(0, Number(strongTokens) || 0);
  const wt = Math.max(0, Number(weakTokens) || 0);
  const denom = st + wt;
  const gap = denom > 0 ? (st - wt) / denom : 0;     // -1..1
  let F = 1 + 0.25 * Math.max(0, gap);               // 只补不罚，最多 +25%
  // 强者必须为正：ratioWeak * F 要显著小于 1
  if (ratioWeak > 0) {
    const cap = 0.99 / ratioWeak;
    if (F > cap) F = cap;
  }
  return Math.max(1, Math.min(1.5, F));
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const username = decoded.username;
  const action = req.query.action;

  // ── 发起下注邀请 ──
  if (action === 'invite') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { to, stake } = req.body || {};
    const amount = Math.round(Number(stake));
    if (!to || to === username) return res.status(400).json({ success: false, message: 'Invalid target' });
    if (!Number.isFinite(amount) || amount < MIN_STAKE) {
      return res.status(400).json({ success: false, message: `Minimum stake is ${MIN_STAKE}` });
    }

    const target = await db.collection('users').findOne(
      { username: to }, { projection: { username: 1, banned: 1, role: 1, displayName: 1 } }
    );
    if (!target || target.banned) return res.status(404).json({ success: false, message: 'User not found' });
    if (target.role === 'team') return res.status(400).json({ success: false, message: 'Cannot invite team account' });

    // 已有未过期邀请就拦住
    const now = new Date();
    const myPending = await db.collection('pk_bet_invitations').findOne({
      status: 'pending',
      expiresAt: { $gt: now },
      $or: [{ from: username }, { to: username }],
    });
    if (myPending) {
      return res.status(409).json({ success: false, message: 'You already have a pending PK invite', inviteId: myPending.id });
    }

    const me = await db.collection('users').findOne({ username }, { projection: { token: 1, displayName: 1 } });
    const have = totalTokens(me?.token);
    const after = deductTokens(me?.token, amount);
    if (!after) {
      return res.status(400).json({
        success: false,
        message: `Not enough tokens: you need ${amount.toLocaleString()} but have ${have.toLocaleString()}`,
        code: 'INSUFFICIENT_TOKENS',
        need: amount,
        have,
      });
    }
    await db.collection('users').updateOne({ username }, { $set: { token: after } });

    const invite = {
      id: genId('PKB'),
      from: username,
      fromDisplay: decoded.displayName || me.displayName || username,
      to,
      toDisplay: target.displayName || to,
      stake: amount,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    };
    await db.collection('pk_bet_invitations').insertOne(invite);

    await auditLog(db, 'pk_bet_invite', { inviteId: invite.id, to, stake: amount }, username, 'info').catch(() => {});
    return res.status(200).json({ success: true, invite });
  }

  // ── 接受邀请：扣费、抽题、开赛 ──
  if (action === 'accept') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { inviteId } = req.body || {};
    if (!inviteId) return res.status(400).json({ success: false, message: 'Missing inviteId' });

    const invite = await db.collection('pk_bet_invitations').findOne({ id: inviteId });
    if (!invite) return res.status(404).json({ success: false, message: 'Invitation not found' });
    if (invite.to !== username) return res.status(403).json({ success: false, message: 'Not yours' });
    if (invite.status !== 'pending') return res.status(409).json({ success: false, message: `Already ${invite.status}` });
    if (new Date(invite.expiresAt) < new Date()) {
      await refundInvite(db, invite, 'expired');
      return res.status(410).json({ success: false, message: 'Expired' });
    }

    const me = await db.collection('users').findOne({ username }, { projection: { token: 1, displayName: 1 } });
    const myTokens = totalTokens(me?.token);
    if (myTokens < invite.stake) {
      return res.status(400).json({
        success: false,
        message: `Not enough tokens to match this stake: need ${invite.stake.toLocaleString()}, you have ${myTokens.toLocaleString()}`,
        code: 'INSUFFICIENT_TOKENS',
        need: invite.stake,
        have: myTokens,
      });
    }
    const after = deductTokens(me?.token, invite.stake);
    if (!after) {
      return res.status(400).json({
        success: false,
        message: `Not enough tokens to match this stake: need ${invite.stake.toLocaleString()}, you have ${myTokens.toLocaleString()}`,
        code: 'INSUFFICIENT_TOKENS',
        need: invite.stake,
        have: myTokens,
      });
    }

    // 双方 rating → 平均难度
    const [rA, rB] = await Promise.all([
      computeRating(db, invite.from),
      computeRating(db, username),
    ]);
    const targetDiff = ratingToDifficulty((rA + rB) / 2);
    const picked = await pickProblems(db, targetDiff);
    if (!picked) {
      return res.status(500).json({ success: false, message: 'No public problems available' });
    }

    await db.collection('users').updateOne({ username }, { $set: { token: after } });

    const now = new Date();
    const pool = invite.stake * 2;
    const fee = Math.floor(pool * FEE_RATE);
    const roomId = genId('PKB');

    await db.collection('pk_bet_rooms').insertOne({
      id: roomId,
      players: [
        { username: invite.from, displayName: invite.fromDisplay, rating: rA, stake: invite.stake },
        { username, displayName: decoded.displayName || me.displayName || username, rating: rB, stake: invite.stake },
      ],
      pool,
      fee,
      prize: pool - fee,
      problemIds: picked.map(p => p.id),
      problemDifficulties: picked.map(p => p.difficulty),
      targetDifficulty: targetDiff,
      startAt: now,
      endAt: new Date(now.getTime() + DURATION_MS),
      status: 'active',
      createdAt: now,
    });

    await db.collection('pk_bet_invitations').updateOne(
      { id: inviteId },
      { $set: { status: 'accepted', roomId, acceptedAt: now } }
    );

    await auditLog(db, 'pk_bet_accept', { inviteId, roomId, pool, fee }, username, 'info').catch(() => {});
    return res.status(200).json({ success: true, roomId });
  }

  // ── 交卷 ──
  // 前端传 answer，由后端判分（0 或 100），避免用户自己填分数。
  // 每题可重复提交，只保留最后一次。
  if (action === 'submit') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { roomId, problemId, answer } = req.body || {};
    if (!roomId || !problemId) return res.status(400).json({ success: false, message: 'Missing roomId or problemId' });
    if (answer === undefined || answer === null || String(answer).trim() === '') {
      return res.status(400).json({ success: false, message: 'Empty answer' });
    }

    const room = await db.collection('pk_bet_rooms').findOne({ id: roomId });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    if (!room.players.some(p => p.username === username)) {
      return res.status(403).json({ success: false, message: 'Not a player' });
    }
    if (room.status !== 'active') return res.status(409).json({ success: false, message: 'Room closed' });
    if (!room.problemIds.includes(problemId)) {
      return res.status(400).json({ success: false, message: 'Not in this room' });
    }

    const now = new Date();
    if (now > new Date(room.endAt)) {
      return res.status(410).json({ success: false, message: 'Time is up' });
    }

    // 判分：只做数值比对（PK 题库都是可数值化的题）
    const problem = await db.collection('problems').findOne(
      { id: problemId }, { projection: { ans: 1, _id: 0 } }
    );
    if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

    const refAns = Number(problem.ans);
    const userAns = Number(String(answer).trim());
    const correct = Number.isFinite(refAns) && Number.isFinite(userAns) && Math.abs(userAns - refAns) < 1e-6;
    const sc = correct ? 100 : 0;

    // 开赛瞬间记 0，第一秒是 1
    let timeSec = Math.floor((now - new Date(room.startAt)) / 1000) + 1;
    timeSec = Math.max(1, Math.min(DURATION_SEC, timeSec));

    const weighted = Math.round((DURATION_SEC - timeSec) * sc);

    await db.collection('pk_bet_attempts').updateOne(
      { roomId, username, problemId },
      {
        $set: {
          roomId, username, problemId,
          score: sc,
          timeSec,
          submittedAt: now,
          weighted,
        },
      },
      { upsert: true }
    );

    return res.status(200).json({ success: true, correct, timeSec, score: sc, weighted });
  }

  // ── 房间状态（含是否该结算） ──
  if (action === 'room') {
    const roomId = req.query.roomId;
    if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });
    const room = await db.collection('pk_bet_rooms').findOne({ id: roomId });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    if (!room.players.some(p => p.username === username)) {
      return res.status(403).json({ success: false, message: 'Not a player' });
    }

    // 到点自动结算一次
    if (room.status === 'active' && new Date() > new Date(room.endAt)) {
      const settled = await settleRoom(db, room);
      return res.status(200).json({ success: true, room: settled.room, result: settled.result, you: username });
    }

    const attempts = await db.collection('pk_bet_attempts')
      .find({ roomId }, { projection: { _id: 0 } }).toArray();

    // 题面随房间一起下发；ans 绝不下发，否则前端能直接看到答案
    const probs = await db.collection('problems').find(
      { id: { $in: room.problemIds } },
      { projection: { id: 1, statement: 1, difficulty: 1, _id: 0 } }
    ).toArray();
    const probMap = Object.fromEntries(probs.map(p => [p.id, p]));
    const problems = room.problemIds.map(id => probMap[id] || { id, statement: '(missing)', difficulty: null });

    return res.status(200).json({
      success: true,
      room: publicRoom(room),
      problems,
      attempts,
      you: username,
      serverNow: new Date().toISOString(),
    });
  }

  // ── 读取结算结果（永久） ──
  if (action === 'result') {
    const resultId = req.query.resultId || req.query.roomId;
    if (!resultId) return res.status(400).json({ success: false, message: 'Missing resultId' });
    const result = await db.collection('pk_bet_results').findOne(
      { $or: [{ id: String(resultId) }, { roomId: String(resultId) }] },
      { projection: { _id: 0 } }
    );
    if (!result) return res.status(404).json({ success: false, message: 'Result not found' });
    return res.status(200).json({ success: true, result });
  }

  // ── 主动结算（通常由 room 自动触发） ──
  if (action === 'settle') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { roomId } = req.body || {};
    if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });
    const room = await db.collection('pk_bet_rooms').findOne({ id: roomId });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    if (!room.players.some(p => p.username === username)) {
      return res.status(403).json({ success: false, message: 'Not a player' });
    }
    if (room.status !== 'active') {
      const existing = await db.collection('pk_bet_results').findOne({ roomId }, { projection: { _id: 0 } });
      return res.status(200).json({ success: true, result: existing });
    }
    if (new Date() < new Date(room.endAt)) {
      return res.status(409).json({ success: false, message: 'Contest still running' });
    }
    const settled = await settleRoom(db, room);
    return res.status(200).json({ success: true, result: settled.result });
  }

  // ── 取消邀请（未接受） ──
  if (action === 'cancel') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { inviteId } = req.body || {};
    const invite = await db.collection('pk_bet_invitations').findOne({ id: inviteId });
    if (!invite) return res.status(404).json({ success: false, message: 'Not found' });
    if (invite.from !== username) return res.status(403).json({ success: false, message: 'Not yours' });
    if (invite.status !== 'pending') return res.status(409).json({ success: false, message: `Already ${invite.status}` });
    await refundInvite(db, invite, 'cancelled');
    return res.status(200).json({ success: true });
  }

  // ── 拒绝（退款给发起方） ──
  if (action === 'decline') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { inviteId } = req.body || {};
    const invite = await db.collection('pk_bet_invitations').findOne({ id: inviteId });
    if (!invite) return res.status(404).json({ success: false, message: 'Not found' });
    if (invite.to !== username) return res.status(403).json({ success: false, message: 'Not yours' });
    if (invite.status !== 'pending') return res.status(409).json({ success: false, message: `Already ${invite.status}` });
    await refundInvite(db, invite, 'declined');
    return res.status(200).json({ success: true });
  }

  // ── 查单个邀请（分享链接落地页用） ──
  if (action === 'invite-status') {
    const inviteId = req.query.inviteId;
    if (!inviteId) return res.status(400).json({ success: false, message: 'Missing inviteId', code: 'MISSING_PARAM' });
    const invite = await db.collection('pk_bet_invitations').findOne(
      { id: String(inviteId) }, { projection: { _id: 0 } }
    );
    if (!invite) {
      return res.status(404).json({ success: false, message: 'Invitation not found', code: 'INVITE_NOT_FOUND' });
    }
    if (invite.from !== username && invite.to !== username) {
      return res.status(403).json({ success: false, message: 'This invitation is not yours', code: 'NOT_PARTICIPANT' });
    }
    return res.status(200).json({ success: true, invite });
  }

  // ── 我发出的全部挑战（含历史） ──
  if (action === 'outgoing') {
    const now = new Date();
    // 先把过期但仍 pending 的落定
    await db.collection('pk_bet_invitations').updateMany(
      { status: 'pending', expiresAt: { $lt: now } },
      { $set: { status: 'expired' } }
    );

    const invites = await db.collection('pk_bet_invitations')
      .find({ from: username }, { sort: { createdAt: -1 }, limit: 100, projection: { _id: 0 } })
      .toArray();

    // 每个邀请带上房间/结果 id，方便前端直接跳
    const roomIds = invites.filter(i => i.roomId).map(i => i.roomId);
    let roomMap = {};
    if (roomIds.length) {
      const rooms = await db.collection('pk_bet_rooms')
        .find({ id: { $in: roomIds } }, { projection: { id: 1, resultId: 1, status: 1, _id: 0 } })
        .toArray();
      roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));
    }

    const items = invites.map(i => {
      const room = i.roomId ? roomMap[i.roomId] : null;
      return {
        id: i.id,
        to: i.to,
        toDisplay: i.toDisplay,
        stake: i.stake,
        status: i.status,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        roomId: i.roomId || null,
        resultId: room ? room.resultId || null : null,
        canCancel: i.status === 'pending' && new Date(i.expiresAt) > now,
      };
    });

    return res.status(200).json({ success: true, invites: items, serverNow: now.toISOString() });
  }

  // ── 待处理的邀请（给全局通知用） ──
  if (action === 'pending') {
    const now = new Date();
    await db.collection('pk_bet_invitations').updateMany(
      { status: 'pending', expiresAt: { $lt: now } },
      { $set: { status: 'expired' } }
    );
    const incoming = await db.collection('pk_bet_invitations').findOne(
      { to: username, status: 'pending', expiresAt: { $gt: now } },
      { sort: { createdAt: -1 }, projection: { _id: 0 } }
    );
    const outgoing = await db.collection('pk_bet_invitations').findOne(
      { from: username, status: 'pending', expiresAt: { $gt: now } },
      { sort: { createdAt: -1 }, projection: { _id: 0 } }
    );
    return res.status(200).json({ success: true, incoming: incoming || null, outgoing: outgoing || null });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

// 把未接受的邀请退款给发起方，并把状态落定
async function refundInvite(db, invite, status) {
  const r = await db.collection('pk_bet_invitations').updateOne(
    { id: invite.id, status: 'pending' },
    { $set: { status, [status + 'At']: new Date() } }
  );
  if (r.modifiedCount !== 1) return;   // 已被别人处理，避免双退
  const user = await db.collection('users').findOne({ username: invite.from }, { projection: { token: 1 } });
  const restored = addTokens(user?.token, invite.stake);
  await db.collection('users').updateOne({ username: invite.from }, { $set: { token: restored } });
}

function publicRoom(room) {
  return {
    id: room.id,
    players: room.players.map(p => ({ username: p.username, displayName: p.displayName, rating: p.rating, stake: p.stake })),
    pool: room.pool,
    fee: room.fee,
    prize: room.prize,
    problemIds: room.problemIds,
    problemDifficulties: room.problemDifficulties,
    targetDifficulty: room.targetDifficulty,
    startAt: room.startAt,
    endAt: room.endAt,
    status: room.status,
  };
}

// 结算：算分、算奖、发币、写永久结果
async function settleRoom(db, room) {
  // 幂等：先抢占 status
  const claim = await db.collection('pk_bet_rooms').updateOne(
    { id: room.id, status: 'active' },
    { $set: { status: 'settling' } }
  );
  if (claim.modifiedCount !== 1) {
    const existing = await db.collection('pk_bet_results').findOne({ roomId: room.id }, { projection: { _id: 0 } });
    return { room: room, result: existing };
  }

  const attempts = await db.collection('pk_bet_attempts').find({ roomId: room.id }).toArray();
  const [pA, pB] = room.players;

  function scoreOf(u) {
    const mine = attempts.filter(a => a.username === u);
    const total = mine.reduce((s, a) => s + (Number(a.weighted) || 0), 0);
    return { total, per: mine };
  }

  const sA = scoreOf(pA.username);
  const sB = scoreOf(pB.username);
  const grand = sA.total + sB.total;

  // 分数占比；两人都 0 分则平分
  let ratioA, ratioB;
  if (grand > 0) {
    ratioA = sA.total / grand;
    ratioB = sB.total / grand;
  } else {
    ratioA = ratioB = 0.5;
  }

  // 定强弱：分数高者为强（平分时以 rating 高者为强，仍平分）
  let weakIdx, strongIdx;
  if (sA.total === sB.total) {
    weakIdx = pA.rating <= pB.rating ? 0 : 1;
    strongIdx = 1 - weakIdx;
  } else {
    weakIdx = sA.total < sB.total ? 0 : 1;
    strongIdx = 1 - weakIdx;
  }

  const weakP = room.players[weakIdx];
  const strongP = room.players[strongIdx];
  const ratioWeak = weakIdx === 0 ? ratioA : ratioB;

  // token 余额（当前值，用于补助计算）
  const users = await db.collection('users')
    .find({ username: { $in: [weakP.username, strongP.username] } })
    .project({ username: 1, token: 1 }).toArray();
  const tokMap = Object.fromEntries(users.map(u => [u.username, totalTokens(u.token)]));
  const weakTokens = tokMap[weakP.username] || 0;
  const strongTokens = tokMap[strongP.username] || 0;

  const F = subsidyFactor(strongTokens, weakTokens, ratioWeak);
  const prize = room.prize;

  let weakPrize = prize * ratioWeak * F;
  let strongPrize = prize - weakPrize;

  // 保险：强者不得为负；若出现极值则退回按比例分配
  if (strongPrize < 0) {
    weakPrize = prize * ratioWeak;
    strongPrize = prize - weakPrize;
  }
  weakPrize = Math.round(weakPrize);
  strongPrize = Math.round(strongPrize);
  // 舍入修正，保证两人加起来正好等于 prize
  const diff = prize - (weakPrize + strongPrize);
  strongPrize += diff;

  // 发奖
  for (const [p, amount] of [[weakP, weakPrize], [strongP, strongPrize]]) {
    const u = await db.collection('users').findOne({ username: p.username }, { projection: { token: 1 } });
    await db.collection('users').updateOne(
      { username: p.username },
      { $set: { token: addTokens(u?.token, amount) } }
    );
  }

  const result = {
    id: genId('PKR'),
    roomId: room.id,
    problemIds: room.problemIds,
    problemDifficulties: room.problemDifficulties,
    targetDifficulty: room.targetDifficulty,
    startAt: room.startAt,
    endAt: room.endAt,
    pool: room.pool,
    fee: room.fee,
    prize: prize,
    subsidyFactor: Number(F.toFixed(4)),
    ratioWeak: Number(ratioWeak.toFixed(6)),
    players: [
      {
        username: pA.username, displayName: pA.displayName, rating: pA.rating, stake: pA.stake,
        totalScore: sA.total,
        attempts: sA.per.map(a => ({ problemId: a.problemId, score: a.score, timeSec: a.timeSec, weighted: a.weighted })),
        prize: pA.username === weakP.username ? weakPrize : strongPrize,
        role: pA.username === weakP.username ? 'weak' : 'strong',
        winner: pA.username === strongP.username && sA.total !== sB.total,
      },
      {
        username: pB.username, displayName: pB.displayName, rating: pB.rating, stake: pB.stake,
        totalScore: sB.total,
        attempts: sB.per.map(a => ({ problemId: a.problemId, score: a.score, timeSec: a.timeSec, weighted: a.weighted })),
        prize: pB.username === weakP.username ? weakPrize : strongPrize,
        role: pB.username === weakP.username ? 'weak' : 'strong',
        winner: pB.username === strongP.username && sA.total !== sB.total,
      },
    ],
    createdAt: new Date(),
  };

  await db.collection('pk_bet_results').insertOne(result);
  await db.collection('pk_bet_rooms').updateOne(
    { id: room.id },
    { $set: { status: 'settled', settledAt: new Date(), resultId: result.id } }
  );

  await auditLog(db, 'pk_bet_settle', {
    roomId: room.id, resultId: result.id, prize,
    weak: weakP.username, weakPrize, strong: strongP.username, strongPrize,
  }, 'system', 'info').catch(() => {});

  return { room: { ...room, status: 'settled', resultId: result.id }, result };
}

export default wrapHandler(handler);
