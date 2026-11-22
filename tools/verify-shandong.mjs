// tools/verify-shandong.mjs —— 读回校验 2026 山东预赛 13 题入库结果
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const col = client.db(env.MONGODB_DB || 'wyk_math').collection('problems');

const docs = await col.find({ id: /^CHSMLHSD/ }).sort({ id: 1 }).toArray();
console.log(`CHSMLHSD* 文档数: ${docs.length}\n`);
console.log('id            FS     diff   ans                    tags');
console.log('─'.repeat(100));
for (const d of docs) {
  console.log(
    `${d.id}  ${String(d.FS).padEnd(5)}  ${String(d.difficulty).padEnd(5)}  ${JSON.stringify(d.ans).padEnd(22)} ${d.tags.join(',')}`
  );
}

const main = ['Algebra', 'Geometry', 'NumberTheory', 'Combinatorics'];
const bad = [];
for (const d of docs) {
  if (d.statement.includes('$$')) bad.push(`${d.id}: 含 $$`);
  if (!/\\[a-zA-Z]+/.test(d.statement)) bad.push(`${d.id}: 无 LaTeX 命令（反斜杠可能丢失）`);
  if (d.tags.filter(t => main.includes(t)).length !== 1) bad.push(`${d.id}: 主标签数异常`);
  if (!d.tags.includes('CHSML')) bad.push(`${d.id}: 缺 CHSML`);
  if (d.tags.includes('bug')) bad.push(`${d.id}: 误加 bug 标签`);
  if (d.public !== false) bad.push(`${d.id}: public 非 false`);
  if (d.name !== `高中联赛预赛（山东）第${Number(d.id.slice(-2))}题`) bad.push(`${d.id}: name=${d.name}`);
}
console.log('\n' + (bad.length ? '❌ 问题:\n' + bad.join('\n') : '✅ 全部字段校验通过'));

console.log('\n--- 第 12 题 statement（检查转义） ---');
console.log(docs.find(d => d.id === 'CHSMLHSD12')?.statement);
console.log('\n--- 第 5 题 statement ---');
console.log(docs.find(d => d.id === 'CHSMLHSD05')?.statement);

await client.close();
