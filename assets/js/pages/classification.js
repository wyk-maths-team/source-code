// assets/js/pages/classification.js
//
// 管理员跑技能分类的界面。
//
// 每点一次「Start」就循环调 /api/classify，一次最多 50 道；后端返回 nextCursor
// 就带着它继续，直到 done=true。这样单个 serverless 调用不会超时。
//
// 花费只进全局 token 计数（首页那个 total），不扣任何人的答疑额度。

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var startBtn = $('clf-start');
  var stopBtn = $('clf-stop');
  var statusEl = $('clf-status');
  var logEl = $('clf-log');
  var barFill = $('clf-bar-fill');
  var regexRow = $('clf-regex-row');
  var regexInput = $('clf-regex');
  var limitInput = $('clf-limit');

  var running = false;
  var stopRequested = false;
  var session = { processed: 0, ok: 0, failed: 0, tokens: 0, cost: 0 };

  function token() {
    try { return localStorage.getItem('auth_token') || ''; } catch (e) { return ''; }
  }

  function log(line, cls) {
    var row = document.createElement('div');
    row.className = 'clf-log-line' + (cls ? ' ' + cls : '');
    row.textContent = line;
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setBar(done, total) {
    var pct = total > 0 ? Math.min(100, Math.round(done / total * 100)) : 0;
    barFill.style.width = pct + '%';
  }

  function fmt(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function mode() {
    var el = document.querySelector('input[name="mode"]:checked');
    return el ? el.value : 'missing';
  }

  function refreshLegend() {
    regexRow.hidden = mode() !== 'regex';
  }

  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener('change', refreshLegend);
  });
  refreshLegend();

  // 先问后端当前规模：多少题、多少已分类
  async function loadStats() {
    try {
      var res = await fetch('/api/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify({ mode: mode(), limit: 1, dryRun: true }),
      });
      var d = await res.json();
      if (d && d.success) {
        $('clf-total').textContent = fmt(d.total);
        $('clf-done').textContent = fmt(d.total - (d.pending || 0));
      }
    } catch (e) { /* 拿不到就留 – */ }
  }
  loadStats();

  async function runBatch(cursor) {
    var body = { mode: mode(), limit: Math.max(1, Math.min(50, Number(limitInput.value) || 20)) };
    if (cursor) body.cursor = cursor;
    if (mode() === 'regex') body.regex = regexInput.value.trim();

    var res = await fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
      body: JSON.stringify(body),
    });
    var d = await res.json();
    if (!res.ok || !d.success) throw new Error((d && d.message) || ('HTTP ' + res.status));
    return d;
  }

  function updateTotals(d) {
    session.processed += d.processed || 0;
    session.ok += d.ok || 0;
    session.failed += d.failed || 0;
    session.tokens += d.spent || 0;
    session.cost += d.costUsd || 0;
    $('clf-spent').textContent = fmt(session.tokens);
    $('clf-cost').textContent = '$' + session.cost.toFixed(3);
  }

  async function loop() {
    var cursor = '';
    var total = 0;
    var first = true;

    while (!stopRequested) {
      var d;
      try {
        d = await runBatch(cursor);
      } catch (e) {
        log('error: ' + e.message, 'bad');
        break;
      }

      if (first) { total = d.total || 0; first = false; }
      updateTotals(d);
      setBar(session.processed, total);

      statusEl.textContent = d.processed + ' this batch · ' + session.processed + ' total';
      (d.results || []).forEach(function (r) {
        if (r.error) log('  ' + r.id + '  ' + r.error, 'bad');
        else log('  ' + r.id + '  ' + (r.skills || []).join(', '));
      });

      if (d.done) {
        log('finished — ' + session.ok + ' tagged, ' + session.failed + ' failed, ' + fmt(session.tokens) + ' tokens', 'good');
        break;
      }
      cursor = d.nextCursor || '';
      if (!cursor) { log('stopped: server returned no cursor', 'bad'); break; }
    }
  }

  startBtn.addEventListener('click', async function () {
    if (running) return;
    running = true;
    stopRequested = false;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    logEl.innerHTML = '';
    session = { processed: 0, ok: 0, failed: 0, tokens: 0, cost: 0 };
    $('clf-spent').textContent = '0';
    $('clf-cost').textContent = '$0.000';
    setBar(0, 1);
    log('started in mode: ' + mode());
    await loop();
    running = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusEl.textContent = '';
  });

  stopBtn.addEventListener('click', function () {
    stopRequested = true;
    log('stop requested — will stop after the current batch', 'warn');
  });
})();
