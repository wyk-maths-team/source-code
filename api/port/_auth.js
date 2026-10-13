// api/port/_auth.js
import { verifyToken } from '../../lib/auth.js';
import { applyRateLimit } from '../../lib/rateLimit.js';

export async function portAuth(req, res) {
  if (!(await applyRateLimit(req, res))) return null;
  const decoded = await verifyToken(req);
  if (!decoded) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return null;
  }
  if (decoded.role !== 'root') {
    res.status(403).json({ success: false, message: 'Root only' });
    return null;
  }
  return decoded;
}