// lib/neko.js
//
// 小群体的彩蛋：开了 nekos 的人，提交成功时响应里多一张猫娘图。
//
// 只有 smallGroup 成员能开（见 api/users.js 的 prefs）。开着的人在
// userdata.nekos = true。没开、不在圈内、接口挂了 —— 一律安静返回 null，
// 绝不能让一张图把提交结果拖下去。
//
// 多源：单靠 nekos.best 在 Vercel 的出口 IP 上不一定通（Cloudflare 会对
// 数据中心网段挑食），所以按顺序试几个，谁先回就用谁。全挂就返回诊断信息，
// 方便在线上直接看出是哪一层挡住的 —— 不重试、不等待。

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

async function fetchFrom(source, timeoutMs) {
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

/**
 * @returns {{ neko: object|null, debug: object|null }}
 *   neko  —— 拿到就返回，没有就是 null
 *   debug —— 只在全都失败时返回，写明每个源的问题（给管理员看）
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
    const r = await fetchFrom(source, 2500);
    if (r.ok) return { neko: r.value, debug: null };
    failures.push(source.name + ': ' + r.why);
  }
  return { neko: null, debug: { tried: SOURCES.length, failures } };
}
