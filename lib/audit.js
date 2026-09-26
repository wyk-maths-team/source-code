// lib/audit.js
import { notifyDanger, notifyWarn, notifyInfo } from './webhook.js';

const RISKY_PATTERNS = [
  { re: /(^|_)(delete|remove)(_|$)/i, level: 'danger' },
  { re: /_batch$/i,                    level: 'danger' },
  { re: /(^|_)update(_|$)/i,           level: 'warn' },
  { re: /(^|_)set(_|$)/i,              level: 'warn' },
  { re: /upload_.*_image/i,            level: 'warn' },
  { re: /(^|_)create(_|$)/i,           level: 'info' },
  { re: /(^|_)upload(_|$)/i,           level: 'info' },
];

export async function auditLog(db, action, details, operator, level = null) {
  try {
    await db.collection('audit_logs').insertOne({
      action, details, operator,
      level: level || undefined,
      timestamp: new Date(),
    });

    let finalLevel = level;
    if (!finalLevel) {
      const match = RISKY_PATTERNS.find(p => p.re.test(action));
      finalLevel = match ? match.level : 'info';
    }
    const notifyFn =
      finalLevel === 'danger' ? notifyDanger :
      finalLevel === 'warn'   ? notifyWarn   :
                                notifyInfo;
    notifyFn(`${operator} → ${action}`, summarizeDetails(details), {
      operator, action, ...pickFields(details)
    });
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

function summarizeDetails(details) {
  if (!details) return '';
  if (details.id !== undefined) return `Target: ${details.id}`;
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