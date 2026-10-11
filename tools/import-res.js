// tools/import-res.js  (ESM 版)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══ 自動找 .env ═══
(function loadEnv() {
  const candidates = [
    path.join(__dirname, '.env.local'),
    path.join(__dirname, '..', '.env.local'),
    path.join(process.cwd(), '.env.local'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      console.log(`📄 .env: ${p}`);
      return;
    }
  }
  console.warn('⚠️  找不到 .env，靠環境變數');
})();

// ═══ 參數 ═══
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry');
const fileArg = args.find(a => !a.startsWith('--'));

if (!fileArg) {
  console.error('Usage: node import-res.js <res-file> [--dry]');
  process.exit(1);
}

const RES_FILE = path.resolve(fileArg);
if (!fs.existsSync(RES_FILE)) {
  console.error('❌ File not found:', RES_FILE);
  process.exit(1);
}

// ═══════════════ 解析 ═══════════════
function parseRes(text) {
  const parts = text.split(/(?=^###\s+[A-Z]+\d+)/m).filter(s => s.trim());

  const problems = [];
  for (const block of parts) {
    const idMatch = block.match(/^###\s+([A-Z]+\d+)/m);
    if (!idMatch) continue;
    const id = idMatch[1].trim();

    const scriptMatch = block.match(/<<<STATEMENT_SCRIPT>>>\s*([\s\S]*?)\s*<<<END>>>/);
    const logicMatch  = block.match(/<<<LOGIC>>>\s*([\s\S]*?)\s*<<<END>>>/);
    const ansMatch    = block.match(/<<<ANS>>>\s*([\s\S]*?)\s*<<<END>>>/);

    problems.push({
      id,
      script: scriptMatch ? scriptMatch[1].trim() : '',
      logic:  logicMatch  ? logicMatch[1].trim()  : '',
      ans:    ansMatch    ? ansMatch[1].trim()    : '',
    });
  }
  return problems;
}

// ═══════════════ 主流程 ═══════════════
async function main() {
  const text = fs.readFileSync(RES_FILE, 'utf-8');
  const problems = parseRes(text);

  console.log(`\n📄 讀取: ${RES_FILE}`);
  console.log(`📦 解析到 ${problems.length} 題\n`);

  if (problems.length === 0) {
    console.error('❌ 沒解析到任何題目，檢查檔案格式');
    process.exit(1);
  }

  const noScript = problems.filter(p => !p.script).length;
  const noLogic  = problems.filter(p => !p.logic).length;
  const noAns    = problems.filter(p => !p.ans).length;
  if (noScript) console.log(`⚠️  ${noScript} 題沒有 script`);
  if (noLogic)  console.log(`⚠️  ${noLogic} 題沒有 logic`);
  if (noAns)    console.log(`⚠️  ${noAns} 題沒有 ans`);
  if (noScript || noLogic || noAns) console.log('');

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'wyk_math';
  if (!uri) {
    console.error('❌ MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const col = db.collection('problems');

  console.log(`🔌 連線: ${dbName}`);
  console.log(`🎯 模式: ${DRY_RUN ? '🔍 DRY RUN（不寫入）' : '✏️  實際寫入'}\n`);

  const report = [];

  for (const p of problems) {
    const doc = await col.findOne(
      { id: p.id },
      { projection: { statement: 1, ans: 1, logic: 1 } }
    );

    if (!doc) {
      report.push({ id: p.id, status: 'NOT_FOUND' });
      console.log(`❌ ${p.id}: 題目不存在`);
      continue;
    }

    const marker = `CUSTOM_${p.id}`;
    const hasScript = p.script && doc.statement && doc.statement.includes(marker);

    const $set = {};
    if (p.ans)   $set.ans = p.ans;
    if (p.logic) $set.logic = p.logic;
    if (p.script && !hasScript) {
      $set.statement = (doc.statement || '') + '\n\n' + p.script;
    }

    if (Object.keys($set).length === 0) {
      report.push({ id: p.id, status: 'NO_CHANGE' });
      console.log(`⚪ ${p.id}: 沒有變更`);
      continue;
    }

    const fields = [];
    if (p.ans)   fields.push('ans');
    if (p.logic) fields.push('logic');
    if (p.script && !hasScript) fields.push('statement+');
    if (p.script && hasScript)  fields.push('statement(skip)');

    if (DRY_RUN) {
      console.log(`🔍 ${p.id}: ${fields.join(', ')}`);
      report.push({ id: p.id, status: 'DRY', fields });
    } else {
      const r = await col.updateOne({ id: p.id }, { $set });
      console.log(`✅ ${p.id}: ${fields.join(', ')}  (modified: ${r.modifiedCount})`);
      report.push({ id: p.id, status: 'OK', fields });
    }
  }

  console.log('\n═══════════════════════════════');
  const ok       = report.filter(r => r.status === 'OK').length;
  const dry      = report.filter(r => r.status === 'DRY').length;
  const skip     = report.filter(r => r.status === 'NO_CHANGE').length;
  const notFound = report.filter(r => r.status === 'NOT_FOUND').length;
  console.log(`  OK:         ${ok}`);
  console.log(`  DRY:        ${dry}`);
  console.log(`  NO_CHANGE:  ${skip}`);
  console.log(`  NOT_FOUND:  ${notFound}`);
  console.log('═══════════════════════════════\n');

  await client.close();
}

main().catch(err => {
  console.error('❌', err);
  process.exit(1);
});