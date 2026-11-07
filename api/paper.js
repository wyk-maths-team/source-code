// api/paper.js —— DSE 试卷：取卷、提交单题、一键批改整份
//
// 每个答题区是一张手写画板，逐题独立批改（走 buildDsePrompt），
// 一键批改就是把这一份里所有已画的题并发提交一次。
import { connectToDatabase } from './_db.js';
import { verifyToken } from '../lib/auth.js';
import { applyRateLimit } from '../lib/rateLimit.js';
import { wrapHandler } from '../lib/errors.js';
import { getTokenBalance, consumeTokens } from '../lib/token.js';
import { buildDsePrompt } from '../lib/grade-prompt.js';
import crypto from 'crypto';

export const config = { maxDuration: 300 };

const PER_QUESTION_COST = 3000;
const MAX_BATCH = 25;
const ALLOWED_IMAGE_HOSTS = ['https://res.cloudinary.com/', 'https://cdn.jsdelivr.net/'];

function isAllowedImageUrl(url) {
  const s = String(url || '');
  return ALLOWED_IMAGE_HOSTS.some((p) => s.startsWith(p));
}

function parseJSONReply(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
  const base = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error('AI HTTP ' + res.status);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return content;
}

// 图纸走 vision 接口：把图片和 prompt 一起发
async function markOneImage(prompt, imageUrl) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
  const base = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
  const model = process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash';

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error('AI HTTP ' + res.status);
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

function normalizeMark(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const awarded = Number(parsed.awarded);
  const total = Number(parsed.total);
  const score = Number(parsed.score);
  const lines = Array.isArray(parsed.lines) ? parsed.lines.map((l) => String(l).slice(0, 400)) : [];
  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    awarded: Number.isFinite(awarded) ? awarded : null,
    total: Number.isFinite(total) ? total : null,
    lines,
    summary: String(parsed.summary || '').slice(0, 600),
  };
}

// 每次批改写一条 dsesubmissions 记录（与普通 submissions 分开存）
function genDseSubid() {
  return 'DSE' + crypto.randomBytes(8).toString('hex');
}

async function recordDseSubmission(db, doc) {
  try {
    await db.collection('dsesubmissions').insertOne({
      subid: genDseSubid(),
      createdAt: new Date(),
      ...doc,
    });
  } catch (e) {
    console.error('[paper] failed to record dsesubmission:', e.message);
  }
}

async function handler(req, res) {
  if (!(await applyRateLimit(req, res))) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const decoded = await verifyToken(req);
  if (!decoded) return res.status(401).json({ success: false, message: 'Unauthorized' });

  req.user = { username: decoded.username, role: decoded.role };
  const db = await connectToDatabase();
  const action = req.query.action || (req.body && req.body.action);

  // ── 一份卷子的元数据 + 题目 + 布局 ──
  if (action === 'get') {
    const track = String(req.query.track || 'M0');
    const year = Number(req.query.year) || 2025;
    const paper = await db.collection('papers').findOne({ track, year });
    if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });

    const probs = await db.collection('problems').find(
      { id: { $in: paper.problemIds || [] } },
      { projection: { id: 1, name: 1, statement: 1, difficulty: 1, _id: 0 } }
    ).toArray();
    const map = Object.fromEntries(probs.map((p) => [p.id, p]));

    const marks = await db.collection('paperMarks').find({
      username: req.user.username, paperTrack: track, paperYear: year,
    }, { projection: { pid: 1, score: 1, awarded: 1, total: 1, lines: 1, summary: 1, markedAt: 1, _id: 0 } }).toArray();

    return res.status(200).json({
      success: true,
      paper: {
        track, year, title: paper.title,
        questions: (paper.problemIds || []).map((pid) => ({ ...(map[pid] || { id: pid, name: pid, statement: '' }) })),
        layout: paper.layout || { items: [] },
      },
      marks: Object.fromEntries(marks.map((m) => [m.pid, m])),
      serverNow: Date.now(),
    });
  }

  // ── 管理员：试卷列表 ──
  if (action === 'listPapers') {
    if (req.user.role !== 'admin' && req.user.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }
    const rows = await db.collection('papers')
      .find({}, { projection: { track: 1, year: 1, title: 1, problemIds: 1, updatedAt: 1, _id: 0 } })
      .sort({ track: 1, year: -1 })
      .toArray();
    return res.status(200).json({
      success: true,
      papers: rows.map((p) => ({
        track: p.track, year: p.year, title: p.title,
        count: (p.problemIds || []).length, updatedAt: p.updatedAt,
      })),
    });
  }

  // ── 管理员：按题目 id 格式自动抓题建卷 ──
  // M0 → 19 题，M1 / M2 → 各 12 题；题目 id 形如 M0DSE2501
  if (action === 'createPaper') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (req.user.role !== 'admin' && req.user.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const track = String(req.body && req.body.track || '').toUpperCase();
    const year = Number(req.body && req.body.year);
    if (!['M0', 'M1', 'M2'].includes(track)) {
      return res.status(400).json({ success: false, message: 'track must be M0, M1 or M2' });
    }
    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ success: false, message: 'Invalid year' });
    }

    const expected = track === 'M0' ? 19 : 12;
    const yy = String(year).slice(-2);
    const re = new RegExp('^' + track + 'DSE' + yy + '\d{2}$');

    // 先按格式精确找，找不到时退一步按「前缀 + 年份」模糊找
    let probs = await db.collection('problems')
      .find({ id: { $regex: re } }, { projection: { id: 1, _id: 0 } })
      .sort({ id: 1 })
      .toArray();

    if (!probs.length) {
      probs = await db.collection('problems')
        .find({ paperTrack: track, paperYear: year }, { projection: { id: 1, _id: 0 } })
        .sort({ id: 1 })
        .toArray();
    }

    if (!probs.length) {
      return res.status(404).json({
        success: false,
        message: 'No questions found for ' + track + ' ' + year + ' (looked for ' + track + 'DSE' + yy + 'xx)',
      });
    }

    const ids = probs.map((p) => p.id).slice(0, expected);
    const existing = await db.collection('papers').findOne({ track, year });

    // 已有 layout 高度就保留
    const prev = new Map(((existing && existing.layout && existing.layout.items) || []).map((it) => [it.pid, it]));
    const items = ids.map((pid, i) => ({
      pid,
      page: (prev.get(pid) && prev.get(pid).page) || i + 1,
      height: (prev.get(pid) && prev.get(pid).height) || 260,
    }));

    await db.collection('papers').updateOne(
      { track, year },
      {
        $set: {
          track, year,
          title: String((req.body && req.body.title) || (year + ' DSE ' + track + ' Paper')),
          problemIds: ids,
          layout: { items },
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    return res.status(200).json({
      success: true,
      created: !existing,
      track, year,
      picked: ids.length,
      expected,
      warning: ids.length < expected ? ('Only ' + ids.length + ' of ' + expected + ' questions matched') : null,
    });
  }

  // ── 管理员：保存布局（每题在哪一页、画板多高）──
  if (action === 'saveLayout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (req.user.role !== 'admin' && req.user.role !== 'root') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const { track = 'M0', year = 2025, items } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: 'Missing layout items' });
    }

    const paper = await db.collection('papers').findOne({ track, year });
    if (!paper) return res.status(404).json({ success: false, message: 'Paper not found' });

    const allowed = new Set(paper.problemIds || []);
    const cleaned = items
      .filter((it) => it && allowed.has(String(it.pid)))
      .map((it) => ({
        pid: String(it.pid),
        page: Math.max(1, Math.min(99, Math.floor(Number(it.page) || 1))),
        height: Math.max(120, Math.min(2000, Math.floor(Number(it.height) || 260))),
      }));

    // 保持原题目顺序，布局只改 page / height
    const byPid = new Map(cleaned.map((it) => [it.pid, it]));
    const finalItems = (paper.problemIds || []).map((pid, i) => (
      byPid.get(pid) || { pid, page: i + 1, height: 260 }
    ));

    await db.collection('papers').updateOne(
      { track, year },
      { $set: { layout: { items: finalItems }, updatedAt: new Date() } }
    );

    return res.status(200).json({ success: true, saved: finalItems.length });
  }

  // ── 提交单题的画板作答并批改 ──
  if (action === 'mark') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { track = 'M0', year = 2025, pid } = req.body || {};
    let imageUrl = String(req.body && req.body.imageUrl || '');
    const imageData = req.body && req.body.image;
    if (!pid || (!imageUrl && !imageData)) return res.status(400).json({ success: false, message: 'Missing pid or image' });

    if (!imageUrl) {
      if (!String(imageData).startsWith('data:image/')) {
        return res.status(400).json({ success: false, message: 'Invalid image data.' });
      }
      try {
        const { uploadImage } = await import('../lib/cloudinary.js');
        imageUrl = await uploadImage(imageData);
      } catch (e) {
        return res.status(500).json({ success: false, message: 'Image upload failed' });
      }
    } else if (!isAllowedImageUrl(imageUrl)) {
      return res.status(400).json({ success: false, message: 'Invalid image source.' });
    }

    const problem = await db.collection('problems').findOne({ id: String(pid) });
    if (!problem) return res.status(404).json({ success: false, message: 'Problem not found' });

    const marksMatch = String(problem.statement || '').match(/\((\d+)\s*marks?\)/i);
    const totalMarks = marksMatch ? Number(marksMatch[1]) : null;

    const bal = await getTokenBalance(db, req.user.username);
    if ((bal.daily || 0) + (bal.global || 0) < PER_QUESTION_COST && req.user.role !== 'root') {
      return res.status(400).json({ success: false, message: 'Insufficient tokens (' + PER_QUESTION_COST + ' needed)' });
    }

    const prompt = buildDsePrompt({
      statement: problem.statement,
      reference_answer: String(problem.ans || ''),
      total_marks: totalMarks,
    });

    const raw = await markOneImage(prompt, imageUrl);
    const mark = normalizeMark(parseJSONReply(raw));
    if (!mark) return res.status(502).json({ success: false, message: 'AI reply was not valid JSON' });

    if (req.user.role !== 'root') {
      try { await consumeTokens(db, req.user.username, PER_QUESTION_COST); } catch (e) { /* 余额不足仍返回批改结果 */ }
    }

    await db.collection('paperMarks').updateOne(
      { username: req.user.username, paperTrack: track, paperYear: year, pid: String(pid) },
      { $set: { ...mark, pid: String(pid), paperTrack: track, paperYear: year, markedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    await recordDseSubmission(db, {
      username: req.user.username,
      paperTrack: track,
      paperYear: year,
      pid: String(pid),
      imageUrl,
      score: mark.score,
      awarded: mark.awarded,
      total: mark.total,
      lines: mark.lines,
      summary: mark.summary,
      mode: 'single',
      markedAt: new Date(),
    });

    return res.status(200).json({ success: true, pid, mark });
  }

  // ── 一键批改：把这一份里所有已画的题并发提交 ──
  if (action === 'markAll') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { track = 'M0', year = 2025, answers } = req.body || {};
    if (!Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ success: false, message: 'No answers submitted' });
    }
    if (answers.length > MAX_BATCH) {
      return res.status(400).json({ success: false, message: 'Too many answers in one batch (max ' + MAX_BATCH + ')' });
    }

    const probs = await db.collection('problems').find(
      { id: { $in: answers.map((a) => String(a.pid)) } },
      { projection: { id: 1, statement: 1, ans: 1, _id: 0 } }
    ).toArray();
    const byId = Object.fromEntries(probs.map((p) => [p.id, p]));

    const { uploadImage } = await import('../lib/cloudinary.js');

    const results = await Promise.allSettled(answers.map(async (a) => {
      const pid = String(a.pid);
      let imageUrl = String(a.imageUrl || '');
      const problem = byId[pid];
      if (!problem) throw new Error('Problem not found: ' + pid);

      if (!imageUrl) {
        const data = String(a.image || '');
        if (!data.startsWith('data:image/')) throw new Error('Invalid image data for ' + pid);
        imageUrl = await uploadImage(data);
      } else if (!isAllowedImageUrl(imageUrl)) {
        throw new Error('Invalid image source for ' + pid);
      }

      const marksMatch = String(problem.statement || '').match(/\((\d+)\s*marks?\)/i);
      const totalMarks = marksMatch ? Number(marksMatch[1]) : null;

      const prompt = buildDsePrompt({
        statement: problem.statement,
        reference_answer: String(problem.ans || ''),
        total_marks: totalMarks,
      });
      const raw = await markOneImage(prompt, imageUrl);
      const mark = normalizeMark(parseJSONReply(raw));
      if (!mark) throw new Error('AI reply invalid for ' + pid);

      await db.collection('paperMarks').updateOne(
        { username: req.user.username, paperTrack: track, paperYear: year, pid },
        { $set: { ...mark, pid, paperTrack: track, paperYear: year, markedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
        { upsert: true }
      );

      await recordDseSubmission(db, {
        username: req.user.username,
        paperTrack: track,
        paperYear: year,
        pid,
        imageUrl,
        score: mark.score,
        awarded: mark.awarded,
        total: mark.total,
        lines: mark.lines,
        summary: mark.summary,
        mode: 'batch',
        markedAt: new Date(),
      });

      return { pid, mark };
    }));

    const ok = [];
    const failed = [];
    results.forEach((r, i) => {
      const pid = String(answers[i].pid);
      if (r.status === 'fulfilled') ok.push(r.value);
      else failed.push({ pid, error: String(r.reason && r.reason.message || r.reason) });
    });

    const cost = PER_QUESTION_COST * ok.length;
    if (cost > 0 && req.user.role !== 'root') {
      try { await consumeTokens(db, req.user.username, cost); } catch (e) { /* 允许欠费，结果已经拿到 */ }
    }

    return res.status(200).json({ success: true, marked: ok, failed, cost });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

export default wrapHandler(handler);
