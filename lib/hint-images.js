// lib/hint-images.js
//
// 提示图存 GitHub 私有仓库，不存数据库。
//
// 为什么要走这条路：提示图本身是「付费内容」。放在 public 仓库或 CDN 上，
// 任何人拿到 raw 链接就绕过了 token 门槛；存在数据库里则会把 MongoDB 当图床用，
// 每次读图都要过一次查询配额。
//
// 所以：图片进 private 仓库，读的时候由 api/hint-image.js 带 token 代理出来，
// 代理前先查 hintPurchases。客户端从头到尾看不到仓库地址，也拿不到可分享的链接。
//
// 仓库用 GITHUB_HINTS_REPO（默认 backup）。注意不能复用 GITHUB_REPO ——
// 那是 public 的 source-code，放进去等于公开。

const GITHUB_API = 'https://api.github.com';

function config() {
  const token = process.env.GITHUB_HINTS_TOKEN || process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_HINTS_OWNER || process.env.GITHUB_OWNER;
  // 默认 backup：它是 private，而且已经在存每日备份，权限现成
  const repo = process.env.GITHUB_HINTS_REPO || 'backup';
  const branch = process.env.GITHUB_HINTS_BRANCH || 'main';
  if (!token || !owner) throw new Error('GitHub hints storage not configured');
  return { token, owner, repo, branch };
}

/** 只看文件名，不让外部传路径 —— 防止 ../../ 之类的东西 */
const FILE_RE = /^[A-Za-z0-9._-]{1,120}\.svg$/;

export function isValidHintFile(name) {
  return FILE_RE.test(String(name || ''));
}

function pathOf(file) {
  return `hints/${file}`;
}

/**
 * GitHub 调用统一入口。
 *
 * api.github.com 偶发连接超时（尤其从这台机器出去），一次失败就抛错会让
 * 学生看到 502，但同一请求重试一次通常就过了。这里做三次指数退避，
 * 只对网络层失败重试 —— HTTP 4xx/5xx 原样返回，让调用方决定怎么处理。
 */
async function gh(url, opts, token) {
  const tries = 3;
  let lastErr = null;

  for (let i = 0; i < tries; i++) {
    try {
      return await fetch(url, {
        ...opts,
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'moj-hints',
          ...(opts && opts.headers),
        },
        signal: AbortSignal.timeout(25_000),
      });
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr || new Error('GitHub request failed');
}

/**
 * 上传/覆盖一张提示图。
 * @param {string} file  形如 IP0207-h2.svg
 * @param {string} svg   SVG 源码
 * @returns {Promise<{file:string,path:string,sha:string,created:boolean}>}
 */
export async function putHintImage(file, svg) {
  if (!isValidHintFile(file)) throw new Error('Invalid hint image filename');

  const { token, owner, repo, branch } = config();
  const path = pathOf(file);
  const base = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  // 已存在就要带 sha 才能覆盖
  let sha = null;
  const head = await gh(`${base}?ref=${encodeURIComponent(branch)}`, {}, token);
  if (head.status === 200) {
    const body = await head.json();
    sha = body.sha;
  } else if (head.status !== 404) {
    throw new Error(`GitHub read failed: ${head.status}`);
  }

  const res = await gh(base, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: `${sha ? 'update' : 'add'} hint image ${file}`,
      content: Buffer.from(svg, 'utf8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  }, token);

  if (!res.ok) {
    throw new Error(`GitHub write failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const out = await res.json();
  return {
    file,
    path,
    sha: out.content && out.content.sha,
    created: !sha,
  };
}

/**
 * 读一张提示图。
 * 用 Contents API 而不是 raw.githubusercontent.com —— raw 对私有仓库需要额外鉴权，
 * 走 API 更稳，而且返回体本身就是 base64。
 */
export async function getHintImage(file) {
  if (!isValidHintFile(file)) throw new Error('Invalid hint image filename');

  const { token, owner, repo, branch } = config();
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${pathOf(file)}?ref=${encodeURIComponent(branch)}`;

  const res = await gh(url, {}, token);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed: ${res.status}`);

  const body = await res.json();
  if (!body.content) return null;

  return {
    file,
    buffer: Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8'),
    sha: body.sha,
    size: body.size,
  };
}

export async function deleteHintImage(file) {
  if (!isValidHintFile(file)) throw new Error('Invalid hint image filename');

  const { token, owner, repo, branch } = config();
  const path = pathOf(file);
  const base = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;

  const head = await gh(`${base}?ref=${encodeURIComponent(branch)}`, {}, token);
  if (head.status === 404) return false;
  const { sha } = await head.json();

  const res = await gh(base, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: `remove hint image ${file}`, sha, branch }),
  }, token);

  if (!res.ok) throw new Error(`GitHub delete failed: ${res.status}`);
  return true;
}
