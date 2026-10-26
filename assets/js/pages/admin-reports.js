
(function () {
  'use strict';

  if (!isLoggedIn()) { window.location.href = '/index.html'; return; }
  const me = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
  if (!me || (me.role !== 'admin' && me.role !== 'root')) {
    window.location.href = '/index.html';
    return;
  }

  // ═══════════ 工具 ═══════════
  const $ = id => document.getElementById(id);

  function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

  // ⭐ 顯示真實錯誤（不再一律 Network error）
  function extractErrMsg(err) {
    return err?.data?.message
        || err?.data?.error
        || err?.message
        || 'Network error';
  }

  let _msgTimer = null;
  function showMessage(msg, type = 'ok') {
    const el = $('message');
    if (!el) return;
    el.textContent = msg;
    el.className = 'message ' + (type === 'error' ? 'err' : 'ok');
    clearTimeout(_msgTimer);
    _msgTimer = setTimeout(() => { el.textContent = ''; }, 5000);
  }

  // ═══════════ 狀態 ═══════════
  let _reports = [];
  let _busyIds = new Set();   // ⭐ 正在處理中的 reportId，防重複點擊

  // ═══════════ 載入 ═══════════
  async function loadReports() {
    const container = $('reportsList');
    container.innerHTML = '<p>Loading…</p>';

    try {
      const res = await apiCall('/api/problem?action=report');
      if (!res || !res.success) {
        throw new Error(res?.message || 'Failed to load');
      }

      _reports = Array.isArray(res.reports) ? res.reports : [];

      if (_reports.length === 0) {
        container.innerHTML = '<p>No reports yet.</p>';
        return;
      }

      renderTable();
    } catch (err) {
      console.error('[reports] load failed:', err);
      container.innerHTML =
        `<div class="error-msg">${escapeHtml(extractErrMsg(err))}</div>`;
    }
  }

  // ═══════════ 渲染 ═══════════
  function renderTable() {
    const container = $('reportsList');

    let html = `<table>
      <thead><tr>
        <th class="col-center">✓</th>
        <th>#</th>
        <th>Problem ID</th>
        <th>Username</th>
        <th>Reason</th>
        <th>Time</th>
        <th>Actions</th>
      </tr></thead><tbody>`;

    _reports.forEach((r, idx) => {
      const time = new Date(r.timestamp).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
      const isResolved = !!r.resolved;
      const rowClass = isResolved ? 'report-resolved' : 'report-pending';
      const reason = (r.reason || '').trim();
      const rid = String(r._id);

      html += `<tr class="${rowClass}" data-report-id="${escapeHtml(rid)}">
        <td class="col-center">
          <input type="checkbox" class="resolve-checkbox"
            data-report-id="${escapeHtml(rid)}" ${isResolved ? 'checked' : ''}>
        </td>
        <td>${idx + 1}</td>
        <td><a href="/admin/problems/${encodeURIComponent(r.problemId)}">${escapeHtml(r.problemId)}</a></td>
        <td>${escapeHtml(r.username)}</td>
        <td class="reason-cell${reason ? '' : ' empty'}">
          ${reason ? escapeHtml(reason) : '(no reason provided)'}
        </td>
        <td>${escapeHtml(time)}</td>
        <td style="white-space:nowrap;">
          <button class="btn-sm btn-primary" data-action="edit" data-report-id="${escapeHtml(rid)}">Edit</button>
          <button class="btn-sm btn-danger"  data-action="delete" data-report-id="${escapeHtml(rid)}">Delete</button>
        </td>
      </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // ⭐ 用事件委託，取代 inline onclick
    container.addEventListener('change', onCheckboxChange);
    container.addEventListener('click', onActionClick);
  }

  // ═══════════ 事件處理 ═══════════
  async function onCheckboxChange(e) {
    const cb = e.target.closest('.resolve-checkbox');
    if (!cb) return;

    const reportId = cb.dataset.reportId;
    if (!reportId || _busyIds.has(reportId)) {
      // ⭐ 忙 → 回滾 checkbox 狀態
      cb.checked = !cb.checked;
      return;
    }

    const row = cb.closest('tr');
    const newResolved = cb.checked;

    // 樂觀更新
    row.classList.toggle('report-resolved', newResolved);
    row.classList.toggle('report-pending', !newResolved);

    // 鎖住
    _busyIds.add(reportId);
    cb.disabled = true;

    try {
      const res = await apiCall('/api/problem?action=report', 'PUT', {
        reportId,
        resolved: newResolved,
      });

      if (!res || !res.success) {
        throw new Error(res?.message || 'Update failed');
      }

      // 更新本地資料
      const r = _reports.find(x => String(x._id) === reportId);
      if (r) r.resolved = newResolved;

      showMessage('Updated', 'ok');
    } catch (err) {
      console.error('[reports] toggle failed:', err);
      // 回滾
      cb.checked = !newResolved;
      row.classList.toggle('report-resolved', !newResolved);
      row.classList.toggle('report-pending', newResolved);
      showMessage(extractErrMsg(err), 'error');
    } finally {
      _busyIds.delete(reportId);
      cb.disabled = false;
    }
  }

  async function onActionClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const reportId = btn.dataset.reportId;
    if (!reportId || _busyIds.has(reportId)) return;

    if (action === 'edit') {
      const r = _reports.find(x => String(x._id) === reportId);
      if (r) {
        window.location.href = '/admin/problems/' + encodeURIComponent(r.problemId);
      }
      return;
    }

    if (action === 'delete') {
      if (!confirm('Delete this report?')) return;

      _busyIds.add(reportId);
      btn.disabled = true;
      btn.textContent = '…';

      try {
        const res = await apiCall('/api/problem?action=report', 'DELETE', { reportId });

        if (!res || !res.success) {
          throw new Error(res?.message || 'Delete failed');
        }

        // 從本地移除
        _reports = _reports.filter(x => String(x._id) !== reportId);

        // 從 DOM 移除那一行
        const row = btn.closest('tr');
        if (row) row.remove();

        showMessage('Report deleted', 'ok');

        // 若沒資料了，顯示空狀態
        if (_reports.length === 0) {
          $('reportsList').innerHTML = '<p>No reports yet.</p>';
        }
      } catch (err) {
        console.error('[reports] delete failed:', err);

        // ⭐ 404 = 別人刪了 → 從 UI 移除
        if (err?.status === 404 || /not found/i.test(err?.message || '')) {
          _reports = _reports.filter(x => String(x._id) !== reportId);
          const row = btn.closest('tr');
          if (row) row.remove();
          showMessage('Report already deleted', 'ok');
        } else {
          showMessage(extractErrMsg(err), 'error');
          btn.disabled = false;
          btn.textContent = 'Delete';
        }
      } finally {
        _busyIds.delete(reportId);
      }
    }
  }

  // ═══════════ 啟動 ═══════════
  loadReports();
})();
