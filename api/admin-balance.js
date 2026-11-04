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

  // 美元余额：优先用接口直接给的 USD / USDT，没有就按固定汇率折算
  const usdInfo = (data.balance_infos || []).find(b => b.currency === 'USD' || b.currency === 'USDT');
  const CNY_PER_USD = 7.2;
  const totalUsd = usdInfo ? Number(usdInfo.total_balance || 0) : totalBalance / CNY_PER_USD;
  const grantedUsd = usdInfo ? Number(usdInfo.granted_balance || 0) : Number(cny?.granted_balance || 0) / CNY_PER_USD;
  const toppedUsd = usdInfo ? Number(usdInfo.topped_up_balance || 0) : Number(cny?.topped_up_balance || 0) / CNY_PER_USD;

  // ── 储备池：按「最亏损的峰期」折算 ──
  // 每 1 token 收费对应的真实成本 = 3e-9 美元 × AI_CHARGE_DIVISOR（峰期）
  // 空闲时段是半价，所以这是最保守的口径
  const { AI_CHARGE_DIVISOR } = await import('../lib/submission.js');
  const { isPeakHour } = await import('../lib/pricing.js');

  const USD_PER_TOKEN_PEAK = 3e-9 * AI_CHARGE_DIVISOR;   // 峰期：1.2e-6 美元/token
  const estTokens = totalUsd > 0 ? Math.floor(totalUsd / USD_PER_TOKEN_PEAK) : 0;
  const estUnitUsd = USD_PER_TOKEN_PEAK * 1_000_000;     // 美元 / 百万 token（峰期）
  const estUnit = (estUnitUsd * CNY_PER_USD).toFixed(2); // 折算回人民币便于对照

  return res.status(200).json({
    success: true,
    available: data.is_available,
    currency: cny?.currency || 'CNY',
    totalBalance,
    grantedBalance: Number(cny?.granted_balance || 0),
    toppedUpBalance: Number(cny?.topped_up_balance || 0),
    peak: isPeakHour(),
    peakMultiplier: isPeakHour() ? 2 : 1,
    estUnitUsd,
    estSource: 'peak',
    currencyUsd: usdInfo ? (usdInfo.currency || 'USD') : 'USD',
    totalUsd,
    grantedUsd,
    toppedUsd,
    usdSource: usdInfo ? 'api' : 'converted',
    cnyPerUsd: CNY_PER_USD,
    estTokens,
    estUnit: EST_UNIT,
  });
});