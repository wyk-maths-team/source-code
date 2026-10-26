    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    const mainContainer = document.getElementById('mainContent');
    let currentPage = 1;
    const limit = 20;
    let totalPages = 1;

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    async function loadContests(page = 1) {
      try {
        const data = await apiCall(`/api/contests?action=list&page=${page}&limit=${limit}`);
        if (data.success) {
          totalPages = data.totalPages;
          currentPage = data.page;
          return data.contests;
        }
      } catch (err) { console.error(err); }
      return [];
    }

    function renderContests(contests) {
      let html = `<div class="contests-container">
        <div class="top-actions">
          <h2 style="display:inline-block; margin-right:1rem;">Manage Contests</h2>
          <button class="btn btn-primary" id="addContestBtn">Add Contest</button>
        </div>`;
      if (!contests.length) {
        html += '<p>No contests yet.</p>';
      } else {
        html += `<table class="contests-table">
          <thead><tr>
            <th>ID</th>
            <th>Name</th>
            <th>Public</th>
            <th>Participants</th>
            <th>Actions</th>
          </tr></thead><tbody>`;
        contests.forEach(c => {
          html += `<tr class="contest-row">
            <td onclick="window.location.href='/contest/${c.id}'">${c.id}</td>
            <td onclick="window.location.href='/contest/${c.id}'">${escapeHtml(c.name)}</td>
            <td onclick="window.location.href='/contest/${c.id}'">
              ${c.public !== false ? '<span class="badge-public">Public</span>' : '<span class="badge-private">Private</span>'}
            </td>
            <td onclick="window.location.href='/contest/${c.id}'">${c.contestantCount || 0}</td>
            <td>
              <button class="btn btn-warning" onclick="event.stopPropagation(); window.location.href='/admin/contests/${c.id}'">Edit</button>
              <button class="btn btn-danger" data-delete-id="${c.id}" onclick="event.stopPropagation();">Delete</button>
            </td>
          </tr>`;
        });
        html += '</tbody></table>';

        let paginationHtml = '<div class="pagination">';
        for (let i = 1; i <= totalPages; i++) {
          paginationHtml += `<a class="${i === currentPage ? 'active' : ''}" href="javascript:void(0)" onclick="gotoPage(${i})">${i}</a>`;
        }
        paginationHtml += '</div>';
        html += paginationHtml;
      }
      html += '</div>';
      mainContainer.innerHTML = html;

      document.getElementById('addContestBtn')?.addEventListener('click', () => {
        window.location.href = '/admin/create/contest';
      });

      // ⭐ 只綁一次：用 data-delete-id
      document.querySelectorAll('.btn-danger[data-delete-id]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const id = Number(btn.dataset.deleteId);
          if (!confirm(`Delete contest #${id}?`)) return;
          btn.disabled = true;
          try {
            const res = await apiCall('/api/contests?action=adminDelete', 'DELETE', { id });
            if (res.success) {
              const contests = await loadContests(currentPage);
              renderContests(contests);
            } else {
              (window.DSHUI ? DSHUI.toast(res.message || 'Delete failed', 'err') : alert(res.message || 'Delete failed'));
              btn.disabled = false;
            }
          } catch (err) {
            (window.DSHUI ? DSHUI.toast('Error: ' + err.message, 'err') : alert('Error: ' + err.message));
            btn.disabled = false;
          }
        });
      });
    }

    async function gotoPage(page) {
      const contests = await loadContests(page);
      renderContests(contests);
    }

    (async function init() {
      const contests = await loadContests(1);
      renderContests(contests);
    })();
  