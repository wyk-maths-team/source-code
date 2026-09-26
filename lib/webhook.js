// lib/webhook.js
// 發送通知到 Discord（或其他 webhook 端點）

let _queue = [];
let _flushTimer = null;
const FLUSH_DELAY = 300;          // 合併 300ms 內的多條通知
const STALE_TTL_MS = 30_000;      // 入隊超過 30 秒的事件直接丟棄（防殘留）

async function postToDiscord(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.warn('[webhook] Discord returned', res.status);
  } catch (e) {
    console.warn('[webhook] send failed:', e.message);
  }
}

const LEVEL_COLOR = { info: 0x4a90d9, warn: 0xffc107, danger: 0xf85149 };
const LEVEL_EMOJI = { info: 'ℹ️', warn: '⚠️', danger: '🚨' };

/**
 * 發送一則通知（會自動合併 300ms 內的多條）
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} opts.level - 'info' | 'warn' | 'danger'
 * @param {object} opts.fields
 */
export function notify({ title, message, level = 'info', fields = {} } = {}) {
  // ⭐ 關鍵：入隊時就固定時間戳，避免 flush 時被誤標為「現在」
  _queue.push({
    title: String(title || ''),
    message: String(message || ''),
    level,
    fields,
    enqueuedAt: Date.now(),
    timestamp: new Date().toISOString(),
  });

  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flush, FLUSH_DELAY);
}

async function flush() {
  _flushTimer = null;
  if (!_queue.length) return;

  const now = Date.now();
  // ⭐ 丟棄殘留的舊事件（上個請求崩潰留下的）
  const fresh = _queue.filter(it => now - it.enqueuedAt < STALE_TTL_MS);
  const dropped = _queue.length - fresh.length;
  if (dropped > 0) {
    console.warn(`[webhook] dropped ${dropped} stale notification(s)`);
  }
  _queue = [];

  if (!fresh.length) return;

  const items = fresh.slice(0, 5);
  const embeds = items.map(item => {
    const fields = Object.entries(item.fields || {})
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .slice(0, 10)
      .map(([name, value]) => ({
        name: String(name).slice(0, 256),
        value: String(value).slice(0, 1024),
        inline: true,
      }));

    return {
      title: `${LEVEL_EMOJI[item.level] || ''} ${item.title.slice(0, 250)}`.trim(),
      description: item.message ? item.message.slice(0, 4000) : undefined,
      color: LEVEL_COLOR[item.level] || 0x4a90d9,
      fields: fields.length ? fields : undefined,
      timestamp: item.timestamp,     // ⭐ 用事件本身的時間
    };
  });

  if (fresh.length > 5) {
    embeds.push({
      description: `...and ${fresh.length - 5} more event(s)`,
      color: 0x888888,
    });
  }

  await postToDiscord({ username: 'WYK Maths Audit', embeds });
}

// ⭐ 快捷方法
export function notifyDanger(title, message, fields) {
  return notify({ title, message, level: 'danger', fields });
}
export function notifyWarn(title, message, fields) {
  return notify({ title, message, level: 'warn', fields });
}
export function notifyInfo(title, message, fields) {
  return notify({ title, message, level: 'info', fields });
}

// ═══════════════ 兼容層：sendAuditNotification(action, details, operator, level) ═══════════════
// users.js 一直在 import 這個函數，這裡補上，避免 undefined 呼叫。
// 若呼叫端沒給 level，這裡會自動依 action 命名推斷。
export function sendAuditNotification(action, details = {}, operator = 'system', level = null) {
  const inferred = inferLevel(action);
  const finalLevel = level || inferred;

  const fields = { operator, action };
  const KEYS = ['username', 'id', 'problemId', 'contestId', 'count', 'score',
                'role', 'displayName', 'realName', 'banned'];
  for (const k of KEYS) {
    const v = details?.[k];
    if (v !== undefined && v !== null && v !== '') fields[k] = v;
  }
  if (Array.isArray(details?.ids) && details.ids.length) {
    fields.count = details.ids.length;
    fields.ids = details.ids.slice(0, 5).join(', ') +
      (details.ids.length > 5 ? '…' : '');
  }

  const message = summarize(action, details);
  return notify({ title: `${action}`, message, level: finalLevel, fields });
}

// 依 action 命名推斷通知級別（前後綴皆可）
function inferLevel(action) {
  if (typeof action !== 'string') return 'info';
  const a = action.toLowerCase();
  if (/(^|_)delete(_|$)|(^|_)remove(_|$)|_batch$|^delete_|_delete$/.test(a)) return 'danger';
  if (/(^|_)update(_|$)|(^|_)set(_|$)|_fail(ed)?$/.test(a)) return 'warn';
  return 'info';
}

function summarize(action, details) {
  if (!details || typeof details !== 'object') return String(details || '');
  const parts = [];
  if (details.username) parts.push(`user=${details.username}`);
  if (details.id !== undefined) parts.push(`id=${details.id}`);
  if (Array.isArray(details.ids)) parts.push(`ids=${details.ids.length}`);
  if (Array.isArray(details.notes) && details.notes.length) {
    parts.push(details.notes.join('; '));
  }
  // 若 auditLog 帶 before/after，diff 出實際變動
  if (details.before && details.after && typeof details.before === 'object') {
    const changes = [];
    for (const k of Object.keys(details.after)) {
      const b = JSON.stringify(details.before[k]);
      const a = JSON.stringify(details.after[k]);
      if (b !== a) changes.push(`${k}: ${b} → ${a}`);
    }
    if (changes.length) parts.push(changes.join('; '));
  }
  if (Array.isArray(details.fields) && details.fields.length) {
    parts.push(`fields=${details.fields.join(',')}`);
  }
  return parts.join(' | ') || `action: ${action}`;
}