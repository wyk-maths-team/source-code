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
    '  <p class="lab-intro">Offline checks that compare the estimator against what is already stored. ',
    '  Nothing here writes to the problem bank — results are for reading, and can be saved as a run for later comparison.</p>',
    '  <p class="lab-intro" style="margin-top:-12px;">Note: the stored difficulty was produced by a ',
    '  <strong>different model in one bulk pass</strong>, not by human markers. A large mismatch means two models ',
    '  disagree, not that one of them is right.</p>',
    '</div>',

    // ── 模块 1：难度对拍 ──
    '<section class="lab-module" id="mod-difficulty">',
    '  <header>',
    '    <h2><i class="fas fa-ruler-combined"></i> Difficulty calibration</h2>',
    '    <p class="lab-desc">Sample N problems, ask the model to re-score each one with the production rubric, ',
    '    then compare against the stored difficulty. Costs tokens on your account, same as pressing Auto.</p>',
    '  </header>',
    '  <div class="lab-controls">',
    '    <label>Sample <input type="number" id="diffN" value="10" min="1" max="1000"></label>',
    '    <label>Concurrency <input type="number" id="diffConcurrency" value="3" min="1" max="50"></label>',
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
    '    <label>Concurrency <input type="number" id="simConcurrency" value="4" min="1" max="50"></label>',
    '    <button type="button" class="btn btn-primary" id="simRun"><i class="fas fa-play"></i> Run</button>',
    '    <button type="button" class="btn btn-secondary" id="simStop" disabled>Stop</button>',
    '    <span class="lab-progress" id="simProgress"></span>',
    '  </div>',
    '  <div class="lab-stats" id="simStats"></div>',
    '  <div class="lab-table-wrap" id="simTable"><div class="lab-empty">No run yet.</div></div>',
    '</section>',

    // ── 模块 3：prompt 编辑器（手风琴，默认收起）──
    '<section class="lab-module" id="mod-prompt">',
    '  <header class="lab-accordion-head" id="promptToggle">',
    '    <h2><i class="fas fa-sliders"></i> Difficulty prompt <span class="lab-badge" id="promptSource">…</span>',
    '      <i class="fas fa-chevron-down lab-chevron"></i></h2>',
    '    <p class="lab-desc">The rubric the estimator actually sends. Saved to the database and picked up by the next run; Reset restores the built-in template.</p>',
    '  </header>',
    '  <div class="lab-accordion-body" id="promptBody" hidden>',
    '    <textarea id="promptText" class="lab-prompt-input" spellcheck="false" placeholder="Loading…"></textarea>',
    '    <div class="lab-controls" style="margin-top:10px;">',
    '      <button type="button" class="btn btn-primary" id="promptSave"><i class="fas fa-floppy-disk"></i> Save</button>',
    '      <button type="button" class="btn btn-secondary" id="promptReset">Reset to default</button>',
    '      <span class="lab-progress" id="promptStatus"></span>',
    '    </div>',
    '    <p class="lab-prompt-meta">Placeholders: <code>{{ID}}</code> <code>{{CURRENT}}</code> <code>{{HAS_ANSWER}}</code> <code>{{STATEMENT}}</code>. The last one is required — without it the model never sees the problem.</p>',
    '  </div>',
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
    // 上限 1000：一次 1000 题大约烧 3M tokens，跑之前先看余额
    const n = Math.max(1, Math.min(1000, Number($('diffN').value) || 10));
    // 上限 50：ds-flash 侧允许的并发是 2500，瓶颈不会在模型那边。
    // 真正要守住的是后端限流（api/admin-difficulty 现在是 300 次/分钟）。
    const concurrency = Math.max(1, Math.min(50, Number($('diffConcurrency').value) || 3));
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

      // 并发跑：N 道题串行要 N×8 秒，20 题就超过两分钟。
      // 用固定数量的 worker 从共享游标里取题，结果按原索引写回，顺序不会乱。
      const results = new Array(list.length);
      let cursor = 0;
      let done = 0;

      const worker = async () => {
        while (state.diffRunning) {
          const i = cursor++;
          if (i >= list.length) return;
          const p = list[i];
          const callOnce = () => apiCall('/api/admin-difficulty', 'POST', { problemId: p.id });

          let r = null;
          let lastErr = null;
          let retried = false;
          try {
            r = await callOnce();
          } catch (err1) {
            // 单题失败重试一次：并发 50 时偶发的 429 / 网关抖动不该算进统计
            retried = true;
            lastErr = err1;
            await new Promise((ok) => setTimeout(ok, 600));
            try { r = await callOnce(); } catch (err2) { lastErr = err2; }
          }

          if (!r) {
            results[i] = {
              id: p.id, name: p.name, existing: p.difficulty, ai: null,
              error: lastErr ? lastErr.message : 'failed', retried,
            };
          } else {
            results[i] = {
              id: p.id, name: p.name, existing: p.difficulty,
              ai: (r.difficulty === null) ? null : r.difficulty,
              band: r.band, rationale: r.rationale, charged: r.charged || 0,
              error: (r.difficulty === null) ? 'not-a-problem (R5)' : null,
              retried,
            };
          }
          done++;
          $('diffProgress').textContent = 'Scored ' + done + '/' + list.length
            + ' · ' + Math.min(concurrency, list.length) + ' in flight';
          // 节流：每两题重绘一次，N 大时不必每题重建表格与散点
          if (done % 10 === 0 || done === list.length) {
            rows.length = 0;
            rows.push(...results.filter(Boolean));
            renderDiff(rows, list.length);
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, list.length) }, () => worker())
      );

      rows.length = 0;
      rows.push(...results.filter(Boolean));
      $('diffProgress').textContent = state.diffRunning
        ? 'Done · ' + rows.length + ' problems'
        : 'Stopped at ' + rows.length;
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

    const retried = rows.filter((x) => x.retried).length;

    $('diffStats').innerHTML = [
      statCell('scored', pairs.length + '/' + rows.length),
      statCell('MAE', fmt(mean(abs))),
      statCell('RMSE', fmt(Math.sqrt(mean(diffs.map((d) => d * d))))),
      statCell('bias', fmt(mean(diffs))),
      statCell('SD of diff', fmt(sdv)),
      statCell('variance', fmt(sdv * sdv, 3)),
      statCell('Pearson r', fmt(r, 3)),
      statCell('retried', retried),
      statCell('tokens spent', charged.toLocaleString()),
    ].join('');

    $('diffChart').innerHTML = scatter(pairs);

    if (!rows.length) {
      $('diffTable').innerHTML = '<div class="lab-empty">No run yet.</div>';
      return;
    }
    // 1000 题时整表渲染会卡，只画前 300 行；统计始终用全量
    const RENDER_ROWS = 300;
    const shown = rows.slice(0, RENDER_ROWS);

    const body = shown.map((row) => {
      const delta = (row.ai === null) ? null : row.ai - row.existing;
      const cls = delta === null ? '' : (delta >= 0 ? 'lab-delta-pos' : 'lab-delta-neg');
      return '<tr>'
        + '<td class="mono">' + esc(row.id) + '</td>'
        + '<td>' + esc(String(row.name || '').slice(0, 46)) + '</td>'
        + '<td>' + fmt(row.existing) + '</td>'
        + '<td>' + (row.ai === null ? '<span style="color:var(--danger)">' + esc(row.error || 'failed') + '</span>' : fmt(row.ai)) + '</td>'
        + '<td class="' + cls + '">' + (delta === null ? '—' : (delta >= 0 ? '+' : '') + fmt(delta)) + '</td>'
        + '<td class="mono">' + esc(row.band || '') + (row.retried ? ' *' : '') + '</td>'
        + '<td title="' + esc(row.rationale || '') + '">' + esc(String(row.rationale || '').slice(0, 70)) + '</td>'
        + '</tr>';
    }).join('');

    const more = rows.length > RENDER_ROWS
      ? '<div class="lab-empty">Showing the first ' + RENDER_ROWS + ' of ' + rows.length
        + ' rows — the statistics above use all of them.</div>'
      : '';

    $('diffTable').innerHTML = '<table class="lab-table"><thead><tr>'
      + '<th>id</th><th>name</th><th>stored</th><th>AI</th><th>Δ</th><th>band</th><th>reason</th>'
      + '</tr></thead><tbody>' + body + '</tbody></table>' + more;
  }

  function scatter(pairs) {
    if (!pairs.length) return '';
    const W = 620, H = 400;
    const padL = 46, padB = 42, padT = 18, padR = 20;
    const max = 9.5;
    const x = (v) => padL + (v / max) * (W - padL - padR);
    const y = (v) => H - padB - (v / max) * (H - padT - padB);

    // 网格：每 1 分一条，够密能读数、又不会盖住点
    let grid = '';
    for (let v = 0; v <= 9; v++) {
      grid += '<line class="grid" x1="' + x(v).toFixed(1) + '" y1="' + padT + '" x2="' + x(v).toFixed(1) + '" y2="' + (H - padB) + '"/>';
      grid += '<line class="grid" x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(v).toFixed(1) + '"/>';
    }

    let ticks = '';
    [0, 3, 6, 9].forEach((v) => {
      ticks += '<text x="' + x(v).toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + v + '</text>';
      ticks += '<text x="' + (padL - 10) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    });

    const dots = pairs.map((p) => {
      const delta = p.ai - p.existing;
      const off = Math.abs(delta) > 1.5;
      return '<circle class="dot' + (off ? ' off' : '') + '" cx="' + x(p.existing).toFixed(1)
        + '" cy="' + y(p.ai).toFixed(1) + '" r="4.6"><title>' + esc(p.id) + ' · stored '
        + fmt(p.existing) + ' · AI ' + fmt(p.ai) + ' · Δ' + (delta >= 0 ? '+' : '') + fmt(delta)
        + '</title></circle>';
    }).join('');

    const legendX = W - padR - 168;
    const legendY = padT + 8;

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="AI estimate versus stored difficulty">'
      + grid
      + '<line class="axis" x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '"/>'
      + '<line class="axis" x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (H - padB) + '"/>'
      + '<line class="diag" x1="' + x(0).toFixed(1) + '" y1="' + y(0).toFixed(1) + '" x2="' + x(max).toFixed(1) + '" y2="' + y(max).toFixed(1) + '"/>'
      + '<text x="' + (x(max) - 6).toFixed(1) + '" y="' + (y(max) - 8).toFixed(1) + '" text-anchor="end" class="diag-label">perfect agreement</text>'
      + dots
      + ticks
      + '<text x="' + (padL + (W - padL - padR) / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="axis-label">stored difficulty</text>'
      + '<text x="14" y="' + (padT + (H - padT - padB) / 2).toFixed(1) + '" text-anchor="middle" transform="rotate(-90 14 ' + (padT + (H - padT - padB) / 2).toFixed(1) + ')" class="axis-label">AI estimate</text>'
      + '<g class="legend" transform="translate(' + legendX + ',' + legendY + ')">'
      + '<circle class="dot" cx="5" cy="4" r="4.6"/><text x="16" y="8">within 1.5</text>'
      + '<circle class="dot off" cx="5" cy="22" r="4.6"/><text x="16" y="26">off by more than 1.5</text>'
      + '</g>'
      + '</svg>';
  }

  // ═════════ 模块 2：相似题抽查 ═════════
  async function runSimilarity() {
    if (state.simRunning) return;
    const n = Math.max(1, Math.min(100, Number($('simN').value) || 20));
    const concurrency = Math.max(1, Math.min(50, Number($('simConcurrency').value) || 4));

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

      // 这一块不烧 token，但每次 similar 也要查库，同样并发跑
      const results = new Array(list.length);
      let cursor = 0;
      let done = 0;

      const worker = async () => {
        while (state.simRunning) {
          const i = cursor++;
          if (i >= list.length) return;
          const p = list[i];
          try {
            const d = await apiCall('/api/problem?action=similar&id=' + encodeURIComponent(p.id));
            const sim = Array.isArray(d && d.similar) ? d.similar : [];
            const top1 = sim[0] || null;
            const top3 = sim.slice(0, 3);
            results[i] = {
              id: p.id, name: p.name, stored: p.difficulty,
              engine: (d && d.engine) || '(legacy)',
              top1: top1 ? top1.id : '—',
              top1Shared: top1 && Array.isArray(top1.shared) ? top1.shared.length : 0,
              top3Shared: top3.reduce((s, x) => s + ((x.shared && x.shared.length) || 0), 0),
              top3Share: top3.length
                ? top3.filter((x) => (x.shared || []).length).length + '/' + top3.length
                : '—',
            };
          } catch (e) {
            results[i] = { id: p.id, name: p.name, stored: p.difficulty, error: e.message };
          }
          done++;
          $('simProgress').textContent = 'Checked ' + done + '/' + list.length;
          if (done % 4 === 0 || done === list.length) {
            rows.length = 0;
            rows.push(...results.filter(Boolean));
            renderSim(rows);
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, list.length) }, () => worker())
      );

      rows.length = 0;
      rows.push(...results.filter(Boolean));
      $('simProgress').textContent = state.simRunning
        ? 'Done · ' + rows.length + ' problems'
        : 'Stopped at ' + rows.length;
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

  // ═════════ 模块 3：prompt 编辑器 ═════════
  let promptLoaded = false;

  function paintPromptSource(d) {
    const badge = $('promptSource');
    const isDb = d && d.source === 'db';
    badge.textContent = isDb ? 'custom' : 'default';
    badge.classList.toggle('db', isDb);
    $('promptStatus').textContent = isDb
      ? 'edited by ' + (d.updatedBy || '?') + ' · ' + (d.updatedAt ? new Date(d.updatedAt).toLocaleString() : '')
      : 'using the built-in template';
  }

  async function loadPrompt() {
    try {
      const d = await apiCall('/api/admin-lab?action=prompt');
      if (!d || !d.success) throw new Error((d && d.message) || 'load failed');
      promptLoaded = true;
      $('promptText').value = d.text || '';
      paintPromptSource(d);
    } catch (e) {
      $('promptStatus').textContent = 'Failed: ' + e.message;
    }
  }

  $('promptToggle').addEventListener('click', async function () {
    const mod = $('mod-prompt');
    const body = $('promptBody');
    const willOpen = body.hidden;
    body.hidden = !willOpen;
    mod.classList.toggle('expanded', willOpen);
    if (willOpen && !promptLoaded) await loadPrompt();
  });

  $('promptSave').addEventListener('click', async function () {
    const text = $('promptText').value;
    $('promptStatus').textContent = 'Saving…';
    try {
      const d = await apiCall('/api/admin-lab', 'POST', { action: 'savePrompt', text });
      if (!d || !d.success) throw new Error((d && d.message) || 'save failed');
      $('promptSource').textContent = 'custom';
      $('promptSource').classList.add('db');
      $('promptStatus').textContent = 'Saved · the next run uses it';
    } catch (e) {
      $('promptStatus').textContent = 'Failed: ' + e.message;
    }
  });

  $('promptReset').addEventListener('click', async function () {
    $('promptStatus').textContent = 'Resetting…';
    try {
      const d = await apiCall('/api/admin-lab', 'POST', { action: 'resetPrompt' });
      if (!d || !d.success) throw new Error((d && d.message) || 'reset failed');
      $('promptText').value = d.text || '';
      $('promptSource').textContent = 'default';
      $('promptSource').classList.remove('db');
      $('promptStatus').textContent = 'Reset to the built-in template';
    } catch (e) {
      $('promptStatus').textContent = 'Failed: ' + e.message;
    }
  });

  // ── 绑定 ──
  $('diffRun').addEventListener('click', runDifficulty);
  $('diffStop').addEventListener('click', () => { state.diffRunning = false; });
  $('simRun').addEventListener('click', runSimilarity);
  $('simStop').addEventListener('click', () => { state.simRunning = false; });
})();
