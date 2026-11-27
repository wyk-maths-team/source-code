// api/neko-image.js
//
// 猫娘图的代理端点。
//
// 为什么不让浏览器直接去第三方 CDN 拉：那几家图动辄 1.8–3.8MB，且 waifu.pics
// 经常整个域名解析失败。直接塞进提交响应（base64）会把 JSON 撑到 2–5MB，
// 根本发不出去。所以提交响应里只给一个代理地址，图由这个端点取。
//
//   GET /api/neko-image?src=<base64url 的原始地址>
//
// 白名单域名，防 SSRF；只允许图片类型；带 1 天浏览器缓存。

import { wrapHandler, sendError } from '../lib/errors.js';

const ALLOWED_HOSTS = [
  'nekos.best',
  'cdn.nekos.best',
  'api.waifu.pics',
  'i.waifu.pics',
  'nekos.life',
  'cdn.nekos.life',
];

const MAX_BYTES = 6 * 1024 * 1024;

function decodeSrc(s) {
  try {
    return Buffer.from(String(s || ''), 'base64url').toString('utf8');
  } catch (e) {
    return '';
  }
}

export function proxyUrlFor(originalUrl) {
  return '/api/neko-image?src=' + Buffer.from(String(originalUrl), 'utf8').toString('base64url');
}

async function handler(req, res) {
  if (req.method !== 'GET') return sendError(req, res, 'BAD_REQUEST', 'Method not allowed');

  const src = decodeSrc(req.query && req.query.src);
  if (!src) return sendError(req, res, 'BAD_REQUEST', 'Missing src');

  let parsed;
  try { parsed = new URL(src); } catch (e) { return sendError(req, res, 'BAD_REQUEST', 'Bad url'); }

  if (parsed.protocol !== 'https:') return sendError(req, res, 'BAD_REQUEST', 'https only');
  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(host)) return sendError(req, res, 'BAD_REQUEST', 'Host not allowed');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: { 'User-Agent': 'wyk-math-oj', 'Accept': 'image/*' },
    });
    if (!upstream.ok) return sendError(req, res, 'UPSTREAM', 'Image fetch failed');

    const ct = String(upstream.headers.get('content-type') || '');
    if (ct.indexOf('image/') !== 0) return sendError(req, res, 'UPSTREAM', 'Not an image');

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return sendError(req, res, 'UPSTREAM', 'Image too large');

    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', String(buf.length));
    // 同一张图不会再变，缓存一天足够；private 是因为它只给圈内人看
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    return res.status(200).send(buf);
  } catch (e) {
    return sendError(req, res, 'UPSTREAM', 'Image fetch failed');
  } finally {
    clearTimeout(timer);
  }
}

export default wrapHandler(handler, { gate: false });
