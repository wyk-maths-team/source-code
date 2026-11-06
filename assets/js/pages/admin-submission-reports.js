// assets/js/pages/admin-submission-reports.js
// 提交举报列表：列出 submission_reports，可标记已处理，可直接跳去发系统消息
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const _reports = [];
  let _busy = new Set();

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function showMessage(text, kind) {
    const el = $('message');
    if (!el) return;
    el.textContent = text;
    el.className = 'message ' + (kind || '');
    setTimeout(() => { el.textContent = ''; el.className = 'message'; }, 4000);
  }

  async function apiCall(url, method, body) {
    const opts = { method: method || 'GET', headers: {} };
    const t = localStorage.getItem('auth_token');
    if (t) opts.headers['Authorization'] = 'Bearer ' + t;
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(url, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || data.error || ('HTTP ' + r.status));
    return data;
  }

  async function load() {
    try {
      const includeResolved = $('showResolved') && $('showResolved').checked;
      const res = await apiCall('/api/submissions?action=adminReports' + (includeResolved ? '&resolved=1' : ''));
      _reports.length = 0;
      (res.reports || []).forEach((r) => _reports.push(r));
      renderTable();
    } catch (e) {
      showMessage('Load failed: ' + e.message, 'error');
    }
  }

  function renderTable() {
    const c = $('subReportsList');
    if (!c) return;

    if (!_reports.length) {
      c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-secondary);">No submission reports</div>';
      return;
    }

    let html = '<table><thead><tr>' +
      '<th class="col-center">✓</th>' +
      '<th>#</th><th>Submission</th><th>Problem</th><th>Reported</th><th>Reported by</th>' +
      '<th>Reason</th><th>Time</th><th>Actions</th>' +
      '</tr></thead><tbody>';

    _reports.forEach((r, i) => {
      const t = r.createdAt ? new Date(r.createdAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' }) : '';
      const rid = escapeHtml(r.id);
      const reason = (r.reason || '').trim();
      html += '<tr class="' + (r.resolved ? 'report-resolved' : 'report-pending') + '" data-report-id="' + rid + '">' +
        '<td class="col-center"><input type="checkbox" class="resolve-checkbox" data-report-id="' + rid + '"' + (r.resolved ? ' checked' : '') + '></td>' +
        '<td>' + (i + 1) + '</td>' +
        '<td><a href="/submissions/detail?subid=' + encodeURIComponent(r.subid) + '">' + escapeHtml(r.subid) + '</a></td>' +
        '<td><a href="/problems/' + encodeURIComponent(r.problemId) + '">' + escapeHtml(r.problemId) + '</a></td>' +
        '<td>' + escapeHtml(r.submissionOwner) + '</td>' +
        '<td>' + escapeHtml(r.by) + '</td>' +
        '<td class="reason-cell' + (reason ? '' : ' empty') + '">' + (reason ? escapeHtml(reason) : '(no reason provided)') + '</td>' +
        '<td>' + escapeHtml(t) + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn-sm btn-secondary" data-action="reply" data-report-id="' + rid + '" title="Open the message composer">Reply</button>' +
        '</td>' +
      '</tr>';
    });

    html += '</tbody></table>';
    c.innerHTML = html;
    c.onclick = onClick;
    c.onchange = onCheck;
  }

  function onClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const rid = btn.dataset.reportId;
    const r = _reports.find((x) => String(x.id) === rid);
    if (!r) return;

    if (btn.dataset.action === 'reply') {
      const u = new URL('/admin/send-message', window.location.origin);
      u.searchParams.set('username', r.by || '');
      u.searchParams.set('problemid', r.problemId || '');
      u.searchParams.set('subid', r.subid || '');
      u.searchParams.set('template', 'submissionReport');
      window.location.href = u.toString();
    }
  }

  async function onCheck(e) {
    const cb = e.target.closest('.resolve-checkbox');
    if (!cb) return;
    const rid = cb.dataset.reportId;
    if (_busy.has(rid)) return;
    _busy.add(rid);
    cb.disabled = true;
    try {
      await apiCall('/api/submissions?action=resolveReport', 'POST', { id: rid, resolved: cb.checked });
      const row = _reports.find((x) => String(x.id) === rid);
      if (row) row.resolved = cb.checked;
      const tr = cb.closest('tr');
      if (tr) tr.className = cb.checked ? 'report-resolved' : 'report-pending';
      showMessage(cb.checked ? 'Marked as handled' : 'Marked as pending', 'ok');
    } catch (err) {
      cb.checked = !cb.checked;
      showMessage('Failed: ' + err.message, 'error');
    } finally {
      _busy.delete(rid);
      cb.disabled = false;
    }
  }

  Page.boot({ title: 'Submission Reports', requireAuth: true, skeleton: true });
  Page.ready(async (user) => {
    if (user.role !== 'admin' && user.role !== 'root') {
      $('mainContent').innerHTML = '<h2 style="text-align:center;padding:40px;">403 Forbidden</h2>';
      Page.hideSkeleton();
      return;
    }
    Page.hideSkeleton();
    const toggle = $('showResolved');
    if (toggle) toggle.addEventListener('change', load);
    await load();
  });
})();
