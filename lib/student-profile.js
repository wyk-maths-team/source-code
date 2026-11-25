// lib/student-profile.js
//
// 从提交记录反推每个学生的知识树：哪些技能他用过并且做对了，哪些练过但一次
// 都没对。tutor 拿它来决定「先讲什么」—— 学生在哪一步卡住，就先解释哪一块。
//
// 数据都是现成的：
//   submissions      { username, problemId, status }  AC 表示做对
//   problem_vectors  { problemId, skills[] }          题 → 叶技能
//   skills           { id, name: {zh,en} }           技能中文名
//
// 不落库：一次查询几十毫秒，比维护一份会过期的缓存省心。

const MAX_KNOWN = 8;
const MAX_GAPS = 6;

function pickName(name, fallback) {
  if (!name) return fallback;
  if (typeof name === 'string') return name;
  return name.zh || name.en || fallback;
}

/** 该学生整体画像：known（做对过）、gaps（练过但没做对） */
export async function buildStudentProfile(db, username, opts) {
  const extra = new Set((opts && opts.extraSkills) || []);
  const empty = {
    username, empty: true, solvedCount: 0, triedCount: 0,
    skills: {}, names: {}, known: [], gaps: [],
  };

  const subs = await db.collection('submissions')
    .find({ username }, { projection: { problemId: 1, status: 1, _id: 0 } })
    .toArray();
  if (!subs.length) return empty;

  const solvedIds = new Set();
  const triedIds = new Set();
  for (const s of subs) {
    const id = String(s.problemId || '').trim();
    if (!id) continue;
    triedIds.add(id);
    if (s.status === 'AC') solvedIds.add(id);
  }
  if (!triedIds.size) return empty;

  const ids = [...triedIds];
  const vectors = await db.collection('problem_vectors')
    .find({ problemId: { $in: ids } }, { projection: { problemId: 1, skills: 1, _id: 0 } })
    .toArray();
  const byProblem = new Map(
    vectors.map((v) => [String(v.problemId), Array.isArray(v.skills) ? v.skills.map(String) : []])
  );

  const stats = new Map();
  for (const id of ids) {
    const isSolved = solvedIds.has(id);
    for (const sk of (byProblem.get(id) || [])) {
      const st = stats.get(sk) || { solved: 0, tried: 0 };
      st.tried += 1;
      if (isSolved) st.solved += 1;
      stats.set(sk, st);
    }
  }

  const skillIds = new Set([...stats.keys(), ...extra]);
  const docs = skillIds.size
    ? await db.collection('skills')
      .find({ id: { $in: [...skillIds] } }, { projection: { id: 1, name: 1, _id: 0 } })
      .toArray()
    : [];
  const names = {};
  for (const d of docs) names[d.id] = pickName(d.name, d.id);

  const all = [...stats.entries()].map(([id, st]) => ({
    id, name: names[id] || id, solved: st.solved, tried: st.tried,
  }));

  const gaps = all
    .filter((x) => x.solved === 0)
    .sort((a, b) => b.tried - a.tried)
    .slice(0, MAX_GAPS);

  const known = all
    .filter((x) => x.solved > 0)
    .sort((a, b) => b.solved - a.solved || b.tried - a.tried)
    .slice(0, MAX_KNOWN);

  return {
    username,
    empty: false,
    solvedCount: solvedIds.size,
    triedCount: triedIds.size,
    skills: Object.fromEntries(all.map((x) => [x.id, { solved: x.solved, tried: x.tried }])),
    names,
    known,
    gaps,
  };
}

/** 把当前题需要的技能分成三堆：学生练过没做对的、已经熟的、没接触过的 */
export function classifyForProblem(profile, problemSkills) {
  const needed = (Array.isArray(problemSkills) ? problemSkills : []).map(String).filter(Boolean);
  const gap = [];
  const known = [];
  const fresh = [];

  for (const id of needed) {
    const name = (profile.names && profile.names[id]) || id;
    const st = profile.skills && profile.skills[id];
    if (!st) fresh.push({ id, name });
    else if (st.solved === 0) gap.push({ id, name, tried: st.tried });
    else known.push({ id, name, solved: st.solved });
  }

  return { needed, gap, known, fresh };
}

function line(item, suffix) {
  return '- ' + item.name + ' (' + suffix + ')';
}

/**
 * 生成塞进 prompt 的段落。没有画像时返回空串，调用方据此保持原 prompt。
 */
export function profileBlock(profile, split) {
  if (!profile || profile.empty) return '';

  const parts = [];
  parts.push('【THIS STUDENT】');
  parts.push('Solved ' + profile.solvedCount + ' problems out of ' + profile.triedCount + ' attempted on this platform.');

  if (profile.known.length) {
    parts.push('Already comfortable with (they have solved problems that need these):');
    parts.push(profile.known.map((x) => line(x, 'solved ' + x.solved + '/' + x.tried)).join('\n'));
  } else {
    parts.push('They have not solved anything yet, so assume no prior technique is secure.');
  }

  if (profile.gaps.length) {
    parts.push('Practised but never got right (these are the real gaps):');
    parts.push(profile.gaps.map((x) => line(x, 'attempted ' + x.tried + ', solved 0')).join('\n'));
  }

  // 当前题需要的技能，单独排序：缺口优先
  if (split && split.needed.length) {
    parts.push('');
    parts.push('【THIS PROBLEM NEEDS】');
    if (split.gap.length) {
      parts.push('GAP - the student has tried this before and never succeeded:');
      parts.push(split.gap.map((x) => line(x, 'attempted ' + x.tried + ', solved 0')).join('\n'));
    }
    if (split.fresh.length) {
      parts.push('NEW - the student has never met this:');
      parts.push(split.fresh.map((x) => line(x, 'no attempts yet')).join('\n'));
    }
    if (split.known.length) {
      parts.push('SECURE - already used successfully:');
      parts.push(split.known.map((x) => line(x, 'solved ' + x.solved)).join('\n'));
    }
    if (!split.gap.length && !split.fresh.length) {
      parts.push('Every skill this problem needs is one the student has already used successfully.');
    }
  }

  parts.push('');
  parts.push('【HOW TO ANSWER, GIVEN THIS PROFILE】');
  parts.push('1. If any GAP or NEW skill is listed above, start by explaining the FIRST one in 2-3 sentences: what it is, when it applies, and the single move it lets you make. This is the priority - that is where the student is actually stuck. Do not solve the problem here.');
  parts.push('2. One sentence connecting that skill to this specific problem.');
  parts.push('3. Then the overall approach, in the usual short form, built on the SECURE skills.');
  parts.push('If every needed skill is already secure, skip step 1 and say in one line that their existing tools are enough, then go straight to the approach.');
  parts.push('Never mention that you were given a profile, and never list skill names as a diagnostic report - just teach in that order.');

  return parts.join('\n');
}
