// lib/github-upload.js
// 上傳圖片到 GitHub repo，回傳 jsDelivr URL
// 使用 Git Trees API 查現有檔案，避免重複編號
import crypto from 'crypto';

const GITHUB_API = 'https://api.github.com';

function getConfig() {
  const token  = process.env.GITHUB_IMAGES_TOKEN || process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_IMAGES_OWNER || process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_IMAGES_REPO  || process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_IMAGES_BRANCH || process.env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    throw new Error('GitHub image upload not configured (missing env vars)');
  }
  return { token, owner, repo, branch };
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:image\/([\w+]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid image data URL');
  let ext = m[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  if (ext === 'svg+xml') ext = 'svg';
  if (!['jpg', 'png', 'gif', 'webp', 'svg'].includes(ext)) ext = 'jpg';
  return { ext, base64: m[2] };
}

async function ghFetch(url, opts, token) {
  return fetch(url, {
    ...(opts || {}),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wyk-math-upload',
      ...((opts && opts.headers) || {}),
    },
  });
}

// ═══════════════ Tree 快取（60 秒）═══════════════
let _treeCache = { data: null, expireAt: 0 };
const TREE_TTL = 60 * 1000;

async function getTree(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _treeCache.data && _treeCache.expireAt > now) {
    return _treeCache.data;
  }
  const { token, owner, repo, branch } = getConfig();
  const url = `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const res = await ghFetch(url, {}, token);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Get tree failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const paths = new Set((data.tree || []).map(n => n.path));
  _treeCache = { data: paths, expireAt: now + TREE_TTL };
  return paths;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 從 tree 找 {baseName}-N.ext 的最大 N
async function findMaxIndex(folder, baseName) {
  const paths = await getTree();
  const prefix = folder ? folder.replace(/\/+$/, '') + '/' : '';
  const re = new RegExp(
    '^' + escapeRegex(prefix + baseName) + '-(\\d+)\\.[a-zA-Z0-9]+$'
  );
  let max = 0;
  for (const p of paths) {
    const m = p.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return max;
}

// ═══════════════ 底層：PUT 檔案 ═══════════════
async function putFile(path, base64, token, owner, repo, branch, message) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURI(path)}`;
  const res = await ghFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64, branch }),
  }, token);
  if (res.ok) return;
  const t = await res.text().catch(() => '');
  const err = new Error(`PUT ${path} failed (${res.status}): ${t.slice(0, 200)}`);
  err.status = res.status;
  throw err;
}

// ═══════════════ 對外 API 1：編號式 ═══════════════
/**
 * 上傳「編號式」圖片 → {folder}/{baseName}-{N}.{ext}
 * 自動找下一個可用 N（同一個 baseName 累加）
 *
 * @param {string} dataUrl - data:image/jpeg;base64,xxx
 * @param {object} opts - { folder, baseName }
 * @returns {Promise<string>} jsDelivr URL
 */
export async function uploadNumberedImage(dataUrl, opts = {}) {
  const { token, owner, repo, branch } = getConfig();
  const { ext, base64 } = parseDataUrl(dataUrl);
  const folder = (opts.folder || 'images/problems').replace(/^\/+|\/+$/g, '');
  const baseName = String(opts.baseName || 'img').replace(/[^A-Za-z0-9._-]/g, '_');

  // 最多重試 3 次（並發上傳同一題時可能撞號）
  for (let attempt = 0; attempt < 3; attempt++) {
    const max = await findMaxIndex(folder, baseName);
    const n = max + 1;
    const path = `${folder}/${baseName}-${n}.${ext}`;
    try {
      await putFile(path, base64, token, owner, repo, branch, `upload: ${path}`);
      _treeCache.expireAt = 0;   // 讓下次查樹刷新
      return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
    } catch (e) {
      // 422 / 409 = 檔案已存在（並發衝突）→ 刷新樹重試
      if (e.status === 422 || e.status === 409) {
        _treeCache.expireAt = 0;
        await getTree(true);
        continue;
      }
      throw e;
    }
  }
  throw new Error('Upload failed after 3 attempts (concurrent conflict)');
}

// ═══════════════ 對外 API 2：時間戳式 ═══════════════
/**
 * 上傳「時間戳式」圖片 → {folder}/{baseName}-{ts}.{ext}
 * 用於頭像等需要每次新 URL 的場景（避免 CDN 快取問題）
 *
 * @param {string} dataUrl - data:image/jpeg;base64,xxx
 * @param {object} opts - { folder, baseName }
 * @returns {Promise<string>} jsDelivr URL
 */
export async function uploadTimestampedImage(dataUrl, opts = {}) {
  const { token, owner, repo, branch } = getConfig();
  const { ext, base64 } = parseDataUrl(dataUrl);
  const folder = (opts.folder || 'images/pfp').replace(/^\/+|\/+$/g, '');
  const baseName = String(opts.baseName || 'img').replace(/[^A-Za-z0-9._-]/g, '_');
  const ts = Date.now();
  const path = `${folder}/${baseName}-${ts}.${ext}`;

  await putFile(path, base64, token, owner, repo, branch, `upload: ${path}`);
  _treeCache.expireAt = 0;
  return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`;
}

// ═══════════════ 對外 API 3：刪除 ═══════════════
/**
 * 刪除檔案（傳完整 path）
 * @param {string} path - "images/problems/HA2501-1.jpg"
 */
export async function deleteImage(path) {
  const { token, owner, repo, branch } = getConfig();
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`;

  // 先拿 sha
  const getRes = await ghFetch(url, {}, token);
  if (!getRes.ok) {
    if (getRes.status === 404) return false;
    throw new Error(`Get file failed: ${getRes.status}`);
  }
  const meta = await getRes.json();

  const delRes = await ghFetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURI(path)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `delete: ${path}`, sha: meta.sha, branch }),
    },
    token
  );
  if (!delRes.ok) {
    throw new Error(`Delete failed: ${delRes.status}`);
  }
  _treeCache.expireAt = 0;
  return true;
}