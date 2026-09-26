// lib/audit.js
import { notifyDanger, notifyWarn } from './webhook.js';

const RISKY_PATTERNS = [
  { re: /^problem_delete/,      level: 'danger' },
  { re: /^delete_problem/,      level: 'danger' },
  { re: /^delete_user/,         level: 'danger' },
  { re: /^delete_contest/,      level: 'danger' },
  { re: /^delete_discussion/,   level: 'warn' },
  { re: /_batch$/,              level: 'danger' },   // 任何 *_batch
  { re: /^update_user/,         level: 'warn' },
  { re: /^set_discussion_likes/, level: 'warn' },
  { re: /^upload_.*_image/,     level: 'warn' },
];

export async function auditLog(db, action, details, operator) {
  try {
    await db.collection('audit_logs').insertOne({
      action,
      details,
      operator,
      timestamp: new Date(),
    });

    // 檢查是否觸發 webhook
    const match = RISKY_PATTERNS.find(p => p.re.test(action));
    if (match) {
      const notifyFn = match.level === 'danger' ? notifyDanger : notifyWarn;
      notifyFn(
        `${operator} → ${action}`,
        summarizeDetails(details),
        { operator, action, ...pickFields(details) }
      );
    }
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

function summarizeDetails(details) {
  if (!details) return '';
  if (details.id) return `Target: ${details.id}`;
  if (Array.isArray(details.ids)) return `Batch: ${details.ids.length} items`;
  if (details.username) return `User: ${details.username}`;
  return JSON.stringify(details).slice(0, 200);
}

function pickFields(details) {
  const out = {};
  const KEYS = ['id', 'username', 'problemId', 'contestId', 'count', 'score', 'role'];
  for (const k of KEYS) {
    if (details && details[k] !== undefined) out[k] = details[k];
  }
  if (Array.isArray(details?.ids) && details.ids.length) {
    out.count = details.ids.length;
    out.ids = details.ids.slice(0, 5).join(', ') + (details.ids.length > 5 ? '…' : '');
  }
  return out;
}