// api/course.js —— 课程（Course）
//
// 三门 track：Compulsory(M) / Extended(M2) / Olympiad(MO)
// 每门 track 下有一堆课（id 是管理员自定的字符串，track 内唯一）
// 进度：单独一个集合 courseProgress，按 (username, track, courseId) 存已 AC 的 pid 列表
//
// 前端：
//   GET  ?action=list&track=M
//   GET  ?action=get&track=M&id=1
//   POST ?action=reset   { track, id }
//   admin:
//   GET  ?action=adminList
//   GET  ?action=adminGet&track=M&id=1
//   POST ?action=adminCreate  { track, id, topic, difficulty, content }
//   POST ?action=adminUpdate  { track, id, topic, difficulty, content, newId? }
//   POST ?action=adminDelete  { track, id }

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { auditLog } from '../lib/audit.js';

const TRACKS = ['M', 'M2', 'MO'];
const TRACK_LABELS = { M: 'Compulsory', M2: 'Extended', MO: 'Olympiad' };
const DIFFICULTIES = ['easy', 'medium', 'hard', 'challenging', 'insane'];

/** 从 content 里抽出所有 <div pid="..."></div> 引用 */
function extractPids(html) {
  const out = new Set();
  const re = /<div[^>]*\bpid\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const pid = String(m[1]).trim();
    if (pid) out.add(pid);
  }
  return [...out];
}

// ── PDF 版式 ──
// pdf = { url, idPrefix, idDigits, boxes: [{ pid, page, x, y, h }] }
// 坐标一律存百分比，换缩放或换屏宽都不会错位。
function normalizePdf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const url = String(raw.url || '').trim().slice(0, 2000);
  if (!url) return null;
  const boxes = Array.isArray(raw.boxes) ? raw.boxes.slice(0, 500).map((b) => {
    const page = Math.max(1, Math.floor(Number(b.page) || 1));
    const pageEnd = Math.max(page, Math.floor(Number(b.pageEnd) || page));
    const out = {
      pid: String(b.pid || '').slice(0, 64),
      page,
      x: Math.min(100, Math.max(0, Number(b.x) || 0)),
      y: Math.min(100, Math.max(0, Number(b.y) || 0)),
      h: Math.min(200, Math.max(1, Number(b.h) || 8)),
    };
    // 跨页框：pageEnd > page，结束位置用 yEnd（落在结束页的 %）
    if (pageEnd > page) {
      out.pageEnd = pageEnd;
      out.yEnd = Math.min(100, Math.max(0, Number(b.yEnd) || 50));
      out.h = 0;
    }
    return out;
  }).filter((b) => b.pid) : [];
  return {
    url,
    idPrefix: String(raw.idPrefix || '').slice(0, 32),
    idDigits: Math.min(6, Math.max(1, Math.floor(Number(raw.idDigits) || 3))),
    boxes,
  };
}

/** 课程进度要把 PDF 框里的题也算进去 */
function mergePids(fromContent, pdf) {
  const set = new Set(fromContent);
  if (pdf) for (const b of pdf.boxes) set.add(b.pid);
  return [...set];
}

function isAdminRole(role) {
  return role === 'admin' || role === 'root';
}

async function progressOf(db, username, track) {
  const docs = await db.collection('courseProgress')
    .find({ username, track }, { projection: { courseId: 1, solved: 1, _id: 0 } })
    .toArray();
  const map = {};
  for (const d of docs) map[d.courseId] = new Set(Array.isArray(d.solved) ? d.solved : []);
  return map;
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  const user = await verifyToken(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const action = String(req.query.action || '').toLowerCase();
  const isAdmin = isAdminRole(user.role);

  try {
    // ── 列表（带进度）──
    if (action === 'list') {
      const track = String(req.query.track || '');
      if (!TRACKS.includes(track)) {
        return res.status(400).json({ success: false, message: 'Unknown track' });
      }

      const courses = await db.collection('courses')
        .find({ track }, { projection: { _id: 0 } })
        .toArray();
      courses.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

      const prog = await progressOf(db, user.username, track);

      // 同步：题库里已经 AC 过的题也算课程进度（历史记录不必再刷一遍）
      const stats = await db.collection('userstats').findOne(
        { username: user.username }, { projection: { states: 1, _id: 0 } }
      );
      const passed = (stats && stats.states) || {};

      return res.status(200).json({
        success: true,
        track,
        trackLabel: TRACK_LABELS[track],
        courses: courses.map((c) => {
          const pids = Array.isArray(c.pids) ? c.pids : [];
          const solved = new Set(prog[c.id] || []);
          for (const pid of pids) {
            if (passed[pid] === 'passed') solved.add(pid);
          }
          const done = pids.filter((p) => solved.has(p)).length;
          return {
            id: c.id,
            topic: c.topic || '',
            difficulty: c.difficulty || 'easy',
            total: pids.length,
            solved: done,
            completed: pids.length > 0 && done === pids.length,
          };
        }),
      });
    }

    // ── 单课 ──
    if (action === 'get') {
      const track = String(req.query.track || '');
      const id = String(req.query.id || '');
      if (!TRACKS.includes(track) || !id) {
        return res.status(400).json({ success: false, message: 'Missing track or id' });
      }

      const course = await db.collection('courses').findOne({ track, id }, { projection: { _id: 0 } });
      if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

      const pids = Array.isArray(course.pids) ? course.pids : extractPids(course.content);
      const prog = await db.collection('courseProgress')
        .findOne({ username: user.username, track, courseId: id }, { projection: { solved: 1, _id: 0 } });
      const solved = new Set(Array.isArray(prog?.solved) ? prog.solved : []);

      // 同步：userstats 里 AC 过的题也算（含课程上线之前的历史提交）
      const statsDoc = await db.collection('userstats')
        .findOne({ username: user.username }, { projection: { states: 1, _id: 0 } });
      const passedStates = (statsDoc && statsDoc.states) || {};
      for (const pid of pids) {
        if (passedStates[pid] === 'passed') solved.add(pid);
      }

      // 卷末题目清单：带上题名，方便在 PDF 尾巴列出并可点进编辑页
      const probDocs = pids.length
        ? await db.collection('problems').find(
            { id: { $in: pids } },
            { projection: { id: 1, name: 1, difficulty: 1, _id: 0 } }
          ).toArray()
        : [];
      const probMap = Object.fromEntries(probDocs.map((p) => [p.id, p]));
      const problemList = pids.map((pid) => ({
        id: pid,
        name: (probMap[pid] && probMap[pid].name) || '',
        difficulty: (probMap[pid] && probMap[pid].difficulty) || null,
        solved: solved.has(pid),
      }));

      return res.status(200).json({
        success: true,
        track,
        trackLabel: TRACK_LABELS[track],
        course: {
          id: course.id,
          topic: course.topic || '',
          difficulty: course.difficulty || 'easy',
          content: course.content || '',
          pdf: course.pdf || null,
          pids,
          solvedPids: pids.filter((p) => solved.has(p)),
          problems: problemList,
        },
      });
    }

    // ── 重置这门课的进度 ──
    if (action === 'reset') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const { track, id } = req.body || {};
      if (!TRACKS.includes(track) || !id) {
        return res.status(400).json({ success: false, message: 'Missing track or id' });
      }
      await db.collection('courseProgress').deleteOne({ username: user.username, track, courseId: String(id) });
      return res.status(200).json({ success: true, message: 'Progress reset' });
    }

    // ══════════ 以下仅管理员 ══════════
    if (action.startsWith('admin')) {
      if (!isAdmin) return res.status(403).json({ success: false, message: 'Forbidden' });

      if (action === 'adminlist') {
        const courses = await db.collection('courses').find({}, { projection: { _id: 0 } }).toArray();
        courses.sort((a, b) => {
          const t = TRACKS.indexOf(a.track) - TRACKS.indexOf(b.track);
          if (t) return t;
          return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
        });
        return res.status(200).json({ success: true, courses });
      }

      if (action === 'adminget') {
        const track = String(req.query.track || '');
        const id = String(req.query.id || '');
        const course = await db.collection('courses').findOne({ track, id }, { projection: { _id: 0 } });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
        return res.status(200).json({ success: true, course });
      }

      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const body = req.body || {};

      if (action === 'admincreate') {
        const track = String(body.track || '');
        const id = String(body.id || '').trim();
        const topic = String(body.topic || '').trim();
        const difficulty = String(body.difficulty || 'easy');
        const content = String(body.content || '');

        if (!TRACKS.includes(track)) return res.status(400).json({ success: false, message: 'Unknown track' });
        if (!id) return res.status(400).json({ success: false, message: 'Missing id' });
        if (!DIFFICULTIES.includes(difficulty)) return res.status(400).json({ success: false, message: 'Bad difficulty' });

        const exists = await db.collection('courses').findOne({ track, id }, { projection: { _id: 1 } });
        if (exists) return res.status(409).json({ success: false, message: 'id already exists in this track' });

        const pdf = normalizePdf(body.pdf);
        const now = new Date();
        await db.collection('courses').insertOne({
          track, id, topic, difficulty, content,
          pids: mergePids(extractPids(content), pdf),
          pdf,
          createdAt: now, updatedAt: now,
          createdBy: user.username,
        });
        await auditLog(db, 'course_create', { track, id }, user.username, 'info').catch(() => {});
        return res.status(200).json({ success: true, message: 'Created' });
      }

      if (action === 'adminupdate') {
        const track = String(body.track || '');
        const id = String(body.id || '').trim();
        const newId = String(body.newId || id).trim();
        const topic = String(body.topic || '').trim();
        const difficulty = String(body.difficulty || 'easy');
        const content = String(body.content || '');

        if (!TRACKS.includes(track)) return res.status(400).json({ success: false, message: 'Unknown track' });
        if (!id) return res.status(400).json({ success: false, message: 'Missing id' });
        if (!newId) return res.status(400).json({ success: false, message: 'Missing new id' });
        if (!DIFFICULTIES.includes(difficulty)) return res.status(400).json({ success: false, message: 'Bad difficulty' });

        if (newId !== id) {
          const clash = await db.collection('courses').findOne({ track, id: newId }, { projection: { _id: 1 } });
          if (clash) return res.status(409).json({ success: false, message: 'id already exists in this track' });
        }

        const pdf = normalizePdf(body.pdf);
        const upd = await db.collection('courses').updateOne(
          { track, id },
          { $set: { id: newId, topic, difficulty, content, pdf, pids: mergePids(extractPids(content), pdf), updatedAt: new Date() } }
        );
        if (!upd.matchedCount) return res.status(404).json({ success: false, message: 'Course not found' });

        if (newId !== id) {
          await db.collection('courseProgress').updateMany(
            { track, courseId: id },
            { $set: { courseId: newId } }
          ).catch(() => {});
        }
        await auditLog(db, 'course_update', { track, id, newId }, user.username, 'info').catch(() => {});
        return res.status(200).json({ success: true, message: 'Updated' });
      }

      if (action === 'admindelete') {
        const track = String(body.track || '');
        const id = String(body.id || '');
        const del = await db.collection('courses').deleteOne({ track, id });
        if (!del.deletedCount) return res.status(404).json({ success: false, message: 'Course not found' });
        await db.collection('courseProgress').deleteMany({ track, courseId: id }).catch(() => {});
        await auditLog(db, 'course_delete', { track, id }, user.username, 'warn').catch(() => {});
        return res.status(200).json({ success: true, message: 'Deleted' });
      }

      return res.status(400).json({ success: false, message: 'Unknown admin action' });
    }

    return res.status(400).json({ success: false, message: 'Unknown action' });
  } catch (err) {
    console.error('[course]', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export default wrapHandler(handler);
