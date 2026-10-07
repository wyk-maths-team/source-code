// bridge.js
// 主程式：掃 Mongo → 呼叫 DeepSeek → 寫回結果
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const config = require('./config');
const crypto = require('crypto');
const db = require('./db');
const deepseek = require('./deepseek');
const { buildStepsPrompt } = require('./prompt');

// ═══════════════ 工具 ═══════════════
function log(...args) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(config.LOG_DIR, 'bridge.log'), line + '\n');
  } catch {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════ 解析 AI 回覆（強化版） ═══════════════
function parseReply(raw) {
  if (!raw) return null;

  const original = String(raw);
  let s = original;

  // 1. 移除 BOM / 零寬 / 行分隔符
  s = s.replace(/[\uFEFF\u200B-\u200D\u2028\u2029]/g, '');

  // 2. 全形 → 半形（JSON 結構字元）
  s = s
    .replace(/[\u201C\u201D]/g, '"')     // “ ” → "
    .replace(/\uFF1A/g, ':')              // ： → :
    .replace(/\uFF0C/g, ',')              // ， → ,
    .replace(/\uFF5B/g, '{')              // ｛ → {
    .replace(/\uFF5D/g, '}');             // ｝ → }

  // 3. trim + 剝 markdown 圍欄
  s = s.trim();
  s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // 4. 找 JSON 邊界
  const first = s.indexOf('{');
  const last  = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    log(`[parse] 找不到 {} 邊界,原文: ${JSON.stringify(s.slice(0, 200))}`);
    return null;
  }

  let jsonStr = s.slice(first, last + 1);

  // 5. 修尾隨逗號
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

  // 6. parse
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    log(`[parse] JSON.parse 失敗: ${e.message}`);
    log(`[parse] 原始長度: ${original.length}`);
    log(`[parse] 清理後: ${JSON.stringify(jsonStr.slice(0, 500))}`);
    // 印出所有非 ASCII 字元的碼位,方便肉眼排查
    const bad = [];
    for (let i = 0; i < jsonStr.length; i++) {
      const cp = jsonStr.charCodeAt(i);
      if (cp > 127 || cp < 32) bad.push(`${i}:U+${cp.toString(16)}`);
    }
    log(`[parse] 非 ASCII 位置: ${bad.slice(0, 30).join(' ')}`);
    return null;
  }
}

// ═══════════════ 拉題目 ═══════════════
async function getProblem(problemId) {
  const d = db.getDb();
  return d.collection('problems').findOne(
    { id: String(problemId) },
    { projection: { id: 1, name: 1, statement: 1, ans: 1, _id: 0 } }
  );
}

// ═══════════════ 搶佔任務（v4/v5/v6 通用寫法） ═══════════════
async function claimTask() {
  const d = db.getDb();
  const now = new Date();
  const staleThreshold = new Date(Date.now() - config.LOCK_TTL_MS);
  const col = d.collection(config.TASK_COLLECTION);

  // 最多重試 3 次（多 bridge 情境下會有競態）
  for (let attempt = 0; attempt < 3; attempt++) {
    // 1. 找最老的 pending 任務（FIFO）
    const candidate = await col.findOne(
      {
        status: 'pending',
        $or: [
          { lockedAt: { $exists: false } },
          { lockedAt: null },
          { lockedAt: { $lt: staleThreshold } },
        ],
      },
      {
        sort: { createdAt: 1 },
        projection: { taskId: 1, _id: 0 },
      }
    );

    if (!candidate) return null;

    // 2. 原子搶佔
    const claimToken = crypto.randomUUID();
    const r = await col.updateOne(
      { taskId: candidate.taskId, status: 'pending' },
      {
        $set: {
          status: 'processing',
          lockedAt: now,
          worker: 'bridge-1',
          pickedUpAt: now,
          claimToken,
        },
      }
    );

    // 3. 搶到 → 用 claimToken 精確取回完整文檔
    if (r.modifiedCount === 1) {
      return await col.findOne({ claimToken });
    }

    // 被別人搶走 → 換下一個候選
    log(`[claim] ${candidate.taskId} 被搶走,重試 (${attempt + 1}/3)`);
  }

  return null;
}

async function updateTask(taskId, update) {
  const d = db.getDb();
  await d.collection(config.TASK_COLLECTION).updateOne(
    { taskId },
    { $set: update }
  );
}

// ═══════════════ 處理單一任務 ═══════════════
async function processTask(page, task) {
  const { taskId, problemId, steps, model } = task;
  const stepsLen = (steps || '').length;
  log(`▶ 處理 ${taskId} | problem=${problemId} | model=${model || 'r1'} | ${stepsLen}字`);

  try {
    // 1. 拉題目
    const problem = await getProblem(problemId);
    if (!problem) {
      log(`✖ ${taskId} 題目不存在: ${problemId}`);
      await updateTask(taskId, {
        status: 'done',
        result: { score: -100, comment: 'AI error' },
        error: `Problem ${problemId} not found`,
        completedAt: new Date(),
      });
      return;
    }

    // 2. 準備 prompt
    const statement = String(problem.statement || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const prompt = buildStepsPrompt({
      statement,
      reference_answer: String(problem.ans ?? ''),
      student_steps: String(steps || ''),
    });

    // 3. 問 DeepSeek
    const t0 = Date.now();
    const reply = await deepseek.ask(prompt, {
      model: (model === 'v3') ? 'v3' : 'r1',
      timeoutMs: config.TASK_TIMEOUT_MS,
    });
    const elapsed = Date.now() - t0;
    log(`  ← 回覆 ${reply.length}字,${elapsed}ms`);

    // 4. 解析
    const parsed = parseReply(reply);

    // ⭐ 放寬：接受 number 或可轉成 number 的字串
    let scoreNum = NaN;
    if (parsed) {
      const v = parsed.score ?? parsed.Score ?? parsed.SCORE;
      scoreNum = typeof v === 'number' ? v : Number(v);
    }

    if (!parsed || !Number.isFinite(scoreNum)) {
      log(`✖ ${taskId} 解析失敗`);
      log(`✖ parsed = ${JSON.stringify(parsed)}`);
      log(`✖ reply(前500字) = ${JSON.stringify(reply.slice(0, 500))}`);
      await updateTask(taskId, {
        status: 'done',
        result: { score: -100, comment: 'AI error' },
        rawReply: reply.slice(0, 4000),
        parsedRaw: JSON.stringify(parsed).slice(0, 1000),   // ⭐ 存進 DB
        completedAt: new Date(),
      });
      return;
    }

    // 5. 正常化
    let score = Math.round(scoreNum);
    score = Math.max(0, Math.min(100, score));
    const comment = String(parsed.comment || '').slice(0, 500);

    await updateTask(taskId, {
      status: 'done',
      result: { score, comment },
      rawReply: reply.slice(0, 4000),
      elapsedMs: elapsed,
      completedAt: new Date(),
    });
    log(`✔ ${taskId} 完成 score=${score} | ${comment.slice(0, 40)}`);

  } catch (err) {
    log(`✖ ${taskId} 錯誤: ${err.message}`);

    // 截圖
    let shotPath = null;
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      shotPath = path.join(config.FAILED_DIR, `${taskId}-${ts}.png`);
      await deepseek.screenshot(shotPath);
    } catch {}

    await updateTask(taskId, {
      status: 'done',
      result: { score: -100, comment: 'AI error' },
      error: String(err.message || err).slice(0, 300),
      screenshot: shotPath,
      completedAt: new Date(),
    });
  }
}

// ═══════════════ 主流程 ═══════════════
async function main() {
  // 目錄
  fs.mkdirSync(config.LOG_DIR, { recursive: true });
  fs.mkdirSync(config.FAILED_DIR, { recursive: true });

  log('═══════════════════════════════════');
  log('  DeepSeek Grader Bridge 啟動');
  log('═══════════════════════════════════');

  // 連 Mongo
  await db.connect();
  log(`✅ Mongo 已連線: ${config.MONGODB_DB}`);

  // 開瀏覽器
  const { page } = await deepseek.launch();

  // 登入檢查
  if (!(await deepseek.isLoggedIn())) {
    await deepseek.waitForManualLogin();
  } else {
    log('✅ DeepSeek 已登入（沿用上次 profile）');
  }

  // 訊號處理
  let running = true;
  const shutdown = async (sig) => {
    log(`收到 ${sig},關閉中...`);
    running = false;
    try { await deepseek.close(); } catch {}
    try { await db.close(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log(`🚀 進入主循環 (poll 間隔 ${config.POLL_INTERVAL_MS}ms)`);

  // 主循環
  while (running) {
    try {
      const task = await claimTask();

      if (!task) {
        await sleep(config.POLL_INTERVAL_MS);
        continue;
      }

      await processTask(page, task);

    } catch (err) {
      log(`[main] 未預期錯誤: ${err.message}`);
      await sleep(3000);
    }
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  try {
    fs.appendFileSync(
      path.join(__dirname, 'logs', 'fatal.log'),
      `[${new Date().toISOString()}] ${err.stack || err.message}\n`
    );
  } catch {}
  process.exit(1);
});