// 临时脚本：输出被调整题目的 statement + 难度变化（用后删除）
import fs from 'fs';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
dotenv.config({ path: 'grader/.env' });

// 1. 读 diff
const cur = JSON.parse(fs.readFileSync('_problems_cur.json', 'utf8')).problems || [];
const upd = JSON.parse(fs.readFileSync('_problems_upd.json', 'utf8')).problems || [];
const curMap = new Map(cur.map(d => [String(d.id), d]));

const changed = [];
for (const u of upd) {
  const c = curMap.get(String(u.id));
  if (!c) continue;
  const od = Number(c.difficulty) || 0;
  const nd = Number(u.difficulty) || 0;
  if (od !== nd) {
    changed.push({ id: String(u.id), name: u.name || c.name, old: od, new: nd, delta: Math.round((nd - od) * 100) / 100 });
  }
}
changed.sort((a, b) => b.delta - a.delta);

// 2. 连库取 statement
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'wyk_math');

const ids = changed.map(c => c.id);
const docs = await db.collection('problems').find(
  { id: { $in: ids } },
  { projection: { id: 1, statement: 1, _id: 0 } }
).toArray();
const stmtMap = new Map(docs.map(d => [String(d.id), d.statement || '']));

// 3. HTML → 纯文本（保留 LaTeX，去掉 script/style 逻辑代码）
function clean(s) {
  let t = String(s || '');
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
  t = t.replace(/<img[^>]*alt=["']([^"']+)["'][^>]*>/gi, '[图: $1]');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// 4. 写报告
const up = changed.filter(c => c.delta > 0).length;
const down = changed.filter(c => c.delta < 0).length;
const avgUp = changed.filter(c => c.delta > 0).reduce((s, c) => s + c.delta, 0) / (up || 1);
const avgDown = changed.filter(c => c.delta < 0).reduce((s, c) => s + c.delta, 0) / (down || 1);

const lines = [];
lines.push('# 难度调整报告');
lines.push('');
lines.push(`- 总变化题目数：**${changed.length}**`);
lines.push(`- 难度上调：${up} 道（平均 +${avgUp.toFixed(2)}）`);
lines.push(`- 难度下调：${down} 道（平均 ${avgDown.toFixed(2)}）`);
lines.push('');
lines.push('| id | 难度变化 | 题目 | statement |');
lines.push('|----|---------|------|-----------|');
for (const c of changed) {
  const st = clean(stmtMap.get(c.id));
  const oneLine = st.replace(/\n+/g, ' ').slice(0, 400);
  lines.push(`| ${c.id} | ${c.old} → ${c.new}（Δ${c.delta >= 0 ? '+' : ''}${c.delta}） | ${c.name} | ${oneLine} |`);
}
fs.writeFileSync('_difficulty_changes.md', lines.join('\n'), 'utf8');

console.log('写入 _difficulty_changes.md，共', changed.length, '道题');
console.log('上调', up, '下调', down, '缺失statement', changed.filter(c => !stmtMap.get(c.id)).length);

await client.close();
