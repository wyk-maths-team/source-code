// import-difficulty.js
// 用法：
//   MONGODB_URI="mongodb+srv://..." node import-difficulty.js                # 乾跑，只看會改哪些
//   MONGODB_URI="mongodb+srv://..." node import-difficulty.js --write        # 實際寫入
// 可選：
//   MONGODB_DB=wyk_math            # 預設 wyk_math
//   TSV=./difficulty.solutions.tsv # 預設 ./difficulty.solutions.tsv

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || 'wyk_math';
const TSV_PATH = process.env.TSV || path.join(__dirname, 'difficulty.solutions.tsv');
const WRITE = process.argv.includes('--write');

if (!URI) {
  console.error('❌ MONGODB_URI 未設定');
  process.exit(1);
}
if (!fs.existsSync(TSV_PATH)) {
  console.error('❌ TSV 檔案不存在：' + TSV_PATH);
  process.exit(1);
}

// ─────────────────────────────────────────────
// 1. 解析 TSV
// ─────────────────────────────────────────────
function parseTSV(content) {
  const lines = content.split(/\r?\n/);
  const rows = [];
  let headers = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    if (!headers) {
      headers = cols.map(h => h.trim());
      continue;
    }
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

// ─────────────────────────────────────────────
// 2. 主流程
// ─────────────────────────────────────────────
async function main() {
  const content = fs.readFileSync(TSV_PATH, 'utf8');
  const rows = parseTSV(content);

  console.log(`📄 讀取 ${rows.length} 行`);

  // 過濾 + 解析
  const updates = [];
  const skipped = [];

  for (const r of rows) {
    const id = r.problem_id;
    const diffStr = r.difficulty;
    if (!id) { skipped.push({ row: r, reason: 'no id' }); continue; }

    const diff = Number(diffStr);
    if (!Number.isFinite(diff)) {
      skipped.push({ id, diffStr, reason: 'invalid difficulty' });
      continue;
    }
    updates.push({
      id: String(id),
      difficulty: diff,
      evidence: r.evidence || ''
    });
  }

  console.log(`✅ 有效：${updates.length} 筆`);
  if (skipped.length) {
    console.log(`⚠️  略過：${skipped.length} 筆`);
    skipped.slice(0, 10).forEach(s => {
      console.log(`   - ${s.id || '(no id)'}: ${s.reason}${s.diffStr ? ` (${s.diffStr})` : ''}`);
    });
    if (skipped.length > 10) console.log(`   ... 還有 ${skipped.length - 10} 筆`);
  }

  // ─────────────────────────────────────────────
  // 3. 連資料庫
  // ─────────────────────────────────────────────
  const client = new MongoClient(URI, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 50000,
  });

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const col = db.collection('problems');

    // ─────────────────────────────────────────────
    // 4. 檢查哪些 id 存在、哪些不存在
    // ─────────────────────────────────────────────
    const ids = updates.map(u => u.id);
    const existing = await col
      .find({ id: { $in: ids } }, { projection: { id: 1, difficulty: 1, _id: 0 } })
      .toArray();
    const existingMap = new Map(existing.map(p => [p.id, p]));

    const toUpdate = [];   // { id, oldDiff, newDiff, changed }
    const notFound = [];

    for (const u of updates) {
      const cur = existingMap.get(u.id);
      if (!cur) { notFound.push(u.id); continue; }
      toUpdate.push({
        id: u.id,
        oldDiff: cur.difficulty,
        newDiff: u.difficulty,
        changed: Number(cur.difficulty) !== u.difficulty
      });
    }

    // ─────────────────────────────────────────────
    // 5. 報告
    // ─────────────────────────────────────────────
    const changed = toUpdate.filter(x => x.changed);
    const unchanged = toUpdate.filter(x => !x.changed);

    console.log('\n══════ 資料庫檢查 ══════');
    console.log(`  ✏️  需要更新：${changed.length}`);
    console.log(`  ⏸️  值相同：${unchanged.length}`);
    console.log(`  ❓ 資料庫找不到：${notFound.length}`);

    if (notFound.length) {
      console.log('\n⚠️  以下 id 在資料庫中不存在：');
      notFound.slice(0, 20).forEach(id => console.log('   - ' + id));
      if (notFound.length > 20) console.log(`   ... 還有 ${notFound.length - 20} 筆`);
    }

    if (changed.length) {
      console.log('\n將要修改的內容（前 15 筆）：');
      changed.slice(0, 15).forEach(x => {
        console.log(`   ${x.id}:  ${x.oldDiff}  →  ${x.newDiff}`);
      });
      if (changed.length > 15) console.log(`   ... 還有 ${changed.length - 15} 筆`);
    }

    if (!WRITE) {
      console.log('\n🧪 這是乾跑。加 --write 才會真正寫入：');
      console.log('   node import-difficulty.js --write');
      return;
    }

    // ─────────────────────────────────────────────
    // 6. 執行寫入
    // ─────────────────────────────────────────────
    if (changed.length === 0) {
      console.log('\n✅ 沒有需要修改的，跳過。');
      return;
    }

    console.log('\n⏳ 開始寫入...');

    // 備份
    const backupPath = path.join(
      __dirname,
      `difficulty-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`
    );
    fs.writeFileSync(
      backupPath,
      JSON.stringify(changed.map(x => ({ id: x.id, difficulty: x.oldDiff })), null, 2),
      'utf8'
    );
    console.log(`💾 舊值已備份到：${backupPath}`);

    // 批量更新
    const ops = changed.map(x => ({
      updateOne: {
        filter: { id: x.id },
        update: { $set: { difficulty: x.newDiff } }
      }
    }));

    const result = await col.bulkWrite(ops, { ordered: false });
    console.log(`\n✅ 完成：modified ${result.modifiedCount}, matched ${result.matchedCount}`);

    // 順便 bump problemsVersion，讓前端知道要重拉題目列表
    await db.collection('metadata').updateOne(
      { _key: 'problemsVersion' },
      { $set: { version: Date.now() } }
    );
    console.log('🔄 problemsVersion 已更新');

  } catch (err) {
    console.error('\n❌ 錯誤：', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();