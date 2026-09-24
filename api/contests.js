// api/contests.js
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';

function isAdminUser(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

function deriveStatus(contest, now = new Date()) {
  if (!contest.startTime) return 'upcoming';
  const start = new Date(contest.startTime);
  if (isNaN(start.getTime())) return 'upcoming';
  const duration = Number(contest.duration) || 0;
  const end = new Date(start.getTime() + duration * 60000);
  if (now < start) return 'upcoming';
  if (now > end) return 'ended';
  return 'ongoing';
}

function normalizeProblems(raw) {
  const out = [];
  for (const p of (raw || [])) {
    if (typeof p === 'object' && p && p.problemId) {
      out.push({ problemId: String(p.problemId), evalType: p.evalType || 'numeric' });
    } else if (typeof p === 'string' || typeof p === 'number') {
      out.push({ problemId: String(p), evalType: 'numeric' });
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const action = req.query.action;
  const username = decoded.username;
  const isAdmin = isAdminUser(decoded);

  // ========== 列表 ==========
  if (action === 'list') {
    const { page = '1', limit = '20' } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(50, parseInt(limit) || 20);

    try {
      const filter = isAdmin ? {} : { public: true };

      const [total, contests] = await Promise.all([
        db.collection('contests').countDocuments(filter),
        db.collection('contests')
          .find(filter, { projection: { id: 1, name: 1, startTime: 1, duration: 1, public: 1, participants: 1 } })
          .sort({ id: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .toArray()
      ]);

      const enriched = contests.map(c => ({
        id: c.id,
        name: c.name || '',
        startTime: c.startTime,
        duration: c.duration,
        public: c.public !== false,
        contestantCount: Array.isArray(c.participants) ? c.participants.length : 0
      }));

      return res.status(200).json({
        success: true,
        contests: enriched,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      });
    } catch (err) {
      console.error('Contest list error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

    // ========== 詳情頁 ==========
  if (action === 'page') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, message: 'Missing contest id' });

    try {
      const contest = await db.collection('contests').findOne({ id: Number(id) });
      if (!contest) return res.status(404).json({ success: false, message: 'Contest not found' });
      if (!isAdmin && !contest.public) {
        return res.status(404).json({ success: false, message: 'Contest not found' });
      }

      let isParticipant = Array.isArray(contest.participants) && contest.participants.includes(username);

      // ⭐ 特殊竞赛：检查是否属于某 team
      let teamInfo = null;
      if (contest.special) {
        const team = await db.collection('teams').findOne({
          contestId: contest.id,
          members: username
        });
        if (team) {
          isParticipant = true;
          teamInfo = {
            id: team.id,
            name: team.name,
            captain: team.captain,
            members: team.members,
            mode: team.mode,
            locked: team.locked,
          };
        }
      }
      const status = deriveStatus(contest);

      let normProblems = normalizeProblems(contest.problems);

      // ⭐ Fallback：contest.problems 為空 → 從 contest_results 反推題目 ID
      if (normProblems.length === 0) {
        const resultPids = await db.collection('contest_results')
          .distinct('problemId', { contestId: contest.id });

        // 自然排序（HA2501 < HA2502 < ... < HA2520）
        resultPids.sort((a, b) =>
          String(a).localeCompare(String(b), undefined, { numeric: true })
        );

        normProblems = resultPids.map(pid => ({
          problemId: String(pid),
          evalType: 'numeric'
        }));

        // 順便寫回 contests collection（一次性修復，下次就不需要 fallback）
        if (normProblems.length > 0) {
          await db.collection('contests').updateOne(
            { id: contest.id },
            { $set: { problems: normProblems } }
          );
        }
      }

      const problemIds = normProblems.map(p => p.problemId);
      const evalMap = Object.fromEntries(normProblems.map(p => [p.problemId, p.evalType]));

      const result = {
        id: contest.id,
        name: contest.name || '',
        startTime: contest.startTime,
        duration: Number(contest.duration) || 0,
        status,
        isParticipant,
        participantCount: Array.isArray(contest.participants) ? contest.participants.length : 0,
        participants: Array.isArray(contest.participants) ? contest.participants : [],
        public: contest.public !== false,
        problems: [],
        userScores: {},
        userContestStates: {},
        userWrongAttempts: {},
        team: teamInfo, 
        special: !!contest.special,
        globalStates: {}
      };

      const showProblems =
        (status === 'ongoing' || status === 'ended') &&
        isParticipant &&
        problemIds.length > 0;

      const tasks = [];

      // 1) 題目詳情（含 name）
      if (showProblems) {
        tasks.push(
          db.collection('problems')
            .find(
              { id: { $in: problemIds } },
              { projection: { id: 1, name: 1, difficulty: 1, tags: 1, _id: 0 } }
            )
            .toArray()
            .then(probs => {
              const map = Object.fromEntries(probs.map(p => [p.id, p]));
              result.problems = problemIds.map(pid => {
                const p = map[pid] || { id: pid, name: '(missing)' };
                return { ...p, evalType: evalMap[pid] || 'numeric' };
              });
            })
        );
      }

            // 2) 當前用戶分數 / 狀態 / wrongAttempts（⭐ 唯一一個讀 contest_results 的地方）
      const scoreUsername = teamInfo ? String(teamInfo.id) : username;
      tasks.push(
        db.collection('contest_results')
          .find(
            { contestId: contest.id, username: scoreUsername },
            { projection: { problemId: 1, score: 1, solved: 1, wrongAttempts: 1, locked: 1, _id: 0 } }
          )
          .toArray()
                    .then(results => {
            const scores = {};
            const states = {};
            const attempts = {};
            const locked = {};
            for (const r of results) {
              scores[r.problemId] = r.score;
              attempts[r.problemId] = Number(r.wrongAttempts) || 0;
              locked[r.problemId] = r.locked === true;
              // ⭐ WA 锁定 → 状态永远 failed
              if (r.locked === true) states[r.problemId] = 'failed';
              else if (r.solved === true) states[r.problemId] = 'passed';
              else if (r.score > 0) states[r.problemId] = 'partial';
              else states[r.problemId] = 'failed';
            }
            result.userScores = scores;
            result.userContestStates = states;
            result.userWrongAttempts = attempts;
            result.userLocked = locked;
          })
      );

      // 3) 全域狀態（給「賽前已完成」判斷用）
      if (showProblems) {
        tasks.push(
          db.collection('userstats')
            .findOne({ username }, { projection: { states: 1, _id: 0 } })
            .then(stats => {
              const all = stats?.states || {};
              const relevant = {};
              for (const pid of problemIds) {
                if (all[pid]) relevant[pid] = all[pid];
              }
              result.globalStates = relevant;
            })
        );
      }

      // 4) 已結束 → 統計
      if (status === 'ended') {
        tasks.push(
          calculateContestStats(db, contest)
            .then(stats => { result.stats = stats; })
            .catch(err => {
              console.error('Stats error:', err);
              result.stats = { participants: [], problems: [] };
            })
        );
      }

      await Promise.all(tasks);
      return res.status(200).json({ success: true, contest: result });
    } catch (err) {
      console.error('Contest page error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ========== 加入 ==========
  if (action === 'join') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId } = req.body || {};
    if (!contestId) return res.status(400).json({ success: false, message: 'Missing contestId' });

    try {
      const contest = await db.collection('contests').findOne({ id: Number(contestId) });
      if (!contest) return res.status(404).json({ success: false, message: 'Contest not found' });
      if (!isAdmin && !contest.public) {
        return res.status(404).json({ success: false, message: 'Contest not found' });
      }

      const now = new Date();
      const start = new Date(contest.startTime);
      const end = new Date(start.getTime() + (Number(contest.duration) || 0) * 60000);
      if (now > end) return res.status(400).json({ success: false, message: 'Contest already ended' });

      await db.collection('contests').updateOne(
        { id: Number(contestId) },
        { $addToSet: { participants: username } }
      );
      return res.status(200).json({ success: true, message: 'Joined contest' });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ========== 退出 ==========
  if (action === 'quit') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { contestId } = req.body || {};
    if (!contestId) return res.status(400).json({ success: false, message: 'Missing contestId' });

    try {
      const contest = await db.collection('contests').findOne({ id: Number(contestId) });
      if (!contest) return res.status(404).json({ success: false, message: 'Contest not found' });

      if (new Date() >= new Date(contest.startTime)) {
        return res.status(400).json({ success: false, message: 'Cannot quit after contest started' });
      }

      await db.collection('contests').updateOne(
        { id: Number(contestId) },
        { $pull: { participants: username } }
      );
      return res.status(200).json({ success: true, message: 'Left contest' });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }

  // ========== 結果 ==========
  if (action === 'results') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, message: 'Missing contest id' });
    try {
      const contest = await db.collection('contests').findOne({ id: Number(id) });
      if (!contest) return res.status(404).json({ success: false, message: 'Contest not found' });
      if (!isAdmin && !contest.public) {
        return res.status(404).json({ success: false, message: 'Contest not found' });
      }
      if (new Date() < new Date(contest.startTime) && !isAdmin) {
        return res.status(403).json({ success: false, message: 'Contest not started yet' });
      }
      const stats = await calculateContestStats(db, contest);
      return res.status(200).json({ success: true, stats });
    } catch (err) {
      console.error('Results error:', err);
      return res.status(500).json({ success: false, message: 'Error calculating results' });
    }
  }

  // ============================================================
  //                      管理端（admin*）
  // ============================================================
  if (typeof action === 'string' && action.startsWith('admin')) {
    if (!isAdmin) return res.status(403).json({ success: false, message: 'Admin only' });

    if (action === 'adminDetail') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
      const { id } = req.query;
      if (!id) return res.status(400).json({ success: false, message: 'Missing contest id' });
      const contest = await db.collection('contests').findOne({ id: Number(id) });
      if (!contest) return res.status(404).json({ success: false, message: 'Contest not found' });
      return res.status(200).json({ success: true, contest });
    }

    if (action === 'adminCreate') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { name, problems, participants, startTime, duration, public: isPublic, special: isSpecial } = req.body || {};
      if (!name || !startTime || !duration) {
        return res.status(400).json({ success: false, message: 'Missing required fields (name, startTime, duration)' });
      }

      const lastContest = await db.collection('contests')
        .find({}, { projection: { id: 1 } })
        .sort({ id: -1 })
        .limit(1)
        .toArray();
      const nextId = (lastContest.length > 0 ? lastContest[0].id : 0) + 1;

            const newContest = {
        id: nextId,
        name,
        startTime: new Date(startTime),
        duration: Math.min(Math.max(0, parseInt(duration) || 0), 600000000),
        problems: Array.isArray(problems) ? problems : [],
        participants: Array.isArray(participants) ? participants : [],
        public: isPublic !== false,
        special: isSpecial === true,
        createdBy: username
      };

      await db.collection('contests').insertOne(newContest);
      return res.status(201).json({ success: true, message: 'Contest created', id: nextId });
    }

    if (action === 'adminUpdate') {
      if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
      const { id } = req.query;
      if (!id) return res.status(400).json({ success: false, message: 'Missing contest id' });
      const numericId = Number(id);

      const exist = await db.collection('contests').findOne({ id: numericId });
      if (!exist) return res.status(404).json({ success: false, message: 'Contest not found' });

      const upd = {};
      if (req.body.name !== undefined) upd.name = req.body.name;
      if (req.body.startTime !== undefined) upd.startTime = new Date(req.body.startTime);
      if (req.body.duration !== undefined) {
        upd.duration = Math.min(Math.max(0, parseInt(req.body.duration) || 0), 201600000);
      }
      if (req.body.problems !== undefined) upd.problems = Array.isArray(req.body.problems) ? req.body.problems : [];
      if (req.body.participants !== undefined) upd.participants = Array.isArray(req.body.participants) ? req.body.participants : [];
            if (req.body.special !== undefined) upd.special = !!req.body.special;

      if (Object.keys(upd).length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      await db.collection('contests').updateOne({ id: numericId }, { $set: upd });
      return res.status(200).json({ success: true, message: 'Contest updated' });
    }

    if (action === 'adminDelete') {
      if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ success: false, message: 'Missing contest id' });
      const numericId = Number(id);

      const result = await db.collection('contests').deleteOne({ id: numericId });
      if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Contest not found' });
      await db.collection('contest_results').deleteMany({ contestId: numericId });
      return res.status(200).json({ success: true, message: 'Contest deleted' });
    }

    return res.status(400).json({ success: false, message: 'Invalid admin action' });
  }

  return res.status(400).json({ success: false, message: 'Invalid action' });
}

// ====== 統計（⭐ problems[pid] 改為 { score, wrongAttempts }）======
async function calculateContestStats(db, contest) {
  const participants = Array.isArray(contest.participants) ? contest.participants : [];
  const userScores = {};
  for (const u of participants) {
    userScores[u] = { total: 0, lastTime: null, problems: {} };
  }

  try {
    const results = await db.collection('contest_results')
      .find({ contestId: contest.id })
      .toArray();

    for (const r of results) {
      try {
        if (!r.username || !userScores[r.username]) continue;
        const score = Number(r.score) || 0;
        const wrongAttempts = Number(r.wrongAttempts) || 0;

        userScores[r.username].total += score;

        if (r.problemId) {
          userScores[r.username].problems[r.problemId] = {
            score,
            wrongAttempts,
            solved: r.solved === true,
          };
        }

        let time = r.lastSubmissionTime || r.time || r.timestamp || null;
        if (time) {
          if (!(time instanceof Date)) time = new Date(time);
          if (isNaN(time.getTime())) time = null;
        }
        if (time) {
          if (!userScores[r.username].lastTime || time > userScores[r.username].lastTime) {
            userScores[r.username].lastTime = time;
          }
        }
      } catch (innerErr) {
        console.error('Error processing single contest result:', r, innerErr);
      }
    }
  } catch (err) {
    console.error('Error fetching contest_results:', err);
    return { participants: [], problems: [] };
  }

    const sorted = Object.entries(userScores)
    .map(([uname, data]) => ({ username: uname, ...data }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (!a.lastTime) return 1;
      if (!b.lastTime) return -1;
      return a.lastTime - b.lastTime;
    });

  // ⭐ 補齊 displayName / realName / pfp
  const usernames = sorted.map(p => p.username);
  let nameMap = {};
  if (usernames.length > 0) {
    try {
      const userDocs = await db.collection('users')
        .find(
          { username: { $in: usernames } },
          { projection: { username: 1, displayName: 1, realName: 1, pfp: 1, _id: 0 } }
        )
        .toArray();
      nameMap = Object.fromEntries(
        userDocs.map(u => [u.username, {
          displayName: u.displayName || '',
          realName: u.realName || '',
          pfp: u.pfp || ''
        }])
      );
    } catch (e) {
      console.error('calculateContestStats user lookup failed:', e);
    }
  }

  const enriched = sorted.map(p => {
    const meta = nameMap[p.username] || {};
    return {
      ...p,
      displayName: meta.displayName || '',
      realName: meta.realName || '',
      pfp: meta.pfp || ''
    };
  });

  // ⭐ Special contest：用队伍名替代
  let finalParticipants = enriched;
  if (contest.special) {
    const teamIds = sorted
      .map(p => p.username)
      .filter(u => /^\d+$/.test(u))
      .map(Number);
    if (teamIds.length > 0) {
      const teams = await db.collection('teams')
        .find({ id: { $in: teamIds } },
              { projection: { id: 1, name: 1, captain: 1, members: 1, _id: 0 } })
        .toArray();
      const teamMap = Object.fromEntries(teams.map(t => [String(t.id), t]));
      finalParticipants = enriched.map(p => {
        const t = teamMap[String(p.username)];
        if (!t) return p;
        return {
          ...p,
          displayName: t.name,
          isTeam: true,
          teamId: t.id,
          captain: t.captain,
          memberCount: Array.isArray(t.members) ? t.members.length : 0,
        };
      });
    }
  }

  return {
    participants: finalParticipants,
    problems: (contest.problems || []).map(p => {
      if (typeof p === 'object' && p.problemId) return p.problemId;
      if (typeof p === 'string') return p;
      return 'unknown';
    })
  };
}