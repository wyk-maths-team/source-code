// api/hint-image.js
//
// 提示图的唯一出口。
//
// 安全模型很简单，但每一条都必须在服务端：
//   1. 必须登录
//   2. hintPurchases 里必须有这条 (username, problemId, hintId)
//   3. 文件名由服务端从题目文档里查出来，客户端只传 problemId + hintId
//   4. 图片本体在 private 仓库，响应只回字节，不回任何仓库地址
//
// 客户端拿不到可分享的链接：它调的是这个端点，带的是自己的 Bearer token。
// 把 URL 发给别人没有用 —— 对方没有那条 hintPurchases 记录。

import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { getHintImage, isValidHintFile } from '../lib/hint-images.js';

function isAdmin(user) {
  return !!user && (user.role === 'admin' || user.role === 'root');
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const user = await verifyToken(req);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const problemId = String(req.query.problemId || '').trim();
  const hintId = String(req.query.hintId || '').trim();
  if (!problemId || !hintId) {
    return res.status(400).json({ success: false, message: 'Missing problemId or hintId' });
  }

  const db = await connectToDatabase();

  // 1) 文件名只信数据库，不信查询参数
  const problem = await db.collection('problems').findOne(
    { id: problemId },
    { projection: { hints: 1 } }
  );
  if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

  const hint = (problem.hints || []).find(h => String(h.id) === hintId);
  const file = hint && hint.image && hint.image.file;
  if (!file || !isValidHintFile(file)) {
    return res.status(404).json({ success: false, message: 'No image for this hint' });
  }

  // 2) 解锁校验。AC 过的题免 Hint 费，但仍然要求有一条购买记录
  //    （hint.js 在 AC 的情况下也会写一条 price:0 的记录，所以这里统一查）。
  const admin = isAdmin(user);
  if (!admin) {
    const bought = await db.collection('hintPurchases').findOne(
      { username: user.username, problemId, hintId },
      { projection: { _id: 1 } }
    );
    if (!bought) {
      return res.status(403).json({ success: false, message: 'Hint not unlocked' });
    }
  }

  // 3) 取图
  let img;
  try {
    img = await getHintImage(file);
  } catch (e) {
    console.error('[hint-image] storage read failed:', e && e.message);
    return res.status(502).json({ success: false, message: 'Image storage unavailable' });
  }
  if (!img) return res.status(404).json({ success: false, message: 'Image not found' });

  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Content-Length', String(img.buffer.length));
  // 私有内容：浏览器可以缓存（同一用户重复看同一张图是常事），
  // 但任何共享缓存都不许存（s-maxage 缺席 + private）。
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // SVG 能带脚本：把它当图片渲染，禁止当作文档解释
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  return res.status(200).send(img.buffer);
}

export default wrapHandler(handler, { gate: false });
