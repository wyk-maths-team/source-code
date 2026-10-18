
    const me = getCurrentUser();
    if (!isLoggedIn() || (me?.role !== 'admin' && me?.role !== 'root')) {
      window.location.href = '/index.html';
      throw new Error('Forbidden');
    }

    const bodyEl = document.getElementById('pkpBody');
    const countEl = document.getElementById('pkpCount');
    const searchEl = document.getElementById('pkpSearch');

    function esc(s) { return (window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }; }
    function stripHtml(html) {
      const d = document.createElement('div');
      d.innerHTML = html;
      return (d.textContent || '').trim();
    }

    async function load(q) {
      bodyEl.innerHTML = '<div class="pkp-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>';
      try {
        const url = `/api/admin-pkproblem?action=list` + (q ? `&q=${encodeURIComponent(q)}` : '');
        const data = await apiCall(url);
        if (!data.success) throw new Error(data.message);

        const items = data.items || [];
        countEl.textContent = `(${data.total})`;

        if (!items.length) {
          bodyEl.innerHTML = '<div class="pkp-empty">No problems found</div>';
          return;
        }

        bodyEl.innerHTML = `
          <table class="pkp-table">
            <thead>
              <tr>
                <th style="width:110px;">ID</th>
                <th>Statement</th>
                <th style="width:70px;">Ans</th>
                <th style="width:90px;">Choices</th>
                <th style="width:90px;"></th>
              </tr>
            </thead>
            <tbody>
              ${items.map(p => `
                <tr>
                  <td class="pkp-id">${esc(p.id)}</td>
                  <td class="pkp-stmt" title="${esc(stripHtml(p.statement))}">${esc(stripHtml(p.statement))}</td>
                  <td class="pkp-ans">${esc(p.ans)}</td>
                  <td style="color:var(--text-secondary);font-size:.82rem;">
                    ${Array.isArray(p.choice) ? p.choice.length : 0} options
                  </td>
                  <td>
                    <a href="/admin/pkproblems/${encodeURIComponent(p.id)}" class="pkp-edit">
                      <i class="fas fa-pen"></i> Edit
                    </a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } catch (err) {
        bodyEl.innerHTML = `<div class="pkp-empty" style="color:var(--danger)">Error: ${esc(err.message)}</div>`;
      }
    }

    let _t = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(_t);
      _t = setTimeout(() => load(searchEl.value.trim()), 300);
    });
    document.getElementById('pkpSearchBtn').addEventListener('click', () => {
      load(searchEl.value.trim());
    });
    searchEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); load(searchEl.value.trim()); }
    });

    load('');
  