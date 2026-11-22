import fs from "node:fs";
import { MongoClient } from "mongodb";
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 30000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || "wyk_math");
const live = await db.collection("problems").find({ id: /^MO/ }, { projection: { _id:0 } }).toArray();
const byId = new Map(live.map(r => [r.id, r]));

const map = JSON.parse(fs.readFileSync("temp/hkmo-realign/id-map.json", "utf8"));
const json = JSON.parse(fs.readFileSync("private/hkmo.json", "utf8"));
console.log("json 原条数:", json.length);

let kept = 0, renamed = 0, dropped = 0, updated = 0;
const out = [];
for (const row of json) {
  const id = row.id;
  let target = id;
  if (map.duplicated[id] && !map.kept.includes(id)) { dropped++; continue; }   // 副本，删
  if (map.renamed[id]) { target = map.renamed[id]; renamed++; }
  const src = byId.get(target);
  if (!src) { dropped++; continue; }
  kept++;
  const merged = { id: target, statement: src.statement, ans: src.ans, difficulty: src.difficulty ?? row.difficulty };
  if (src.tags) merged.tags = src.tags;
  if (merged.statement !== row.statement || String(merged.ans) !== String(row.ans)) updated++;
  out.push(merged);
}
// 补上新出现的（改名后的 id 若 json 原本没有）
const have = new Set(out.map(r => r.id));
for (const r of live) {
  if (!have.has(r.id)) {
    const m = { id: r.id, statement: r.statement, ans: r.ans, difficulty: r.difficulty ?? 1 };
    if (r.tags) m.tags = r.tags;
    out.push(m); kept++;
  }
}
out.sort((a,b) => a.id.localeCompare(b.id));
fs.writeFileSync("private/hkmo.json", JSON.stringify(out, null, 1), "utf8");
console.log(`保留 ${kept}，改名 ${renamed}，丢弃 ${dropped}，内容更新 ${updated}`);
console.log("json 新条数:", out.length, " 库:", live.length);
// 差异检查
const dbIds = new Set(live.map(r => r.id)), jsonIds = new Set(out.map(r => r.id));
const onlyDb = [...dbIds].filter(x => !jsonIds.has(x));
const onlyJson = [...jsonIds].filter(x => !dbIds.has(x));
console.log(`只在库: ${onlyDb.length}  只在json: ${onlyJson.length}`);
await c.close();
