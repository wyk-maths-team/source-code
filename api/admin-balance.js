// api/admin-balance.js
import { verifyToken } from '../lib/auth.js';
import { wrapHandler } from '../lib/errors.js';

export default wrapHandler(async (req, res) => {
  const decoded = await verifyToken(req);
  if (!decoded || (decoded.role !== 'admin' && decoded.role !== 'root')) {
    return res.status(403).json({ success: false, message: 'Admin only' });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, message: 'DEEPSEEK_API_KEY not configured' });
  }

  const r = await fetch('https://api.deepseek.com/user/balance', {
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  });

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return res.status(502).json({ success: false, message: `DeepSeek API ${r.status}`, detail: text.slice(0, 300) });
  }

  const data = await r.json();
  const cny = (data.balance_infos || []).find(b => b.currency === 'CNY')
          || (data.balance_infos || [])[0];

  const totalBalance = Number(cny?.total_balance || 0);
  const EST_UNIT = 1.57; // 元 / 百万 token
  const estTokens = Math.floor((totalBalance / EST_UNIT) * 1_000_000);

  return res.status(200).json({
    success: true,
    available: data.is_available,
    currency: cny?.currency || 'CNY',
    totalBalance,
    grantedBalance: Number(cny?.granted_balance || 0),
    toppedUpBalance: Number(cny?.topped_up_balance || 0),
    estTokens,
    estUnit: EST_UNIT,
  });
});