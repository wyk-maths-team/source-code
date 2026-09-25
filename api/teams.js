// api/teams.js
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';

function genInviteCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function getNextTeamId(db) {
  const meta = await db.collection('metadata').findOne({ _key: 'teamCounter' });
  if (!meta) {
    await db.collection('metadata').insertOne({ _key: 'teamCounter', value: 0 });
    return 1;
  }
  const next = (meta.value || 0) + 1;
  await db.collection('metadata').updateOne(
    { _key: 'teamCounter' },
    { $set: { value: next } }
  );
  return next;
}

async function getContest(db, contestId) {
  return db.collection('contests').findOne({ id: Number(contestId) });
}

function isContestStarted(contest, now = new Date()) {
  const start = new Date(contest.startTime);
  if (isNaN(start.getTime())) return false;
  return now >= start;
}

function isContestEnded(contest, now = new Date()) {
  const start = new Date(contest.startTime);
  if (isNaN(start.getTime())) return false;
  const end = new Date(start.getTime() + (Number(contest.duration) || 0) * 60000);
  return now > end;
}

// 找到用户在某 contest 中的队伍（含 formerMembers）
async function findTeamByUser(db, contestId, username) {
  return db.collection('teams').findOne({
    contestId: Number(contestId),
    $or: [{ members: username }, { formerMembers: username }]
  });
}

async function findActiveTeamForUser(db, username, now = new Date()) {
  // 找所有进行中的 special contests
  const specials = await db.collection('contests').find({ special: true }).toArray();
  for (const c of specials) {
    if (!isContestStarted(c, now) || isContestEnded(c, now)) continue;
    const t = await db.collection('teams').findOne({
      contestId: c.id,
      members: username
    });
    if (t) return { team: t, contest: c };
  }
  return null;
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const action = req.query.action || 'list';
  const username = decoded.username;
  const isAdmin = decoded.role === 'admin' || decoded.role === 'root';

  // ═══════════ LIST（公开）═══════════
  if (action === 'list') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId } = req.query;
    if (!contestId) return res.status(400).json({ success: false, message: 'Missing contestId' });

    const teams = await db.collection('teams')
      .find({ contestId: Number(contestId) }, {
        projection: { _id: 0, id: 1, name: 1, captain: 1, members: 1, locked: 1 }
      })
      .sort({ id: 1 })
      .toArray();

    return res.status(200).json({ success: true, teams });
  }

  // ═══════════ GET 单队（公开）═══════════
  if (action === 'get') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    const team = await db.collection('teams').findOne({ id: Number(id) });
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });

    const contest = await db.collection('contests').findOne(
      { id: team.contestId },
      { projection: { id: 1, name: 1, startTime: 1, duration: 1, special: 1, _id: 0 } }
    );

    // 提交记录（team username = String(id)）
    const teamUsername = String(team.id);
    const submissions = await db.collection('submissions')
      .find({ username: teamUsername, contestId: team.contestId }, {
        projection: { _id: 0, subid: 1, problemId: 1, score: 1, correct: 1, systemError: 1,
                      timestamp: 1, submittedBy: 1, approvedBy: 1, type: 1, marked: 1 }
      })
      .sort({ timestamp: 1 })
      .toArray();

    // contest_results 拿 locked
    const results = await db.collection('contest_results')
      .find({ contestId: team.contestId, username: teamUsername },
            { projection: { problemId: 1, score: 1, locked: 1, lastSubmissionTime: 1, _id: 0 } })
      .toArray();
    const resultMap = {};
    for (const r of results) resultMap[r.problemId] = r;

    const enrichedSubs = submissions.map(s => ({
      ...s,
      locked: resultMap[s.problemId]?.locked || false
    }));

    return res.status(200).json({
      success: true,
      team: {
        id: team.id,
        contestId: team.contestId,
        name: team.name,
        captain: team.captain,
        members: team.members || [],
        formerMembers: team.formerMembers || [],
        mode: team.mode,
        locked: team.locked || isContestStarted(contest || {}),
        createdAt: team.createdAt,
      },
      contest: contest || null,
      submissions: enrichedSubs,
      results: results,
    });
  }

  // ═══════════ MINE ═══════════
  if (action === 'mine') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId } = req.query;
    if (!contestId) return res.status(400).json({ success: false, message: 'Missing contestId' });

    const team = await findTeamByUser(db, contestId, username);
    if (!team) return res.status(200).json({ success: true, team: null });

    const contest = await db.collection('contests').findOne({ id: Number(contestId) });
    const started = isContestStarted(contest || {});
    const ended = isContestEnded(contest || {});
    const isMember = (team.members || []).includes(username);
    const isCaptain = team.captain === username;
    const isFormer = (team.formerMembers || []).includes(username);

    const resp = {
      success: true,
      team: {
        id: team.id,
        contestId: team.contestId,
        name: team.name,
        captain: team.captain,
        members: team.members || [],
        formerMembers: team.formerMembers || [],
        mode: team.mode,
        inviteCode: (isCaptain && !started) ? team.inviteCode : undefined,
        locked: team.locked || started,
        isMember, isCaptain, isFormer,
        started, ended,
      }
    };

    // 队长拿建议队列
    if (isCaptain && team.mode === 1) {
      resp.suggestions = team.suggestions || [];
    }

    // 队员拿自己的建议（回顾用）
    if (!isCaptain && team.mode === 1) {
      resp.mySuggestions = (team.suggestions || []).filter(s => s.username === username);
    }

    // 拿题目列表（如果已开始或已结束）
    if (started) {
      const contestProblems = await getContestProblems(db, contest);
      resp.problems = contestProblems;

      // contest_results（含 locked / solved / wrongAttempts）
      const teamUsername = String(team.id);
      const results = await db.collection('contest_results')
        .find(
          { contestId: team.contestId, username: teamUsername },
          { projection: { problemId: 1, score: 1, solved: 1, locked: 1, wrongAttempts: 1, lastSubmissionTime: 1, _id: 0 } }
        )
        .toArray();
      resp.results = results;
    }

    return res.status(200).json(resp);
  }
    // ═══════════ ACTIVE（供 pd-script 检测）═══════════
  if (action === 'active') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const now = new Date();
    const specials = await db.collection('contests').find({
      special: true,
      startTime: { $lte: now },
      $expr: { $gte: [{ $add: ['$startTime', { $multiply: ['$duration', 60000] }] }, now] }
    }).toArray();

    for (const c of specials) {
      const t = await db.collection('teams').findOne({ contestId: c.id, members: username });
      if (t) {
        return res.status(200).json({
          success: true,
          active: {
            contestId: c.id,
            teamId: t.id,
            teamName: t.name,
            mode: t.mode,
            isCaptain: t.captain === username,
            contestProblemIds: (c.problems || []).map(p =>
              (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p)
            ),
          }
        });
      }
    }
    return res.status(200).json({ success: true, active: null });
  }
  // ═══════════ CREATE ═══════════
  if (action === 'create') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId, name, mode } = req.body || {};
    if (!contestId || !name) return res.status(400).json({ success: false, message: 'Missing fields' });
    if (name.length > 30) return res.status(400).json({ success: false, message: 'Name too long (max 30)' });
    if (![1, 2].includes(Number(mode))) return res.status(400).json({ success: false, message: 'Invalid mode' });

    const contest = await getContest(db, contestId);
    if (!contest || !contest.special) {
      return res.status(404).json({ success: false, message: 'Special contest not found' });
    }
    if (isContestEnded(contest)) {
      return res.status(400).json({ success: false, message: 'Contest has ended' });
    }

    // 检查用户是否已在其他队伍
    const existing = await findTeamByUser(db, contestId, username);
    if (existing) return res.status(400).json({ success: false, message: 'Already in a team' });

    // 生成唯一邀请码
    let inviteCode;
    for (let i = 0; i < 20; i++) {
      inviteCode = genInviteCode();
      const dup = await db.collection('teams').findOne({ contestId: Number(contestId), inviteCode });
      if (!dup) break;
      inviteCode = null;
    }
    if (!inviteCode) return res.status(500).json({ success: false, message: 'Cannot generate code' });

    const teamId = await getNextTeamId(db);
    const teamUsername = String(teamId);
    const now = new Date();

    // 1. 创建 team
    await db.collection('teams').insertOne({
      id: teamId,
      contestId: Number(contestId),
      name: String(name).trim().slice(0, 30),
      captain: username,
      members: [username],
      formerMembers: [],
      inviteCode,
      mode: Number(mode),
      locked: false,
      suggestions: [],
      createdAt: now,
      createdBy: username,
    });

    // 2. 创建虚拟 user
    await db.collection('users').insertOne({
      username: teamUsername,
      password: '',
      displayName: String(name).trim().slice(0, 30),
      role: 'team',
      banned: false,
      teamId,
      contestId: Number(contestId),
      createdAt: now,
    });

    // 3. 加入 contest.participants
    await db.collection('contests').updateOne(
      { id: Number(contestId) },
      { $addToSet: { participants: teamUsername } }
    );

    return res.status(201).json({ success: true, teamId, inviteCode });
  }

  // ═══════════ JOIN ═══════════
  if (action === 'join') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId, code } = req.body || {};
    if (!contestId || !code) return res.status(400).json({ success: false, message: 'Missing fields' });

    const contest = await getContest(db, contestId);
    if (!contest || !contest.special) {
      return res.status(404).json({ success: false, message: 'Special contest not found' });
    }
    if (isContestEnded(contest)) {
      return res.status(400).json({ success: false, message: 'Contest has ended' });
    }

    const existing = await findTeamByUser(db, contestId, username);
    if (existing) return res.status(400).json({ success: false, message: 'Already in a team' });

    const team = await db.collection('teams').findOne({
      contestId: Number(contestId),
      inviteCode: String(code).trim()
    });
    if (!team) return res.status(404).json({ success: false, message: 'Invalid invite code' });
    if (team.locked) return res.status(400).json({ success: false, message: 'Team locked' });
    if ((team.members || []).length >= 4) return res.status(400).json({ success: false, message: 'Team full' });

    await db.collection('teams').updateOne(
      { id: team.id },
      { $addToSet: { members: username } }
    );

    return res.status(200).json({ success: true, teamId: team.id });
  }

  // ═══════════ SUGGEST（Mode 1 成员建议）═══════════
  if (action === 'suggest') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId, problemId, answer } = req.body || {};
    if (!contestId || !problemId || answer === undefined) {
      return res.status(400).json({ success: false, message: 'Missing fields' });
    }

    const contest = await getContest(db, contestId);
    if (!contest || !contest.special) {
      return res.status(404).json({ success: false, message: 'Special contest not found' });
    }
    if (!isContestStarted(contest)) {
      return res.status(400).json({ success: false, message: 'Contest not started' });
    }
    if (isContestEnded(contest)) {
      return res.status(400).json({ success: false, message: 'Contest ended' });
    }

    const team = await db.collection('teams').findOne({
      contestId: Number(contestId),
      members: username
    });
    if (!team) return res.status(403).json({ success: false, message: 'Not in a team' });
    if (team.mode !== 1) return res.status(400).json({ success: false, message: 'Team is not in Mode 1' });

    const trimmedAnswer = String(answer).trim();
    if (!trimmedAnswer) return res.status(400).json({ success: false, message: 'Empty answer' });

    // 若已锁定，不允许再建议
    const teamUsername = String(team.id);
    const locked = await db.collection('contest_results').findOne({
      contestId: Number(contestId), username: teamUsername, problemId
    });
    if (locked && locked.locked) return res.status(400).json({ success: false, message: 'Problem already locked' });

    // 更新或追加建议（同一用户同一题只保留最新）
    const existing = (team.suggestions || []).findIndex(
      s => s.username === username && s.problemId === problemId
    );
    const suggestion = { username, problemId, answer: trimmedAnswer, ts: new Date() };

    if (existing >= 0) {
      await db.collection('teams').updateOne(
        { id: team.id },
        { $set: { [`suggestions.${existing}`]: suggestion } }
      );
    } else {
      await db.collection('teams').updateOne(
        { id: team.id },
        { $push: { suggestions: suggestion } }
      );
    }

    return res.status(200).json({ success: true });
  }
    // ═══════════ LEAVE（队员主动退出）═══════════
  if (action === 'leave') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId } = req.body || {};
    if (!contestId) return res.status(400).json({ success: false, message: 'Missing contestId' });

    const contest = await getContest(db, contestId);
    if (!contest || !contest.special) {
      return res.status(404).json({ success: false, message: 'Special contest not found' });
    }
    if (isContestEnded(contest)) {
      return res.status(400).json({ success: false, message: 'Contest has ended' });
    }

    const team = await db.collection('teams').findOne({
      contestId: Number(contestId),
      members: username
    });
    if (!team) return res.status(404).json({ success: false, message: 'Not in a team' });

    if (team.locked) {
      return res.status(400).json({ success: false, message: 'Team is finalized. Cannot leave.' });
    }
    if (team.captain === username) {
      return res.status(400).json({ success: false, message: 'Captain cannot leave. Use Disband instead.' });
    }

    await db.collection('teams').updateOne(
      { id: team.id },
      {
        $pull: { members: username },
        $addToSet: { formerMembers: username }
      }
    );

    return res.status(200).json({ success: true });
  }

  // ═══════════ KICK / TRANSFER / LOCK / DISBAND / UPDATE ═══════════
  if (action === 'kick' || action === 'transfer' || action === 'lock' || action === 'disband' || action === 'update') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId } = req.body || {};
    if (!contestId) return res.status(400).json({ success: false, message: 'Missing contestId' });

    const contest = await getContest(db, contestId);
    if (!contest || !contest.special) {
      return res.status(404).json({ success: false, message: 'Special contest not found' });
    }

    const team = await db.collection('teams').findOne({
      contestId: Number(contestId),
      captain: username
    });
    if (!team) return res.status(403).json({ success: false, message: 'Not a captain' });

    // ⭐ 新的冻结条件：team.locked 或 比赛结束
    if (action !== 'lock' && team.locked) {
      return res.status(400).json({ success: false, message: 'Team is finalized. No changes allowed.' });
    }
    if (isContestEnded(contest)) {
      return res.status(400).json({ success: false, message: 'Contest has ended' });
    }

    if (action === 'kick') {
      const { target } = req.body;
      if (!target || target === username) return res.status(400).json({ success: false, message: 'Invalid target' });
      if (!team.members.includes(target)) return res.status(404).json({ success: false, message: 'Not a member' });

      await db.collection('teams').updateOne(
        { id: team.id },
        { $pull: { members: target }, $addToSet: { formerMembers: target } }
      );
      return res.status(200).json({ success: true });
    }

    if (action === 'transfer') {
      const { newCaptain } = req.body;
      if (!newCaptain || !team.members.includes(newCaptain)) {
        return res.status(400).json({ success: false, message: 'New captain must be a member' });
      }
      await db.collection('teams').updateOne(
        { id: team.id },
        { $set: { captain: newCaptain } }
      );
      return res.status(200).json({ success: true });
    }

    if (action === 'lock') {
      if (team.locked) {
        return res.status(200).json({ success: true, alreadyLocked: true });
      }
      await db.collection('teams').updateOne(
        { id: team.id },
        { $set: { locked: true } }
      );
      return res.status(200).json({ success: true });
    }

    if (action === 'disband') {
      const teamUsername = String(team.id);
      await db.collection('teams').deleteOne({ id: team.id });
      await db.collection('users').deleteOne({ username: teamUsername });
      await db.collection('submissions').deleteMany({ username: teamUsername, contestId: Number(contestId) });
      await db.collection('contest_results').deleteMany({ username: teamUsername, contestId: Number(contestId) });
      await db.collection('contests').updateOne(
        { id: Number(contestId) },
        { $pull: { participants: teamUsername } }
      );
      return res.status(200).json({ success: true });
    }

    if (action === 'update') {
      const { name, mode } = req.body;
      const upd = {};
      if (name !== undefined) {
        if (String(name).trim().length > 30) return res.status(400).json({ success: false, message: 'Name too long' });
        upd.name = String(name).trim();
      }
      if (mode !== undefined) {
        const m = Number(mode);
        if (![1, 2].includes(m)) return res.status(400).json({ success: false, message: 'Invalid mode' });
        upd.mode = m;
      }
      if (Object.keys(upd).length === 0) return res.status(400).json({ success: false, message: 'Nothing to update' });

      await db.collection('teams').updateOne({ id: team.id }, { $set: upd });
      if (upd.name) {
        await db.collection('users').updateOne({ username: String(team.id) }, { $set: { displayName: upd.name } });
      }
      return res.status(200).json({ success: true });
    }
  }

  // ═══════════ ADMIN ═══════════
  if (action === 'adminList') {
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Admin only' });
    const { contestId } = req.query;
    const filter = contestId ? { contestId: Number(contestId) } : {};
    const teams = await db.collection('teams').find(filter).sort({ id: 1 }).toArray();
    return res.status(200).json({ success: true, teams });
  }

  if (action === 'adminRename') {
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Admin only' });
    const { teamId, name } = req.body || {};
    if (!teamId || !name) return res.status(400).json({ success: false, message: 'Missing fields' });
    if (String(name).trim().length > 30) return res.status(400).json({ success: false, message: 'Name too long' });
    await db.collection('teams').updateOne({ id: Number(teamId) }, { $set: { name: String(name).trim() } });
    await db.collection('users').updateOne({ username: String(teamId) }, { $set: { displayName: String(name).trim() } });
    return res.status(200).json({ success: true });
  }

  if (action === 'adminDelete') {
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Admin only' });
    const { teamId } = req.body || {};
    if (!teamId) return res.status(400).json({ success: false, message: 'Missing teamId' });
    const team = await db.collection('teams').findOne({ id: Number(teamId) });
    if (!team) return res.status(404).json({ success: false, message: 'Team not found' });
    const teamUsername = String(teamId);
    await db.collection('teams').deleteOne({ id: Number(teamId) });
    await db.collection('users').deleteOne({ username: teamUsername });
    await db.collection('submissions').deleteMany({ username: teamUsername });
    await db.collection('contest_results').deleteMany({ username: teamUsername });
    await db.collection('contests').updateOne(
      { id: team.contestId },
      { $pull: { participants: teamUsername } }
    );
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}

// 获取竞赛题目（含 evalType）
async function getContestProblems(db, contest) {
  if (!contest || !Array.isArray(contest.problems)) return [];
  const ids = contest.problems.map(p =>
    (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p)
  );
  const probs = await db.collection('problems')
    .find({ id: { $in: ids } }, { projection: { id: 1, name: 1, difficulty: 1, _id: 0 } })
    .toArray();
  const map = Object.fromEntries(probs.map(p => [p.id, p]));
  return contest.problems.map(p => {
    const pid = (typeof p === 'object' && p.problemId) ? String(p.problemId) : String(p);
    const evalType = (typeof p === 'object' && p.evalType) ? p.evalType : 'numeric';
    return { id: pid, name: map[pid]?.name || pid, difficulty: map[pid]?.difficulty || 0, evalType };
  });
}