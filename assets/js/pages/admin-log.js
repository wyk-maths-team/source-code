    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    let currentPage = 1;
    const limit = 20;
    let totalPages = 1;
    let filterAction = '';
    let filterOperator = '';

    // ============ 工具 ============
    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    // HKO 時區，YYYY-MM-DD HH:MM:SS
    function formatTime(ts) {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '—';
      const pad = n => String(n).padStart(2, '0');
      const localTime = d.getTime() + 8 * 3600000;
      const ld = new Date(localTime);
      return `${ld.getUTCFullYear()}-${pad(ld.getUTCMonth() + 1)}-${pad(ld.getUTCDate())} ` +
             `${pad(ld.getUTCHours())}:${pad(ld.getUTCMinutes())}:${pad(ld.getUTCSeconds())}`;
    }

    // 值轉字串，長度上限
    function fmtVal(v, maxLen = 400) {
      if (v === null || v === undefined) return '<i style="color:var(--text-secondary);">null</i>';
      let s;
      if (typeof v === 'object') {
        try { s = JSON.stringify(v, null, 0); }
        catch { s = String(v); }
      } else {
        s = String(v);
      }
      if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
      return escapeHtml(s);
    }

    // ============ 分類器 ============
    // 回傳: { kind, class, icon, summary, body }
    //   kind: 'change' | 'create' | 'delete' | 'details' | 'empty'
    //   body: HTML 字串（展開後顯示的內容）
    function classifyEntry(entry) {
      const d = entry.details || {};

      // 1) problem_change
      if (d.changes && typeof d.changes === 'object') {
        const fields = Object.keys(d.changes);
        return {
          kind: 'change',
          class: 'change',
          icon: '✎',
          summary: fields.length === 1
            ? `field: ${fields[0]}`
            : `${fields.length} fields changed`,
          body: renderChangesTable(d.changes),
        };
      }

      // 2) problem_create（有 after）
      if (d.after && typeof d.after === 'object') {
        return {
          kind: 'create',
          class: 'create',
          icon: '＋',
          summary: 'New record',
          body: renderObjectTable(d.after, 'After'),
        };
      }

      // 3) problem_delete（有 backup）
      if (d.backup && typeof d.backup === 'object') {
        return {
          kind: 'delete',
          class: 'delete',
          icon: '🗑',
          summary: 'Deleted · backup saved',
          body: renderObjectTable(d.backup, 'Backup (full document)'),
        };
      }

      // 4) 一般 details
      if (entry.details !== undefined) {
        let body;
        if (typeof d === 'object' && d !== null) {
          body = renderObjectTable(d, 'Details');
        } else {
          body = `<pre class="json-block">${escapeHtml(String(d))}</pre>`;
        }
        return {
          kind: 'details',
          class: classForAction(entry.action),
          icon: iconForAction(entry.action),
          summary: 'details',
          body,
        };
      }

      return {
        kind: 'empty',
        class: 'neutral',
        icon: '·',
        summary: '—',
        body: '',
      };
    }

function renderTarget(entry) {
  const d = entry.details || {};
  const parts = [];
  if (d.problemId) {
    parts.push(
      `<a href="/problems/${encodeURIComponent(d.problemId)}">${escapeHtml(d.problemId)}</a>`
    );
  }
  if (d.collection) {
    parts.push(`<span class="coll">${escapeHtml(d.collection)}</span>`);
  }
  if (parts.length === 0) {
    return '<span style="color:var(--text-secondary);">—</span>';
  }
  return `<span class="log-target">${parts.join(' · ')}</span>`;
}
    function classForAction(action) {
      if (/create|new/i.test(action)) return 'create';
      if (/change|update|edit|rejudge/i.test(action)) return 'change';
      if (/delete|remove/i.test(action)) return 'delete';
      if (/upload/i.test(action)) return 'upload';
      if (/set|add|like|favorite/i.test(action)) return 'set';
      return 'neutral';
    }

    function iconForAction(action) {
      if (/create|new/i.test(action)) return '＋';
      if (/change|update|edit|rejudge/i.test(action)) return '✎';
      if (/delete|remove/i.test(action)) return '🗑';
      if (/upload/i.test(action)) return '↑';
      if (/set|add|like|favorite/i.test(action)) return '⚙';
      return '·';
    }

    // ============ 渲染器 ============
    function renderChangesTable(changes) {
      const rows = Object.entries(changes).map(([field, pair]) => {
        const before = pair && typeof pair === 'object' ? pair.before : undefined;
        const after  = pair && typeof pair === 'object' ? pair.after  : undefined;
        return `<tr>
          <td>${escapeHtml(field)}</td>
          <td class="diff-del">${fmtVal(before)}</td>
          <td class="diff-add">${fmtVal(after)}</td>
        </tr>`;
      }).join('');
      return `<table class="diff-table">
        <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }

    function renderObjectTable(obj, title) {
      const skip = new Set(['_id']);
      const rows = Object.entries(obj)
        .filter(([k]) => !skip.has(k))
        .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${fmtVal(v)}</td></tr>`)
        .join('');
      return `<table class="kv-table">
        <thead><tr><th colspan="2">${escapeHtml(title)}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    }

    // Target 列（collection · problemId）
    // function renderTarget(entry) {
    //   const parts = [];
    //   if (entry.problemId) {
    //     parts.push(
    //       `<a href="/problems/${encodeURIComponent(entry.problemId)}">${escapeHtml(entry.problemId)}</a>`
    //     );
    //   }
    //   if (entry.collection) {
    //     parts.push(`<span class="coll">${escapeHtml(entry.collection)}</span>`);
    //   }
    //   if (parts.length === 0) return '<span style="color:var(--text-secondary);">—</span>';
    //   return `<span class="log-target">${parts.join(' · ')}</span>`;
    // }

    // ============ 列表 ============
    function renderLogs(logs) {
      const container = document.getElementById('logList');
      if (!logs || logs.length === 0) {
        container.innerHTML = '<div class="loading-msg">No logs found.</div>';
        return;
      }
      let html = `<table class="log-table">
        <thead><tr>
          <th>Time</th>
          <th>Action</th>
          <th>Operator</th>
          <th>Target</th>
          <th>Details</th>
        </tr></thead><tbody>`;

      for (const entry of logs) {
        const info = classifyEntry(entry);
        const time = formatTime(entry.timestamp);
        const operator = entry.operator || 'system';

        let detailsCell;
        if (info.body) {
          detailsCell = `<details>
            <summary>${escapeHtml(info.summary)}</summary>
            <div class="details-content">${info.body}</div>
          </details>`;
        } else {
          detailsCell = `<span style="color:var(--text-secondary);">${escapeHtml(info.summary)}</span>`;
        }

        html += `<tr>
          <td class="log-time">${escapeHtml(time)}</td>
          <td>
            <span class="log-action ${info.class}">
              <span class="ico">${info.icon}</span>${escapeHtml(entry.action || '')}
            </span>
          </td>
          <td class="log-operator">${escapeHtml(operator)}</td>
          <td>${renderTarget(entry)}</td>
          <td class="details-cell">${detailsCell}</td>
        </tr>`;
      }
      html += '</tbody></table>';
      container.innerHTML = html;
    }

    function renderPagination(page, total) {
      const pagination = document.getElementById('pagination');
      if (totalPages <= 1) { pagination.innerHTML = ''; return; }
      let html = '';
      html += `<button class="page-btn" onclick="goToPage(${page - 1})" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
      for (let i = 1; i <= totalPages; i++) {
        html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
      }
      html += `<button class="page-btn" onclick="goToPage(${page + 1})" ${page >= totalPages ? 'disabled' : ''}>›</button>`;
      pagination.innerHTML = html;
    }

    window.goToPage = function (newPage) {
      if (newPage < 1 || newPage > totalPages) return;
      currentPage = newPage;
      loadLogs();
    };

    async function loadLogs() {
      const container = document.getElementById('logList');
      container.innerHTML = '<div class="loading-msg">Loading...</div>';
      try {
        const params = new URLSearchParams({ page: currentPage, limit });
        if (filterAction) params.set('actionFilter', filterAction);
        if (filterOperator) params.set('operatorFilter', filterOperator);
        const data = await apiCall(`/api/admin?action=logs&${params.toString()}`);
        if (data.success) {
          totalPages = data.totalPages;
          renderLogs(data.logs);
          renderPagination(data.page, data.total);
        } else {
          container.innerHTML = `<div class="error-msg">${escapeHtml(data.message || 'Failed to load logs')}</div>`;
        }
      } catch (err) {
        container.innerHTML = '<div class="error-msg">Network error</div>';
      }
    }

    document.getElementById('applyFilterBtn').addEventListener('click', () => {
      filterAction = document.getElementById('filterAction').value.trim();
      filterOperator = document.getElementById('filterOperator').value.trim();
      currentPage = 1;
      loadLogs();
    });
    document.getElementById('clearFilterBtn').addEventListener('click', () => {
      document.getElementById('filterAction').value = '';
      document.getElementById('filterOperator').value = '';
      filterAction = '';
      filterOperator = '';
      currentPage = 1;
      loadLogs();
    });

    loadLogs();
  