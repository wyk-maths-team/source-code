// temp/hkmo-realign/backup.mjs —— 重整前完整备份
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const DIR = 'temp/hkmo-realign';
fs.mkdirSync(DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = `${DIR}/backup-${stamp}`;
fs.mkdirSync(out, { recursive: true });

const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 30_000 });
await c.connect();
const db = c.db(process.env.MONGODB_DB || 'wyk_math');

const probs = await db.collection('problems').find({ id: /^MO/ }).toArray();
fs.writeFileSync(`${out}/problems-MO.json`, JSON.stringify(probs, null, 0));
console.log(`problems (MO): ${probs.length} 条`);

const subs = await db.collection('submissions').find({ problemId: /^MO/ }).toArray();
fs.writeFileSync(`${out}/submissions-MO.json`, JSON.stringify(subs, null, 0));
console.log(`submissions (MO): ${subs.length} 条`);

const stats = await db.collection('userstats').find({}).toArray();
fs.writeFileSync(`${out}/userstats.json`, JSON.stringify(stats, null, 0));
console.log(`userstats: ${stats.length} 条`);

// 也把 hkmo.json 快照一份
if (fs.existsSync('private/hkmo.json')) {
  fs.copyFileSync('private/hkmo.json', `${out}/hkmo.json`);
  console.log('hkmo.json 已快照');
}

fs.writeFileSync(`${out}/README.txt`, `HKMO 重整前备份 ${stamp}
problems(MO)=${probs.length}  submissions(MO)=${subs.length}  userstats=${stats.length}
`, 'utf8');

console.log(`\n备份目录: ${out}`);
await c.close();
