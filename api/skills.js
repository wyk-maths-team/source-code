// api/skills.js —— 技能图数据
//
// GET /api/skills?action=graph    →  { nodes, edges, stats }
// GET /api/skills?action=profile  →  当前登录学生的知识画像
//                                   （管理员可加 &username=X 看别人）
//
// 只给登录用户看。节点来自 skills 集合（运行时会随 review-skills 的
// promote / reject 变化），边来自 skill_edges（由 build-skill-vectors 写入）。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler } from '../lib/errors.js';
import { buildStudentProfile } from '../lib/student-profile.js';

async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const action = (req.query && req.query.action) || 'graph';

  // ── 某个学生的知识画像：tutor 用它决定先讲什么，也方便在页面上看 ──
  if (action === 'profile') {
    const asked = String((req.query && req.query.username) || '').trim();
    const isAdmin = ['admin', 'root'].includes(decoded.role);
    const target = asked || decoded.username;
    if (asked && asked !== decoded.username && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const profile = await buildStudentProfile(db, target);
    if (profile.empty) {
      return res.status(200).json({
        success: true, username: target, empty: true,
        solvedCount: 0, triedCount: 0, known: [], gaps: [],
      });
    }

    // 交给前端的就是它在星图上涂色需要的最小集合
    return res.status(200).json({
      success: true,
      username: target,
      empty: false,
      solvedCount: profile.solvedCount,
      triedCount: profile.triedCount,
      known: profile.known,
      gaps: profile.gaps,
      skills: profile.skills,
      names: profile.names,
    });
  }


  // ── 单个技能的详情：描述 + 一道典题 ──
  // 典题从 problem_vectors 里挑：优先 depth 最高的（最能体现这个技巧的深度），
  // 同样深度就挑难度适中的（太难会吓跑人，太简单体现不出技巧）。
  if (action === 'detail') {
    const id = String((req.query && req.query.id) || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

    const skill = await db.collection('skills').findOne({ id });
    if (!skill) return res.status(404).json({ success: false, message: 'Skill not found' });

    const [children, parents, edgesOut, edgesIn] = await Promise.all([
      db.collection('skills').find({ parent: id }, { projection: { id: 1, name: 1, _id: 0 } }).toArray(),
      db.collection('skills').find({ id: skill.parent || '' }, { projection: { id: 1, name: 1, _id: 0 } }).toArray(),
      db.collection('skill_edges').find({ from: id }, { projection: { to: 1, type: 1, _id: 0 } }).toArray(),
      db.collection('skill_edges').find({ to: id }, { projection: { from: 1, type: 1, _id: 0 } }).toArray(),
    ]);

    // 用过这个技能的所有题，带上 depth
    const vectors = await db.collection('problem_vectors')
      .find({ skills: id }, { projection: { problemId: 1, depths: 1, _id: 0 } })
      .limit(400).toArray();

    const scored = vectors.map((v) => {
      const d = Number(v.depths && v.depths[id]) || 1;
      return { problemId: String(v.problemId), depth: d };
    });

    // 挑难度 4-6 的优先（有挑战但不至于放弃），depth 高的优先
    const ids = scored.map((s) => s.problemId);
    const problems = ids.length
      ? await db.collection('problems')
        .find({ id: { $in: ids }, public: true },
          { projection: { id: 1, difficulty: 1, name: 1, _id: 0 } })
        .toArray()
      : [];
    const byId = new Map(problems.map((p) => [p.id, p]));

    const ranked = scored
      .filter((s) => byId.has(s.problemId))
      .map((s) => {
        const p = byId.get(s.problemId);
        const diff = Number(p.difficulty) || 5;
        // 难度落在 4-6 得满分，偏离越多扣越多
        const diffScore = 3 - Math.min(3, Math.abs(diff - 5));
        return { ...s, difficulty: diff, name: p.name || '', score: s.depth * 2 + diffScore };
      })
      .sort((a, b) => b.score - a.score);

    return res.status(200).json({
      success: true,
      skill: {
        id: skill.id,
        name: skill.name || { zh: skill.id, en: skill.id },
        level: skill.level,
        description: skill.description || '',
      },
      parent: parents[0] || null,
      children: children,
      related: {
        out: edgesOut.slice(0, 20),
        in: edgesIn.slice(0, 20),
      },
      example: ranked[0] || null,
      alternatives: ranked.slice(1, 5),
      problemCount: ranked.length,
    });
  }

  if (action === 'graph') {
    const [nodes, edges] = await Promise.all([
      db.collection('skills').find({}, { projection: { _id: 0 } }).toArray(),
      db.collection('skill_edges').find({}, { projection: { _id: 0 } }).toArray(),
    ]);

    // 每道题挂了多少技能：节点大小/热度的依据
    const usage = await db.collection('problem_vectors').aggregate([
      { $unwind: '$skills' },
      { $group: { _id: '$skills', n: { $sum: 1 } } },
    ]).toArray();
    const count = new Map(usage.map((u) => [u._id, u.n]));

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const shaped = nodes.map((n) => ({
      id: n.id,
      name: n.name || {},
      parent: n.parent || null,
      level: Number(n.level) || String(n.id).split('.').length,
      status: n.status || 'active',
      description: n.description || '',
      problems: count.get(n.id) || 0,
    }));

    return res.status(200).json({
      success: true,
      nodes: shaped,
      edges: edges.filter((e) => byId.has(e.from) && byId.has(e.to)),
      stats: {
        nodes: shaped.length,
        edges: edges.length,
        active: shaped.filter((n) => n.status === 'active').length,
        suggested: shaped.filter((n) => n.status === 'suggested').length,
      },
    });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

export default wrapHandler(handler);
