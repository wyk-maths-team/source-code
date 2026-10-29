// api/pk-bet-stream.js —— SSE 实验：把房间状态推给双方
//
// 目的：验证在 Vercel 上跑 SSE 是否可行，以及能撑多久。
//
// 关键约束（决定成败）：
//   1. Vercel 的 serverless 函数有硬超时。Hobby 10s，Pro 60s。
//      连接不可能像本地 Node 服务那样挂几千秒 —— 到点函数被掐断，
//      浏览器会看到连接中断。
//   2. 每个活跃连接占一个并发实例。观众多了会撞并发上限。
//   3. 响应必须不缓冲，所以要有 X-Accel-Buffering: no。
//
// 结论预期：技术上能跑，但必须配合客户端「断了就自动重连」，
// 并且客户端不能假设连接长期存活。因此它只是轮询的补充而非替代。

import { sqlDb } from '../lib/docStore.js';
import { verifyToken } from '../lib/auth.js';

// 让 Vercel 允许长一点的执行时间（实际上限取决于套餐）
export const config = { maxDuration: 60 };

const PUSH_MS = 2000;

export default async function handler(req, res) {
  const decoded = await verifyToken(req);
  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const roomId = req.query.roomId;
  if (!roomId) {
    return res.status(400).json({ success: false, message: 'Missing roomId' });
  }

  const db = sqlDb();
  const room = await db.collection('pk_bet_rooms').findOne({ id: roomId });
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }
  if (!room.players.some(p => p.username === decoded.username)) {
    return res.status(403).json({ success: false, message: 'Not a player' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // 关掉 nginx/Vercel 的缓冲，否则事件会被攒着一起发
    'X-Accel-Buffering': 'no',
  });

  const startedAt = Date.now();
  let closed = false;
  let timer = null;

  function send(event, data) {
    if (closed) return;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      closed = true;
    }
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    try { res.end(); } catch (e) {}
  }

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);

  send('hello', {
    roomId,
    you: decoded.username,
    // 客户端据此知道「服务端会在多少秒后主动断开」，可提前计划重连
    expectedLifetimeSec: 60,
    pushIntervalMs: PUSH_MS,
  });

  let lastSig = '';

  async function push() {
    if (closed) return;
    try {
      const fresh = await db.collection('pk_bet_rooms').findOne({ id: roomId });
      if (!fresh) { send('gone', {}); cleanup(); return; }

      // 只推「变化」以减少带宽：签名不同才发
      const sig = JSON.stringify({
        status: fresh.status,
        endAt: fresh.endAt,
        ready: fresh.endRequestedBy || [],
      });
      if (sig !== lastSig) {
        lastSig = sig;
        send('room', {
          status: fresh.status,
          endAt: fresh.endAt,
          startAt: fresh.startAt,
          endRequestedBy: fresh.endRequestedBy || [],
          endedEarly: !!fresh.endedEarly,
          resultId: fresh.resultId || null,
          serverNow: new Date().toISOString(),
        });
      }

      // 心跳，防止中间层判定连接空闲而掐断
      send('ping', { t: Date.now(), uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
    } catch (e) {
      send('error', { message: String(e && e.message || e) });
    }
  }

  await push();
  timer = setInterval(push, PUSH_MS);

  // 主动收尾：在平台强制掐断之前优雅关闭，客户端能看到明确的 end 事件
  setTimeout(() => {
    send('end', { reason: 'lifetime', uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
    cleanup();
  }, 55000);
}