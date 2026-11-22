// tools/migrate-submission-status.mjs
//
// 把 submissions 集合的结果字段收敛成单一 status：
//
//   AC / PS60 / WA / V60 / SE
//
// 旧字段 marked / score / correct / systemError / violation（以及 flag 相关的
// flagged / violationAt / violationBy）在迁移完成后删除。
//
// 用法：
//   node tools/migrate-submission-status.mjs            # 演练，只统计不写
//   node tools/migrate-submission-status.mjs --apply    # 真写
//
// 分片处理，每 500 条一批，写之前会打印进度，中断了可以直接重跑
// （已经是新格式的记录会被跳过）。

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], override: false });
import { MongoClient } from 'mongodb';
import { encodeFromLegacy } from '../lib/submission-status.js';

const APPLY = process.argv.includes('--apply');
const BATCH = 500;
const LEGACY_FIELDS = ['marked', 'score', 'correct', 'systemError', 'violation', 'flagged'];

const client = new MongoClient(process.env.MONGODB_URI);

function isValidStatus(v) {
  return typeof v === 'string' && /^(AC|WA|SE|PS\d{1,2}|V\d{1,2})$/.test(v.trim().toUpperCase());
}

const stats = { total: 0, already: 0, converted: 0, kept: 0, byStatus: {} };

function tally(s) {
  stats.byStatus[s] = (stats.byStatus[s] || 0) + 1;
}

try {
  await client.connect();
  const db = client.db('wyk_math');
  const col = db.collection('submissions');

  const total = await col.estimatedDocumentCount();
  console.log('mode      : ' + (APPLY ? 'APPLY (写库)' : 'DRY RUN (只统计)'));
  console.log('collection: submissions, about ' + total + ' docs');
  console.log('');

  const cursor = col.find({}, {
    projection: {
      subid: 1, status: 1, marked: 1, score: 1, correct: 1, systemError: 1, violation: 1, type: 1, timestamp: 1,
    },
  }).sort({ _id: 1 });

  let buf = [];
  let done = 0;

  async function flush() {
    if (!buf.length) return;

    if (APPLY) {
      const ops = buf.map((d) => ({
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: { status: d.__status },
            $unset: LEGACY_FIELDS.reduce((o, f) => { o[f] = ''; return o; }, {}),
          },
        },
      }));
      await col.bulkWrite(ops, { ordered: false });
    }

    buf = [];
    done += BATCH;
    if (done % 2000 === 0) console.log('  processed roughly ' + done);
  }

  for await (const d of cursor) {
    stats.total += 1;

    if (isValidStatus(d.status)) {
      stats.already += 1;
      tally(d.status.trim().toUpperCase());
      // 已经是对的，只补一次清理旧字段
      if (APPLY && LEGACY_FIELDS.some((f) => d[f] !== undefined)) {
        buf.push({ _id: d._id, __status: d.status.trim().toUpperCase() });
      }
    } else {
      const s = encodeFromLegacy(d);
      stats.converted += 1;
      tally(s);
      buf.push({ _id: d._id, __status: s });
    }

    if (buf.length >= BATCH) await flush();
  }
  await flush();

  console.log('');
  console.log('total       : ' + stats.total);
  console.log('already new : ' + stats.already);
  console.log('converted   : ' + stats.converted);
  console.log('');
  console.log('resulting distribution:');
  Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log('  ' + k.padEnd(6) + String(v).padStart(7));
  });

  if (!APPLY) {
    console.log('');
    console.log('Nothing was written. Re-run with --apply to persist.');
  } else {
    console.log('');
    console.log('Done. Legacy fields removed from every touched document.');
  }
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
