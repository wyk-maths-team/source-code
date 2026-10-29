// lib/github-release.js —— 把备份作为 Release asset 上传到 GitHub
//
// 为什么要 Releases 而不是 repo 文件（原来的做法）：
//   · Contents API 每个文件一次 commit，几十个集合就是几十个 commit，
//     仓库历史会被备份刷爆；Releases 不进提交历史。
//   · Release asset 单文件上限 2GB，比 Contents API 宽松。
//   · 可以按日期打 tag，恢复时按 tag 找，比翻目录清楚。
//
// 环境变量（与 lib/github-upload.js 的备份配置共用）：
//   GITHUB_BACKUP_TOKEN / GITHUB_BACKUP_OWNER / GITHUB_BACKUP_REPO
//   缺失时回退到 GITHUB_IMAGES_* / GITHUB_TOKEN

import { gzipSync } from 'node:zlib';

const API = 'https://api.github.com';
const UPLOAD_API = 'https://uploads.github.com';

function getConfig() {
  const token  = process.env.GITHUB_BACKUP_TOKEN  || process.env.GITHUB_IMAGES_TOKEN  || process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_BACKUP_OWNER  || process.env.GITHUB_IMAGES_OWNER  || process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_BACKUP_REPO   || 'backup';
  const branch = process.env.GITHUB_BACKUP_BRANCH || 'main';

  if (!token || !owner || !repo) {
    throw new Error('GitHub backup not configured (missing GITHUB_BACKUP_* / GITHUB_IMAGES_* env)');
  }
  return { token, owner, repo, branch };
}

function ghFetch(url, opts, token) {
  return fetch(url, {
    ...(opts || {}),
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wyk-math-backup',
      ...((opts && opts.headers) || {}),
    },
  });
}

export function getReleaseBackupInfo() {
  try {
    const { owner, repo, branch } = getConfig();
    return { ok: true, owner, repo, branch };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * 创建一个 release。tag 已存在时返回已存在的那个（幂等）。
 */
export async function createRelease({ tag, name, body, targetCommitish }) {
  const { token, owner, repo, branch } = getConfig();

  const res = await ghFetch(API + '/repos/' + owner + '/' + repo + '/releases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      name: name || tag,
      body: body || '',
      target_commitish: targetCommitish || branch,
      draft: false,
      prerelease: true,   // 备份不算正式版本，避免占 release 主列表
    }),
  }, token);

  if (res.ok) return res.json();

  // 422 = tag 已存在，取回来复用
  if (res.status === 422) {
    const q = await ghFetch(
      API + '/repos/' + owner + '/' + repo + '/releases/tags/' + encodeURIComponent(tag),
      {}, token
    );
    if (q.ok) return q.json();
  }

  const t = await res.text().catch(() => '');
  throw new Error('create release failed (' + res.status + '): ' + t.slice(0, 300));
}

/**
 * 上传一个 asset。
 * @param {number} releaseId
 * @param {string} name       文件名（release 内唯一）
 * @param {Buffer|Uint8Array} buffer
 * @param {string} contentType
 */
export async function uploadReleaseAsset(releaseId, name, buffer, contentType) {
  const { token, owner, repo } = getConfig();
  const url = UPLOAD_API + '/repos/' + owner + '/' + repo + '/releases/' + releaseId +
    '/assets?name=' + encodeURIComponent(name);

  const res = await ghFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': contentType || 'application/gzip',
    },
    body: buffer,
  }, token);

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    // 422 通常是同名 asset 已存在
    throw new Error('upload asset ' + name + ' failed (' + res.status + '): ' + t.slice(0, 300));
  }
  return res.json();
}

/** gzip 一个 JSON 对象 */
export function gzipJson(obj, level = 6) {
  return gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level });
}

/**
 * 把一批集合打包成若干 JSON.gz 并上传到同一个 release。
 *
 * 分片原因：单个 asset 太大时上传容易超时，恢复时也不好打开。
 * 按「未压缩 JSON 体积」累计，超过 partLimitBytes 就换下一个分片。
 *
 * @param {object} opts
 * @param {string} opts.tag
 * @param {string} opts.name
 * @param {string} opts.body
 * @param {{ name: string, data: any, source: 'mongo'|'postgres' }[]} opts.items
 * @param {number} [opts.partLimitBytes]
 * @returns {Promise<{ tag, releaseId, assets: {name, bytes, rows}[], url }>}
 */
export async function publishBackupParts({
  tag, name, body, items, partLimitBytes = 40 * 1024 * 1024,
}) {
  const { owner, repo } = getConfig();
  const release = await createRelease({ tag, name, body });

  const assets = [];
  let partNo = 1;
  let part = {};
  let partBytes = 0;

  const flush = async () => {
    if (Object.keys(part).length === 0) return;
    const fileName = 'backup-' + tag + '-part' + partNo + '.json.gz';
    const gz = gzipJson(part);
    await uploadReleaseAsset(release.id, fileName, gz);
    assets.push({ name: fileName, bytes: gz.length });
    partNo++;
    part = {};
    partBytes = 0;
  };

  for (const item of items) {
    const size = JSON.stringify(item.data).length + item.name.length + 40;
    if (partBytes > 0 && partBytes + size > partLimitBytes) await flush();
    part[item.name] = { source: item.source, rows: Array.isArray(item.data) ? item.data.length : null, data: item.data };
    partBytes += size;
  }
  await flush();

  return {
    tag,
    releaseId: release.id,
    assets,
    url: release.html_url || ('https://github.com/' + owner + '/' + repo + '/releases/tag/' + tag),
  };
}
