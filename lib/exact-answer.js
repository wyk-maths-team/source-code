// lib/exact-answer.js
//
// 题库里的 ans 是当年导入时 "%.6f" % float(精确值) 的产物：整数变 5.000000，
// 2√3 变 3.464102，1/128 变 0.007812（还丢了末位 5）。原卷多处明写
// "No approximation is accepted"，所以这些值本来就是错的口径。
//
// exactAns 存精确形式（mathjs 语法），ans 保持原样不动 —— 判题沙盒现在
// 还在用 ans，等它改成数值等价比较之后再切。两边同时存在，随时可以对照。
//
// 写法约定：
//   整数      5
//   分数      1/128        （不要 0.0078125）
//   根式      24*sqrt(3)   （不要 3.46e1 之类）
//   复合      (sqrt(5)-1)/2
//   负号      整数/分数直接写 -1/24；根式写 (-sqrt(3))/2

import { evaluate, parse } from 'mathjs';

/** 去掉从 LaTeX / 手写里带过来的包装，只留下 mathjs 能吃的表达式 */
export function normalizeExact(input) {
  if (input == null) return '';
  let s = String(input).trim();
  if (!s) return '';
  // \sqrt{3} → sqrt(3)，\frac{a}{b} → ((a)/(b))
  s = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
  s = s.replace(/\\left|\\right/g, '');
  s = s.replace(/\\cdot|\\times/g, '*');
  s = s.replace(/\\pi/g, 'pi');
  // 全角与常见排版符号
  s = s.replace(/[−–—]/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/√/g, 'sqrt');
  s = s.replace(/\s+/g, '');
  return s;
}

/**
 * 有些题的答案本身就是等式（`x^2+90x+2=0`），不是可求值的数值。
 * mathjs 会把 `=` 当成赋值运算符，直接 parse 会抛
 * "Invalid left hand side of assignment operator =" —— 所以先分型。
 */
export function classifyExact(input) {
  const s = normalizeExact(input);
  if (!s) return { kind: 'empty', text: '' };
  if (s.indexOf('=') >= 0) {
    // 等式：两侧分别能解析就算合法，但没法求值，也就不用跟 ans 比数值
    const parts = s.split('=');
    for (const p of parts) {
      try { parse(p); } catch (e) {
        return { kind: 'invalid', text: s, reason: 'equation side: ' + (e && e.message ? e.message.slice(0, 60) : 'parse error') };
      }
    }
    return { kind: 'equation', text: s };
  }
  try {
    parse(s);
    return { kind: 'value', text: s };
  } catch (e) {
    return { kind: 'invalid', text: s, reason: e && e.message ? e.message.slice(0, 80) : 'parse error' };
  }
}

/** 能不能被 mathjs 解析（只做静态检查，不求值） */
export function isValidExact(input) {
  const s = normalizeExact(input);
  if (!s) return { ok: false, reason: 'empty' };
  try {
    parse(s);
    return { ok: true, text: s };
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message.slice(0, 80) : 'parse error' };
  }
}

/** 求成数值；求不出来返回 null */
export function exactToNumber(input) {
  const s = normalizeExact(input);
  if (!s) return null;
  try {
    const v = evaluate(s);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    return null;
  }
}

/**
 * exactAns 与库内 ans 是否数值等价。
 * 用相对 + 绝对双容差：0.0078125 vs 0.007812 这种截断要通过，
 * 而 208 vs 8010 这种量级差要判不等。
 */
export function equivalent(exactAns, decimalAns, opts = {}) {
  const a = exactToNumber(exactAns);
  const b = Number(decimalAns);
  if (a === null || !Number.isFinite(b)) return { ok: false, kind: 'unparseable', reason: 'unparseable' };

  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12);
  const relDiff = diff / scale;
  const out = { ok: true, exact: a, decimal: b, diff, relDiff };

  // "%.6f" 的最大舍入误差是 5e-7（且会随量级放大到相对 5e-7/|值|）。
  // 落在这一档说明库内值只是被截断了，不是算错 —— 这和真错要分开，
  // 否则 1/81 这种三位有效数字的答案会跟 208 vs 8010 混在同一堆里。
  const roundAbs = 5e-7;
  const roundRel = Math.abs(b) > 1 ? roundAbs / Math.abs(b) : roundAbs;

  if (diff <= roundAbs || relDiff <= roundRel) {
    return { ...out, ok: true, kind: 'rounded' };
  }

  // 再给一档宽松容差：有些题的官方答案本身只给了近似值
  const relTol = opts.relTol == null ? 1e-6 : opts.relTol;
  const absTol = opts.absTol == null ? 1e-6 : opts.absTol;
  if (diff <= absTol || relDiff <= relTol) {
    return { ...out, ok: true, kind: 'tolerance' };
  }

  return { ...out, ok: false, kind: 'mismatch' };
}

/**
 * 批量体检：给一组 { id, exactAns, ans } 出报告。
 * 返回 { valid, mismatched, invalid }，不抛异常。
 */
export function auditExact(rows, opts = {}) {
  const valid = [];
  const precision = [];
  const mismatched = [];
  const invalid = [];
  const equations = [];

  for (const r of rows) {
    const kind = classifyExact(r.exactAns);
    if (kind.kind === 'empty' || kind.kind === 'invalid') {
      invalid.push({ id: r.id, exactAns: r.exactAns, reason: kind.reason || 'empty' });
      continue;
    }
    if (kind.kind === 'equation') {
      // 等式类答案存着就好，不参与数值比对
      equations.push({ id: r.id, exactAns: kind.text });
      continue;
    }
    const check = isValidExact(r.exactAns);
    if (!check.ok) {
      invalid.push({ id: r.id, exactAns: r.exactAns, reason: check.reason });
      continue;
    }
    const eq = equivalent(r.exactAns, r.ans, opts);
    if (eq.ok && eq.kind === 'tolerance') {
      // 只靠宽松容差才过：官方答案与库内值本来就不完全一致，单独列出来给人看
      precision.push({
        id: r.id, exactAns: check.text, exactValue: eq.exact,
        currentAns: r.ans, diff: eq.diff, relDiff: eq.relDiff, kind: 'tolerance',
      });
      continue;
    }
    if (!eq.ok) {
      mismatched.push({
        id: r.id,
        exactAns: r.exactAns,
        exactValue: eq.exact,
        currentAns: r.ans,
        decimalValue: eq.decimal,
        relDiff: eq.relDiff,
        reason: eq.reason || 'value differs',
      });
      continue;
    }
    valid.push({ id: r.id, exactAns: check.text, value: eq.exact, kind: eq.kind });
  }

  return { valid, precision, mismatched, invalid, equations };
}
