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
import { sumMarks } from '../lib/marks.js';
import { defaultHeightFor } from '../lib/paperLayout.js';
import { effortForProblem } from '../lib/thinking.js';
import crypto from 'crypto';

export const config = { maxDuration: 300 };

const PER_QUESTION_COST = 3000;
const VIEW_OTHERS_IMAGE_COST = 100000;   // 看别人的 DSE 作答图，每条 100k token
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
async function markOneImage(prompt, imageUrl, effort) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
  const base = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
  const model = process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash';

  // 思考模式不支持 temperature（官方文档：传了不报错但无效），所以这里不传。
  // 稳定性靠 reasoning_effort 分级控制。
  const body = {
    model,
    messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }],
  };
  if (effort) body.reasoning_effort = effort;

  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(body),
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

    // 整卷满分 = 每道题题干里所有 (N marks) 相加；得分 = 已批改题的 awarded 之和
    const questions = (paper.problemIds || []).map((pid) => ({ ...(map[pid] || { id: pid, name: pid, statement: '' }) }));
    const marksPerQuestion = questions.map((q) => sumMarks(q.statement) || 0);
    const totalMarks = marksPerQuestion.reduce((a, b) => a + b, 0);
    const scored = marks.reduce((a, m) => a + (Number(m.awarded) || 0), 0);

    return res.status(200).json({
      success: true,
      paper: {
        track, year, title: paper.title,
        questions,
        layout: paper.layout || { items: [] },
        totalMarks,
        scoredMarks: scored,
        markedCount: marks.length,
      },
      marks: Object.fromEntries(marks.map((m) => [m.pid, m])),
      serverNow: Date.now(),
    });
  }

  // ── 我自己的历史图片提交（Import → submissions 用）──
  if (action === 'myImages') {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    // 指定 pid 时只回这一题的提交 —— Import 默认就要这个行为
    const pid = String(req.query.pid || '').trim();
    const dseFilter = { username: req.user.username, imageUrl: { $nin: [null, ''] } };
    const subFilter = { username: req.user.username, type: 'image', imageUrl: { $nin: [null, ''] } };
    if (pid) { dseFilter.pid = pid; subFilter.problemId = pid; }

    const [dse, normal] = await Promise.all([
      db.collection('dsesubmissions')
        .find(dseFilter,
          { projection: { subid: 1, pid: 1, paperTrack: 1, paperYear: 1, imageUrl: 1, createdAt: 1, _id: 0 } })
        .sort({ createdAt: -1 }).limit(limit).toArray(),
      db.collection('submissions')
        .find(subFilter,
          { projection: { subid: 1, problemId: 1, imageUrl: 1, timestamp: 1, _id: 0 } })
        .sort({ timestamp: -1 }).limit(limit).toArray(),
    ]);

    const rows = [
      ...dse.map((d) => ({
        id: d.subid, pid: d.pid, imageUrl: d.imageUrl,
        at: d.createdAt, source: 'dse',
        label: (d.paperTrack || '') + ' ' + (d.paperYear || '') + ' · ' + (d.pid || ''),
      })),
      ...normal.map((n) => ({
        id: n.subid, pid: n.problemId, imageUrl: n.imageUrl,
        at: n.timestamp, source: 'submission',
        label: n.problemId || '',
      })),
    ]
      .filter((r) => r.imageUrl)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, limit);

    return res.status(200).json({ success: true, images: rows });
  }

  // ── 所有人的 DSE 提交记录（公开给登录用户）──
  if (action === 'dseSubmissions') {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.username) filter.username = String(req.query.username);
    if (req.query.track) filter.paperTrack = String(req.query.track);
    if (Number(req.query.year)) filter.paperYear = Number(req.query.year);

    const isAdmin = req.user.role === 'admin' || req.user.role === 'root';

    const [rows, total] = await Promise.all([
      db.collection('dsesubmissions')
        .find(filter, {
          projection: {
            subid: 1, username: 1, paperTrack: 1, paperYear: 1, pid: 1,
            score: 1, awarded: 1, total: 1, lines: 1, summary: 1,
            imageUrl: 1, mode: 1, markedAt: 1, createdAt: 1, _id: 0,
          },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      db.collection('dsesubmissions').countDocuments(filter),
    ]);

    // 图片只有管理员、本人可以看到；别人的要单独付费解锁（action=dseImage）
    const safe = rows.map((r) => {
      const mine = r.username === req.user.username;
      const out = { ...r, hasImage: !!r.imageUrl, own: mine, unlockable: !mine };
      if (!isAdmin && !mine) delete out.imageUrl;
      return out;
    });

    return res.status(200).json({
      success: true,
      submissions: safe,
      canViewAll: isAdmin,
      unlockCost: VIEW_OTHERS_IMAGE_COST,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    });
  }

  // ── 看另一名学生的作答图 ──
  // 管理员与本人免费；其他人每条 100k token，付过的不再重复收。
  if (action === 'dseImage') {
    const subid = String(req.query.subid || '').trim();
    if (!subid) return res.status(400).json({ success: false, message: 'Missing subid' });

    const row = await db.collection('dsesubmissions').findOne({ subid });
    if (!row) return res.status(404).json({ success: false, message: 'Submission not found' });
    if (!row.imageUrl) return res.status(404).json({ success: false, message: 'This submission has no image' });

    const isAdmin = req.user.role === 'admin' || req.user.role === 'root';
    const mine = row.username === req.user.username;

    if (isAdmin || mine) {
      return res.status(200).json({ success: true, imageUrl: row.imageUrl, charged: 0 });
    }

    // 已经付过就免费再开
    const paid = await db.collection('dseImageViews').findOne({
      username: req.user.username, subid,
    });
    if (paid) {
      return res.status(200).json({ success: true, imageUrl: row.imageUrl, charged: 0, alreadyPaid: true });
    }

    const bal = await getTokenBalance(db, req.user.username);
    const available = (bal.daily || 0) + (bal.global || 0);
    if (available < VIEW_OTHERS_IMAGE_COST) {
      return res.status(400).json({
        success: false,
        message: 'You need ' + VIEW_OTHERS_IMAGE_COST + ' tokens to view another student\'s answer',
        need: VIEW_OTHERS_IMAGE_COST,
        have: available,
      });
    }

    try {
      await consumeTokens(db, req.user.username, VIEW_OTHERS_IMAGE_COST);
    } catch (e) {
      return res.status(409).json({ success: false, message: 'Token balance changed, please retry' });
    }

    await db.collection('dseImageViews').updateOne(
      { username: req.user.username, subid },
      { $set: { username: req.user.username, subid, paidAt: new Date(), cost: VIEW_OTHERS_IMAGE_COST } },
      { upsert: true }
    );

    return res.status(200).json({ success: true, imageUrl: row.imageUrl, charged: VIEW_OTHERS_IMAGE_COST });
  }

  // ── 管理员：试卷列表 ──
  if (action === 'listPapers') {
    // if (req.user.role !== 'admin' && req.user.role !== 'root') {
    //   return res.status(403).json({ success: false, message: 'Admin only' });
    // }
    const rows = await db.collection('papers')
      .find({}, { projection: { track: 1, year: 1, title: 1, problemIds: 1, updatedAt: 1, _id: 0 } })
      .sort({ track: 1, year: -1 })
      .toArray();

    // 所有卷子的题目一次查出来，用来算每份卷的满分
    const allPids = [...new Set(rows.flatMap((p) => p.problemIds || []))];
    const probDocs = allPids.length
      ? await db.collection('problems').find(
          { id: { $in: allPids } },
          { projection: { id: 1, statement: 1, _id: 0 } }
        ).toArray()
      : [];
    const marksById = Object.fromEntries(probDocs.map((p) => [p.id, sumMarks(p.statement) || 0]));

    // 当前用户在这些卷子上的得分
    const myMarks = await db.collection('paperMarks')
      .find({ username: req.user.username }, { projection: { paperTrack: 1, paperYear: 1, awarded: 1, _id: 0 } })
      .toArray();
    const scoreByKey = {};
    for (const m of myMarks) {
      const k = m.paperTrack + ':' + m.paperYear;
      scoreByKey[k] = (scoreByKey[k] || 0) + (Number(m.awarded) || 0);
    }

    return res.status(200).json({
      success: true,
      papers: rows.map((p) => {
        const pids = p.problemIds || [];
        const total = pids.reduce((a, pid) => a + (marksById[pid] || 0), 0);
        return {
          track: p.track, year: p.year, title: p.title,
          count: pids.length,
          totalMarks: total,
          myScore: scoreByKey[p.track + ':' + p.year] || 0,
          updatedAt: p.updatedAt,
        };
      }),
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

    const expected = track === 'M0' ? 19 :track === 'M1'? 12:13;
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
      // 没手动调过就用默认规则（半张 A4，长题整张/两张）
      height: (prev.get(pid) && prev.get(pid).height) || defaultHeightFor(track, i + 1),
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
        height: Math.max(120, Math.min(3200, Math.floor(Number(it.height) || 260))),
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

    // (a) 3 marks + (b) 4 marks 要相加，不能只取第一个
    const totalMarks = sumMarks(problem.statement);

    const bal = await getTokenBalance(db, req.user.username);
    if ((bal.daily || 0) + (bal.global || 0) < PER_QUESTION_COST && req.user.role !== 'root') {
      return res.status(400).json({ success: false, message: 'Insufficient tokens (' + PER_QUESTION_COST + ' needed)' });
    }

    const prompt = buildDsePrompt({
      statement: problem.statement,
      reference_answer: String(problem.ans || ''),
      total_marks: totalMarks,
    });

    const paperTotal = (await db.collection('papers').findOne({ track, year }, { projection: { problemIds: 1 } }) || {}).problemIds || [];
    const effort = effortForProblem(problem, { total: paperTotal.length });
    const raw = await markOneImage(prompt, imageUrl, effort);
    const mark = normalizeMark(parseJSONReply(raw));
    if (!mark) return res.status(502).json({ success: false, message: 'AI reply was not valid JSON' });

    // 和主站提交一致：AI 一返回就扣费，扣不动就不给结果
    if (req.user.role !== 'root') {
      try {
        await consumeTokens(db, req.user.username, PER_QUESTION_COST);
      } catch (e) {
        console.error('[paper] charge failed', req.user.username, e.message, { pid });
        await db.collection('audit_logs').insertOne({
          type: 'paper_charge_failed',
          username: req.user.username,
          pid: String(pid),
          amount: PER_QUESTION_COST,
          error: String(e.message || e),
          mode: 'single',
          at: new Date(),
        }).catch(() => {});
        return res.status(402).json({
          success: false,
          message: 'Marked, but the token charge failed. Please retry.',
          code: 'CHARGE_FAILED',
        });
      }
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

      const totalMarks = sumMarks(problem.statement);

      const prompt = buildDsePrompt({
        statement: problem.statement,
        reference_answer: String(problem.ans || ''),
        total_marks: totalMarks,
      });
      const effort = effortForProblem(problem, { total: answers.length });
      const raw = await markOneImage(prompt, imageUrl, effort);
      const mark = normalizeMark(parseJSONReply(raw));
      if (!mark) throw new Error('AI reply invalid for ' + pid);

      // 立即扣费（原子更新，19 题并发也不会互相踩）
      if (req.user.role !== 'root') {
        await consumeTokens(db, req.user.username, PER_QUESTION_COST);
      }

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

    // 费用已在每题批改完成时扣除，这里只做汇总
    const cost = PER_QUESTION_COST * ok.length;

    return res.status(200).json({ success: true, marked: ok, failed, cost });
  }

  return res.status(400).json({ success: false, message: 'Unknown action' });
}

export default wrapHandler(handler);
