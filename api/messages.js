// api/messages.js
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { ObjectId } from 'mongodb';
import { wrapHandler } from '../lib/errors.js';
import { consumeTokens, getTokenBalance } from '../lib/token.js';

// 允许发送的固定词
const ALLOWED_WORDS = ['Wake', 'Ok', 'Trivial'];
const MESSAGE_COST = 1000;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;   // 题号 / 提交 id / room id 的合法形状

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const col = db.collection('messages');

  // ── 读：默认返回全部消息，并把未读一次性标成已读 ──
  if (req.method === 'GET') {
    const onlyUnread = req.query.unread === '1';
    const filter = onlyUnread
      ? { username: decoded.username, read: false }
      : { username: decoded.username };

    const msgs = await col.find(filter).sort({ createdAt: -1 }).limit(300).toArray();

    // 访问一次就把警告清掉（消息本身仍然留在收件箱里）
    if (!onlyUnread) {
      await col.updateMany(
        { username: decoded.username, read: false },
        { $set: { read: true, readAt: new Date() } }
      );
    }

    return res.status(200).json({ success: true, messages: msgs });
  }

  // ── 写 ──
  if (req.method === 'POST') {
    const body = req.body || {};

    // 兼容旧调用：{ id } 单条标记已读
    if (body.id && !body.kind) {
      try {
        await col.updateOne(
          { _id: new ObjectId(body.id), username: decoded.username },
          { $set: { read: true, readAt: new Date() } }
        );
        return res.status(200).json({ success: true });
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid ID format' });
      }
    }

    // 用户之间发消息
    const { to, kind, text, problemId, submissionId, roomId } = body;
    if (!to) return res.status(400).json({ success: false, message: 'Missing recipient' });
    if (to === decoded.username) return res.status(400).json({ success: false, message: 'You cannot message yourself' });

    const target = await db.collection('users').findOne({ username: to }, { projection: { username: 1 } });
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    // 只允许这五种内容
    let doc = null;
    if (kind === 'text') {
      if (!ALLOWED_WORDS.includes(String(text))) {
        return res.status(400).json({ success: false, message: 'Only Wake / Ok / Trivial can be sent', allowed: ALLOWED_WORDS });
      }
      doc = { kind: 'text', text: String(text) };
    } else if (kind === 'problem') {
      if (!ID_RE.test(String(problemId || ''))) return res.status(400).json({ success: false, message: 'Invalid problem id' });
      const exists = await db.collection('problems').findOne({ id: String(problemId) }, { projection: { id: 1 } });
      if (!exists) return res.status(404).json({ success: false, message: 'Problem not found' });
      doc = { kind: 'problem', problemId: String(problemId) };
    } else if (kind === 'submission') {
      if (!ID_RE.test(String(submissionId || ''))) return res.status(400).json({ success: false, message: 'Invalid submission id' });
      const exists = await db.collection('submissions').findOne({ subid: String(submissionId) }, { projection: { subid: 1 } });
      if (!exists) return res.status(404).json({ success: false, message: 'Submission not found' });
      doc = { kind: 'submission', submissionId: String(submissionId) };
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported message kind' });
    }

    // 收费
    const balance = await getTokenBalance(db, decoded.username);
    const available = (balance.daily || 0) + (balance.global || 0);
    if (available < MESSAGE_COST) {
      return res.status(400).json({
        success: false,
        message: 'Not enough tokens: sending a message costs ' + MESSAGE_COST + ' tokens.',
        need: MESSAGE_COST,
        have: available,
      });
    }
    const after = await consumeTokens(db, decoded.username, MESSAGE_COST);

    await col.insertOne({
      username: to,
      from: decoded.username,
      ...doc,
      roomId: roomId && ID_RE.test(String(roomId)) ? String(roomId) : undefined,
      read: false,
      createdAt: new Date(),
    });

    return res.status(200).json({ success: true, cost: MESSAGE_COST, tokens: after });
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}

export default wrapHandler(handler);
