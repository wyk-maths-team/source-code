// api/messages.js —— 收件箱 + 会话
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { ObjectId } from 'mongodb';
import { wrapHandler } from '../lib/errors.js';
import { consumeTokens, getTokenBalance } from '../lib/token.js';

const ALLOWED_WORDS = ['Wake', 'Ok', 'Trivial'];
const MESSAGE_COST = 1000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const db = await connectToDatabase();
  const col = db.collection('messages');
  const me = decoded.username;

  // ═════════ 会话列表 ═════════
  if (req.method === 'GET' && req.query.action === 'threads') {
    const rows = await col.aggregate([
      { $match: { $or: [{ username: me }, { from: me }] } },
      {
        $addFields: {
          peer: { $cond: [{ $eq: ['$username', me] }, { $ifNull: ['$from', 'system'] }, '$username'] },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$peer',
          last: { $first: '$$ROOT' },
          unread: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$username', me] }, { $eq: ['$read', false] }] },
                1, 0,
              ],
            },
          },
        },
      },
      { $sort: { 'last.createdAt': -1 } },
      { $limit: 100 },
    ]).toArray();

    const peers = rows.map((r) => r._id).filter((p) => p && p !== 'system');
    const users = peers.length
      ? await db.collection('users').find(
          { username: { $in: peers } },
          { projection: { username: 1, displayName: 1, pfp: 1, _id: 0 } }
        ).toArray()
      : [];
    const map = new Map(users.map((u) => [u.username, u]));

    const threads = rows.map((r) => {
      const u = map.get(r._id) || {};
      const last = r.last || {};
      return {
        peer: r._id,
        displayName: r._id === 'system' ? 'System' : (u.displayName || r._id),
        pfp: u.pfp || '',
        unread: r.unread || 0,
        lastKind: last.kind || 'system',
        lastText: last.kind ? (last.text || '') : (last.content || ''),
        lastFrom: last.from || 'system',
        lastAt: last.createdAt,
      };
    });

    return res.status(200).json({ success: true, threads });
  }

  // ═════════ 单个会话 ═════════
  if (req.method === 'GET' && req.query.action === 'thread') {
    const peer = String(req.query.with || '');
    if (!peer) return res.status(400).json({ success: false, message: 'Missing with' });

    const filter = peer === 'system'
      ? { username: me, from: { $in: [null, '', 'system'] } }
      : {
          $or: [
            { username: me, from: peer },
            { username: peer, from: me },
          ],
        };

    const msgs = await col.find(filter).sort({ createdAt: 1 }).limit(500).toArray();

    // 打开会话就把对方发来的标成已读
    await col.updateMany(
      { username: me, read: false, ...(peer === 'system' ? {} : { from: peer }) },
      { $set: { read: true, readAt: new Date() } }
    );

    let peerInfo = { username: 'system', displayName: 'System', pfp: '' };
    if (peer !== 'system') {
      const u = await db.collection('users').findOne(
        { username: peer }, { projection: { username: 1, displayName: 1, pfp: 1, _id: 0 } }
      );
      if (!u) return res.status(404).json({ success: false, message: 'User not found' });
      peerInfo = { username: u.username, displayName: u.displayName || u.username, pfp: u.pfp || '' };
    }

    return res.status(200).json({ success: true, messages: msgs, peer: peerInfo });
  }

  // ═════════ 旧接口：整箱（保留兼容）═════════
  if (req.method === 'GET') {
    const onlyUnread = req.query.unread === '1';
    const filter = onlyUnread ? { username: me, read: false } : { username: me };
    const msgs = await col.find(filter).sort({ createdAt: -1 }).limit(300).toArray();
    if (!onlyUnread) {
      await col.updateMany({ username: me, read: false }, { $set: { read: true, readAt: new Date() } });
    }
    return res.status(200).json({ success: true, messages: msgs });
  }

  // ═════════ 写 ═════════
  if (req.method === 'POST') {
    const body = req.body || {};

    if (body.id && !body.kind) {
      try {
        await col.updateOne(
          { _id: new ObjectId(body.id), username: me },
          { $set: { read: true, readAt: new Date() } }
        );
        return res.status(200).json({ success: true });
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid ID format' });
      }
    }

    const { to, kind, text, problemId, submissionId, roomId } = body;
    if (!to) return res.status(400).json({ success: false, message: 'Missing recipient' });
    if (to === me) return res.status(400).json({ success: false, message: 'You cannot message yourself' });

    const target = await db.collection('users').findOne({ username: to }, { projection: { username: 1 } });
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

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

    const balance = await getTokenBalance(db, me);
    const available = (balance.daily || 0) + (balance.global || 0);
    if (available < MESSAGE_COST) {
      return res.status(400).json({
        success: false,
        message: 'Not enough tokens: sending a message costs ' + MESSAGE_COST + ' tokens.',
        need: MESSAGE_COST,
        have: available,
      });
    }
    const after = await consumeTokens(db, me, MESSAGE_COST);

    await col.insertOne({
      username: to,
      from: me,
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
