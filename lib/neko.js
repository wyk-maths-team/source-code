// lib/neko.js
//
// 小群体的彩蛋：开了 nekos 的人，AC 时响应里多一张猫娘图。
//
// 只有 smallGroup 成员能开（见 api/users.js 的 prefs）。开着的人在
// userdata.nekos = true。没开、不在圈内、接口挂了 —— 一律安静返回 null，
// 绝不能把提交结果拖下去。
//
// 图片由服务端下载后以 data URL 回传：客户端直接 <img src=...> 渲染，
// 不再让浏览器去第三方 CDN 拉图（跨域、墙、CDN 挂掉都不影响）。
// 代价是响应体变大，所以只对 AC 发，且限 1.5MB 以内。

const SOURCES = [
  {
    name: 'nekos.best',
    url: 'https://nekos.best/api/v2/neko',
    pick: function (j) {
      const it = j && Array.isArray(j.results) ? j.results[0] : null;
      return it && it.url ? { url: String(it.url), artist: String(it.artist_name || ''), source: 'nekos.best' } : null;
    },
  },
  {
    name: 'waifu.pics',
    url: 'https://api.waifu.pics/sfw/neko',
    pick: function (j) {
      return j && j.url ? { url: String(j.url), artist: '', source: 'waifu.pics' } : null;
    },
  },
  {
    name: 'nekos.life',
    url: 'https://nekos.life/api/v2/img/neko',
    pick: function (j) {
      return j && j.url ? { url: String(j.url), artist: '', source: 'nekos.life' } : null;
    },
  },
];

const MAX_BYTES = 1_500_000;

function guessMime(url, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.indexOf('png') >= 0) return 'image/png';
  if (ct.indexOf('gif') >= 0) return 'image/gif';
  if (ct.indexOf('webp') >= 0) return 'image/webp';
  if (ct.indexOf('jpeg') >= 0 || ct.indexOf('jpg') >= 0) return 'image/jpeg';
  const u = String(url || '').toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.gif')) return 'image/gif';
  if (u.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function fetchJson(source, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'wyk-math-oj' },
    });
    if (!res.ok) return { ok: false, why: 'http ' + res.status };
    const data = await res.json();
    const picked = source.pick(data);
    if (!picked) return { ok: false, why: 'bad payload' };
    return { ok: true, value: picked };
  } catch (e) {
    return { ok: false, why: (e && e.name === 'AbortError') ? 'timeout' : String((e && e.message) || 'error').slice(0, 60) };
  } finally {
    clearTimeout(timer);
  }
}

// 图片本身不在这里下载 —— 那几家动辄 1.8–3.8MB，base64 塞进 JSON 会把
// 提交响应撑到好几 MB。这里只给一个代理地址，由 /api/neko-image 取。
function proxyUrlFor(url) {
  return '/api/neko-image?src=' + Buffer.from(String(url), 'utf8').toString('base64url');
}

/**
 * @returns {{ neko: object|null, debug: object|null }}
 *   neko  —— { dataUrl, artist, source, bytes }，没有就 null
 *   debug —— 全都失败时返回，写明每个源的问题（给管理员看）
 */
export async function maybeNeko(db, username) {
  if (!username) return { neko: null, debug: null };

  let allowed = false;
  try {
    const [u, d] = await Promise.all([
      db.collection('users').findOne({ username: String(username) }, { projection: { smallGroup: 1, _id: 0 } }),
      db.collection('userdata').findOne({ username: String(username) }, { projection: { nekos: 1, _id: 0 } }),
    ]);
    allowed = !!(u && u.smallGroup === true && d && d.nekos === true);
  } catch (e) {
    return { neko: null, debug: null };
  }
  if (!allowed) return { neko: null, debug: null };

  const failures = [];
  for (const source of SOURCES) {
    const meta = await fetchJson(source, 2500);
    if (!meta.ok) { failures.push(source.name + ': ' + meta.why); continue; }

    return {
      neko: {
        url: meta.value.url,
        proxyUrl: proxyUrlFor(meta.value.url),
        artist: meta.value.artist,
        source: meta.value.source,
      },
      debug: null,
    };
  }
  return { neko: null, debug: { tried: SOURCES.length, failures } };
}
