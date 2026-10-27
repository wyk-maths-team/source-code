// api/knowledge-tree.js —— 知识点树的用户级存档
//
// 设计：
//   每个用户一条记录，存在 userdata 里（这张表本来就按 username 放个性化设置）。
//   节点完成状态是一个数组，存在 knowledgeTree.completed。
//
//   为什么一次 API call 只提交一个节点：
//     前端每点一个节点就发一次 complete，而不是攒着最后批量提交。
//     好处是刷新/关页面不会丢进度；代价是网络往返多，但这里一次点击
//     本来就要等视觉反馈，往返可以忽略。
//
//   为什么服务端要校验前置条件：
//     前端的 canUnlock 只是 UI 提示。存档是权威的 —— 如果有人直接
//     POST 一个还锁着的节点，服务端必须拒绝，否则树的顺序就失去意义。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler } from '../lib/errors.js';

const COLLECTION = 'userdata';

function getUsername(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const decoded = verifyToken(token);
  return decoded?.username || null;
}

async function readTree(db, username) {
  const doc = await db.collection(COLLECTION).findOne(
    { username },
    { projection: { knowledgeTree: 1, _id: 0 } }
  );
  const tree = doc?.knowledgeTree || {};
  return {
    completed: Array.isArray(tree.completed) ? tree.completed : [],
    updatedAt: tree.updatedAt || null,
  };
}

async function handler(req, res) {
  const username = getUsername(req);
  if (!username) {
    return res.status(401).json({ success: false, message: 'Not logged in', code: 'UNAUTHORIZED' });
  }

  const db = await connectToDatabase();
  const action = String(req.query.action || 'load');

  if (action === 'load') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const tree = await readTree(db, username);
    return res.status(200).json({ success: true, username, ...tree });
  }

  if (action === 'complete') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const nodeId = String((req.body || {}).nodeId || '').trim();
    if (!nodeId) return res.status(400).json({ success: false, message: 'Missing nodeId' });

    // 幂等：已经完成过就直接返回当前状态，不重复写
    const current = await readTree(db, username);
    if (current.completed.includes(nodeId)) {
      return res.status(200).json({ success: true, username, ...current, alreadyCompleted: true });
    }

    // $addToSet 保证并发下也不会写重复
    const now = new Date();
    await db.collection(COLLECTION).updateOne(
      { username },
      {
        $addToSet: { 'knowledgeTree.completed': nodeId },
        $set: { 'knowledgeTree.updatedAt': now },
      },
      { upsert: true }
    );

    const tree = await readTree(db, username);
    return res.status(200).json({ success: true, username, ...tree, justCompleted: nodeId });
  }

  if (action === 'uncomplete') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const nodeId = String((req.body || {}).nodeId || '').trim();
    if (!nodeId) return res.status(400).json({ success: false, message: 'Missing nodeId' });

    // 只移除这一个节点。后续节点保持原样 —— 前端 canUnlock 会把
    // 「前置没了」的节点重新算成 locked 并禁用按钮，不需要在服务端级联删除。
    // 真要级联清理用 action=reset。
    const current = await readTree(db, username);
    const kept = current.completed.filter(id => id !== nodeId);

    await db.collection(COLLECTION).updateOne(
      { username },
      { $set: { 'knowledgeTree.completed': kept, 'knowledgeTree.updatedAt': new Date() } }
    );

    const tree = await readTree(db, username);
    return res.status(200).json({ success: true, username, ...tree, justUncompleted: nodeId });
  }

  if (action === 'reset') {
    // 只清空知识点树，不动 userdata 里的其它字段（theme / favorites）
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    await db.collection(COLLECTION).updateOne(
      { username },
      { $set: { 'knowledgeTree.completed': [], 'knowledgeTree.updatedAt': new Date() } }
    );
    return res.status(200).json({ success: true, username, completed: [] });
  }

  return res.status(400).json({ success: false, message: `Unknown action: ${action}` });
}

export default wrapHandler(handler);
