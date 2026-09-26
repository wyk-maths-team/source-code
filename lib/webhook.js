// lib/webhook.js
// 發送通知到 Discord（或其他 webhook 端點）

let _queue = [];
let _flushTimer = null;
const FLUSH_DELAY = 300;   // 合併 300ms 內的多條通知

async function postToDiscord(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    // 沒設定 → 靜默跳過（不影響主流程）
    return;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn('[webhook] Discord returned', res.status);
    }
  } catch (e) {
    console.warn('[webhook] send failed:', e.message);
  }
}

/**
 * 發送一則通知（會自動合併 300ms 內的多條）
 * @param {object} opts
 * @param {string} opts.title - 標題
 * @param {string} opts.message - 內容
 * @param {string} opts.level - 'info' | 'warn' | 'danger'
 * @param {object} opts.fields - 額外欄位 { key: value }
 */
export function notify({ title, message, level = 'info', fields = {} } = {}) {
  _queue.push({ title, message, level, fields });

  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flush, FLUSH_DELAY);
}

async function flush() {
  _flushTimer = null;
  if (!_queue.length) return;

  const items = _queue.slice();
  _queue = [];

  const LEVEL_COLOR = { info: 0x4a90d9, warn: 0xffc107, danger: 0xf85149 };
  const LEVEL_EMOJI = { info: 'ℹ️', warn: '⚠️', danger: '🚨' };

  // 合併成一條 Discord embed（最多 10 個 field）
  const embeds = items.slice(0, 5).map(item => {
    const fields = Object.entries(item.fields || {})
      .slice(0, 10)
      .map(([name, value]) => ({
        name: String(name).slice(0, 256),
        value: String(value).slice(0, 1024),
        inline: true,
      }));

    return {
      title: `${LEVEL_EMOJI[item.level] || ''} ${String(item.title || '').slice(0, 250)}`,
      description: String(item.message || '').slice(0, 4000),
      color: LEVEL_COLOR[item.level] || 0x4a90d9,
      fields: fields.length ? fields : undefined,
      timestamp: new Date().toISOString(),
    };
  });

  if (items.length > 5) {
    embeds.push({
      description: `...and ${items.length - 5} more`,
      color: 0x888888,
    });
  }

  await postToDiscord({
    username: 'WYK Maths Audit',
    embeds,
  });
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