// api/pk.js
// PK 系统 —— 阶段 1：邀请 / 接受 / 拒绝 / 取消
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { auditLog } from '../lib/audit.js';
import crypto from 'crypto';

const INVITE_TTL_MS = 10 * 60 * 1000;   // 邀请有效期 10 分钟
// ⭐ PK 房间锁与冷却
const PK_LOCK_TTL_MS     = 4 * 60 * 1000;    // 4 分钟看题上限（题目锁，双方互斥）
const PK_TIMEOUT_LOCK_MS = 1 * 60 * 1000;    // ⭐ 超时后再锁 1 分钟（个人锁）
const PK_COOLDOWN_MS     = 10 * 60 * 1000;   // ⭐ WA 冷却 10 分钟（个人锁）

function getRoomLock(room, problemId) {
  const l = room.locks && room.locks[problemId];
  if (!l) return null;
  if (Date.now() - new Date(l.ts).getTime() > PK_LOCK_TTL_MS) return null;  // 过期
  return l;
}
// ⭐ 地图拓扑
const ADJACENCY = {
  1: [2, 6],
  2: [1, 3],
  3: [2, 4],
  4: [3, 5],
  5: [4, 6, 7, 8],
  6: [1, 5, 7, 8],
  7: [5, 6, 8, 9],
  8: [5, 6, 7, 9],
  9: [7, 8],
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ⭐ 从 problems 里随机挑一年，返回 9 区结构
async function setupRoomProblems(db) {
  const all = await db.collection('pkproblems')
    .find({ id: /^DP\d{4,}$/ })
    .project({ id: 1, _id: 0 })
    .toArray();

  if (all.length === 0) return null;

  const yearMap = {};
  for (const p of all) {
    const m = String(p.id).match(/^DP(\d{2})(\d+)$/);
    if (!m) continue;
    const year = m[1];
    const num  = parseInt(m[2], 10);
    if (!yearMap[year]) yearMap[year] = [];
    yearMap[year].push({ id: p.id, num });
  }

  const validYears = Object.entries(yearMap).filter(([, list]) => {
    const aPart = list.filter(p => p.num >= 1 && p.num <= 30);
    const bPart = list.filter(p => p.num >= 31 && p.num <= 45);
    return aPart.length >= 30 && bPart.length >= 15;
  });

  if (validYears.length === 0) return null;

  const [year, list] = validYears[Math.floor(Math.random() * validYears.length)];
  const aPool = list.filter(p => p.num >= 1 && p.num <= 30);
  const bPool = list.filter(p => p.num >= 31 && p.num <= 45);

  shuffle(aPool);
  shuffle(bPool);

  const regions = [];
  for (let i = 0; i < 6; i++) {
    regions.push({
      index: i + 1,
      part: 'A',
      problems: aPool.slice(i * 5, i * 5 + 5).map((p, slot) => ({
        slot, problemId: p.id, owner: null,
      })),
    });
  }
  for (let i = 0; i < 3; i++) {
    regions.push({
      index: 7 + i,
      part: 'B',
      problems: bPool.slice(i * 5, i * 5 + 5).map((p, slot) => ({
        slot, problemId: p.id, owner: null,
      })),
    });
  }

  return { year, regions };
}

function genId(prefix, len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return prefix + s;
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const action = req.query.action;
  const username = decoded.username;

  // ── 发起邀请 ──
  if (action === 'invite') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { to } = req.body || {};
    if (!to || to === username) {
      return res.status(400).json({ success: false, message: 'Invalid target' });
    }

    const target = await db.collection('users').findOne(
      { username: to }, { projection: { username: 1, banned: 1, role: 1, displayName: 1 } }
    );
    if (!target || target.banned) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (target.role === 'team') {
      return res.status(400).json({ success: false, message: 'Cannot invite team account' });
    }

    // 自己已有 pending 邀请
    const myPending = await db.collection('pk_invitations').findOne({
      status: 'pending',
      $or: [{ from: username }, { to: username }],
    });
    if (myPending) {
      return res.status(409).json({
        success: false,
        message: '你已经在等待另一个邀请',
        inviteId: myPending.id,
      });
    }

    // 对方已有 pending 邀请
    const theirPending = await db.collection('pk_invitations').findOne({
      status: 'pending',
      $or: [{ from: to }, { to }],
    });
    if (theirPending) {
      return res.status(409).json({
        success: false,
        message: '该用户正忙',
      });
    }

    const now = new Date();
    const invite = {
      id: genId('INV', 8),
      from: username,
      fromDisplay: decoded.displayName || username,
      to,
      toDisplay: target.displayName || to,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    };
    await db.collection('pk_invitations').insertOne(invite);

    return res.status(200).json({ success: true, invite });
  }

  // ── 查我的 pending ──
  if (action === 'pending') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // 清理过期
    await db.collection('pk_invitations').updateMany(
      { status: 'pending', expiresAt: { $lt: new Date() } },
      { $set: { status: 'expired' } }
    );

    const incoming = await db.collection('pk_invitations').findOne(
      { to: username, status: 'pending' },
      { sort: { createdAt: -1 } }
    );
    const outgoing = await db.collection('pk_invitations').findOne(
      { from: username, status: 'pending' },
      { sort: { createdAt: -1 } }
    );
    return res.status(200).json({ success: true, incoming, outgoing });
  }

  // ── 查单个邀请（用于发送方轮询） ──
  if (action === 'invite-status') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { inviteId } = req.query;
    if (!inviteId) return res.status(400).json({ success: false, message: 'Missing inviteId' });

    const invite = await db.collection('pk_invitations').findOne({ id: inviteId });
    if (!invite) return res.status(404).json({ success: false, message: 'Not found' });
    if (invite.from !== username && invite.to !== username) {
      return res.status(403).json({ success: false, message: 'Not yours' });
    }
    return res.status(200).json({ success: true, invite });
  }

  // ── 查房间信息 ──
  // ── 查房间信息（含观战） ──
  if (action === 'room-info') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { roomId } = req.query;
    if (!roomId) return res.status(400).json({ success: false, message: 'Missing roomId' });

    const room = await db.collection('pk_rooms').findOne({ id: roomId });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    const isHost  = room.host === username;
    const isGuest = room.guest === username;
    // ⭐ 观众：不是 host/guest，且明确请求观战
    const isSpectator = !isHost && !isGuest && req.query.spectate === '1';

    // if (!isHost && !isGuest && !isSpectator) {
    //   return res.status(403).json({ success: false, message: 'Not yours' });
    // }

    // ⭐ 观众视角：host 始终是红方，guest 始终是蓝方
    // ⭐ 观众看到的区域 = host 解锁区域 ∪ guest 解锁区域
    let myUnlocked;
    if (isSpectator) {
      const hostU  = (room.unlocked && room.unlocked[room.host])  || [1];
      const guestU = (room.unlocked && room.unlocked[room.guest]) || [1];
      myUnlocked = Array.from(new Set([...hostU, ...guestU]));
    } else {
      myUnlocked = (room.unlocked && room.unlocked[username]) || [1];
    }

    const regions = (room.regions || []).map(reg => {
      const counts = { [room.host]: 0, [room.guest]: 0, null: 0 };
      for (const p of reg.problems) {
        counts[p.owner === null ? null : p.owner] =
          (counts[p.owner === null ? null : p.owner] || 0) + 1;
      }

      const unlocked = myUnlocked.includes(reg.index);

      return {
        index: reg.index,
        part: reg.part,
        counts: {
          host: counts[room.host] || 0,
          guest: counts[room.guest] || 0,
          empty: counts.null || 0,
        },
        unlocked,
        problems: unlocked
          ? reg.problems.map(p => ({
              slot: p.slot,
              // ⭐ 观众只能看到已占领格子的 problemId
              problemId: p.problemId, 
              owner: p.owner || null,
            }))
          : reg.problems.map(p => ({
              slot: p.slot,
              problemId: null,
              owner: p.owner || null,
            })),
      };
    });

    return res.status(200).json({
      success: true,
      room: {
        id: room.id,
        status: room.status,
        // ⭐ 'host' | 'guest' | 'spectator'
        me: isSpectator ? 'spectator' : (isHost ? 'host' : 'guest'),
        createdAt: room.createdAt,
        year: room.year || null,
        host:  { username: room.host,  displayName: room.hostDisplay  || room.host  },
        guest: { username: room.guest, displayName: room.guestDisplay || room.guest },
        regions,
        adjacency: ADJACENCY,
      },
      serverNow: Date.now(),
    });
  }

  // ── 打开题目（建立临时锁） ──
  if (action === 'open') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { roomId, problemId } = req.body || {};
    if (!roomId || !problemId) {
      return res.status(400).json({ success: false, message: 'Missing roomId or problemId' });
    }

    const room = await db.collection('pk_rooms').findOne({ id: roomId });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    const isHost  = room.host === username;
    const isGuest = room.guest === username;
    if (!isHost && !isGuest) {
      return res.status(403).json({ success: false, message: 'Not yours' });
    }
    if (room.status !== 'playing') {
      return res.status(409).json({ success: false, message: 'Game not running' });
    }

    // 找该 problemId 属于哪个区
    let regIndex = null;
    let slot = null;
    for (const reg of room.regions) {
      const p = reg.problems.find(x => x.problemId === problemId);
      if (p) { regIndex = reg.index; slot = p.slot; break; }
    }
    if (regIndex === null) {
      return res.status(404).json({ success: false, message: 'Problem not in this room' });
    }

    // 检查该区是否已解锁
    const myUnlocked = (room.unlocked && room.unlocked[username]) || [1];
    if (!myUnlocked.includes(regIndex)) {
      return res.status(403).json({ success: false, message: 'Island locked' });
    }

    // 检查是否已被占
    const reg = room.regions[regIndex - 1];
    const target = reg.problems[slot];
    if (target.owner !== null) {
      return res.status(409).json({
        success: false,
        reason: 'already_owned',
        owner: target.owner,
        message: target.owner === username ? 'Already yours' : 'Opponent already claimed',
      });
    }

    // ═══════════════════════════════════════════════════════
    // ⭐ 1. 个人 WA 冷却（10 分钟）
    // ═══════════════════════════════════════════════════════
    const cd = (room.cooldown && room.cooldown[username]) || {};
    if (cd[problemId]) {
      const cdAge = Date.now() - new Date(cd[problemId]).getTime();
      if (cdAge < PK_COOLDOWN_MS) {
        const remain = Math.ceil((PK_COOLDOWN_MS - cdAge) / 1000);
        const mins = Math.ceil(remain / 60);
        return res.status(429).json({
          success: false,
          reason: 'cooldown',
          remainSec: remain,
          message: `Wrong answer penalty — locked for ${mins} min`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════
    // ⭐ 2. 个人 timeout 锁（1 分钟，只影响自己）
    // ═══════════════════════════════════════════════════════
    const tLocks = (room.timeoutLocks && room.timeoutLocks[username]) || {};
    if (tLocks[problemId]) {
      const tAge = Date.now() - new Date(tLocks[problemId]).getTime();
      if (tAge < PK_TIMEOUT_LOCK_MS) {
        const remain = Math.ceil((PK_TIMEOUT_LOCK_MS - tAge) / 1000);
        return res.status(429).json({
          success: false,
          reason: 'timeout_lock',
          remainSec: remain,
          message: `Released after timeout — locked ${remain}s`,
        });
      }
    }

    // ═══════════════════════════════════════════════════════
    // ⭐ 3. 题目锁（双方互斥，4 分钟看题上限）
    // ═══════════════════════════════════════════════════════
    const lock = room.locks && room.locks[problemId];
    if (lock && lock.ts) {
      const lockAge = Date.now() - new Date(lock.ts).getTime();

      if (lockAge < PK_LOCK_TTL_MS) {
        // 3a. 锁还在有效期内
        if (lock.username !== username) {
          return res.status(423).json({
            success: false,
            reason: 'locked_by_other',
            owner: lock.username,
            message: 'Opponent is viewing this problem',
          });
        }
        // 是自己的锁 → 允许，往下走续期
      } else {
        // 3b. 锁已超时 → 给超时者上「个人 timeout 锁」，并清掉题目锁
        const timeoutOwner = lock.username;
        const timeoutStartMs = new Date(lock.ts).getTime() + PK_LOCK_TTL_MS;

        await db.collection('pk_rooms').updateOne(
          { id: roomId },
          {
            $set:   { [`timeoutLocks.${timeoutOwner}.${problemId}`]: timeoutStartMs },
            $unset: { [`locks.${problemId}`]: '' },
          }
        );

        if (timeoutOwner === username) {
          // ⭐ 自己就是超时者 → 拒绝
          const remain = Math.max(1, Math.ceil((PK_TIMEOUT_LOCK_MS - (Date.now() - timeoutStartMs)) / 1000));
          return res.status(429).json({
            success: false,
            reason: 'timeout_lock',
            remainSec: remain,
            message: `Released after timeout — locked ${remain}s`,
          });
        }
        // ⭐ 对方超时 → 允许自己继续（题目锁已被 unset，下面会重新建立）
      }
    }

    // ═══════════════════════════════════════════════════════
    // 建立 / 续期题目锁
    // ═══════════════════════════════════════════════════════
    const nowIso = new Date().toISOString();
    await db.collection('pk_rooms').updateOne(
      { id: roomId },
      { $set: { [`locks.${problemId}`]: { username, ts: nowIso } } }
    );

    // 返回题目内容
    const problem = await db.collection('pkproblems').findOne(
      { id: problemId },
      { projection: { _id: 0, id: 1, statement: 1, choice: 1 } }   // 不给 ans
    );
    if (!problem) {
      return res.status(404).json({ success: false, message: 'Problem content not found' });
    }

    return res.status(200).json({
      success: true,
      problem,
      regIndex,
      slot,
      lockExpiresAt: Date.now() + PK_LOCK_TTL_MS,
    });
  }

  // ── 提交答案 ──
  if (action === 'submit') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { roomId, problemId, ans } = req.body || {};
    if (!roomId || !problemId || !ans) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const room = await db.collection('pk_rooms').findOne({ id: roomId });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });

    const isHost  = room.host === username;
    const isGuest = room.guest === username;
    if (!isHost && !isGuest) {
      return res.status(403).json({ success: false, message: 'Not yours' });
    }
    if (room.status !== 'playing') {
      return res.status(409).json({ success: false, message: 'Game not running' });
    }

    // 定位题目
    let regIndex = null, slot = null;
    for (const reg of room.regions) {
      const p = reg.problems.find(x => x.problemId === problemId);
      if (p) { regIndex = reg.index; slot = p.slot; break; }
    }
    if (regIndex === null) {
      return res.status(404).json({ success: false, message: 'Problem not in room' });
    }
    const reg = room.regions[regIndex - 1];
    if (reg.problems[slot].owner !== null) {
      return res.status(409).json({ success: false, message: 'Already claimed' });
    }

    // 校验锁
    const lock = getRoomLock(room, problemId);
    if (lock && lock.username !== username) {
      return res.status(423).json({ success: false, message: 'Locked by other' });
    }

    // 判题
    const pk = await db.collection('pkproblems').findOne({ id: problemId });
    if (!pk) return res.status(404).json({ success: false, message: 'Problem not found' });

    const userAns = String(ans).trim().toUpperCase();
    const isAC = userAns === String(pk.ans).trim().toUpperCase();
    const status = isAC ? 'AC' : 'WA';

    // 写 pksubmissions
    const subId = 'PKS' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    await db.collection('pksubmissions').insertOne({
      id: subId,
      username,
      problemId,
      roomId,
      ans: userAns,
      status,
      timestamp: new Date(),
    });

    const $unset = { [`locks.${problemId}`]: '' };
    const $set = {};
    const $inc = {};

    if (isAC) {
      // 标记 owner
      $set[`regions.${regIndex - 1}.problems.${slot}.owner`] = username;
      $inc[`acCount.${username}`] = 1;
      $set[`lastACAt.${username}`] = new Date();

      // 解锁新岛
      const myUnlocked = new Set((room.unlocked && room.unlocked[username]) || [1]);
      myUnlocked.add(regIndex);
      for (const n of (ADJACENCY[regIndex] || [])) myUnlocked.add(n);
      $set[`unlocked.${username}`] = [...myUnlocked];
    } else {
      // WA → 冷却自己 10 分钟
      $set[`cooldown.${username}.${problemId}`] = new Date();
    }

    const op = { $unset };
    if (Object.keys($set).length) op.$set = $set;
    if (Object.keys($inc).length) op.$inc = $inc;

    await db.collection('pk_rooms').updateOne({ id: roomId }, op);

    return res.status(200).json({
      success: true,
      status,
      correct: isAC,
      subId,
      cooldownSec: isAC ? 0 : Math.ceil(PK_COOLDOWN_MS / 1000),
    });
  }

  // ── 接受 ──
  if (action === 'accept') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { inviteId } = req.body || {};
    if (!inviteId) return res.status(400).json({ success: false, message: 'Missing inviteId' });

    const invite = await db.collection('pk_invitations').findOne({ id: inviteId });
    if (!invite) return res.status(404).json({ success: false, message: 'Invitation not found' });
    if (invite.to !== username) return res.status(403).json({ success: false, message: 'Not yours' });
    if (invite.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Already ${invite.status}` });
    }
    if (new Date(invite.expiresAt) < new Date()) {
      await db.collection('pk_invitations').updateOne(
        { id: inviteId }, { $set: { status: 'expired' } }
      );
      return res.status(410).json({ success: false, message: 'Expired' });
    }

    // 创建房间
    const roomId = genId('PK', 6);
    const now = new Date();
    const setup = await setupRoomProblems(db);
    if (!setup) {
      return res.status(500).json({
        success: false,
        message: 'No suitable DSE paper found (need a year with 30+15 problems)',
      });
    }

    await db.collection('pk_rooms').insertOne({
      id: roomId,
      host: invite.from,
      hostDisplay: invite.fromDisplay || invite.from,
      guest: invite.to,
      guestDisplay: decoded.displayName || invite.to,
      status: 'playing',
      createdAt: now,
      year: setup.year,
      regions: setup.regions,
      locks: {},           // 题目锁（双方互斥）
      cooldown: {},        // ⭐ 个人 WA 冷却（10 分钟）
      timeoutLocks: {},    // ⭐ 个人超时锁（1 分钟）
      unlocked: {
        [invite.from]: [1],
        [invite.to]: [1],
      },
      acCount: {
        [invite.from]: 0,
        [invite.to]: 0,
      },
      lastACAt: {
        [invite.from]: null,
        [invite.to]: null,
      },
    });

    await db.collection('pk_invitations').updateOne(
      { id: inviteId },
      { $set: { status: 'accepted', roomId, acceptedAt: now } }
    );

    await auditLog(db, 'pk_invite_accept', {
      inviteId, roomId, host: invite.from, guest: invite.to,
    }, username, 'info').catch(() => {});

    return res.status(200).json({ success: true, roomId });
  }

  // ── 拒绝 ──
  if (action === 'decline') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { inviteId } = req.body || {};
    if (!inviteId) return res.status(400).json({ success: false, message: 'Missing inviteId' });

    const invite = await db.collection('pk_invitations').findOne({ id: inviteId });
    if (!invite) return res.status(404).json({ success: false, message: 'Not found' });
    if (invite.to !== username) return res.status(403).json({ success: false, message: 'Not yours' });
    if (invite.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Already ${invite.status}` });
    }

    await db.collection('pk_invitations').updateOne(
      { id: inviteId },
      { $set: { status: 'declined', declinedAt: new Date() } }
    );
    return res.status(200).json({ success: true });
  }

  // ── 取消（发起方） ──
  if (action === 'cancel') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { inviteId } = req.body || {};
    if (!inviteId) return res.status(400).json({ success: false, message: 'Missing inviteId' });

    const invite = await db.collection('pk_invitations').findOne({ id: inviteId });
    if (!invite) return res.status(404).json({ success: false, message: 'Not found' });
    if (invite.from !== username) return res.status(403).json({ success: false, message: 'Not yours' });
    if (invite.status !== 'pending') {
      return res.status(409).json({ success: false, message: `Already ${invite.status}` });
    }

    await db.collection('pk_invitations').updateOne(
      { id: inviteId },
      { $set: { status: 'cancelled', cancelledAt: new Date() } }
    );
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}