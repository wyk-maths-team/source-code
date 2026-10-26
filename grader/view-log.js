#!/usr/bin/env node
// 用法:
//   node view-log.js              看最近 50 条
//   node view-log.js --tail 200   看最近 200 条
//   node view-log.js --follow     实时跟踪（tail -f）
//   node view-log.js --user chris 只看某人
//   node view-log.js --kind port  只看某类

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'private', 'ai-grade.jsonl');

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', gray: '\x1b[90m',
  brightGreen: '\x1b[92m', brightRed: '\x1b[91m',
  brightCyan: '\x1b[96m', brightYellow: '\x1b[93m',
  bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgYellow: '\x1b[43m',
  black: '\x1b[30m',
};

// ═══ CLI 參數 ═══
const args = process.argv.slice(2);
function argVal(flag, def) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : def;
}
const TAIL    = parseInt(argVal('--tail', '50'), 10) || 50;
const FOLLOW  = args.includes('--follow');
const USER    = argVal('--user', null);
const KIND    = argVal('--kind', null);

// ═══ 格式化 ═══
function padL(s, n) {
  s = String(s ?? '');
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}
function padR(s, n) {
  s = String(s ?? '');
  return s.length >= n ? s.slice(0, n) : ' '.repeat(n - s.length) + s;
}
function shortTime(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function shortId(s) { return String(s).slice(-8); }

function kindTag(kind) {
  switch (kind) {
    case 'steps': return `${C.brightCyan}STEPS${C.reset}`;
    case 'image': return `${C.brightYellow}IMAGE${C.reset}`;
    case 'port':  return `${C.magenta}PORT ${C.reset}`;
    default:      return `${C.gray}?????${C.reset}`;
  }
}

function scoreTag(score) {
  if (score === -1)     return `${C.magenta}  diag ${C.reset}`;
  if (score === -100)   return `${C.bgRed}${C.black} FAIL ${C.reset}`;
  if (score === 100)    return `${C.bgGreen}${C.black} 100  ${C.reset}`;
  if (score >= 60)      return `${C.bgGreen}${C.black} ${padL(score,3)}  ${C.reset}`;
  if (score >= 30)      return `${C.bgYellow}${C.black} ${padL(score,3)}  ${C.reset}`;
  if (score >= 0)       return `${C.bgRed}${C.black} ${padL(score,3)}  ${C.reset}`;
  return `${C.gray}  ---  ${C.reset}`;
}

function renderLine(e) {
  const t  = `${C.gray}${shortTime(e.ts)}${C.reset}`;
  const k  = kindTag(e.kind);
  const s  = scoreTag(e.score);
  const u  = `${C.brightCyan}${padL(e.username || '?', 12)}${C.reset}`;
  const p  = `${C.bold}${padL(e.problemId || '?', 12)}${C.reset}`;
  const id = `${C.gray}${shortId(e.taskId || '?')}${C.reset}`;

  let extra = '';
  if (e.status === 'error') {
    extra = ` ${C.brightRed}${(e.error || '').slice(0, 60)}${C.reset}`;
  } else if (e.commentPreview) {
    const preview = String(e.commentPreview).replace(/\s+/g, ' ').slice(0, 60);
    extra = ` ${C.dim}${preview}${C.reset}`;
  }

  const ms = e.elapsedMs ? `${C.yellow}${(e.elapsedMs/1000).toFixed(1)}s${C.reset}` : '';

  return `${t} ${k} ${s} ${u} ${p} ${id} ${ms}${extra}`;
}

// ═══ 主邏輯 ═══
if (!fs.existsSync(LOG_FILE)) {
  console.error(`${C.red}Log file not found: ${LOG_FILE}${C.reset}`);
  process.exit(1);
}

function filter(line) {
  if (USER && line.username !== USER) return false;
  if (KIND && line.kind !== KIND) return false;
  return true;
}

function readTail(n) {
  const raw = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const parsed = [];
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (filter(e)) parsed.push(e);
    } catch {}
  }
  return parsed.slice(-n);
}

function printHeader() {
  console.log('');
  console.log(`${C.bold}${C.brightCyan}╭─ AI Grade Log ─────────────────────────────────────────────────────────╮${C.reset}`);
  console.log(`${C.gray}│${C.reset} ${C.bold}File:${C.reset} ${LOG_FILE}`);
  console.log(`${C.gray}│${C.reset} ${C.bold}Filters:${C.reset} ${USER ? `user=${USER}` : 'all users'} · ${KIND ? `kind=${KIND}` : 'all kinds'}`);
  console.log(`${C.bold}${C.brightCyan}╰────────────────────────────────────────────────────────────────────────╯${C.reset}`);
  console.log('');
}

printHeader();

const initial = readTail(TAIL);
for (const e of initial) console.log(renderLine(e));

// ═══ --follow ═══
if (FOLLOW) {
  console.log('');
  console.log(`${C.dim}--- following ${LOG_FILE} (Ctrl+C to stop) ---${C.reset}`);
  let pos = fs.statSync(LOG_FILE).size;
  fs.watchFile(LOG_FILE, { interval: 500 }, () => {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size < pos) pos = 0; // 檔案被替換
    if (stat.size === pos) return;
    const stream = fs.createReadStream(LOG_FILE, {
      start: pos,
      end: stat.size - 1,
      encoding: 'utf8',
    });
    let buf = '';
    stream.on('data', d => buf += d);
    stream.on('end', () => {
      pos = stat.size;
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (filter(e)) console.log(renderLine(e));
        } catch {}
      }
    });
  });
}