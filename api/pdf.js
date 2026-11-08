// api/pdf.js —— 课程 PDF 的受控出口
//
// 静态托管下的 /assets/pdf/*.pdf 任何人都能直接下载。这里用 vercel.json 把
// 那个前缀整体重写过来，先校验登录再读文件，路径和内容都不再是公开资源。
//
// 这不是真正的权限系统（没有按用户/课程授权），目标是挡住「扒一下源码或
// 网络面板就能把整份 PDF 拿走」的程度。

import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyToken } from '../lib/auth.js';
import { wrapHandler } from '../lib/errors.js';

const PDF_ROOT = path.join(process.cwd(), 'assets', 'pdf');

function safeJoin(name) {
  // 只允许 assets/pdf 下的文件：去掉开头的斜杠，拒绝任何 .. 段，
  // 再确认解析结果仍在 PDF_ROOT 里。
  const cleaned = String(name || '').replace(/^\/+/, '').split('\\').join('/');
  if (!cleaned || cleaned.split('/').some((seg) => seg === '..')) return null;

  const full = path.resolve(PDF_ROOT, cleaned);
  const root = path.resolve(PDF_ROOT);
  const rel = path.relative(root, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const user = await verifyToken(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Please sign in to view this PDF' });
  }

  // 从 URL 直接解析：Vercel rewrite 会把 /assets/pdf/xxx 变成 /api/pdf?path=xxx，
  // 而某些框架（Express 5）的 req.query 是只读 getter。
  let name = '';
  try {
    const u = new URL(String(req.url || ''), 'http://localhost');
    name = u.searchParams.get('path') || u.searchParams.get('file') || '';
  } catch (e) { name = ''; }
  if (!name && req.query) name = req.query.path || req.query.file || '';
  const full = safeJoin(Array.isArray(name) ? name.join('/') : name);
  if (!full) return res.status(400).json({ success: false, message: 'Invalid path' });

  let buf;
  try {
    buf = await fs.readFile(full);
  } catch (e) {
    return res.status(404).json({ success: false, message: 'PDF not found' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(buf.length));
  // inline：浏览器内置阅读器直接打开；同时禁止被当成附件随便存
  res.setHeader('Content-Disposition', 'inline; filename="notes.pdf"');
  // 不让中间层缓存，避免绕开登录
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(buf);
}

export default wrapHandler(handler);
