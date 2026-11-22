// tools/export-ha-simplest.mjs —— 导出 HA 开头最简单的 100 道题给 territory-game
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const ROOT = 'C:/moj';
const OUT_DIR = 'C:/territory-game';

const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const TARGET = 100;

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 90000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('problems');

// 只取有答案的：没答案的题无法在游戏里判分
const docs = await col.find(
  { id: /^HA/, ans: { $nin: ['', null] } },
  { projection: { id: 1, statement: 1, ans: 1, difficulty: 1, _id: 0 } }
).toArray();

// 按难度升序，同难度用 id 打破平局，保证结果可重现
docs.sort((a, b) => {
  const da = typeof a.difficulty === 'number' ? a.difficulty : 99;
  const db = typeof b.difficulty === 'number' ? b.difficulty : 99;
  if (da !== db) return da - db;
  return String(a.id).localeCompare(String(b.id));
});

const picked = docs.slice(0, TARGET).map(d => ({
  id: d.id,
  statement: d.statement || '',
  ans: String(d.ans ?? ''),
  difficulty: typeof d.difficulty === 'number' ? Math.round(d.difficulty * 100) / 100 : null,
}));

const payload = {
  source: 'wyk_math.problems',
  filter: 'id starts with HA, has ans',
  count: picked.length,
  difficultyRange: picked.length
    ? [Math.min(...picked.map(p => p.difficulty)), Math.max(...picked.map(p => p.difficulty))]
    : [],
  exportedAt: new Date().toISOString(),
  items: picked,
};

if (!fs.existsSync(OUT_DIR)) {
  console.error('目标目录不存在:', OUT_DIR);
  process.exit(1);
}

const outFile = path.join(OUT_DIR, 'problems-ha-100.json');
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

console.log(`已导出 ${picked.length} 题 → ${outFile}`);
console.log(`难度范围 ${payload.difficultyRange[0]} – ${payload.difficultyRange[1]}`);
console.log(`\n前 5 题:`);
for (const p of picked.slice(0, 5)) {
  console.log(`  ${p.id}  d=${p.difficulty}  ans=${JSON.stringify(p.ans)}`);
  console.log(`    ${p.statement.slice(0, 80).replace(/\n/g, ' ')}`);
}
console.log(`\n后 5 题（即最简单的 100 道里最难的 5 道）:`);
for (const p of picked.slice(-5)) {
  console.log(`  ${p.id}  d=${p.difficulty}  ans=${JSON.stringify(p.ans)}`);
}

await client.close();
