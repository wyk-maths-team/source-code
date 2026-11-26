// lib/neko.js
//
// 小群体的彩蛋：开了 nekos 的人，提交成功时响应里多一张猫娘图。
//
// 只有 smallGroup 成员能开（见 api/users.js 的 prefs）。开着的人在
// userdata.nekos = true。没开、不在圈内、接口挂了 —— 一律安静返回 null，
// 绝不能让一张图把提交结果拖下去。
//
// 直接打 nekos.best：超时 2.5 秒，失败就算了，不重试（提交本身比彩蛋重要）。

const NEKO_ENDPOINT = 'https://nekos.best/api/v2/neko';

async function fetchNeko() {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 2500);
  try {
    const res = await fetch(NEKO_ENDPOINT, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const item = data && Array.isArray(data.results) ? data.results[0] : null;
    if (!item || !item.url) return null;
    return { url: String(item.url), artist: String(item.artist_name || '') };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 该用户此刻该不该拿到 neko；不该就返回 null */
export async function maybeNeko(db, username) {
  if (!username) return null;
  try {
    const [u, d] = await Promise.all([
      db.collection('users').findOne({ username: String(username) }, { projection: { smallGroup: 1, _id: 0 } }),
      db.collection('userdata').findOne({ username: String(username) }, { projection: { nekos: 1, _id: 0 } }),
    ]);
    if (!u || u.smallGroup !== true) return null;
    if (!d || d.nekos !== true) return null;
    return await fetchNeko();
  } catch (e) {
    return null;
  }
}
