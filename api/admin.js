// api/admin.js
import { connectToDatabase } from './db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { sanitizeHTML } from '../lib/sanitize.js';
import bcrypt from 'bcrypt';
import fs from 'fs';
import path from 'path';
const allowedCollections = ['problems', 'users', 'submissions', 'userstats', 'updates', 'contests', 'contest_results', 'metadata'];

const ALLOWED_COLLECTIONS = ['problems', 'users', 'submissions', 'userstats', 'updates', 'contests', 'contest_results', 'metadata'];
async function auditLog(db, action, details, operator) {
  try {
    await db.collection('audit_logs').insertOne({
      action,
      details,
      operator,
      timestamp: new Date()
    });
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

export default async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'root')) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const db = await connectToDatabase();
  const { action } = req.query;

  // ====== 审计日志（内部） ======
  async function auditLog(actionName, details) {
    try {
      await db.collection('audit_logs').insertOne({
        action: actionName,
        details,
        operator: decoded.username,
        timestamp: new Date()
      });
    } catch (e) { console.error('Audit log error:', e); }
  }
  // ========== Marker: 待批改列表 ==========
  if (action === 'markerList') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const submissions = await db.collection('submissions')
      .find({ type: 'image', marked: false })
      .sort({ timestamp: -1 })
      .project({ username: 1, problemId: 1, subid: 1, timestamp: 1, _id: 0 })
      .toArray();
    return res.status(200).json({ success: true, submissions });
  }

  if (action === 'markerDetail') {
    const { subid } = req.query;
    if (!subid) return res.status(400).json({ success: false, message: 'Missing subid' });
    const sub = await db.collection('submissions').findOne({ subid });
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });

    // 不要排除 image 字段，直接返回
    const { username, problemId, timestamp, marked, score, comment, drawing, image, markedAt } = sub;
    return res.status(200).json({
      success: true,
      submission: {
        subid,
        image,       // 确保包含 image
        username,
        problemId,
        timestamp,
        marked,
        score,
        comment,
        drawing,
        markedAt: markedAt || null
      }
    });
  }

// ========== Marker: 提交评分 ==========
  if (action === 'markSubmit') {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const { subid, score, comment, drawing } = req.body;
    if (!subid || score === undefined) return res.status(400).json({ success: false, message: 'Missing subid/score' });
    
    const sub = await db.collection('submissions').findOne({ subid });
    if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });
    
    const numScore = Number(score);
    if (isNaN(numScore) || numScore < 0 || numScore > 100) {
      return res.status(400).json({ success: false, message: 'Score must be between 0 and 100' });
    }

    await db.collection('submissions').updateOne(
      { subid },
      { $set: { marked: true, score: numScore, comment: comment || '', drawing: drawing || '', markedAt: new Date() } }
    );

    // 同步更新竞赛结果（如果是竞赛图片提交）
    if (sub.contestId && sub.type === 'image') {
      await db.collection('contest_results').updateOne(
        { contestId: sub.contestId, username: sub.username, problemId: sub.problemId },
        { $set: { score: numScore, lastSubmissionTime: new Date() } },
        { upsert: true }
      );
    }

    // 更新用户解题状态（图片提交批改后）
    if (sub.type === 'image') {
      const statesCol = db.collection('userstats');
      const stats = await statesCol.findOne({ username: sub.username });
      let states = stats ? stats.states : {};
      const pid = sub.problemId;
      if (numScore === 100) {
        states[pid] = 'passed';
      } else if (states[pid] !== 'passed') {
        states[pid] = 'failed';
      }
      await statesCol.updateOne({ username: sub.username }, { $set: { states } }, { upsert: true });
    }

    await auditLog('mark_submission', { subid, score: numScore });
    return res.status(200).json({ success: true, message: 'Marked' });
  }

  // ========== 题目管理 ==========
  if (action === 'problems') {
    if (req.method === 'GET') {
      const { id } = req.query;
      if (id) {
        const problem = await db.collection('problems').findOne({
          $or: [{ id: id }, ...(isNaN(Number(id)) ? [] : [{ id: Number(id) }])]
        });
        if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
        return res.status(200).json({ success: true, problem });
      }
      const problems = await db.collection('problems').find({}).toArray();
      return res.status(200).json({ success: true, problems });
    }

    if (req.method === 'POST') {
      const { id, name, statement, ans, difficulty, tags, public: isPublic, logic } = req.body;
      if (!id || !name || !statement || ans === undefined)
        return res.status(400).json({ success: false, message: 'Missing fields' });
      const exist = await db.collection('problems').findOne({ id });
      if (exist) return res.status(400).json({ success: false, message: 'Problem ID already exists' });
      const publicFlag = isPublic === false ? false : true;
      await db.collection('problems').insertOne({
        id, name,
        statement: statement,
        ans: String(ans),
        difficulty: difficulty || 0,
        tags: tags || [],
        public: publicFlag,
        logic: logic || ''   // 存储逻辑字符串
      });
      await db.collection('metadata').updateOne({ _key: 'problemsVersion' }, { $set: { version: Date.now() } });
      await auditLog('create_problem', { id });
      return res.status(201).json({ success: true, message: 'Problem created' });
    }

    if (req.method === 'PUT') {
      const { id, ids, name, statement, ans, difficulty, tags, public: isPublic, logic } = req.body;
      // 批量更新 public（隐藏/显示）
      if (ids && Array.isArray(ids) && ids.length && isPublic !== undefined) {
        const result = await db.collection('problems').updateMany(
          { id: { $in: ids } },
          { $set: { public: isPublic === false ? false : true } }
        );
        await auditLog('batch_update_problems', { ids, public: isPublic });
        return res.status(200).json({ success: true, message: `Updated ${result.modifiedCount} problems` });
      }
      // 单个更新
      if (!id) return res.status(400).json({ success: false, message: 'Missing problem ID' });
      const exist = await db.collection('problems').findOne({ id });
      if (!exist) return res.status(404).json({ success: false, message: 'Problem not found' });
      const upd = {};
      if (name !== undefined) upd.name = name;
      if (statement !== undefined) upd.statement = statement;
      if (ans !== undefined) upd.ans = String(ans);
      if (difficulty !== undefined) upd.difficulty = Number(difficulty) || 0;
      if (tags !== undefined) upd.tags = tags;
      if (isPublic !== undefined) upd.public = isPublic === false ? false : true;
      if (logic !== undefined) upd.logic = logic;   // 更新逻辑
      // if (mcPdfStyles !== undefined) upd.mcPdfStyles = mcPdfStyles;
      // if (mcPdfPlacements !== undefined) upd.mcPdfPlacements = mcPdfPlacements;
      await db.collection('problems').updateOne({ id }, { $set: upd });
      await db.collection('metadata').updateOne({ _key: 'problemsVersion' }, { $set: { version: Date.now() } });
      await auditLog('update_problem', { id, fields: Object.keys(upd) });
      return res.status(200).json({ success: true, message: 'Problem updated' });
    }

    if (req.method === 'DELETE') {
      const { id, ids } = req.body;
      if (!id && !ids) return res.status(400).json({ success: false, message: 'Missing id or ids' });

      if (id) {
        const result = await db.collection('problems').deleteOne({ id });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Problem not found' });
        await db.collection('userstats').updateMany({}, { $unset: { [`states.${id}`]: "" } });
        await auditLog('delete_problem', { id });
        return res.status(200).json({ success: true, message: 'Problem deleted' });
      }

      if (Array.isArray(ids) && ids.length) {
        const result = await db.collection('problems').deleteMany({ id: { $in: ids } });
        for (const pid of ids) {
          await db.collection('userstats').updateMany({}, { $unset: { [`states.${pid}`]: "" } });
        }
        await auditLog('delete_problems_batch', { ids });
        return res.status(200).json({ success: true, message: `Deleted ${result.deletedCount} problems` });
      }
      return res.status(400).json({ success: false, message: 'Invalid ids' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ========== 提交管理（ssubmissions） ==========
  if (action === 'ssubmissions') {
    if (req.method === 'GET') {
      const { problem_id, page = '1', limit = '50' } = req.query;
      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = Math.min(100, parseInt(limit) || 50);
      const filter = {};
      if (problem_id) {
        const pid = String(problem_id);
        const num = Number(pid);
        filter.problemId = { $in: [pid] };
        if (!isNaN(num)) filter.problemId.$in.push(num);
      }
      const [total, toMark, subs] = await Promise.all([
        db.collection('submissions').countDocuments(filter),
        db.collection('submissions').countDocuments({ type: 'image', marked: false }),
        db.collection('submissions').find(filter, { projection: { image: 0 } })
          .sort({ timestamp: -1 }).skip((pageNum - 1) * limitNum).limit(limitNum).toArray()
      ]);

      const pids = [...new Set(subs.map(s => s.problemId))];
      const probs = await db.collection('problems')
        .find({ id: { $in: pids } }, { projection: { id: 1, name: 1 } })
        .toArray();
      const nameMap = Object.fromEntries(probs.map(p => [p.id, p.name]));

      const enriched = subs.map(s => {
        let status;
        if (s.type === 'image') {
          if (s.marked) {
            if (s.score === 100) status = 'Accepted';
            else if (s.score === 0) status = 'Wrong Answer';
            else status = `Partial Score (${s.score})`;
          } else {
            status = 'Pending';
          }
        } else {
          status = s.systemError ? 'System Error' : (s.correct ? 'Accepted' : 'Wrong Answer');
        }
        return {
          ...s,
          problemName: nameMap[s.problemId] || `Problem #${s.problemId}`,
          status,
          answer: s.type === 'image' ? '[Image]' : s.answer
        };
      });

      return res.status(200).json({
        success: true,
        submissions: enriched,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        toMark       // 关键：必须显式返回
      });
    }

    if (req.method === 'DELETE') {
      const { submissionId } = req.body;
      if (!submissionId) return res.status(400).json({ success: false, message: 'Missing submission ID' });
      const { ObjectId } = await import('mongodb');
      let oid;
      try { oid = new ObjectId(submissionId); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
      const result = await db.collection('submissions').deleteOne({ _id: oid });
      if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Submission not found' });
      await auditLog('delete_submission', { submissionId });
      return res.status(200).json({ success: true, message: 'Submission deleted' });
    }

    if (req.method === 'PUT') {
      const { submissionId } = req.body;
      if (!submissionId) return res.status(400).json({ success: false, message: 'Missing submission ID' });
      const { ObjectId } = await import('mongodb');
      let oid;
      try { oid = new ObjectId(submissionId); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
      const sub = await db.collection('submissions').findOne({ _id: oid });
      if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });
      const problem = await db.collection('problems').findOne({ id: sub.problemId });
      if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });
      let correct = false, systemError = false;
      const ansStr = String(problem.ans).trim();
      const userAns = String(sub.answer).trim();
      const isValid = s => { const n = Number(s); return Number.isFinite(n); };
      if (!isValid(ansStr)) systemError = true;
      else {
        const userNum = Number(userAns);
        if (!Number.isFinite(userNum)) systemError = true;
        else correct = Math.abs(userNum - Number(ansStr)) < 1e-6;
      }
      await db.collection('submissions').updateOne({ _id: oid }, { $set: { correct, systemError } });
      const username = sub.username, problemId = sub.problemId;
      const statsCol = db.collection('userstats');
      const stats = await statsCol.findOne({ username });
      let states = stats ? stats.states : {};
      if (correct && states[problemId] !== 'passed') states[problemId] = 'passed';
      else if (!correct && states[problemId] !== 'passed') states[problemId] = 'failed';
      await statsCol.updateOne({ username }, { $set: { states } }, { upsert: true });
      await auditLog('rejudge_submission', { submissionId });
      return res.status(200).json({ success: true, correct, systemError, message: 'Rejudged' });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (action === 'privateFile') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { file } = req.query;
    if (!file) return res.status(400).json({ success: false, message: 'Missing file parameter' });

    // 只允许安全的文件名（字母、数字、下划线、连字符、点、%编码）
    if (!/^[\w\-.%]+$/.test(file)) return res.status(400).json({ success: false, message: 'Invalid file name' });

    const githubRawBase = 'https://raw.githubusercontent.com/wyk-math-team/resources/refs/heads/main/';
    const fileUrl = githubRawBase + file;

    try {
      const response = await fetch(fileUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) {
        return res.status(404).json({ success: false, message: 'File not found on GitHub' });
      }

      // 设置缓存头：边缘缓存 1 天，减少函数调用
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="' + file + '"');

      // 获取文件内容并返回
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      res.status(200).send(buffer);
    } catch (err) {
      console.error('Proxy error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
    return;
  }
  // ========== 管理用户 ==========
  if (action === 'users') {
    // GET
    if (req.method === 'GET') {
      const { username } = req.query;
      if (username) {
        const user = await db.collection('users').findOne({ username });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const { password, ...safeUser } = user;
        return res.status(200).json({ success: true, user: safeUser });
      }
      const users = await db.collection('users').find({}).project({ password: 0 }).toArray();
      return res.status(200).json({ success: true, users });
    }
    

    // POST
    if (req.method === 'POST') {
      const { username, password, displayName, role } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required' });
      }
      const existing = await db.collection('users').findOne({ username });
      if (existing) return res.status(400).json({ success: false, message: 'Username already exists' });

      let finalRole;
      if (decoded.role === 'root') {
        finalRole = (role === 'admin') ? 'admin' : 'student';
      } else {
        finalRole = 'student';
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser = {
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: finalRole,
        banned: false
      };
      await db.collection('users').insertOne(newUser);
      await db.collection('userstats').updateOne(
        { username },
        { $setOnInsert: { username, states: {} } },
        { upsert: true }
      );

      await auditLog(db, 'create_user', { username, role: finalRole }, decoded.username);
      return res.status(201).json({ success: true, message: 'User created' });
    }

    // PUT
    if (req.method === 'PUT') {
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const targetUser = await db.collection('users').findOne({ username });
      if (!targetUser) return res.status(404).json({ success: false, message: 'User not found' });
      if (targetUser.role === 'root') {
        return res.status(400).json({ success: false, message: 'Cannot modify root user' });
      }
      if (decoded.role === 'admin' && targetUser.role !== 'student') {
        return res.status(400).json({ success: false, message: 'Admin can only edit students' });
      }

      const updateFields = {};
      if (req.body.realName !== undefined) {
        updateFields.realName = String(req.body.realName).trim().slice(0, 60);
      }
      if (req.body.displayName !== undefined) {
        updateFields.displayName = req.body.displayName;
      }
      if (req.body.newUsername !== undefined && req.body.newUsername !== username) {
        const existingNew = await db.collection('users').findOne({ username: req.body.newUsername });
        if (existingNew) return res.status(400).json({ success: false, message: 'New username already exists' });
        updateFields.username = req.body.newUsername;
      }
      if (req.body.password !== undefined && req.body.password.trim() !== '') {
        try {
          updateFields.password = await bcrypt.hash(req.body.password, 10);
        } catch (hashError) {
          console.error('Password hashing error:', hashError);
          return res.status(500).json({ success: false, message: 'Password hashing failed' });
        }
      }
      if (req.body.role !== undefined) {
        if (decoded.role === 'root') {
          if (req.body.role === 'root') {
            return res.status(400).json({ success: false, message: 'Cannot promote to root' });
          }
          updateFields.role = req.body.role;
        } else {
          return res.status(400).json({ success: false, message: 'Admins cannot change user roles' });
        }
      }
      if (req.body.banned !== undefined) {
        if (decoded.role === 'root') {
          updateFields.banned = !!req.body.banned;
        } else if (decoded.role === 'admin' && targetUser.role === 'student') {
          updateFields.banned = !!req.body.banned;
        } else {
          return res.status(400).json({ success: false, message: 'Admin can only ban students' });
        }
      }

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      try {
        if (updateFields.username && updateFields.username !== username) {
          await db.collection('users').updateOne({ username }, { $set: updateFields });
          await db.collection('submissions').updateMany({ username }, { $set: { username: updateFields.username } });
          await db.collection('userstats').updateOne({ username }, { $set: { username: updateFields.username } });
        } else {
          await db.collection('users').updateOne({ username }, { $set: updateFields });
        }

        await auditLog(db, 'update_user', { username, fields: Object.keys(updateFields) }, decoded.username);
        return res.status(200).json({ success: true, message: 'User updated' });
      } catch (dbError) {
        console.error('Database update error:', dbError);
        return res.status(500).json({ success: false, message: 'Database update failed: ' + dbError.message });
      }
    }

    // DELETE
    if (req.method === 'DELETE') {
      const { username } = req.query;
      if (!username) return res.status(400).json({ success: false, message: 'Missing username' });

      const user = await db.collection('users').findOne({ username });
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (user.role === 'root') {
        return res.status(403).json({ success: false, message: 'Cannot delete root user' });
      }
      if (decoded.role === 'admin' && user.role !== 'student') {
        return res.status(403).json({ success: false, message: 'Admin can only delete students' });
      }

      await db.collection('users').deleteOne({ username });
      await db.collection('submissions').deleteMany({ username });
      await db.collection('userstats').deleteOne({ username });

      await auditLog(db, 'delete_user', { username }, decoded.username);
      return res.status(200).json({ success: true, message: 'User deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ========== 管理公告 ==========
  if (action === 'updates') {
    if (req.method === 'GET') {
      const { id } = req.query;
      if (id) {
        const { ObjectId } = await import('mongodb');
        let objectId;
        try { objectId = new ObjectId(id); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }
        const update = await db.collection('updates').findOne({ _id: objectId });
        if (!update) return res.status(404).json({ success: false, message: 'Update not found' });
        return res.status(200).json({ success: true, update });
      }
      const updates = await db.collection('updates').find({}).sort({ date: -1 }).toArray();
      return res.status(200).json({ success: true, updates });
    }

    if (req.method === 'POST') {
      const { badge, badgeText, time, title, content, locked } = req.body;
      if (!badge || !badgeText || !time || !content) {
        return res.status(400).json({ success: false, message: 'Missing fields (badge, badgeText, time, content are required)' });
      }
      const cleanedContent = sanitizeHTML(content);
      const newUpdate = {
        badge,
        badgeText,
        time,                         // 直接使用客户端传来的时间字符串
        title: title ? sanitizeHTML(title) : '',
        content: cleanedContent,
        date: new Date(),
        locked: !!locked
      };
      await db.collection('updates').insertOne(newUpdate);
      await auditLog(db, 'create_update', { title }, decoded.username);
      return res.status(201).json({ success: true, message: 'Update created' });
    }

    if (req.method === 'PUT') {
      const { id, badge, badgeText, time, title, content, locked } = req.body;
      if (!id) return res.status(400).json({ success: false, message: 'Missing update ID' });
      const { ObjectId } = await import('mongodb');
      let objectId;
      try { objectId = new ObjectId(id); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }

      const existing = await db.collection('updates').findOne({ _id: objectId });
      if (!existing) return res.status(404).json({ success: false, message: 'Update not found' });
      if (existing.locked && decoded.role !== 'root') {
        return res.status(403).json({ success: false, message: 'Only root can edit locked updates' });
      }

      const updateFields = {};
      if (badge !== undefined) updateFields.badge = badge;
      if (badgeText !== undefined) updateFields.badgeText = badgeText;
      if (title !== undefined) updateFields.title = sanitizeHTML(title);
      if (content !== undefined) updateFields.content = sanitizeHTML(content);
      if (locked !== undefined && decoded.role === 'root') {
        updateFields.locked = (locked === true);
      }
      // 不更新 time 字段（保持原值）

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      await db.collection('updates').updateOne({ _id: objectId }, { $set: updateFields });
      await auditLog(db, 'update_update', { id }, decoded.username);
      return res.status(200).json({ success: true, message: 'Update updated' });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ success: false, message: 'Missing update ID' });
      const { ObjectId } = await import('mongodb');
      let objectId;
      try { objectId = new ObjectId(id); } catch { return res.status(400).json({ success: false, message: 'Invalid ID' }); }

      const update = await db.collection('updates').findOne({ _id: objectId });
      if (!update) return res.status(404).json({ success: false, message: 'Update not found' });
      if (update.locked && decoded.role !== 'root') {
        return res.status(403).json({ success: false, message: 'Only root can delete locked updates' });
      }

      const result = await db.collection('updates').deleteOne({ _id: objectId });
      if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Update not found' });

      await auditLog(db, 'delete_update', { id }, decoded.username);
      return res.status(200).json({ success: true, message: 'Update deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ========== 管理资源 ==========
  if (action === 'resources') {
    const collection = db.collection('resources');

    if (req.method === 'GET') {
      const resources = await collection.find({}).sort({ order: 1, id: 1 }).toArray();
      return res.status(200).json({ success: true, resources });
    }

    if (req.method === 'POST') {
      const { id, title, summary, content, level, order } = req.body;
      if (!id || !title || !content) {
        return res.status(400).json({ success: false, message: 'id, title, content are required' });
      }
      const existing = await collection.findOne({ id });
      if (existing) return res.status(400).json({ success: false, message: 'Resource ID already exists' });

      const newResource = {
        id,
        title: sanitizeHTML(title),
        summary: summary ? sanitizeHTML(summary) : '',
        content: sanitizeHTML(content),
        level: level || '',
        order: order || 0
      };
      await collection.insertOne(newResource);
      await auditLog(db, 'create_resource', { id }, decoded.username);
      return res.status(201).json({ success: true, message: 'Resource created' });
    }

    if (req.method === 'PUT') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ success: false, message: 'Missing resource ID' });

      const existing = await collection.findOne({ id });
      if (!existing) return res.status(404).json({ success: false, message: 'Resource not found' });

      const updateFields = {};
      if (req.body.title !== undefined) updateFields.title = sanitizeHTML(req.body.title);
      if (req.body.summary !== undefined) updateFields.summary = sanitizeHTML(req.body.summary);
      if (req.body.content !== undefined) updateFields.content = sanitizeHTML(req.body.content);
      if (req.body.level !== undefined) updateFields.level = req.body.level;
      if (req.body.order !== undefined) updateFields.order = Number(req.body.order);

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      await collection.updateOne({ id }, { $set: updateFields });
      await auditLog(db, 'update_resource', { id }, decoded.username);
      return res.status(200).json({ success: true, message: 'Resource updated' });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ success: false, message: 'Missing resource ID' });
      const result = await collection.deleteOne({ id });
      if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Resource not found' });

      await auditLog(db, 'delete_resource', { id }, decoded.username);
      return res.status(200).json({ success: true, message: 'Resource deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }
    // ========== 审计日志查询 ==========
  if (action === 'logs') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    // 仅 admin/root 可访问（已在上层验证）

    const { page = '1', limit = '20', actionFilter, operatorFilter } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    const filter = {};
    if (actionFilter) filter.action = { $regex: actionFilter, $options: 'i' };
    if (operatorFilter) filter.operator = { $regex: operatorFilter, $options: 'i' };

    try {
      const total = await db.collection('audit_logs').countDocuments(filter);
      const logs = await db.collection('audit_logs')
        .find(filter)
        .sort({ timestamp: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .toArray();

      return res.status(200).json({
        success: true,
        logs,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      });
    } catch (err) {
      console.error('Logs error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // ========== 同步版本号 ==========
  if (action === 'syncVersion') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const newVer = Date.now();
    await db.collection('metadata').updateOne({ _key: 'problemsVersion' }, { $set: { version: newVer } });
    await auditLog('sync_version', { newVer });
    return res.status(200).json({ success: true, version: newVer });
  }
    // ========== 高级命令终端 ==========
  if (action === 'cmd') {
    if (decoded.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Only root can use this terminal' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { mode, code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Missing code' });

    try {
      let result, output = '';
      // 捕获 console.log 输出
      const logs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        logs.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
      };

      const vm = await import('vm');
      const context = vm.createContext({
        console: {
          log: (...args) => {
            logs.push(args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
          },
          error: (...args) => {
            logs.push('[ERROR] ' + args.map(arg => String(arg)).join(' '));
          },
          warn: (...args) => {
            logs.push('[WARN] ' + args.map(arg => String(arg)).join(' '));
          }
        },
        Buffer,
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        Promise,
        process,
        require: (moduleName) => require(moduleName),
        // 对于 db 模式，注入 db 和 ObjectId
        ...(mode === 'db' ? {
          db: db,
          ObjectId: (await import('mongodb')).ObjectId,
          ISODate: Date
        } : {})
      });

      // 如果是 db 模式，还可以提供额外的辅助
      if (mode === 'db') {
        // 可以注入一些常用的 MongoDB 辅助，但无需额外
      }

      // 包装代码为异步函数，以便支持 await
      const asyncWrapper = `(async () => { ${code} })()`;
      const script = new vm.Script(asyncWrapper);
      const rawResult = await script.runInContext(context);
      // 恢复 console.log
      console.log = originalLog;
      output = logs.join('\n');
      result = rawResult;

      // 如果 result 是 undefined，忽略
      if (result === undefined) {
        // 仅输出日志
      }

      return res.status(200).json({ success: true, output, result: result !== undefined ? result : null });
    } catch (err) {
      console.error('CMD error:', err);
      return res.status(500).json({ success: false, message: err.message });
    }
  }
  // ========== SQL 终端 ==========
  if (action === 'terminal') {
    if (decoded.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Only root can use SQL terminal' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { sql } = req.body;
    if (!sql) return res.status(400).json({ success: false, message: 'Missing SQL command' });

    try {
      const result = await executeSQL(db, sql);
      await auditLog(db, 'terminal_exec', { sql }, decoded.username);
      res.status(200).json({ success: true, result });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
    return;
  }
  // ========== 管理竞赛 ==========
  if (action === 'contests') {
    // GET 获取列表或单个竞赛
    if (req.method === 'GET') {
      const { id } = req.query;

      // 单个竞赛详情（用于编辑）
      if (id) {
        const contest = await db.collection('contests').findOne({ id: Number(id) });
        if (!contest) return res.status(404).json({ success: false, message: 'Contest not found' });
        return res.status(200).json({ success: true, contest });
      }

      // 全部列表
      const contests = await db.collection('contests')
        .find({})
        .sort({ id: -1 })
        .toArray();
      return res.status(200).json({ success: true, contests });
    }

    // POST 创建竞赛（自动生成数字 id）
    if (req.method === 'POST') {
      const { name, problems, participants, startTime, duration, public: isPublic } = req.body;
      if (!name || !startTime || !duration) {
        return res.status(400).json({ success: false, message: 'Missing required fields (name, startTime, duration)' });
      }

      // 自动生成下一个数字 ID（从 1 开始递增）
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
        problems: problems || [],
        participants: participants || [],
        public: isPublic !== false,
        createdBy: decoded.username
      };

      await db.collection('contests').insertOne(newContest);
      await auditLog('create_contest', { id: nextId });
      return res.status(201).json({ success: true, message: 'Contest created', id: nextId });
    }

    // PUT 更新竞赛
    if (req.method === 'PUT') {
      const { id } = req.query;        // 从 URL 参数获取 id
      if (!id) return res.status(400).json({ success: false, message: 'Missing contest id' });
      const numericId = Number(id);

      const exist = await db.collection('contests').findOne({ id: numericId });
      if (!exist) return res.status(404).json({ success: false, message: 'Contest not found' });

      const updateFields = {};
      if (req.body.name !== undefined) updateFields.name = req.body.name;
      if (req.body.startTime !== undefined) updateFields.startTime = new Date(req.body.startTime);
      if (req.body.duration !== undefined) updateFields.duration = Math.min(Math.max(0, parseInt(req.body.duration) || 0), 201600000);
      if (req.body.problems !== undefined) updateFields.problems = req.body.problems;
      if (req.body.participants !== undefined) updateFields.participants = req.body.participants;
      if (req.body.public !== undefined) updateFields.public = req.body.public;

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ success: false, message: 'No fields to update' });
      }

      await db.collection('contests').updateOne({ id: numericId }, { $set: updateFields });
      await auditLog('update_contest', { id: numericId, fields: Object.keys(updateFields) });
      return res.status(200).json({ success: true, message: 'Contest updated' });
    }

    // DELETE 删除竞赛
    if (req.method === 'DELETE') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ success: false, message: 'Missing contest id' });
      const numericId = Number(id);

      const result = await db.collection('contests').deleteOne({ id: numericId });
      if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Contest not found' });
      await db.collection('contest_results').deleteMany({ contestId: numericId });
      await auditLog('delete_contest', { id: numericId });
      return res.status(200).json({ success: true, message: 'Contest deleted' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }
  // ========== 管理讨论：删除帖子 ==========
  if (action === 'deleteDiscussion') {
    if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
    const { id } = req.body;  // 通过 body 传 id
    if (!id) return res.status(400).json({ success: false, message: 'Missing discussion id' });
    const { ObjectId } = await import('mongodb');
    let oid;
    try { oid = new ObjectId(id); } catch { return res.status(400).json({ message: 'Invalid ID' }); }
    const result = await db.collection('discussions').deleteOne({ _id: oid });
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Post not found' });
    await auditLog('delete_discussion', { id });
    return res.status(200).json({ success: true, message: 'Discussion deleted' });
  }

  // ========== 管理讨论：设置 likes 数值 ==========
  if (action === 'setDiscussionLikes') {
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
    const { id, likes } = req.body;
    if (!id || likes === undefined) return res.status(400).json({ success: false, message: 'Missing id or likes' });
    const { ObjectId } = await import('mongodb');
    let oid;
    try { oid = new ObjectId(id); } catch { return res.status(400).json({ message: 'Invalid ID' }); }
    const result = await db.collection('discussions').updateOne(
      { _id: oid },
      { $set: { likes: Number(likes) } }
    );
    if (result.modifiedCount === 0) return res.status(404).json({ success: false, message: 'Post not found' });
    await auditLog('set_discussion_likes', { id, likes });
    return res.status(200).json({ success: true, message: 'Likes updated' });
  }
  // ========== executeSQL 函数 ==========
  async function executeSQL(db, sql) {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();
  // const allowedCollections = ['problems', 'users', 'submissions', 'userstats', 'updates', 'contests', 'contest_results', 'metadata'];

  // SHOW TABLES
  if (upper === 'SHOW TABLES') {
    return { type: 'show_tables', collections: allowedCollections };
  }
  if (upper.startsWith('DESCRIBE ') || upper.startsWith('DESC ') || upper.startsWith('SHOW COLUMNS')) {
    let collection;
    if (upper.startsWith('SHOW COLUMNS')) {
      const m = trimmed.match(/SHOW\s+COLUMNS\s+FROM\s+(\w+)/i);
      if (!m) throw new Error('Usage: SHOW COLUMNS FROM table');
      collection = m[1];
    } else {
      const parts = trimmed.split(/\s+/);
      if (parts.length < 2) throw new Error('Usage: DESCRIBE table');
      collection = parts[1];
    }

    if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error(`Collection '${collection}' not allowed.`);

    const doc = await db.collection(collection).findOne({});
    if (!doc) return { type: 'describe', message: `Collection '${collection}' is empty.`, columns: [], rows: [] };

    const fields = Object.keys(doc).map(field => {
      const val = doc[field];
      let type = typeof val;
      if (val instanceof Date) type = 'date';
      else if (Array.isArray(val)) type = 'array';
      else if (val === null) type = 'null';
      else if (type === 'object') type = 'object';
      return { Field: field, Type: type };
    });

    const columns = ['Field', 'Type'];
    const rows = fields.map(f => [f.Field, f.Type]);
    return {
      type: 'select',
      count: fields.length,
      columns,
      rows,
      tableHtml: buildTableHtml(columns, rows)
    };
  }

  // CREATE TABLE
  if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE COLLECTION')) {
    const createRegex = /CREATE\s+(?:TABLE|COLLECTION)\s+(\w+)(?:\s*\((.+)\))?$/i;
    const match = trimmed.match(createRegex);
    if (!match) throw new Error('Invalid CREATE TABLE syntax. Example: CREATE TABLE mycoll (field1, field2)');
    const collection = match[1];
    if (!/^[a-zA-Z_]\w*$/.test(collection)) throw new Error('Invalid collection name.');
    await db.createCollection(collection);
    return { type: 'create_table', message: `Collection '${collection}' created (or already exists).` };
  }

  // DROP TABLE
  if (upper.startsWith('DROP TABLE') || upper.startsWith('DROP COLLECTION')) {
    const dropRegex = /DROP\s+(?:TABLE|COLLECTION)\s+(\w+)/i;
    const match = trimmed.match(dropRegex);
    if (!match) throw new Error('Invalid DROP TABLE syntax.');
    const collection = match[1];
    if (!allowedCollections.includes(collection) && collection !== 'discussions' && collection !== 'audit_logs') {
      throw new Error(`Cannot drop protected collection '${collection}'.`);
    }
    await db.collection(collection).drop();
    return { type: 'drop_table', message: `Collection '${collection}' dropped.` };
  }

  // ALTER TABLE ADD COLUMN / DROP COLUMN
  if (upper.startsWith('ALTER TABLE')) {
    if (upper.includes('ADD COLUMN')) {
      const alterAddRegex = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i;
      const match = trimmed.match(alterAddRegex);
      if (!match) throw new Error('Invalid ALTER TABLE ADD COLUMN syntax.');
      const collection = match[1];
      const field = match[2];
      if (!allowedCollections.includes(collection)) throw new Error(`Cannot alter '${collection}'.`);
      return { type: 'alter_add_column', message: `Column '${field}' added to '${collection}' (you may need to update existing documents).` };
    }
    if (upper.includes('DROP COLUMN')) {
      const alterDropRegex = /ALTER\s+TABLE\s+(\w+)\s+DROP\s+COLUMN\s+(\w+)/i;
      const match = trimmed.match(alterDropRegex);
      if (!match) throw new Error('Invalid ALTER TABLE DROP COLUMN syntax.');
      const collection = match[1];
      const field = match[2];
      if (['username', 'password', 'role', 'id', 'states', 'public'].includes(field))
        throw new Error(`Cannot drop protected field '${field}'.`);
      await db.collection(collection).updateMany({}, { $unset: { [field]: "" } });
      return { type: 'alter_drop_column', message: `Dropped column '${field}' from ${collection}.` };
    }
    throw new Error('Unsupported ALTER TABLE operation.');
  }

  // SELECT with JOIN
  if (upper.startsWith('SELECT') && (upper.includes(' JOIN ') || upper.includes(' LEFT JOIN ') || upper.includes(' INNER JOIN '))) {
    return await handleSelectWithJoin(db, trimmed);
  }

  // Standard SELECT (no join)
  if (upper.startsWith('SELECT')) {
    return await handleSelectStandard(db, trimmed);
  }

  // INSERT, UPDATE, DELETE remain unchanged
  if (upper.startsWith('INSERT INTO')) {
    return await handleInsert(db, trimmed);
  }
  if (upper.startsWith('UPDATE')) {
    return await handleUpdate(db, trimmed);
  }
  if (upper.startsWith('DELETE')) {
    return await handleDelete(db, trimmed);
  }

  throw new Error('Unsupported SQL command. Allowed: SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, DROP TABLE, ALTER TABLE, SHOW TABLES, plus JOIN syntax.');
  }
  async function handleSelectWithJoin(db, sql) {
  // Example: SELECT t1.col1, t2.col2 FROM problems t1 INNER JOIN submissions t2 ON t1.id = t2.problemId WHERE t2.username='user' ORDER BY t1.id LIMIT 10
  const joinRegex = /SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+(\w+))?\s+(INNER|LEFT)?\s*JOIN\s+(\w+)(?:\s+(\w+))?\s+ON\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?(?:\s+LIMIT\s+(\d+))?$/i;
  const match = sql.match(joinRegex);
  if (!match) throw new Error('Invalid JOIN syntax. Example: SELECT * FROM t1 a JOIN t2 b ON a.id = b.id WHERE ...');

  const columnsPart = match[1].trim();
  const mainTable = match[2];
  const mainAlias = match[3] || mainTable;
  const joinType = (match[4] || 'INNER').toUpperCase();
  const joinTable = match[5];
  const joinAlias = match[6] || joinTable;
  const onClause = match[7].trim();
  const whereClause = match[8] || null;
  const orderField = match[9] || null;
  const orderDir = (match[10] || 'ASC').toUpperCase() === 'ASC' ? 1 : -1;
  const limit = match[11] ? parseInt(match[11]) : null;

  if (!allowedCollections.includes(mainTable)) throw new Error(`Collection '${mainTable}' not allowed.`);
  if (!allowedCollections.includes(joinTable)) throw new Error(`Collection '${joinTable}' not allowed.`);

  // Parse ON condition: expect "main.field = join.field" or "alias.field = alias.field"
  const onParts = onClause.split('=').map(s => s.trim());
  if (onParts.length !== 2) throw new Error('ON clause must be a single equality.');
  const leftField = onParts[0].split('.').pop();  // take field name after dot, e.g., "t1.id" -> "id"
  const rightField = onParts[1].split('.').pop();

  // Build aggregation pipeline
  const pipeline = [];

  // Match on main table (if WHERE clause present, we will apply after join as $match with aliases? 
  // Simpler: apply main table filter via $match on main collection before join
  if (whereClause) {
    // Convert where clause to filter object for main table
    const mainFilter = parseWhereClause(whereClause);
    if (mainFilter) pipeline.push({ $match: mainFilter });
  }

  // $lookup
  const lookupStage = {
    $lookup: {
      from: joinTable,
      let: { localField: `$${leftField}` },
      pipeline: [
        { $match: { $expr: { $eq: [`$${rightField}`, '$$localField'] } } }
      ],
      as: 'joinedData'
    }
  };
  pipeline.push(lookupStage);

  // For INNER JOIN, unwind and filter out empty arrays
  if (joinType === 'INNER') {
    pipeline.push({ $unwind: '$joinedData' });
  } else {
    // LEFT JOIN: optionally preserve empty arrays (no unwind)
    // We'll leave them as is, but when projecting we'll need to handle nulls
  }

  // Project desired columns
  const columns = columnsPart === '*' 
    ? []  // We'll handle after fetching sample, but we can't easily without knowing structure
    : columnsPart.split(',').map(c => c.trim());

  // If columns is empty (SELECT *), we need to project all fields from both tables?
  // For simplicity, require explicit columns or at least '*' will produce all fields from main and joined.
  // We'll implement a fallback: if columnsPart is '*', we project everything from main and joined using $addFields or just pass through.
  // Better: after lookup, we can merge fields into root using $replaceRoot for INNER, or add fields.
  // Let's create a projection that includes all main fields and the joined object or its fields.
  if (columns.length === 0) {
    // SELECT * : return main document + joined document merged at top level? 
    // We'll just include main document and the joined array (or object) as 'joinedData', then return them separately.
    // The table representation will show nested objects, which is okay.
    pipeline.push({
      $project: {
        _id: 0,
        ...Object.fromEntries(['password'].map(k => [k, 0])),
        // We cannot predefine all fields. Instead, we can use $replaceRoot for INNER to flatten.
      }
    });
    // For better UX, we can try to flatten for INNER join.
    if (joinType === 'INNER') {
      // Replace root with a merged document: main fields + joined fields prefixed with joinAlias_
      // Not trivial, skip for now; we'll just output main doc and joined doc as separate columns.
    }
  } else {
    // Build explicit projection
    const project = { _id: 0 };
    columns.forEach(col => {
      // col may include alias like "t1.id" or "id" - assume if no alias, it's from main table
      const parts = col.split('.');
      if (parts.length === 2) {
        const alias = parts[0];
        const field = parts[1];
        if (alias === mainAlias) {
          project[field] = `$${field}`;
        } else if (alias === joinAlias) {
          project[`${joinAlias}_${field}`] = `$joinedData.${field}`;
        } else {
          // maybe just field name, treat as main
          project[field] = `$${field}`;
        }
      } else {
        // simple column name, assume main
        project[col] = `$${col}`;
      }
    });
    pipeline.push({ $project: project });
  }

  // Sort
  if (orderField) {
    pipeline.push({ $sort: { [orderField]: orderDir } });
  }

  // Limit
  if (limit) {
    pipeline.push({ $limit: limit });
  }

  const documents = await db.collection(mainTable).aggregate(pipeline).toArray();

  // Build table columns and rows
  let finalColumns;
  if (columns.length === 0) {
    // determine from first doc
    if (documents.length > 0) {
      finalColumns = Object.keys(documents[0]).filter(k => !['password','ans','_id'].includes(k));
    } else {
      finalColumns = [];
    }
  } else {
    finalColumns = columns.map(col => {
      const parts = col.split('.');
      return parts.length === 2 ? `${joinAlias}_${parts[1]}` : col;
    });
  }

  const rows = documents.map(doc => finalColumns.map(col => doc[col] ?? ''));

  return {
    type: 'select',
    count: documents.length,
    columns: finalColumns,
    rows,
    tableHtml: buildTableHtml(finalColumns, rows)
  };
  }
  async function handleSelectStandard(db, sql) {
  const selectRegex = /^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)\s+(ASC|DESC))?(?:\s+LIMIT\s+(\d+))?$/i;
  const match = sql.match(selectRegex);
  if (!match) throw new Error('Invalid SELECT syntax.');

  const columnsPart = match[1].trim();
  const collection = match[2];
  const whereClause = match[3] || null;
  const orderField = match[4] || null;
  const orderDir = (match[5] || 'ASC').toUpperCase() === 'ASC' ? 1 : -1;
  const limit = match[6] ? parseInt(match[6]) : null;

  if (!allowedCollections.includes(collection)) throw new Error(`Collection '${collection}' not allowed.`);

  const projection = { password: 0, ans: 0};
  let filter = {};
  if (whereClause) {
    filter = parseWhereClause(whereClause);
  }

  let cursor = db.collection(collection).find(filter, { projection });
  if (orderField) cursor = cursor.sort({ [orderField]: orderDir });
  if (limit) cursor = cursor.limit(limit);

  const documents = await cursor.toArray();

  let columns;
  if (columnsPart === '*') {
    columns = documents.length > 0 ? Object.keys(documents[0]).filter(k => !['password','ans'].includes(k)) : [];
  } else {
    columns = columnsPart.split(',').map(c => c.trim());
  }

  const rows = documents.map(doc => columns.map(col => doc[col] ?? ''));

  return {
    type: 'select',
    count: documents.length,
    columns,
    rows,
    tableHtml: buildTableHtml(columns, rows)
  };
  }
  async function handleInsert(db, sql) {
  const insertRegex = /INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*(.+)$/i;
  const match = sql.match(insertRegex);
  if (!match) throw new Error('Invalid INSERT syntax.');
  const collection = match[1];
  if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error(`Cannot insert into '${collection}'.`);
  const fields = match[2].split(',').map(f => f.trim());
  const valuesPart = match[3].trim();
  const valueRows = valuesPart.match(/\([^)]+\)/g);
  if (!valueRows) throw new Error('Invalid VALUES format.');
  const documents = valueRows.map(row => {
    const inner = row.slice(1, -1).trim();
    const vals = inner.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
    const doc = {};
    fields.forEach((field, i) => {
      let val = vals[i];
      if (!isNaN(val) && val !== '') val = Number(val);
      doc[field] = val;
    });
    return doc;
  });
  const result = await db.collection(collection).insertMany(documents);
  return { type: 'insert', message: `Inserted ${result.insertedCount} document(s) into ${collection}.` };
  }
  async function handleUpdate(db, sql) {
    const updateRegex = /UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i;
    const match = sql.match(updateRegex);
    if (!match) throw new Error('Invalid UPDATE syntax.');
    const collection = match[1];
    if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error(`Cannot update '${collection}'.`);
    const setStr = match[2];
    const setPairs = setStr.split(',').map(pair => pair.split('=').map(s => s.trim()));
    const setObj = {};
    setPairs.forEach(([field, value]) => {
      let val = value.replace(/^["']|["']$/g, '');
      if (!isNaN(val) && val !== '') val = Number(val);
      setObj[field] = val;
    });
    let filter = {};
    const whereClause = match[3] || null;
    if (whereClause) filter = parseWhereClause(whereClause);
    const result = await db.collection(collection).updateMany(filter, { $set: setObj });
    return { type: 'update', message: `Updated ${result.modifiedCount} document(s) in ${collection}.` };
  }
  async function handleDelete(db, sql) {
    const deleteRegex = /DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i;
    const match = sql.match(deleteRegex);
    if (!match) throw new Error('Invalid DELETE syntax.');
    const collection = match[1];
    if (!ALLOWED_COLLECTIONS.includes(collection)) throw new Error(`Cannot delete from '${collection}'.`);
    const whereClause = match[2] || null;
    if (!whereClause) throw new Error('WHERE clause required for DELETE.');
    let filter = parseWhereClause(whereClause);
    const result = await db.collection(collection).deleteMany(filter);
    return { type: 'delete', message: `Deleted ${result.deletedCount} document(s) from ${collection}.` };
  }
  function parseWhereClause(whereStr) {
    // 先按 OR 分割（优先级最低），每个部分再按 AND 分割
    const orParts = whereStr.split(/\s+OR\s+/i);
    if (orParts.length > 1) {
      return { '$or': orParts.map(part => parseAndClause(part)) };
    } else {
      return parseAndClause(whereStr);
    }
  }
  function parseAndClause(andStr) {
    const andParts = andStr.split(/\s+AND\s+/i);
    if (andParts.length > 1) {
      return { '$and': andParts.map(part => parseSingleCondition(part)) };
    } else {
      return parseSingleCondition(andStr);
    }
  }
  function parseSingleCondition(condStr) {
    condStr = condStr.trim();
    // 支持 LIKE
    let m = condStr.match(/^(\w+)\s+LIKE\s+(.+)$/i);
    if (m) {
      const field = m[1];
      let value = m[2].trim().replace(/^["']|["']$/g, '');
      const escaped = value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = escaped.replace(/%/g, '.*').replace(/_/g, '.');
      return { [field]: { $regex: new RegExp('^' + regex + '$', 'i') } };
    }
    // 支持 >= <= > < = !=
    m = condStr.match(/^(\w+)\s*(>=|<=|!=|>|<|=)\s*(.+)$/);
    if (m) {
      const field = m[1];
      const op = m[2];
      let value = m[3].trim().replace(/^["']|["']$/g, '');
      // 转换为数字如果可能
      if (!isNaN(value) && value !== '') value = Number(value);
      switch (op) {
        case '=': return { [field]: value };
        case '!=': return { [field]: { $ne: value } };
        case '>': return { [field]: { $gt: value } };
        case '<': return { [field]: { $lt: value } };
        case '>=': return { [field]: { $gte: value } };
        case '<=': return { [field]: { $lte: value } };
      }
    }
    throw new Error('Invalid condition: ' + condStr);
  }
  function parseConditionGroup(condStr) {
    const andParts = condStr.split(/\s+AND\s+/i);
    const filter = {};
    andParts.forEach(part => {
      let m = part.match(/^(\w+)\s+LIKE\s+(.+)$/i);
      if (m) {
        const field = m[1];
        let value = m[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        const escaped = value.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = escaped.replace(/%/g, '.*').replace(/_/g, '.');
        filter[field] = { $regex: new RegExp('^' + regex + '$', 'i') };
        return;
      }
      m = part.match(/^(\w+)\s*=\s*(.+)$/i);
      if (m) {
        const field = m[1];
        let value = m[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!isNaN(value) && value !== '') value = Number(value);
        filter[field] = value;
        return;
      }
      throw new Error('Invalid condition: ' + part);
    });
    return filter;
  }
  function buildTableHtml(columns, rows) {
  function esc(val) {
    return String(val).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  let html = '<table class="sql-result-table"><thead><tr>';
  columns.forEach(col => { html += `<th>${esc(col)}</th>`; });
  html += '</tr></thead><tbody>';
  rows.forEach(row => {
    html += '<tr>';
    row.forEach(cell => { html += `<td>${esc(cell)}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
  }
    // ========== 題目圖片上傳（Cloudinary，folder: problems）==========
  if (action === 'uploadImage') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { image } = req.body || {};
    if (!image || typeof image !== 'string') {
      return res.status(400).json({ success: false, message: 'Missing image data' });
    }

    // 大小檢查（2 MB）
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const approxBytes = Math.floor(base64Data.length * 3 / 4);
    if (approxBytes > 2 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: 'Image too large (max 2MB)' });
    }

    try {
      const { uploadImage } = await import('../lib/cloudinary.js');
      const url = await uploadImage(image, { folder: 'problems' });
      await auditLog('upload_problem_image', { url });
      return res.status(200).json({ success: true, url });
    } catch (err) {
      console.error('Problem image upload error:', err);
      return res.status(500).json({ success: false, message: 'Upload failed: ' + err.message });
    }
  }
  return res.status(400).json({ success: false, message: 'Invalid action' });
}