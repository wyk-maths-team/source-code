// bridge.js v2
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════
// ⭐ 先建立 logger，再 require 任何其他模組
//    這樣 deepseek.js 裡的 console.log 也會走彩色管道
// ═══════════════════════════════════════════════════════════════

// 顏色
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',

  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',

  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgGray: '\x1b[100m',
};

// 保存原始 console（避免遞迴）
const _rawLog   = console.log.bind(console);
const _rawError = console.error.bind(console);
const _rawWarn  = console.warn.bind(console);

// 檔案路徑（在 config 之後才確定）
const LOG_FILE = path.join(config.LOG_DIR, 'bridge.log');
try { fs.mkdirSync(config.LOG_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(config.FAILED_DIR, { recursive: true }); } catch {}

// ═══ 內部核心：寫檔案 + 輸出到終端 ═══
function _emit(prefix, msg) {
  const line = `${prefix}${msg}`;
  try {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
    fs.appendFileSync(LOG_FILE, plain + '\n');
  } catch {}
  _rawLog(line);
}

// 時間戳（彩色）
function ts() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${C.gray}${hh}:${mm}:${ss}${C.reset}`;
}

// ═══ 樣式判斷：偵測 [deepseek] / [mcq] 等前綴，給對應顏色 ═══
function styleFor(msg) {
  // ── [deepseek] 子類別（細分顏色 + 圖標）──
  if (/^\[deepseek\]\s*✔/.test(msg))  return { color: C.brightGreen,   icon: '🐋' };
  if (/^\[deepseek\]\s*✖/.test(msg))  return { color: C.brightRed,     icon: '🐋' };
  if (/^\[deepseek\]\s*⚠/.test(msg))  return { color: C.brightYellow,  icon: '🐋' };
  if (/^\[deepseek\]\s*▶/.test(msg))  return { color: C.brightCyan,    icon: '🐋' };
  if (/^\[deepseek\]\s*◀/.test(msg))  return { color: C.brightGreen,   icon: '🐋' };
  if (/^\[deepseek\]\s*⏳/.test(msg)) return { color: C.brightBlue,    icon: '🐋' };
  if (/^\[deepseek\]\s*⌛/.test(msg)) return { color: C.blue,          icon: '🐋' };
  if (/^\[deepseek\]\s*🔗/.test(msg)) return { color: C.brightCyan,    icon: '🐋' };
  if (/^\[deepseek\]\s*ℹ/.test(msg))  return { color: C.brightMagenta, icon: '🐋' };
  if (/^\[deepseek\]/.test(msg))      return { color: C.brightMagenta, icon: '🐋' };

  // ── 其他模組前綴 ──
  if (/^\[mcq\]/i.test(msg))    return { color: C.brightBlue,   icon: '📄' };
  if (/^\[parse\]/i.test(msg))  return { color: C.brightYellow, icon: '🔍' };
  if (/^\[claim\]/i.test(msg))  return { color: C.brightCyan,   icon: '🔒' };
  if (/^\[main\]/i.test(msg))   return { color: C.brightRed,    icon: '⚠' };
  if (/^\[math\]/i.test(msg))   return { color: C.brightYellow, icon: '∑'  };
  if (/^\[load/i.test(msg))     return { color: C.brightBlue,   icon: '📦' };
  if (/^\[score\]/i.test(msg))  return { color: C.brightGreen,  icon: '★'  };
  if (/^\[err/i.test(msg))      return { color: C.brightRed,    icon: '✖'  };
  if (/^\[db\]/i.test(msg))     return { color: C.brightCyan,   icon: '🗄' };

  return { color: C.white, icon: '·' };
}

// ═══ 劫持 console ═══
console.log = (...args) => {
  const msg = args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ');

  const { color, icon } = styleFor(msg);
  _emit(`${ts()} ${color}${icon}${C.reset}  `, `${color}${msg}${C.reset}`);
};

console.warn = (...args) => {
  const msg = args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ');
  _emit(`${ts()} ${C.yellow}⚠${C.reset}  `, `${C.yellow}${msg}${C.reset}`);
};

console.error = (...args) => {
  const msg = args.map(a =>
    typeof a === 'string' ? a : JSON.stringify(a)
  ).join(' ');
  _emit(`${ts()} ${C.red}✖${C.reset}  `, `${C.red}${msg}${C.reset}`);
};

// ═══ 對外的封裝（bridge.js 內部用） ═══
function logInfo(msg)  { _emit(`${ts()} ${C.cyan}ℹ${C.reset}  `, `${msg}`); }
function logOk(msg)    { _emit(`${ts()} ${C.green}✔${C.reset}  `, `${msg}`); }
function logWarn(msg)  { _emit(`${ts()} ${C.yellow}⚠${C.reset}  `, `${C.yellow}${msg}${C.reset}`); }
function logError(msg) { _emit(`${ts()} ${C.red}✖${C.reset}  `, `${C.red}${msg}${C.reset}`); }

// ═══ 現在才 require（這樣它們的 console.log 已經被劫持） ═══
const db = require('./db');
const deepseek = require('./deepseek');
const { buildStepsPrompt } = require('./prompt');



// ═══════════════ 全局統計 ═══════════════
const STATS = {
  startedAt: Date.now(),
  processed: 0,
  succeeded: 0,
  failed: 0,
  totalElapsedMs: 0,
  scoreBuckets: { perfect: 0, good: 0, partial: 0, zero: 0, error: 0 },
};



function _write(line) {
  try {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, '');
    fs.appendFileSync(path.join(config.LOG_DIR, 'bridge.log'), plain + '\n');
  } catch {}
  console.log(line);
}

function logInfo(msg)   { _write(`${ts()} ${C.cyan}ℹ${C.reset}  ${msg}`); }
function logOk(msg)     { _write(`${ts()} ${C.green}✔${C.reset}  ${msg}`); }
function logWarn(msg)   { _write(`${ts()} ${C.yellow}⚠${C.reset}  ${msg}`); }
function logError(msg)  { _write(`${ts()} ${C.red}✖${C.reset}  ${msg}`); }

// ═══════════════ 格式化工具 ═══════════════
function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m ${ss}s`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function padL(s, n) {
  s = String(s);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

// 移除 ANSI 計算可見長度
function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

// 中英混合：中文佔 2，ASCII 佔 1
function displayWidth(s) {
  let w = 0;
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1100 && (
      cp <= 0x115F ||
      (cp >= 0x2E80 && cp <= 0x9FFF) ||
      (cp >= 0xAC00 && cp <= 0xD7A3) ||
      (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE30 && cp <= 0xFE6F) ||
      (cp >= 0xFF00 && cp <= 0xFF60) ||
      (cp >= 0xFFE0 && cp <= 0xFFE6)
    )) w += 2;
    else w += 1;
  }
  return w;
}

function padDisplay(s, n) {
  const w = displayWidth(s);
  return w >= n ? s : s + ' '.repeat(n - w);
}

function truncDisplay(s, n) {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  let i = 0;
  for (const ch of plain) {
    const cp = ch.codePointAt(0);
    const cw = (cp >= 0x1100 && (
      cp <= 0x115F ||
      (cp >= 0x2E80 && cp <= 0x9FFF) ||
      (cp >= 0xAC00 && cp <= 0xD7A3) ||
      (cp >= 0xF900 && cp <= 0xFAFF)
    )) ? 2 : 1;
    if (w + cw > n) break;
    w += cw;
    i++;
  }
  return i >= plain.length ? s : plain.slice(0, i) + '…';
}

// ═══════════════ 邊框 ═══════════════
const HORIZ = '─';
const VERT  = '│';

function topBar(color, width = 66) {
  return `${C.gray}  ┌${color}${HORIZ.repeat(width)}${C.gray}┐${C.reset}`;
}
function botBar(color, width = 66) {
  return `${C.gray}  └${color}${HORIZ.repeat(width)}${C.gray}┘${C.reset}`;
}
function midBar(color, width = 66) {
  return `${C.gray}  ├${color}${HORIZ.repeat(width)}${C.gray}┤${C.reset}`;
}

function row(content, width = 66) {
  // content 已含顏色碼；用 displayWidth 計算
  const w = displayWidth(content);
  const padW = Math.max(0, width - w - 1);
  return `${C.gray}  │${C.reset} ${content}${' '.repeat(padW)}${C.gray}│${C.reset}`;
}

// ═══════════════ 啟動橫幅 ═══════════════
function banner() {
  console.log('');
  console.log(`${C.brightCyan}  ╔══════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.brightCyan}  ║${C.reset}  ${C.bold}${C.brightCyan}🐋  DeepSeek Grader Bridge${C.reset}                                      ${C.brightCyan}║${C.reset}`);
  console.log(`${C.brightCyan}  ║${C.reset}  ${C.gray}AI 批改任務轉發器  ·  v2.0${C.reset}                                      ${C.brightCyan}║${C.reset}`);
  console.log(`${C.brightCyan}  ╚══════════════════════════════════════════════════════════════════╝${C.reset}`);
  console.log('');
}

function printBootstrap() {
  const cpus = os.cpus().length;
  const memGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);

  console.log(`${C.dim}  ┌─ 環境 ─────────────────────────────────────────────┐${C.reset}`);
  console.log(`${C.dim}  │${C.reset}  ${C.gray}Model   ${C.reset}${C.brightCyan}${config.MODEL || 'deepseek-r1'}${C.reset}`);
  console.log(`${C.dim}  │${C.reset}  ${C.gray}Database${C.reset}${C.brightCyan}${config.MONGODB_DB}${C.reset}`);
  console.log(`${C.dim}  │${C.reset}  ${C.gray}CPU     ${C.reset}${C.brightCyan}${cpus} cores${C.reset}`);
  console.log(`${C.dim}  │${C.reset}  ${C.gray}RAM     ${C.reset}${C.brightCyan}${memGB} GB${C.reset}`);
  console.log(`${C.dim}  │${C.reset}  ${C.gray}Node    ${C.reset}${C.brightCyan}${process.version}${C.reset}`);
  console.log(`${C.dim}  │${C.reset}  ${C.gray}Poll    ${C.reset}${C.brightCyan}${config.POLL_INTERVAL_MS}ms${C.reset}`);
  console.log(`${C.dim}  └────────────────────────────────────────────────────┘${C.reset}`);
  console.log('');
}
// ═══════════════ JSON 字串內控制字元轉義 ═══════════════
/**
 * 把 JSON 字串內未轉義的控制字元（\n \r \t 等）轉成轉義序列
 * 追蹤字串狀態（"..." 內外）與轉義符（\），避免誤傷結構
 */
function escapeControlCharsInJsonStrings(str) {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const code = str.charCodeAt(i);

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && code < 0x20) {
      switch (ch) {
        case '\n': out += '\\n'; break;
        case '\r': out += '\\r'; break;
        case '\t': out += '\\t'; break;
        case '\b': out += '\\b'; break;
        case '\f': out += '\\f'; break;
        default:   out += '\\u' + code.toString(16).padStart(4, '0');
      }
      continue;
    }
    out += ch;
  }

  return out;
}

// ═══════════════ 壓縮單字符斷行 ═══════════════
/**
 * 把「每個數學 token 一行」的模式合併
 *   "(\n2\n−\n1\n)"  →  "(2−1)"
 * 保留段落換行（兩個以上連續 \n）
 */
function compactShortNewlines(text) {
  if (!text) return text;
  let prev;
  do {
    prev = text;
    // \n<單字符>\n → <單字符>
    text = text.replace(/\n([^\n])\n/g, '$1');
  } while (text !== prev);
  // 尾端
  text = text.replace(/\n([^\n])$/g, '$1');
  // 開頭
  text = text.replace(/^([^\n])\n/g, '$1');
  return text;
}
// ═══════════════ 解析 AI 回覆 ═══════════════
function parseReply(raw) {
  if (!raw) return null;

  const original = String(raw);
  let s = original;

  s = s.replace(/[\uFEFF\u200B-\u200D\u2028\u2029]/g, '');
  s = s
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0C/g, ',')
    .replace(/\uFF5B/g, '{')
    .replace(/\uFF5D/g, '}');

  s = s.trim();
  s = s.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  const first = s.indexOf('{');
  const last  = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    logError(`找不到 {} 邊界 | 原文: ${JSON.stringify(s.slice(0, 200))}`);
    return null;
  }

  let jsonStr = s.slice(first, last + 1);

  // ⭐ 1. 先把字串內未轉義的控制字元轉義
  jsonStr = escapeControlCharsInJsonStrings(jsonStr);

  // 2. 移除尾逗號
  jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(jsonStr);

    // ⭐ 3. comment 清理：合併單字符斷行
    if (parsed && typeof parsed.comment === 'string') {
      parsed.comment = compactShortNewlines(parsed.comment);
      // 壓縮連續空白
      parsed.comment = parsed.comment.replace(/[ \t]+/g, ' ').trim();
    }

    return parsed;
  } catch (e) {
    logError(`JSON.parse 失敗: ${e.message}`);
    logError(`原始長度: ${original.length}`);
    logError(`清理後: ${JSON.stringify(jsonStr.slice(0, 500))}`);
    const bad = [];
    for (let i = 0; i < jsonStr.length; i++) {
      const cp = jsonStr.charCodeAt(i);
      // ⭐ 只記錄真正的控制字元（不含 \t \n \r）
      if (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) {
        bad.push(`${i}:U+${cp.toString(16)}`);
      }
    }
    if (bad.length) logError(`殘留控制字元: ${bad.slice(0, 30).join(' ')}`);
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

// ═══════════════ 搶佔任務 ═══════════════
async function claimTask() {
  const d = db.getDb();
  const now = new Date();
  const staleThreshold = new Date(Date.now() - config.LOCK_TTL_MS);
  const col = d.collection(config.TASK_COLLECTION);

  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = await col.findOne(
      {
        status: 'pending',
        $or: [
          { lockedAt: { $exists: false } },
          { lockedAt: null },
          { lockedAt: { $lt: staleThreshold } },
        ],
      },
      { sort: { createdAt: 1 }, projection: { taskId: 1, _id: 0 } }
    );

    if (!candidate) return null;

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

    if (r.modifiedCount === 1) {
      return await col.findOne({ claimToken });
    }

    logWarn(`${C.magenta}${candidate.taskId}${C.reset} 被搶走，重試 (${attempt + 1}/3)`);
  }

  return null;
}

async function updateTask(taskId, update) {
  const d = db.getDb();
  await d.collection(config.TASK_COLLECTION).updateOne({ taskId }, { $set: update });
}

// ═══════════════ 分數顏色 ═══════════════
function scoreColors(score) {
  if (score === 100)  return { fg: C.brightGreen,  bg: C.bgGreen,  label: '完美' };
  if (score >= 80)    return { fg: C.brightGreen,  bg: C.bgGreen,  label: '優秀' };
  if (score >= 60)    return { fg: C.brightYellow, bg: C.bgYellow, label: '良好' };
  if (score >= 30)    return { fg: C.yellow,       bg: C.bgYellow, label: '部分' };
  if (score > 0)      return { fg: C.brightRed,    bg: C.bgRed,    label: '低分' };
  return { fg: C.red, bg: C.bgRed, label: '零分' };
}

// ═══════════════ 顯示評語（多行 + 引導） ═══════════════
function renderComment(comment, maxWidth = 62) {
  if (!comment) return [];

  // 把 comment 按 \n 拆行
  const lines = String(comment).split(/\n/);

  const out = [];
  for (const line of lines) {
    if (!line.trim()) {
      out.push('');
      continue;
    }
    // 簡單的自動換行（中文按顯示寬度）
    let current = '';
    let currentW = 0;
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      const cw = (cp >= 0x1100 && (
        cp <= 0x115F ||
        (cp >= 0x2E80 && cp <= 0x9FFF) ||
        (cp >= 0xAC00 && cp <= 0xD7A3)
      )) ? 2 : 1;

      if (currentW + cw > maxWidth) {
        out.push(current);
        current = ch;
        currentW = cw;
      } else {
        current += ch;
        currentW += cw;
      }
    }
    if (current) out.push(current);
  }

  return out;
}
// ═══════════════ 在框內渲染 deepseek 日誌 ═══════════════

// 符號 → 顏色（跟 deepseek.js 的符號約定一致）
function symColor(sym) {
  switch (sym) {
    case '✔': return C.brightGreen;
    case '✖': return C.brightRed;
    case '⚠': return C.brightYellow;
    case '▶': return C.brightCyan;
    case '◀': return C.brightGreen;
    case '⏳': return C.brightBlue;
    case '⌛': return C.blue;
    case '🔗': return C.brightCyan;
    case 'ℹ': return C.brightMagenta;
    default:  return C.gray;
  }
}

/**
 * 在 fn() 執行期間，把 [deepseek] 的 console.log 改寫成框內的行。
 * 非 [deepseek] 的訊息照常輸出。
 *
 * @param {number} W   框寬
 * @param {Function} fn 要執行的非同步函式
 */
async function boxedDeepseekLog(W, fn) {
  const prevLog = console.log;

  console.log = (...args) => {
    const msg = args.map(a =>
      typeof a === 'string' ? a : JSON.stringify(a)
    ).join(' ');

    // 不是 deepseek 的訊息 → 直接透傳
    if (!msg.startsWith('[deepseek]')) {
      prevLog(...args);
      return;
    }

    // 解析 [deepseek] <符號> <文字>
    const body = msg.replace(/^\[deepseek\]\s*/, '');
    const m = body.match(/^(ℹ|✔|✖|⚠|▶|◀|⏳|⌛|🔗)\s+([\s\S]*)$/);
    const sym  = m ? m[1] : '·';
    const text = (m ? m[2] : body).replace(/\s+/g, ' ').trim();
    const color = symColor(sym);

    // 用框行渲染（呼叫原本的 console.log，會加上時間戳和 icon）
    prevLog(row(`${color}${C.bold}${sym}${C.reset} ${C.gray}${text}${C.reset}`, W));
  };

  try {
    return await fn();
  } finally {
    console.log = prevLog;
  }
}
// ═══════════════ 處理單一任務 ═══════════════
async function processTask(page, task) {
  const { taskId, problemId, steps, model } = task;
  const stepsLen = (steps || '').length;
  const useModel = (model === 'v3') ? 'v3' : 'r1';
  const modelTag = useModel === 'v3'
    ? `${C.bgYellow}${C.bold} V3 ${C.reset}`
    : `${C.bgMagenta}${C.white}${C.bold} R1 ${C.reset}`;

  const tStart = Date.now();
  const W = 66;

  // ── 任務開始 ──
  console.log('');
  console.log(topBar(C.blue, W));
  console.log(row(
    `${C.bold}${C.brightBlue}◢ TASK${C.reset}  ` +
    `${C.magenta}${taskId}${C.reset}`,
    W
  ));
  console.log(midBar(C.blue, W));
  console.log(row(
    `${C.gray}Problem${C.reset}  ${C.brightCyan}${problemId}${C.reset}  ` +
    `${C.gray}·${C.reset}  ` +
    `${C.gray}Steps${C.reset}  ${C.brightCyan}${stepsLen}${C.reset} chars  ` +
    `${C.gray}·${C.reset}  ${modelTag}`,
    W
  ));

  try {
    // 拉題目
    const problem = await getProblem(problemId);
    if (!problem) {
      console.log(row(`${C.red}✖  題目不存在: ${problemId}${C.reset}`, W));
      await updateTask(taskId, {
        status: 'done',
        result: { score: -100, comment: 'AI error' },
        error: `Problem ${problemId} not found`,
        completedAt: new Date(),
      });
      STATS.processed++;
      STATS.failed++;
      console.log(botBar(C.blue, W));
      return;
    }

    // 準備 prompt
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

    // 呼叫 AI
    console.log(row(
      `${C.dim}→${C.reset} 呼叫 DeepSeek ${useModel.toUpperCase()}...`,
      W
    ));

    let reply, elapsed;
    await boxedDeepseekLog(W, async () => {
      const t0 = Date.now();
      reply = await deepseek.ask(prompt, {
        model: useModel,
        timeoutMs: config.TASK_TIMEOUT_MS,
      });
      elapsed = Date.now() - t0;
    });

    const replyColor =
      elapsed < 10000 ? C.green :
      elapsed < 30000 ? C.yellow : C.brightYellow;

    console.log(row(
      `${C.dim}←${C.reset} 回覆  ` +
      `${C.brightCyan}${reply.length}${C.reset} chars  ` +
      `${C.gray}·${C.reset}  ` +
      `${replyColor}${fmtMs(elapsed)}${C.reset}`,
      W
    ));

    // 解析
    const parsed = parseReply(reply);

    let scoreNum = NaN;
    if (parsed) {
      const v = parsed.score ?? parsed.Score ?? parsed.SCORE;
      scoreNum = typeof v === 'number' ? v : Number(v);
    }

    if (!parsed || !Number.isFinite(scoreNum)) {
      console.log(midBar(C.blue, W));
      console.log(row(`${C.red}${C.bold}✖ 解析失敗${C.reset}`, W));
      console.log(row(
        `${C.gray}parsed:${C.reset} ${C.red}${JSON.stringify(parsed).slice(0, 80)}${C.reset}`,
        W
      ));
      await updateTask(taskId, {
        status: 'done',
        result: { score: -100, comment: 'AI error' },
        rawReply: reply.slice(0, 4000),
        parsedRaw: JSON.stringify(parsed).slice(0, 1000),
        completedAt: new Date(),
      });
      STATS.processed++;
      STATS.failed++;
      STATS.scoreBuckets.error++;
      console.log(botBar(C.blue, W));
      return;
    }

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

    // ── 完成顯示 ──
    const cols = scoreColors(score);
    const scoreBarLen = Math.round(score / 100 * 30);
    const scoreBar =
      `${cols.fg}${'█'.repeat(scoreBarLen)}${C.reset}` +
      `${C.gray}${'░'.repeat(30 - scoreBarLen)}${C.reset}`;

    console.log(midBar(C.blue, W));
    console.log(row(
      `${cols.bg}${C.black}${C.bold} ${padL(score, 3)} ${C.reset}  ` +
      `${scoreBar}  ` +
      `${cols.fg}${C.bold}${cols.label}${C.reset}`,
      W
    ));
    console.log(midBar(C.blue, W));

    // ⭐ 顯示評語（多行 + 引導）
    const commentLines = renderComment(comment, W - 4);
    if (commentLines.length === 0) {
      console.log(row(`${C.dim}(無評語)${C.reset}`, W));
    } else {
      commentLines.forEach((line, idx) => {
        const prefix = idx === 0 ? `${C.cyan}${C.reset} ` : `${C.cyan}  ${C.reset} `;
        console.log(row(`${prefix}${C.white}${line}${C.reset}`, W));
      });
    }

    // 耗時
    const totalMs = Date.now() - tStart;
    console.log(midBar(C.blue, W));
    console.log(row(
      `${C.gray}⏱  總耗時  ${fmtMs(totalMs)}${C.reset}`,
      W
    ));
    console.log(botBar(C.blue, W));

    // 統計
    STATS.processed++;
    STATS.succeeded++;
    STATS.totalElapsedMs += elapsed;
    if (score === 100) STATS.scoreBuckets.perfect++;
    else if (score >= 60) STATS.scoreBuckets.good++;
    else if (score > 0) STATS.scoreBuckets.partial++;
    else STATS.scoreBuckets.zero++;

  } catch (err) {
    console.log(midBar(C.blue, W));
    console.log(row(
      `${C.red}${C.bold}✖ 任務失敗${C.reset}  ${C.red}${err.message}${C.reset}`,
      W
    ));

    let shotPath = null;
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      shotPath = path.join(config.FAILED_DIR, `${taskId}-${timestamp}.png`);
      await deepseek.screenshot(shotPath);
      console.log(row(`${C.gray}已截圖: ${shotPath}${C.reset}`, W));
    } catch {}

    await updateTask(taskId, {
      status: 'done',
      result: { score: -100, comment: 'AI error' },
      error: String(err.message || err).slice(0, 300),
      screenshot: shotPath,
      completedAt: new Date(),
    });

    STATS.processed++;
    STATS.failed++;
    STATS.scoreBuckets.error++;
    console.log(botBar(C.blue, W));
  }
}

// ═══════════════ 週期統計（每 10 個任務顯示一次） ═══════════════
function maybePrintStats() {
  if (STATS.processed > 0 && STATS.processed % 10 === 0) {
    const avg = STATS.succeeded > 0
      ? Math.round(STATS.totalElapsedMs / STATS.succeeded)
      : 0;
    const uptime = Date.now() - STATS.startedAt;

    console.log('');
    console.log(`${C.dim}  ╭─ 進度報告 ────────────────────────────────────────╮${C.reset}`);
    console.log(`${C.dim}  │${C.reset}  ${C.brightCyan}${pad(STATS.processed, 4)}${C.reset} 個任務處理完畢  ` +
                `${C.gray}(${fmtUptime(uptime)})${C.reset}`);
    console.log(`${C.dim}  │${C.reset}  ${C.green}${pad(STATS.succeeded, 4)}${C.reset} 成功  ` +
                `${C.red}${pad(STATS.failed, 4)}${C.reset} 失敗  ` +
                `${C.gray}平均 ${fmtMs(avg)}${C.reset}`);
    console.log(`${C.dim}  │${C.reset}  分數分佈:  ` +
                `${C.brightGreen}${STATS.scoreBuckets.perfect} 完美${C.reset}  ` +
                `${C.brightGreen}${STATS.scoreBuckets.good} 良好${C.reset}  ` +
                `${C.brightYellow}${STATS.scoreBuckets.partial} 部分${C.reset}  ` +
                `${C.red}${STATS.scoreBuckets.zero} 零分${C.reset}  ` +
                `${C.red}${STATS.scoreBuckets.error} 錯誤${C.reset}`);
    console.log(`${C.dim}  ╰────────────────────────────────────────────────────╯${C.reset}`);
    console.log('');
  }
}

// ═══════════════ 主流程 ═══════════════
async function main() {
  fs.mkdirSync(config.LOG_DIR, { recursive: true });
  fs.mkdirSync(config.FAILED_DIR, { recursive: true });

  banner();

  // 連 Mongo
  console.log(`${C.cyan}[1/3]${C.reset} 連接 MongoDB...`);
  await db.connect();
  logOk(`Mongo 已連線: ${C.brightCyan}${config.MONGODB_DB}${C.reset}`);
  console.log('');

  // 開瀏覽器
  console.log(`${C.cyan}[2/3]${C.reset} 啟動 Chrome (CDP)...`);
  const { page } = await deepseek.launch();

  // 登入檢查
  console.log(`${C.cyan}[3/3]${C.reset} 檢查 DeepSeek 登入狀態...`);
  if (!(await deepseek.isLoggedIn())) {
    await deepseek.waitForManualLogin();
  } else {
    logOk('DeepSeek 已登入（沿用上次 profile）');
  }
  console.log('');

  printBootstrap();

  // 訊號處理
  let running = true;
  const shutdown = async (sig) => {
    console.log('');
    console.log(`${C.brightYellow}⏹  收到 ${sig}，正在關閉...${C.reset}`);

    const uptime = Date.now() - STATS.startedAt;
    const avg = STATS.succeeded > 0
      ? Math.round(STATS.totalElapsedMs / STATS.succeeded)
      : 0;

    console.log('');
    console.log(`${C.dim}  ╔═ 本次運行總結 ══════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.dim}  ║${C.reset}  ${C.gray}運行時長${C.reset}      ${C.brightCyan}${pad(fmtUptime(uptime), 30)}${C.reset}${C.dim}║${C.reset}`);
    console.log(`${C.dim}  ║${C.reset}  ${C.gray}處理任務${C.reset}      ${C.brightCyan}${pad(STATS.processed, 30)}${C.reset}${C.dim}║${C.reset}`);
    console.log(`${C.dim}  ║${C.reset}  ${C.gray}成功${C.reset}          ${C.green}${pad(STATS.succeeded, 30)}${C.reset}${C.dim}║${C.reset}`);
    console.log(`${C.dim}  ║${C.reset}  ${C.gray}失敗${C.reset}          ${C.red}${pad(STATS.failed, 30)}${C.reset}${C.dim}║${C.reset}`);
    console.log(`${C.dim}  ║${C.reset}  ${C.gray}平均 AI 耗時${C.reset}  ${C.brightCyan}${pad(fmtMs(avg), 30)}${C.reset}${C.dim}║${C.reset}`);
    console.log(`${C.dim}  ║${C.reset}  ${C.gray}完美 / 良好 / 部分 / 零 / 錯誤${C.reset}`);
    console.log(`${C.dim}  ║${C.reset}  ${C.brightGreen}${pad(STATS.scoreBuckets.perfect, 4)}${C.reset}  ${C.brightGreen}${pad(STATS.scoreBuckets.good, 4)}${C.reset}  ${C.brightYellow}${pad(STATS.scoreBuckets.partial, 4)}${C.reset}  ${C.red}${pad(STATS.scoreBuckets.zero, 4)}${C.reset}  ${C.red}${pad(STATS.scoreBuckets.error, 4)}${C.reset}${' '.repeat(10)}${C.dim}║${C.reset}`);
    console.log(`${C.dim}  ╚═════════════════════════════════════════════════════════╝${C.reset}`);
    console.log('');

    try { await deepseek.close(); } catch {}
    try { await db.close(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 進入主循環
  console.log(
    `${C.brightGreen}${C.bold}🚀 進入主循環${C.reset}  ` +
    `${C.dim}(poll 間隔 ${config.POLL_INTERVAL_MS}ms)${C.reset}`
  );
  console.log(`${C.gray}${'━'.repeat(66)}${C.reset}`);

  while (running) {
    try {
      const task = await claimTask();

      if (!task) {
        await new Promise(r => setTimeout(r, config.POLL_INTERVAL_MS));
        continue;
      }

      await processTask(page, task);
      maybePrintStats();

    } catch (err) {
      logError(`[main] 未預期錯誤: ${err.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

main().catch(err => {
  console.error('');
  console.error(`${C.bgRed}${C.white}${C.bold} FATAL ${C.reset} ${C.red}${err.message}${C.reset}`);
  console.error('');
  console.error(err.stack);
  try {
    fs.appendFileSync(
      path.join(__dirname, 'logs', 'fatal.log'),
      `[${new Date().toISOString()}] ${err.stack || err.message}\n`
    );
  } catch {}
  process.exit(1);
});