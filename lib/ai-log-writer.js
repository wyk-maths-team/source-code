// lib/ai-log-writer.js
// Vercel 端调用 DeepSeek API 后，把审计日志写入 MongoDB
// 本地 bridge 会轮询这个 collection，镜像到终端

/**
 * @param {Db} db
 * @param {object} entry
 * @param {'steps'|'image'|'port'} entry.kind
 * @param {string} entry.taskId
 * @param {string} entry.username
 * @param {string} entry.problemId
 * @param {'r1'|'v3'} entry.model
 * @param {number} [entry.score]
 * @param {number} [entry.elapsedMs]
 * @param {'success'|'error'} entry.status
 * @param {string} [entry.error]
 * @param {string} [entry.commentPreview]
 * @param {string} [entry.stepsPreview]
 */
export async function writeAiLog(db, entry) {
  try {
    await db.collection('ai_grade_logs').insertOne({
      ts: new Date(),
      source: 'api',
      ...entry,
    });
  } catch (e) {
    // 不阻塞主流程，只打 log
    console.error('[ai-log] write failed:', e.message);
  }
}