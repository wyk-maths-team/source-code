// api/port/draft.js
import { connectToDatabase } from '../_pdb.js';
import { portAuth } from './_auth.js';
import { wrapHandler } from '../../lib/errors.js';

async function handler(req, res) {
  const decoded = await portAuth(req, res);
  if (!decoded) return;
  const db = await connectToDatabase();
  const { problemId, steps } = req.body || {};

  if (req.method === 'GET') {
    const doc = await db.collection('port_drafts').findOne({ username: decoded.username, problemId: String(req.query.problemId) });
    return res.status(200).json({ success: true, steps: doc ? doc.steps : '' });
  }

  if (req.method === 'POST') {
    if (!problemId) return res.status(400).json({ success: false });
    await db.collection('port_drafts').updateOne(
      { username: decoded.username, problemId: String(problemId) },
      { $set: { steps: String(steps || ''), updatedAt: new Date() } },
      { upsert: true }
    );
    return res.status(200).json({ success: true });
  }
}
export default wrapHandler(handler);