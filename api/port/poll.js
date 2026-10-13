// api/port/poll.js
// GET /api/port/poll?taskId=xxx
import { connectToDatabase } from '../_pdb.js';
import { portAuth } from './_auth.js';

export default async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ success: false, message: 'Missing taskId' });

  const db = await connectToDatabase();
  const task = await db.collection('port_tasks').findOne({ taskId });
  if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

  if (task.username !== decoded.username) {
    return res.status(403).json({ success: false, message: 'Not yours' });
  }

  if (task.status === 'pending' || task.status === 'processing') {
    return res.status(200).json({ success: true, status: task.status });
  }

  if (task.status === 'error') {
    return res.status(200).json({
      success: true,
      status: 'error',
      message: task.error || 'Grading failed',
    });
  }

  // done — 用原子鎖 consume
  if (task.status === 'done') {
    if (task.consumed === true) {
      return res.status(200).json({
        success: true,
        status: 'done',
        result: task.result,
        submissionId: task.submissionId,
      });
    }

    const r = await db.collection('port_tasks').updateOne(
      { taskId, status: 'done', consumed: { $ne: true } },
      { $set: { consumed: true, consumedAt: new Date() } }
    );

    if (r.modifiedCount === 0) {
      await new Promise(rs => setTimeout(rs, 300));
      const fresh = await db.collection('port_tasks').findOne({ taskId });
      return res.status(200).json({
        success: true,
        status: 'done',
        result: fresh?.result || null,
        submissionId: fresh?.submissionId || null,
      });
    }

    // 落库
    try {
      await db.collection('port_submissions').updateOne(
        { submissionId: task.submissionId },
        {
          $set: {
            score: task.result?.score ?? null,
            maxScore: task.maxScore,
            comment: String(task.result?.comment || '').slice(0, 5000),
            details: task.result?.details ?? null,
            status: 'done',
            gradedAt: new Date(),
          },
        }
      );
    } catch (e) {
      console.error('[port poll] write submission failed:', e);
    }
    // 在 `port_submissions.updateOne(...)` 之後加入：

    try {
      const statsCol = db.collection('port_userstats');
      const pid = task.problemId;
      const finalScore = Math.max(0, Math.min(100, Math.round(task.result?.score ?? 0)));

      await statsCol.updateOne(
        { username: task.username, subject: task.subject },
        { $setOnInsert: { username: task.username, subject: task.subject, states: {} } },
        { upsert: true }
      );

      if (finalScore === 100) {
        await statsCol.updateOne(
          { username: task.username, subject: task.subject },
          { $set: { [`states.${pid}`]: 'passed', updatedAt: new Date() } }
        );
      } else if (finalScore >= 0) {
        // 只有非 AI error 才記 failed
        await statsCol.updateOne(
          {
            username: task.username,
            subject: task.subject,
            [`states.${pid}`]: { $ne: 'passed' },
          },
          { $set: { [`states.${pid}`]: 'failed', updatedAt: new Date() } }
        );
      }
    } catch (e) {
      console.error('[port poll] update userstats failed:', e);
    }

    return res.status(200).json({
      success: true,
      status: 'done',
      result: task.result,
      submissionId: task.submissionId,
    });
  }

  return res.status(200).json({ success: true, status: 'unknown' });
}