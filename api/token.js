// api/token.js
import { sqlDb } from '../lib/docStore.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { getTokenBalance } from '../lib/token.js';
import { wrapHandler } from '../lib/errors.js';

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false });

  try {
    const db = sqlDb();
    const token = await getTokenBalance(db, decoded.username);
    return res.status(200).json({ 
      success: true, 
      daily: token.daily, 
      global: token.global 
    });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
}
export default wrapHandler(handler);