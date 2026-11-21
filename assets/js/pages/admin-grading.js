// assets/js/pages/admin-grading.js
//
// AI 批改的只读面板。两个数据源：
//
//   History   grading_history —— 永久记录，只含元数据（耗时/模型/分数/难度）。
//             条目最多，也是将来算「预期批改时间」的依据。
//   Live queue steps_grading_tasks —— 实时队列，带失败原因和重试次数，
//             会被 cron 收尸，所以只反映最近的情况。

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
  var diffEl = document.getElementById('grDiff');
  var diffNoteEl = document.getElementById('grDiffNote');
  var refreshBtn = document.getElementById('grRefresh');
  var statusSel = document.getElementById('grStatus');
  var rangeSel = document.getElementById('grRange');
  var userInput = document.getElementById('grUser');
  var problemInput = document.getElementById('grProblem');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.gr-tab'));

  var state = { nextBefore: null, loading: false, source: 'history' };

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

  function card(k, v, cls, sub) {
    return '<div class="gr-stat ' + (cls || '') + '">' +
      '<div class="k">' + esc(k) + '</div>' +
      '<div class="v">' + esc(String(v)) + '</div>' +
      '<div class="s">' + esc(sub || '') + '</div>' +
      '</div>';
  }

  // ── 统计 ──
  function renderStats(d) {
    var h = d.history || {};
    var q = d.queue || {};
    var l24 = q.last24h || {};

    statsEl.innerHTML = [
      card('Recorded', h.total || 0, '', 'permanent history'),
      card('Last 7d', h.last7d || 0, '', 'new entries'),
      card('Last 24h', l24.total || 0, '', 'queue activity'),
      card('Succeeded', l24.done || 0, 'ok', l24.successRate == null ? '—' : l24.successRate + '% of judged'),
      card('Failed', l24.error || 0, (l24.error || 0) > 0 ? 'err' : '', (l24.error || 0) > 0 ? 'needs a look' : 'none'),
      card('Avg time', fmtMs(l24.avgMsDone), '', 'last 24h, done'),
    ].join('');

    // 按难度 —— 这就是「预期时间」的数据基础（服务端只统计 steps）
    var rows = h.byDifficulty || [];
    if (rows.length) {
      diffEl.style.display = '';
      if (diffNoteEl) diffNoteEl.style.display = '';
      diffEl.innerHTML = rows.map(function (r) {
        var range = (r.p50Ms && r.p90Ms) ? ('p50 ' + fmtMs(r.p50Ms) + ' · p90 ' + fmtMs(r.p90Ms)) : '';
        return card('Difficulty ' + r.difficulty, fmtMs(r.avgMs), '', (r.n + ' runs') + (range ? ' · ' + range : ''));
      }).join('');
    } else {
      diffEl.style.display = 'none';
      if (diffNoteEl) diffNoteEl.style.display = 'none';
    }
  }

  async function loadStats() {
    try {
      var res = await apiCall('/api/admin-grading?action=stats');
      if (res && res.success) renderStats(res);
    } catch (e) {
      statsEl.innerHTML = '';
      diffEl.style.display = 'none';
    }
  }

  // ── 行 ──
  function row(item) {
    var when = '<span title="' + esc(fmtAbs(item.createdAt)) + '">' + esc(fmtAgo(item.createdAt)) + '</span>';
    if (item.reaped) when += ' <span class="gr-dim" title="reaped by cron">·reaped</span>';

    var note = '<span class="gr-dim">—</span>';
    if (item.source === 'queue' && item.error) {
      note = '<div class="gr-err" title="' + esc(item.error) + '">' + esc(item.error) + '</div>';
    } else if (item.source === 'history' && item.score != null) {
      note = '<span class="gr-mono">' + esc(item.score) + '</span>';
    }

    return '<tr>' +
      '<td data-label="When" class="gr-nowrap">' + when + '</td>' +
      '<td data-label="User">' + esc(item.username || '—') + '</td>' +
      '<td data-label="Problem" class="gr-mono">' + esc(item.problemId || '—') + '</td>' +
      '<td data-label="Diff" class="gr-mono">' + esc(item.difficulty == null ? '—' : item.difficulty) + '</td>' +
      '<td data-label="Status">' + badge(item.status) + '</td>' +
      '<td data-label="Model" class="gr-mono">' + esc(item.model || '—') + '</td>' +
      '<td data-label="Elapsed" class="gr-mono gr-nowrap">' + esc(fmtMs(item.elapsedMs)) + '</td>' +
      '<td data-label="Note">' + note + '</td>' +
      '</tr>';
  }

  // ── 拉列表 ──
  function queryParams() {
    var p = new URLSearchParams();
    p.set('action', 'list');
    p.set('source', state.source);
    p.set('limit', '50');
    if (statusSel.value && state.source === 'queue') p.set('status', statusSel.value);
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
      if (!hasRows) emptyEl.textContent = state.source === 'history'
        ? 'No grading history yet.'
        : 'Nothing in the queue.';
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

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (state.source === tab.dataset.source) return;
      state.source = tab.dataset.source;
      tabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
      // 状态筛选只对队列有意义
      statusSel.disabled = state.source !== 'queue';
      state.nextBefore = null;
      loadList(false);
    });
  });
  statusSel.disabled = true;   // 默认在 history

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
