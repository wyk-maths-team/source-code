// temp/upload-ha-figure.mjs —— 上传已裁好的 HA 图，并写进题目的 statement
//   node --env-file=.env temp/upload-ha-figure.mjs HA1116
//   node --env-file=.env temp/upload-ha-figure.mjs --list   # 看看有哪些裁好的
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { uploadNumberedImage } from '../lib/github-upload.js';

const DIR = 'temp/ha-figures';
const args = process.argv.slice(2);

if (args.includes('--list')) {
  const files = fs.readdirSync(DIR).filter(f => /^HA\d+-1\.jpg$/.test(f));
  console.log(`已裁好 ${files.length} 张:`);
  files.forEach(f => console.log('  ' + f));
  process.exit(0);
}

const id = args[0];
if (!id) { console.error('用法: node temp/upload-ha-figure.mjs <题号>'); process.exit(1); }

const file = path.join(DIR, `${id}-1.jpg`);
if (!fs.existsSync(file)) { console.error(`没有 ${file}`); process.exit(1); }

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 30_000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'wyk_math');

const p = await db.collection('problems').findOne({ id }, { projection: { statement: 1 } });
if (!p) { console.error(`题库里没有 ${id}`); process.exit(1); }
if (/<img/i.test(String(p.statement || ''))) {
  console.log(`${id} 的 statement 里已经有 img，跳过`);
  await client.close();
  process.exit(0);
}

const dataUrl = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
console.log(`${id}: ${(fs.statSync(file).size / 1024).toFixed(1)}KB，上传中…`);
const url = await uploadNumberedImage(dataUrl, { folder: 'images/problems', baseName: id });
console.log(`  -> ${url}`);

const html = `<img src="${url}" alt="problem image" loading="lazy" style="max-width:66.67%;width:100%;height:auto;display:block;margin:.6rem auto;" />`;
await db.collection('problems').updateOne(
  { id },
  { $set: { statement: String(p.statement || '').trim() + '\n' + html } }
);
console.log(`  已写入 ${id}.statement`);

await client.close();
