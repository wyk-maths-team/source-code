// lib/webhook.js
// 發送通知到 Discord（或其他 webhook 端點）
// ⚠️ Vercel serverless：必須同步 await fetch，不能用 setTimeout 排隊

const LEVEL_COLOR = { info: 0x4a90d9, warn: 0xffc107, danger: 0xf85149 };
const LEVEL_EMOJI = { info: 'ℹ️', warn: '⚠️', danger: '🚨' };

async function postToDiscord(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;                          // 沒配置 → 靜默跳過
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn('[webhook] Discord returned', res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    console.warn('[webhook] send failed:', e.message);
  }
}

/**
 * 發送一則通知（立即 await 發送，不排隊）
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {string} opts.level - 'info' | 'warn' | 'danger'
 * @param {object} opts.fields
 */
export async function notify({ title = '', message = '', level = 'info', fields = {} } = {}) {
  const embedFields = Object.entries(fields || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 10)
    .map(([name, value]) => ({
      name: String(name).slice(0, 256),
      value: String(value).slice(0, 1024),
      inline: true,
    }));

  const embed = {
    title: `${LEVEL_EMOJI[level] || ''} ${String(title).slice(0, 250)}`.trim(),
    description: message ? String(message).slice(0, 4000) : undefined,
    color: LEVEL_COLOR[level] || 0x4a90d9,
    fields: embedFields.length ? embedFields : undefined,
    timestamp: new Date().toISOString(),
  };

  // ⭐ 直接 await，不進隊列
  await postToDiscord({ username: 'WYK Maths Audit', embeds: [embed] });
}

// ⭐ 快捷方法（皆為 async）
export async function notifyDanger(title, message, fields) {
  return notify({ title, message, level: 'danger', fields });
}
export async function notifyWarn(title, message, fields) {
  return notify({ title, message, level: 'warn', fields });
}
export async function notifyInfo(title, message, fields) {
  return notify({ title, message, level: 'info', fields });
}

// ═══════════════ 兼容層：sendAuditNotification ═══════════════
// users.js 曾經 import 這個函數；保留導出，避免 undefined 呼叫
export async function sendAuditNotification(action, details = {}, operator = 'system', level = null) {
  const finalLevel = level || inferLevel(action);

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

  return notify({
    title: String(action),
    message: summarize(action, details),
    level: finalLevel,
    fields,
  });
}

function inferLevel(action) {
  if (typeof action !== 'string') return 'info';
  const a = action.toLowerCase();
  if (/(^|_)(delete|remove)(_|$)|_batch$/.test(a)) return 'danger';
  if (/(^|_)(update|set)(_|$)/.test(a)) return 'warn';
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