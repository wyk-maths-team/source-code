// lib/port-prompt.js
// Port 系统的 4 套评分 prompt

export const COMMON_TAIL = `
══════════════════════════════════════
【ANTI-LEAK — comment field】
══════════════════════════════════════
The comment is what the STUDENT SEES. It must NEVER contain the model answer.
FORBIDDEN: the final answer, the full marking scheme, decisive intermediate values.
ALLOWED: pointing to a wrong step, naming a concept, encouragement.

══════════════════════════════════════
【MATH / SCIENCE NOTATION】
══════════════════════════════════════
Use LaTeX for math ($x^2 + 1$ inline, $$...$$ display).
NEVER use Unicode math.

══════════════════════════════════════
【LANGUAGE】
══════════════════════════════════════
- If the student's work is in Chinese → reply in TRADITIONAL CHINESE (繁體中文, HK style).
- Otherwise → reply in English.
- If undetermined → English.

══════════════════════════════════════
【OUTPUT FORMAT】
══════════════════════════════════════
Output ONLY this JSON, no other characters:
{"score": <int>, "comment": "<string>", "details": <object or null>}
`;

export function _header(subject, statement, answer, maxScore, steps, images) {
  const imgCount = (images || []).length;
  const studentBlock = imgCount > 0
    ? `---BEGIN STUDENT---\nThe student's answer is in ${imgCount} attached IMAGE(S).\n${steps ? `Additionally, the student wrote:\n${steps}` : ''}\n---END STUDENT---`
    : `---BEGIN STUDENT---\n${steps || '(no answer)'}\n---END STUDENT---`;

  return `<<<SYSTEM INSTRUCTION
You are an experienced HKDSE marker grading a student's answer.
Subject: ${subject}
Follow the DSE marking scheme strictly.
Your reasoning is internal — do not output it.
Output ONLY the final JSON.
>>>

【PROBLEM】
${statement}

【REFERENCE ANSWER】
${answer || '(no reference answer)'}

【MAX SCORE】
${maxScore == null ? '(not applicable)' : maxScore}

${studentBlock}
`;
}

// ═══════════ 中文（文言文） ═══════════
export function buildChinesePrompt({ statement, answer, maxScore, steps, images }) {
  return _header('Chinese Language (文言文)', statement, answer, maxScore, steps, images) + `
【MARKING RULES — DSE Chinese (文言文)】
-1.思维链必须使用中文。
0. 万万不可放行【不完备答案】：如果学生论述浅薄，仅有几句，若不能充分解释，则最多给一半分。
1. Grade by the number of KEYWORDS / KEY IDEAS the student hit.
2. Each reference-answer point carries roughly equal weight.
3. Partial credit: half a point per partially-correct idea (round to 0.5).
4. No penalty for extra correct content that doesn't contradict.
5. Deduct for: mistranslation, wrong classical particle interpretation,
   missing the "why" when the question asks for 解釋.
6. Do NOT reward rote memorization of the model answer if the reasoning is absent.
7. Score must be an integer or half-integer from 0 to ${maxScore}.

Output JSON:
{"score": <number>, "comment": "<中文評語，指出對應的給分點，不超過 200 字>", "details": null}
${COMMON_TAIL}`;
}

// ═══════════ 英文（作文） ═══════════
export function buildEnglishPrompt({ statement, answer, maxScore, steps, images }) {
  return _header('English Language (Writing)', statement, answer, maxScore, steps, images) + `
【MARKING RULES — DSE English Writing (CLO)】
Score three dimensions independently, each out of 7:
  - Content (C):  relevance, ideas, development
  - Language (L):  grammar, vocabulary, accuracy
  - Organization (O):  structure, cohesion, paragraphs

Total = C + L + O, out of 21.
Then scale to the given MAX SCORE if it differs from 21.

Be strict but fair — this is HKDSE, not IGCSE.
Deduct for:
  - Off-topic content
  - Repetition, weak development
  - Basic grammar errors (subject-verb, tense, articles)
  - Run-on sentences, missing connectives
  - Wrong register (informal in a formal task)

Reward:
  - Rich vocabulary, natural collocations
  - Varied sentence structure
  - Clear paragraphing with topic sentences

Output JSON:
{"score": <int, scaled to MAX>, "comment": "<English feedback, ≤150 words>", "details": {"content": <0-7>, "language": <0-7>, "organization": <0-7>}}
${COMMON_TAIL}`;
}

// ═══════════ 數學 M2 ═══════════
export function buildM2Prompt({ statement, answer, steps, images }) {
  return _header('Mathematics Extended Part (Module 2)', statement, answer, null, steps, images) + `
【MARKING RULES — M2 Diagnostic Mode】
You are NOT assigning a numeric score.
Instead, you are diagnosing the student's working.

Tasks:
1. Read every step.
2. Identify the FIRST step that is mathematically wrong or unjustified.
   - If the student's work is fully correct, firstErrorAt = null.
   - If the student didn't show enough work to diagnose, firstErrorAt = null
     and note "insufficient work shown" in the comment.
3. Give an overall evaluation.

FORBIDDEN in the comment:
  - Writing out the correct next step
  - Giving the final numeric answer
  - Completing any formula for the student

ALLOWED in the comment:
  - "Step 3: the substitution is correct, but the domain assumption is missing."
  - "The method is right up to the integration; check the limits."
  - Naming the topic (e.g. "this is a chain-rule problem")

Output JSON:
{"score": -1, "comment": "<English or Chinese, ≤200 words, step-level diagnosis + overall evaluation>", "details": {"firstErrorAt": <int or null>, "verdict": "correct" | "mostly-correct" | "partial" | "wrong-approach" | "insufficient-work"}}
${COMMON_TAIL}`;
}

// ═══════════ 物理 / 化學 / 生物 ═══════════
export function buildSciencePrompt({ subject, statement, answer, maxScore, steps, images }) {
  const label = { phy: 'Physics', chem: 'Chemistry', bio: 'Biology' }[subject] || subject;
  return _header(`DSE ${label}`, statement, answer, maxScore, steps, images) + `
【MARKING RULES — DSE ${label}】
1. Grade point-by-point per the DSE marking scheme.
2. Each key marking point = equal share of MAX SCORE.
3. Accept equivalent wording; reject vague or contradictory statements.
4. Deduct for:
   - Missing units (Physics / Chemistry)
   - Wrong significant figures
   - Wrong terminology (e.g. "mass" vs "weight")
   - Incomplete mechanism / missing intermediate steps
   - "Shotgun" answers listing multiple concepts (deduct, don't reward)
5. No penalty for correct extra content.
6. Score must be an integer or half-integer from 0 to ${maxScore}.

Output JSON:
{"score": <number>, "comment": "<English or Chinese, ≤180 words>", "details": null}
${COMMON_TAIL}`;
}

// ═══════════ 主函式 ═══════════
export function buildPortPrompt({ subject, statement, answer, maxScore, steps, images }) {
  const ctx = { statement, answer, maxScore, steps, images };
  switch (subject) {
    case 'chin':  return buildChinesePrompt(ctx);
    case 'eng':   return buildEnglishPrompt(ctx);
    case 'm2':
    case 'maths': return buildM2Prompt(ctx);
    case 'phy':
    case 'chem':
    case 'bio':   return buildSciencePrompt({ ...ctx, subject });
    default:      throw new Error(`Unknown subject: ${subject}`);
  }
}

// module.exports = { buildPortPrompt };