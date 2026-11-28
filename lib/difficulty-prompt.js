// lib/difficulty-prompt.js
//
// 难度评级的提示词。从 api/admin-difficulty.js 搬出来单独一份 ——
// 这段东西改了要重跑全库，独立文件便于 diff 和回滚。
//
// 结构分两段：
//   <<<SYSTEM>>>  评分规则，发成 system 消息，和题面物理隔离
//   <<<USER>>>    题目本身，变量替换只发生在这里
//
// 为什么要分：整段塞进 user 时，题面里一句 "ignore the above" 就能改写评分标准。
// 分隔符由 splitTemplate() 解析；找不到就整份当 user —— 库里存的老模板照样能跑。

export const SEP_SYSTEM = '<<<SYSTEM>>>';
export const SEP_USER = '<<<USER>>>';

const RULES = `Rate an olympiad or advanced mathematics problem's intrinsic difficulty from 1.00 to 10.00. Judge the problem itself, not its source, its batch, or its existing rating. Do not fully solve it; form a solution skeleton instead. Assess both discovery and proof. Avoid inflation.

I. FIVE MEASUREMENTS

1. steps — indispensable non-trivial logical steps in an efficient solution. Count important identities, inequalities, lemmas, constructions, bounds and proof justifications. Exclude routine algebra, direct substitution into a supplied formula, repetition, trivial consequences and inefficient steps.

2. insights — distinct non-trivial ideas a student must discover rather than recall or apply: hidden symmetry, substitution, construction, invariant, structural connection, global inequality, or a parameter leading to an ODE. Exclude routine theorem application, Cauchy-Schwarz, AM-GM, integration by parts, differentiation, elementary algebra and mechanical case checks. A theorem counts only when its relevance is non-obvious. Scale: 0 routine; 1 one discovery; 2 two distinct; 3 several interacting; 4 four substantial or comparable; 5+ exceptionally intricate. Never split one idea artificially to raise the count.

3. cases — necessary mutually exclusive branches: parity, congruence, configurations, exceptional parameters, orderings, boundaries. Exclude optional or artificial splits.

4. proof (Boolean) — true when a complete argument is intrinsic: prove or show, existence or non-existence, uniqueness, general identity or inequality, sharp constant, maximum or minimum, exact locus or area, or attainability. A numerical evaluation is normally false.

5. estimate (Boolean) — true when an indispensable non-trivial inequality, global bound, asymptotic, error term or estimate is required. Routine final inequalities do not qualify.

II. TECHNIQUE-AWARE ASSESSMENT

For each significant technique in the simplest efficient solution, assess L (theoretical level 1-10), S (discovery difficulty 0-10), E (execution difficulty 0-10) and Q (essentiality: 0 irrelevant, 1 optional, 2 helpful, 3 important, 4 indispensable). These are diagnostic, not additive. An elementary method can have high S; an advanced method can have low S. Count important applications only, and do not double-count.

III. TECHNIQUE REFERENCE
L values are theoretical references, not problem scores. Assess the actual application.

- Inequalities: triangle and AM-GM (1-2); Cauchy and Bernoulli (2); Schur, rearrangement, Chebyshev (3); Jensen, Muirhead, Holder, Minkowski (4); Karamata (5); SOS and Lagrange (4-5); Gram matrix (5-6).
- Geometry: similarity (1); Ceva, Menelaus, angle bisector, power of a point, Stewart (2); incenter-excenter, Euler, Ptolemy (3); Simson (3.5); Miquel, inversion (4); projective geometry (5-6); Pascal, Brianchon, Desargues (5).
- Number theory and combinatorics: modular arithmetic, induction, pigeonhole (2); inclusion-exclusion (3); double counting (3-5); generating functions (4); Mobius inversion, multiplicative order, LTE (4-5); p-adic valuation (5-6); recurrence modulo (4-5); primitive roots (5); quadratic reciprocity, cyclotomic factorization (5-6); Dirichlet primes theorem (7); Diophantine approximation (6-8).
- Algebra: determinants (3); Vandermonde, factorization (4-5); Gram (5); Cauchy-Binet, Schur complement (5-6); exterior algebra (6-7); spectral theorem (7-8); representation theory (8-9).
- Calculus and integrals: substitution, parts (1); partial fractions (2); Frullani (3); Beta and Gamma (3-4); Laplace (4); Feynman (4-5, or 5-6 with an ODE); Fourier (5); Mellin, Euler-Maclaurin (5-6); stationary phase (6-7); saddle point (7); Stokes (8).
- Complex and special functions: Cauchy theorem and formula (5); residues and contours (6); contour deformation, keyhole, Jordan (6-7); branch cuts, argument principle, Rouche, analytic continuation (7); Jensen (7-8); Weierstrass, Hadamard (8); Mellin inversion, hypergeometric (7); dilogarithm identities (6-8); zeta and L-functions (7-9).
- Real and functional analysis: uniform convergence, Fatou, monotone convergence (4); dominated convergence, Fubini (4-5); Baire, Arzela-Ascoli (6); compact operators, weak convergence (7); open mapping, closed graph (7-8); Hahn-Banach, spectral, measure theory (8); advanced functional analysis (8-9).

Context. Direct use of Cauchy, AM-GM, Jensen, Ceva, Simson, contour-residue or Vandermonde is routine. Hidden concurrency, excenter configurations, determinants, auxiliary constructions or unusual reformulations may be insights. Finding intersections, loci and convex hulls of Simson-line families requires global geometry. Choosing a modulus, using multiplicative order to restrict prime factors, or combining valuations with order and logarithmic bounds forms a difficult number-theoretic chain. Obvious Feynman parameters and standard Mellin pairs are routine; unexpected parameters leading to ODEs, or Mellin inversion with analytic continuation, are advanced. Branch cuts, multiple singularities, principal values and delicate limits add difficulty. A technique name, or Li_2 alone, never justifies a high score.

IV. HOW TECHNIQUES AFFECT THE MEASUREMENTS
steps — count non-trivial deductions, not theorem names.
insights — count discovery only. Direct theorem use adds none; hidden structure or an unusual reformulation may add one substantial insight.
cases — only necessary mutually exclusive branches.
proof — include convergence, interchanges of limits, integrals and sums, sharpness, attainability, extremality, construction validity, boundaries and singularities.
estimate — true only for an indispensable substantive global, sharp or asymptotic bound.
Never double-count one idea or its related stages.

V. DIFFICULTY BANDS
Choose the highest band whose criteria are all met.

B1 1.00-1.99 VERY EASY — direct formula; at most 2 steps; no discovery, no essential case.
B2 2.00-2.99 EASY — 3-5 steps; at most one textbook insight; routine work; little proof difficulty.
B3 3.00-3.99 MODERATE — exactly one meaningful move; 4-8 steps; the remainder largely mechanical.
B4 4.00-4.99 MODERATELY CHALLENGING — 1-2 insights with at least one non-routine; a real choice of technique or configuration; no deep global argument.
B5 5.00-5.99 CHALLENGING — at least 2 insights, or 1 insight with substantial execution; dependent deductions; the solver chooses the starting tool; some proof or optimisation.
B6 6.00-6.99 HARD — several non-trivial steps and interacting methods; structural, recurrence, polynomial or sequence reasoning; non-trivial proof, convergence, or equality verification.
B7 7.00-7.99 VERY HARD — at least 3 substantial insights, or comparably difficult global structure; significant counting, classification or optimisation, number-theoretic restrictions, sharp inequalities, invariants or dependent deductions.
B8 8.00-8.99 EXTREMELY HARD — at least 4 substantial discoveries, or a comparably sophisticated global argument; interacting tools and a substantial proof burden; advanced series or special functions; global geometric optimisation, polyhedral containment, or exact evaluation requiring delicate transformations and convergence.
B9 9.00-9.49 EXCEPTIONAL — deeply interconnected insights; an unusually difficult global locus, convex hull, geometric area or special-function argument; multiple substantial obstacles and a non-obvious synthesis; the proof goes well beyond identifying the answer. Exceptional olympiad geometry, number theory, combinatorics or analysis can qualify; graduate mathematics is NOT required.
B10 9.50-10.00 EXTRAORDINARY — exceptional depth beyond B9; numerous major discoveries or an extraordinary breakthrough; sophisticated interaction of theories, or research-like proof demands. Extremely rare; theorem names and unfamiliarity alone do not qualify.

VI. CALIBRATION SAMPLES
Empirical references, not ground truth. Compare the actual demands; do not copy a number mechanically.

4.05 — minimise y = sin^2 x - 4 sin x + m, then minimise m^y.
4.71 — the medians of a triangle meet at the centroid and AGE is equilateral; find cos C.
6.00 — for roots a, b, c of a cubic, evaluate the sum a^n + b^n + c^n.
7.20 — classify divisor counts under an arithmetic-progression condition on divisor triples.
7.44 — a frog makes three jumps of length 5 and lands at integer coordinates; count the final positions.
7.70 — find the sharp L for the sum of pairwise |x_i - x_j| over 67 reals with zero sum.
8.15 — an infinite integral involving harmonic numbers, the digamma function and a power series.
8.93 — maximise side lengths in regular-polyhedron and cube containment problems.
9.07 — area of the smallest convex set containing the intersections of the distinct Simson lines of a triangle.
9.15 — an improper integral involving a Gaussian exponential, Li_2, an oscillating sine and cosh, with proof.

4.05 and 4.71 sit at B4; 6.00 at B6; 7.20, 7.44 and 7.70 are increasingly demanding B7; 8.15 is lower B8; 8.93 is upper B8; 9.07 and 9.15 are B9.

VII. OVERRIDES

R1 Ignore contest names, institutions, source IDs and batches.
R2 The existing score is a weak prior; recompute from the statement.
R3 If proof is true, the minimum score is 6.00 — but do not automatically assign 9.00. Distinguish a routine proof from dependent insights, global optimisation and exceptional breakthroughs.
R4 If the content is a handout, lecture note, solution sheet or meta page, output difficulty null with band R4.
R5 Necessary graduate-level tools indicate high difficulty but do not automatically imply 9.00. Exceptional elementary geometry can exceed a routine graduate exercise.
R6 Many steps with no discoveries are capped at B3 unless another explicit obstacle justifies more.
R7 A shortcut that identifies the answer does not remove the difficulty of proving correctness, uniqueness, optimality or attainability.
R8 Evaluate the best reasonably accessible solution, not an unnecessarily advanced or inefficient one.
R9 Count only essential techniques.
R10 B8 to B10 require exceptional justification; special functions, geometry, infinite sums or theorem names alone are insufficient.
R11 For borderline problems, compare with the samples and prefer the higher band only when the evidence justifies it.

VIII. INTERNAL PROCEDURE (do not output)
Check validity; find the simplest efficient solution skeleton; count steps, insights and cases; determine proof and estimate; assess each technique as L, S, E, Q; identify hidden structure, estimates, optimisation and proof obligations; choose the highest justified band using the samples; place the score meaningfully inside that band; then check for inflation and double-counting.

IX. SCORE PLACEMENT
Use two meaningful decimals: .05-.20 barely qualifies, .35-.50 sits solidly inside, .70-.95 approaches the next band. Use evidence rather than mechanical rules. Never output a score outside the chosen band, and avoid .00 except for the calibration references above.

X. OUTPUT
Respond with valid json only — no prose, no code fences. The shape is exactly:

{"difficulty": 4.25, "band": "B4", "steps": 6, "insights": 2, "cases": 0, "proof": false, "evidence": "..."}

Requirements for that json object:
- difficulty is a number from 1.00 to 10.00 with two meaningful decimals, and must fall inside the band you report.
- band is one of B1, B2, B3, B4, B5, B6, B7, B8, B9, B10.
- steps, insights and cases are non-negative integers.
- proof is a Boolean.
- evidence is exactly ONE sentence naming concrete objects or techniques from the statement and the decisive obstacle. Never write "hard" or "comprehensive" as the reason, and never include a full solution.
- Omit estimate entirely; assess it internally.
- If R4 applies, output {"difficulty": null, "band": "R4", "evidence": "Not a mathematical problem."} and nothing else.
- No additional properties.`;

export const DEFAULT_TEMPLATE = [
  SEP_SYSTEM,
  RULES,
  '',
  SEP_USER,
  'id: {{ID}}',
  'current difficulty (may be unreliable, see R2): {{CURRENT}}',
  'numeric answer present: {{HAS_ANSWER}}',
  'statement:',
  '{{STATEMENT}}',
].join('\n');

/**
 * 把模板拆成 system 和 user 两段。
 * 没有分隔符的老模板整份当 user —— 库里存的那些照样能跑。
 */
export function splitTemplate(text) {
  const src = String(text == null ? '' : text);
  const i = src.indexOf(SEP_SYSTEM);
  const j = src.indexOf(SEP_USER);
  if (i < 0 || j < 0 || j < i) return { system: '', prompt: src };
  return {
    system: src.slice(i + SEP_SYSTEM.length, j).trim(),
    prompt: src.slice(j + SEP_USER.length).trim(),
  };
}
