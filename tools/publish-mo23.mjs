import { MongoClient } from "mongodb";
const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 30000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || "wyk_math");
const P = db.collection("problems");

const all = await P.find({ id: new RegExp("^MO23") }).project({ id: 1, public: 1, statement: 1, _id: 0 }).toArray();
const before = all.filter(r => r.public === true).length;

// 安全闸：需要图（题面提 figure）但 statement 里没有 <img> 的题，不设 public
const needFig = (r) => /In (the )?[Ff]igure|as shown in the (figure|diagram)|as shown below|Figure \d/i.test(String(r.statement));
const hasImg = (r) => /<img/i.test(String(r.statement));
const blocked = all.filter(r => needFig(r) && !hasImg(r));
console.log(`共 ${all.length} 条，原本 public ${before}，需图未配 ${blocked.length}:`, blocked.map(r => r.id).join(",") || "无");

const ok = all.filter(r => !(needFig(r) && !hasImg(r))).map(r => r.id);
const res = await P.updateMany({ id: { $in: ok } }, { $set: { public: true } });
console.log(`updateMany matched=${res.matchedCount} modified=${res.modifiedCount}`);

const after = await P.find({ id: new RegExp("^MO23") }).project({ id: 1, public: 1, _id: 0 }).toArray();
const pub = after.filter(r => r.public === true);
const priv = after.filter(r => r.public !== true);
console.log(`结果：public ${pub.length} / ${after.length}；仍 private: ${priv.map(r => r.id).join(",") || "无"}`);
await c.close();
