// assets/js/pages/admin-grading.js
//
// AI 批改队列的只读面板。
// 数据源是 steps_grading_tasks —— 每一次批改（无论成功、失败、被收尸）都在这里留痕。
//
// 用法上没什么花活：进页面拉一次统计 + 一页列表，改筛选重新拉，
// 「Load more」用 createdAt 游标往下翻。

(function () {
  'use strict';

  var esc = (window.DSHUI && window.DSHUI.esc) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
    });
  };

  var body = document.getElementById('grBody');
  var emptyEl = document.getElementById('grEmpty');
  var moreBtn = document.getElementById('grMore');
  var statsEl = document.getElementById('grStats');
  var refreshBtn = document.getElementById('grRefresh');
  var statusSel = document.getElementById('grStatus');
  var rangeSel = document.getElementById('grRange');
  var userInput = document.getElementById('grUser');
  var problemInput = document.getElementById('grProblem');

  var state = { nextBefore: null, loading: false };

  // ── 小工具 ──
  function fmtAgo(iso) {
    if (!iso) return '—';
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '—';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }

  function fmtMs(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n <= 0) return '—';
    if (n < 1000) return n + 'ms';
    if (n < 60000) return (n / 1000).toFixed(1) + 's';
    return Math.floor(n / 60000) + 'm' + Math.round((n % 60000) / 1000) + 's';
  }

  function fmtAbs(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch (e) { return String(iso); }
  }

  function badge(status) {
    var s = String(status || 'pending');
    return '<span class="gr-badge ' + esc(s) + '">' + esc(s) + '</span>';
  }

  // ── 统计卡 ──
  function renderStats(d) {
    var l24 = d.last24h || {};
    var by = l24.byStatus || {};
    var done = by.done || 0;
    var err = by.error || 0;
    var judgeable = done + err;
    var successRate = judgeable ? Math.round((done / judgeable) * 100) : null;

    var cards = [
      { k: 'Last 24h', v: l24.total || 0, cls: '', s: 'grading runs' },
      { k: 'Succeeded', v: done, cls: 'ok', s: successRate == null ? '—' : successRate + '% of judged' },
      { k: 'Failed', v: err, cls: err > 0 ? 'err' : '', s: err > 0 ? 'needs a look' : 'none' },
      { k: 'Avg time (done)', v: fmtMs(l24.avgMsDone), cls: '', s: 'last 24h' },
      { k: 'Still open', v: (by.pending || 0) + (by.processing || 0), cls: '', s: 'pending + processing' }
    ];

    statsEl.innerHTML = cards.map(function (c) {
      return '<div class="gr-stat ' + c.cls + '">' +
        '<div class="k">' + esc(c.k) + '</div>' +
        '<div class="v">' + esc(String(c.v)) + '</div>' +
        '<div class="s">' + esc(c.s) + '</div>' +
        '</div>';
    }).join('');
  }

  // ── 行 ──
  function row(item) {
    var err = item.error ? String(item.error) : '';
    var errCell = err
      ? '<div class="gr-err" title="' + esc(err) + '">' + esc(err) + '</div>'
      : '<span class="gr-dim">—</span>';

    var when = '<span title="' + esc(fmtAbs(item.createdAt)) + '">' + esc(fmtAgo(item.createdAt)) + '</span>';
    if (item.reapedAt) when += ' <span class="gr-dim" title="reaped by cron">·reaped</span>';

    // 成功的批次没写 apiAttempts（只有失败路径写），但它至少尝试过一次
    var attempts = item.apiAttempts != null
      ? esc(String(item.apiAttempts))
      : (item.status === 'done' ? '<span class="gr-dim">1</span>' : '<span class="gr-dim">—</span>');

    return '<tr>' +
      '<td data-label="When" class="gr-nowrap">' + when + '</td>' +
      '<td data-label="User">' + esc(item.username || '—') + '</td>' +
      '<td data-label="Problem" class="gr-mono">' + esc(item.problemId || '—') + '</td>' +
      '<td data-label="Status">' + badge(item.status) + '</td>' +
      '<td data-label="Try" class="gr-mono">' + attempts + '</td>' +
      '<td data-label="Model" class="gr-mono">' + esc(item.usedModel || item.handledBy || '—') + '</td>' +
      '<td data-label="Elapsed" class="gr-mono gr-nowrap">' + esc(fmtMs(item.elapsedMs)) + '</td>' +
      '<td data-label="Error">' + errCell + '</td>' +
      '</tr>';
  }

  // ── 拉数据 ──
  function queryParams() {
    var p = new URLSearchParams();
    p.set('action', 'list');
    p.set('limit', '50');
    if (statusSel.value) p.set('status', statusSel.value);
    if (userInput.value.trim()) p.set('username', userInput.value.trim());
    if (problemInput.value.trim()) p.set('problemId', problemInput.value.trim());
    if (rangeSel.value) p.set('since', new Date(Date.now() - Number(rangeSel.value) * 3600_000).toISOString());
    return p.toString();
  }

  async function loadList(append) {
    if (state.loading) return;
    state.loading = true;
    moreBtn.disabled = true;
    try {
      var url = '/api/admin-grading?' + queryParams();
      if (append && state.nextBefore) url += '&before=' + encodeURIComponent(state.nextBefore);

      var res = await apiCall(url);
      if (!res || !res.success) throw new Error((res && res.message) || 'Failed to load');

      var html = (res.items || []).map(row).join('');
      if (append) body.insertAdjacentHTML('beforeend', html);
      else body.innerHTML = html;

      state.nextBefore = res.nextBefore || null;
      var hasRows = body.children.length > 0;
      emptyEl.style.display = hasRows ? 'none' : '';
      moreBtn.style.display = state.nextBefore ? '' : 'none';
    } catch (e) {
      if (!append) body.innerHTML = '';
      emptyEl.style.display = '';
      emptyEl.textContent = 'Could not load: ' + (e.message || 'unknown');
    } finally {
      state.loading = false;
      moreBtn.disabled = false;
    }
  }

  async function loadStats() {
    try {
      var res = await apiCall('/api/admin-grading?action=stats');
      if (res && res.success) renderStats(res);
    } catch (e) {
      statsEl.innerHTML = '';
    }
  }

  async function reloadAll() {
    refreshBtn.classList.add('spinning');
    state.nextBefore = null;
    try {
      await Promise.all([loadStats(), loadList(false)]);
    } finally {
      refreshBtn.classList.remove('spinning');
    }
  }

  // ── 事件 ──
  refreshBtn.addEventListener('click', reloadAll);
  moreBtn.addEventListener('click', function () { loadList(true); });

  var debounceTimer = null;
  function debounced() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { state.nextBefore = null; loadList(false); }, 350);
  }
  statusSel.addEventListener('change', debounced);
  rangeSel.addEventListener('change', debounced);
  userInput.addEventListener('input', debounced);
  problemInput.addEventListener('input', debounced);

  reloadAll();
})();
