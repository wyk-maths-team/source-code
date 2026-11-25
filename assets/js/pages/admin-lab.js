// assets/js/pages/admin-lab.js —— /admin/lab 评测台
//
// 两个模块：
//   difficulty  —— 抽样题目，逐题让 AI 重估难度，与人工标定对拍（烧 token）
//   similarity  —— 抽样题目，看 similar 前几名是否真的共享技能（不烧 token）
//
// 逐题调用而不是整批一次请求：单题 5-10 秒，N=20 会撞函数时限，而且中途
// 没有任何进度。前端串行跑，随时可以 Stop，已经跑完的结果仍然会统计。

(function () {
  'use strict';

  const user = getCurrentUser();
  if (!isLoggedIn() || (user?.role !== 'admin' && user?.role !== 'root')) {
    window.location.href = '/index.html';
    return;
  }

  const main = document.getElementById('mainContent');
  const state = { diffRunning: false, simRunning: false };

  main.innerHTML = [
    '<div class="page-header">',
    '  <h1><i class="fas fa-flask"></i> Lab</h1>',
    '  <p class="lab-intro">Offline checks that compare the AI against what is already stored. ',
    '  Nothing here writes to the problem bank — results are for reading, and can be saved as a run for later comparison.</p>',
    '</div>',

    // ── 模块 1：难度对拍 ──
    '<section class="lab-module" id="mod-difficulty">',
    '  <header>',
    '    <h2><i class="fas fa-ruler-combined"></i> Difficulty calibration</h2>',
    '    <p class="lab-desc">Sample N problems, ask the model to re-score each one with the production rubric, ',
    '    then compare against the stored difficulty. Costs tokens on your account, same as pressing Auto.</p>',
    '  </header>',
    '  <div class="lab-controls">',
    '    <label>Sample <input type="number" id="diffN" value="10" min="1" max="50"></label>',
    '    <label><input type="checkbox" id="diffAnswerOnly"> only problems with a numeric answer</label>',
    '    <button type="button" class="btn btn-primary" id="diffRun"><i class="fas fa-play"></i> Run</button>',
    '    <button type="button" class="btn btn-secondary" id="diffStop" disabled>Stop</button>',
    '    <span class="lab-progress" id="diffProgress"></span>',
    '  </div>',
    '  <div class="lab-stats" id="diffStats"></div>',
    '  <div class="lab-chart" id="diffChart"></div>',
    '  <div class="lab-table-wrap" id="diffTable"><div class="lab-empty">No run yet.</div></div>',
    '</section>',

    // ── 模块 2：相似题抽查 ──
    '<section class="lab-module" id="mod-similarity">',
    '  <header>',
    '    <h2><i class="fas fa-diagram-project"></i> Similarity sanity check</h2>',
    '    <p class="lab-desc">No model calls. For each sampled problem, look at the top 1 and top 3 results from ',
    '    <code>/api/problem?action=similar</code> and count how many actually share an exact skill with it.</p>',
    '  </header>',
    '  <div class="lab-controls">',
    '    <label>Sample <input type="number" id="simN" value="20" min="1" max="100"></label>',
    '    <button type="button" class="btn btn-primary" id="simRun"><i class="fas fa-play"></i> Run</button>',
    '    <button type="button" class="btn btn-secondary" id="simStop" disabled>Stop</button>',
    '    <span class="lab-progress" id="simProgress"></span>',
    '  </div>',
    '  <div class="lab-stats" id="simStats"></div>',
    '  <div class="lab-table-wrap" id="simTable"><div class="lab-empty">No run yet.</div></div>',
    '</section>',

    // ── 扩展说明 ──
    '<section class="lab-module">',
    '  <header><h2><i class="fas fa-plus"></i> Adding a module</h2></header>',
    '  <div class="lab-notes">',
    '    <p>Each module is one section in this file plus, if it needs server-side sampling, one branch in ',
    '    <code>api/admin-lab.js</code>. Results can be archived with <code>POST /api/admin-lab</code> ',
    '    (<code>action: "save"</code>) into the <code>lab_runs</code> collection, so different prompts or models ',
    '    can be compared later via <code>?action=history</code>.</p>',
    '    <p>Candidates worth adding later: grading consistency (re-grade a past submission and diff the score), ',
    '    tutor refusal rate (feed it off-topic questions and count refusals), and vector neighbour recall ',
    '    (does the top 10 contain the problem a human would pick).</p>',
    '  </div>',
    '</section>',
  ].join('');

  // ── 工具 ──
  const $ = (id) => document.getElementById(id);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v)) ? '—' : Number(v).toFixed(d);

  function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
  function sd(a) { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : NaN; }
  function pearson(xs, ys) {
    const n = xs.length;
    if (n < 3) return NaN;
    const mx = mean(xs), my = mean(ys);
    let num0 = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const a = xs[i] - mx, b = ys[i] - my;
      num0 += a * b; dx += a * a; dy += b * b;
    }
    return (dx && dy) ? num0 / Math.sqrt(dx * dy) : NaN;
  }

  function statCell(label, value) {
    return '<div class="lab-stat"><b>' + value + '</b><span>' + label + '</span></div>';
  }

  // ═════════ 模块 1：难度对拍 ═════════
  async function runDifficulty() {
    if (state.diffRunning) return;
    const n = Math.max(1, Math.min(50, Number($('diffN').value) || 10));
    const answerOnly = $('diffAnswerOnly').checked;

    state.diffRunning = true;
    $('diffRun').disabled = true;
    $('diffStop').disabled = false;
    $('diffProgress').textContent = 'Sampling…';
    $('diffTable').innerHTML = '<div class="lab-empty">Running…</div>';
    $('diffStats').innerHTML = '';
    $('diffChart').innerHTML = '';

    const rows = [];
    try {
      const qs = '/api/admin-lab?action=sample&module=difficulty&n=' + n + (answerOnly ? '&answer=1' : '');
      const sample = await apiCall(qs);
      const list = (sample && sample.problems) || [];
      if (!list.length) throw new Error('No problems matched');

      for (let i = 0; i < list.length; i++) {
        if (!state.diffRunning) break;
        const p = list[i];
        $('diffProgress').textContent = 'Scoring ' + (i + 1) + '/' + list.length + '…';
        try {
          const r = await apiCall('/api/admin-difficulty', 'POST', { problemId: p.id });
          rows.push({
            id: p.id, name: p.name, existing: p.difficulty,
            ai: (r && r.difficulty === null) ? null : (r && r.difficulty),
            band: r && r.band, rationale: r && r.rationale, charged: (r && r.charged) || 0,
            error: (r && r.difficulty === null) ? 'not-a-problem (R5)' : null,
          });
        } catch (e) {
          rows.push({ id: p.id, name: p.name, existing: p.difficulty, ai: null, error: e.message });
        }
        renderDiff(rows, list.length);
      }
      $('diffProgress').textContent = state.diffRunning ? 'Done · ' + rows.length + ' problems' : 'Stopped at ' + rows.length;
    } catch (e) {
      $('diffProgress').textContent = 'Failed: ' + e.message;
    } finally {
      state.diffRunning = false;
      $('diffRun').disabled = false;
      $('diffStop').disabled = true;
      renderDiff(rows, rows.length);
    }
  }

  function renderDiff(rows, total) {
    const pairs = rows.filter((r) => r.ai !== null && Number.isFinite(r.ai));
    const diffs = pairs.map((r) => r.ai - r.existing);
    const abs = diffs.map(Math.abs);
    const sdv = sd(diffs);
    const r = pearson(pairs.map((p) => p.existing), pairs.map((p) => p.ai));
    const charged = rows.reduce((s, r2) => s + (r2.charged || 0), 0);

    $('diffStats').innerHTML = [
      statCell('scored', pairs.length + '/' + rows.length),
      statCell('MAE', fmt(mean(abs))),
      statCell('RMSE', fmt(Math.sqrt(mean(diffs.map((d) => d * d))))),
      statCell('bias', fmt(mean(diffs))),
      statCell('SD of diff', fmt(sdv)),
      statCell('variance', fmt(sdv * sdv, 3)),
      statCell('Pearson r', fmt(r, 3)),
      statCell('tokens spent', charged.toLocaleString()),
    ].join('');

    $('diffChart').innerHTML = scatter(pairs);

    if (!rows.length) {
      $('diffTable').innerHTML = '<div class="lab-empty">No run yet.</div>';
      return;
    }
    const body = rows.map((row) => {
      const delta = (row.ai === null) ? null : row.ai - row.existing;
      const cls = delta === null ? '' : (delta >= 0 ? 'lab-delta-pos' : 'lab-delta-neg');
      return '<tr>'
        + '<td class="mono">' + esc(row.id) + '</td>'
        + '<td>' + esc(String(row.name || '').slice(0, 46)) + '</td>'
        + '<td>' + fmt(row.existing) + '</td>'
        + '<td>' + (row.ai === null ? '<span style="color:var(--danger)">' + esc(row.error || 'failed') + '</span>' : fmt(row.ai)) + '</td>'
        + '<td class="' + cls + '">' + (delta === null ? '—' : (delta >= 0 ? '+' : '') + fmt(delta)) + '</td>'
        + '<td class="mono">' + esc(row.band || '') + '</td>'
        + '<td title="' + esc(row.rationale || '') + '">' + esc(String(row.rationale || '').slice(0, 70)) + '</td>'
        + '</tr>';
    }).join('');

    $('diffTable').innerHTML = '<table class="lab-table"><thead><tr>'
      + '<th>id</th><th>name</th><th>stored</th><th>AI</th><th>Δ</th><th>band</th><th>reason</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function scatter(pairs) {
    if (!pairs.length) return '';
    const W = 320, H = 320, pad = 34, max = 9.5;
    const x = (v) => pad + (v / max) * (W - pad * 2);
    const y = (v) => H - pad - (v / max) * (H - pad * 2);
    const dots = pairs.map((p) => {
      const off = Math.abs(p.ai - p.existing) > 1.5;
      return '<circle class="dot' + (off ? ' off' : '') + '" cx="' + x(p.existing).toFixed(1) + '" cy="'
        + y(p.ai).toFixed(1) + '" r="4"><title>' + esc(p.id) + ' · stored ' + fmt(p.existing)
        + ' · AI ' + fmt(p.ai) + '</title></circle>';
    }).join('');

    return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'
      + '<line class="axis" x1="' + pad + '" y1="' + (H - pad) + '" x2="' + (W - pad) + '" y2="' + (H - pad) + '"/>'
      + '<line class="axis" x1="' + pad + '" y1="' + pad + '" x2="' + pad + '" y2="' + (H - pad) + '"/>'
      + '<line class="diag" x1="' + x(0) + '" y1="' + y(0) + '" x2="' + x(max) + '" y2="' + y(max) + '"/>'
      + dots
      + '<text x="' + (W / 2 - 26) + '" y="' + (H - 8) + '">stored difficulty</text>'
      + '<text x="6" y="' + (H / 2) + '" transform="rotate(-90 6 ' + (H / 2) + ')">AI estimate</text>'
      + '</svg>';
  }

  // ═════════ 模块 2：相似题抽查 ═════════
  async function runSimilarity() {
    if (state.simRunning) return;
    const n = Math.max(1, Math.min(100, Number($('simN').value) || 20));

    state.simRunning = true;
    $('simRun').disabled = true;
    $('simStop').disabled = false;
    $('simProgress').textContent = 'Sampling…';
    $('simTable').innerHTML = '<div class="lab-empty">Running…</div>';
    $('simStats').innerHTML = '';

    const rows = [];
    try {
      const sample = await apiCall('/api/admin-lab?action=sample&module=similarity&n=' + n);
      const list = (sample && sample.problems) || [];
      if (!list.length) throw new Error('No problems matched');

      for (let i = 0; i < list.length; i++) {
        if (!state.simRunning) break;
        const p = list[i];
        $('simProgress').textContent = 'Checking ' + (i + 1) + '/' + list.length + '…';
        try {
          const d = await apiCall('/api/problem?action=similar&id=' + encodeURIComponent(p.id));
          const sim = Array.isArray(d && d.similar) ? d.similar : [];
          const top1 = sim[0] || null;
          const top3 = sim.slice(0, 3);
          const sharedTop1 = top1 && Array.isArray(top1.shared) && top1.shared.length ? top1.shared.length : 0;
          const sharedTop3 = top3.reduce((s, x) => s + ((x.shared && x.shared.length) || 0), 0);
          rows.push({
            id: p.id, name: p.name, stored: p.difficulty,
            engine: (d && d.engine) || '(legacy)',
            top1: top1 ? top1.id : '—',
            top1Shared: sharedTop1,
            top3Shared: sharedTop3,
            top3Share: top3.length ? top3.filter((x) => (x.shared || []).length).length + '/' + top3.length : '—',
          });
        } catch (e) {
          rows.push({ id: p.id, name: p.name, stored: p.difficulty, error: e.message });
        }
        renderSim(rows);
      }
      $('simProgress').textContent = state.simRunning ? 'Done · ' + rows.length + ' problems' : 'Stopped at ' + rows.length;
    } catch (e) {
      $('simProgress').textContent = 'Failed: ' + e.message;
    } finally {
      state.simRunning = false;
      $('simRun').disabled = false;
      $('simStop').disabled = true;
      renderSim(rows);
    }
  }

  function renderSim(rows) {
    const ok = rows.filter((r) => !r.error);
    const withTop1 = ok.filter((r) => r.top1Shared > 0).length;
    const pct = ok.length ? (withTop1 / ok.length * 100) : NaN;
    const avgTop3 = ok.length ? mean(ok.map((r) => r.top3Shared)) : NaN;
    const legacy = ok.filter((r) => String(r.engine).indexOf('skill-vector') < 0).length;

    $('simStats').innerHTML = [
      statCell('checked', ok.length + '/' + rows.length),
      statCell('top-1 shares a skill', ok.length ? fmt(pct, 1) + '%' : '—'),
      statCell('avg shared in top-3', fmt(avgTop3, 2)),
      statCell('legacy engine', legacy),
    ].join('');

    if (!rows.length) return;
    const body = rows.map((row) => {
      if (row.error) {
        return '<tr><td class="mono">' + esc(row.id) + '</td><td colspan="5" style="color:var(--danger)">'
          + esc(row.error) + '</td></tr>';
      }
      return '<tr>'
        + '<td class="mono">' + esc(row.id) + '</td>'
        + '<td>' + esc(String(row.name || '').slice(0, 40)) + '</td>'
        + '<td>' + fmt(row.stored) + '</td>'
        + '<td class="mono">' + esc(row.top1) + '</td>'
        + '<td>' + row.top1Shared + '</td>'
        + '<td>' + row.top3Share + '</td>'
        + '<td class="mono">' + esc(row.engine) + '</td>'
        + '</tr>';
    }).join('');

    $('simTable').innerHTML = '<table class="lab-table"><thead><tr>'
      + '<th>id</th><th>name</th><th>stored</th><th>top-1</th><th>shared</th><th>top-3 with share</th><th>engine</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── 绑定 ──
  $('diffRun').addEventListener('click', runDifficulty);
  $('diffStop').addEventListener('click', () => { state.diffRunning = false; });
  $('simRun').addEventListener('click', runSimilarity);
  $('simStop').addEventListener('click', () => { state.simRunning = false; });
})();
