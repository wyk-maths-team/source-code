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
// ═══════════════ 備份專用：分離 config ═══════════════
// backup repo 是 private，和 images 的 static repo 分開
// 環境變數：
//   GITHUB_BACKUP_TOKEN / GITHUB_BACKUP_OWNER / GITHUB_BACKUP_REPO / GITHUB_BACKUP_BRANCH
// 若沒設 → fallback 到 images 的變數（單一 token 授權兩個 repo 的情境）

function getBackupConfig() {
  const token  = process.env.GITHUB_BACKUP_TOKEN  || process.env.GITHUB_IMAGES_TOKEN  || process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_BACKUP_OWNER  || process.env.GITHUB_IMAGES_OWNER  || process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_BACKUP_REPO   || 'backup';
  const branch = process.env.GITHUB_BACKUP_BRANCH || 'main';

  if (!token || !owner || !repo) {
    throw new Error('GitHub backup not configured (missing GITHUB_BACKUP_* / GITHUB_IMAGES_* env)');
  }
  return { token, owner, repo, branch };
}

/**
 * 上傳一個 JSON 物件到 backup repo
 * @param {string} path - 例如 "users/alice-20260926-143052.json"
 * @param {object} obj  - 任意可 JSON.stringify 的物件
 * @param {object} opts - { message?: string, overwrite?: boolean }
 * @returns {Promise<{ path, url, rawUrl, githubUrl, sha }>}
 */
export async function uploadJsonFile(path, obj, opts = {}) {
  const { token, owner, repo, branch } = getBackupConfig();
  const cleanPath = String(path).replace(/^\/+|\/+$/g, '');
  if (!cleanPath) throw new Error('Empty path');

  const content = JSON.stringify(obj, null, 2);
  const base64 = Buffer.from(content, 'utf8').toString('base64');
  const size = Buffer.byteLength(content, 'utf8');

  // 大檔警告（GitHub 單檔 100MB，但 base64 後膨脹 33%）
  if (size > 75 * 1024 * 1024) {
    throw new Error(`Backup too large: ${(size / 1024 / 1024).toFixed(1)} MB (max ~75MB)`);
  }

  const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(cleanPath)}`;

  // 若 overwrite，先取 sha
  let sha = null;
  if (opts.overwrite) {
    try {
      const check = await ghFetch(`${putUrl}?ref=${encodeURIComponent(branch)}`, {}, token);
      if (check.ok) {
        const meta = await check.json();
        sha = meta.sha;
      }
    } catch { /* 不存在 → sha 保持 null */ }
  }

  const body = {
    message: opts.message || `backup: ${cleanPath}`,
    content: base64,
    branch,
  };
  if (sha) body.sha = sha;

  const res = await ghFetch(putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, token);

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`GitHub backup PUT failed (${res.status}): ${t.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  return {
    path: cleanPath,
    sha: (await res.json()).content?.sha,
    size,
    // private repo → 沒有 jsDelivr，但有 GitHub 網頁連結
    githubUrl: `https://github.com/${owner}/${repo}/blob/${branch}/${cleanPath}`,
    rawUrl:    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${cleanPath}`,
  };
}

/**
 * 檢查 backup repo 是否設定正確（debug 用）
 */
export function getBackupInfo() {
  try {
    const { owner, repo, branch } = getBackupConfig();
    return { ok: true, owner, repo, branch };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}