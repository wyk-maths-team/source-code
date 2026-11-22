// tools/sse-probe.mjs —— 实测 SSE 在 Node 端的流式行为与断线重连语义
//
// 目的不是测业务，而是回答三个问题：
//   1. 服务端 write 的 event/data 能否被浏览器逐条收到（而不是攒到最后）
//   2. 服务端主动 end 与异常断开，客户端能否区分
//   3. Vercel 那种「到点就掐」的模型下，EventSource 的重连能否自动接上
import http from 'node:http';

const PORT = 3499;
const TICK_MS = 300;
const TICKS = 6;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let n = 0;
    const startedAt = Date.now();
    let timer = null;
    let closed = false;

    const stop = () => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      try { res.end(); } catch (e) {}
    };
    req.on('close', stop);

    res.write('retry: 1000\n\n');   // 告诉浏览器断线后 1 秒重连
    res.write(`event: hello\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);

    timer = setInterval(() => {
      if (closed) return;
      n++;
      res.write(`event: tick\nid: ${n}\n`);
      res.write(`data: ${JSON.stringify({ n, ms: Date.now() - startedAt })}\n\n`);

      // 模拟 Vercel 到点掐断：第 TICKS 次之后硬结束
      if (n >= TICKS) {
        res.write(`event: end\ndata: ${JSON.stringify({ reason: 'lifetime' })}\n\n`);
        stop();
      }
    }, TICK_MS);
  } else if (url.pathname === '/abort') {
    // 模拟平台强杀：写完头就 destroy，没有 end 事件
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    });
    res.write('event: hello\ndata: {"t":0}\n\n');
    setTimeout(() => { try { res.destroy(); } catch (e) {} }, 400);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><meta charset="utf-8"><title>sse probe</title><p>see /stream or /abort</p>');
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`probe server on http://127.0.0.1:${PORT}`);

  async function readStream(path, maxMs = 5000) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), maxMs);
    const events = [];
    const t0 = Date.now();
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { signal: ac.signal });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) { events.push({ type: 'stream-closed', atMs: Date.now() - t0 }); break; }
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const ev = {};
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) ev.event = line.slice(7);
            else if (line.startsWith('data: ')) ev.data = line.slice(6);
            else if (line.startsWith('id: ')) ev.id = line.slice(4);
            else if (line.startsWith('retry: ')) ev.retry = line.slice(7);
          }
          if (ev.event) events.push({ ...ev, atMs: Date.now() - t0 });
        }
      }
    } catch (e) {
      events.push({ type: 'client-error', message: String(e && e.name || e), atMs: Date.now() - t0 });
    } finally {
      clearTimeout(t);
    }
    return events;
  }

  console.log('\n=== 场景 A：正常流（服务端主动 end）===');
  const a = await readStream('/stream');
  for (const e of a) {
    console.log(`  +${String(e.atMs).padStart(4)}ms  ${e.event || e.type}${e.id ? ' #' + e.id : ''}  ${e.data || ''}`);
  }

  console.log('\n=== 场景 B：平台强杀（destroy，无 end 事件）===');
  const b = await readStream('/abort');
  for (const e of b) {
    console.log(`  +${String(e.atMs).padStart(4)}ms  ${e.event || e.type}  ${e.data || ''}`);
  }

  console.log('\n=== 结论 ===');
  const tickSpread = a.filter(e => e.event === 'tick').map(e => e.atMs);
  const spread = tickSpread.length > 1 ? tickSpread[tickSpread.length - 1] - tickSpread[0] : 0;
  console.log(`  逐条到达：${tickSpread.length} 个 tick 分布在 ${spread}ms 内（期望约 ${(TICKS - 1) * TICK_MS}ms）`);
  console.log(`  → ${tickSpread.length > 1 && spread > TICK_MS ? '是，没有被缓冲' : '否，疑似被攒批'}`);
  console.log(`  正常 end 能被客户端看到：${a.some(e => e.event === 'end') ? '是' : '否'}`);
  console.log(`  强杀时客户端看到的是：${b.find(e => e.type === 'stream-closed' || e.type === 'client-error')?.type || '无'}`);

  server.close();
});
