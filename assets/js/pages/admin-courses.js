// 管理员课程列表
(function () {
  'use strict';
  const u = getCurrentUser();
  if (!u || (u.role !== 'admin' && u.role !== 'root')) { location.href = '/index.html'; return; }
  Page.boot({ title: 'Courses', requireAuth: true });

  const body = document.getElementById('acBody');
  const TRACK_LABEL = { M: 'Compulsory', M2: 'Extended', MO: 'Olympiad' };
  const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard', challenging: 'Challenging', insane: 'Insane' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);

  async function load() {
    try {
      const data = await API.get('/api/course?action=adminList');
      const list = data.courses || [];
      if (!list.length) { body.innerHTML = '<div class="ac-empty">No courses yet.</div>'; return; }

      body.innerHTML = `
        <table class="ac-table">
          <thead><tr>
            <th>Track</th><th>ID</th><th>Topic</th><th>Difficulty</th><th>Problems</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${list.map((c) => `
              <tr data-track="${esc(c.track)}" data-id="${esc(c.id)}">
                <td><span class="ac-track ${esc(c.track)}">${esc(TRACK_LABEL[c.track] || c.track)}</span></td>
                <td class="mono">${esc(c.id)}</td>
                <td>${esc(c.topic || '(untitled)')}</td>
                <td>${esc(DIFF_LABEL[c.difficulty] || c.difficulty)}</td>
                <td>${Array.isArray(c.pids) ? c.pids.length : 0}</td>
                <td>
                  <div class="ac-act">
                    <a href="/admin/course/${encodeURIComponent(c.id)}?track=${encodeURIComponent(c.track)}">Edit</a>
                    <button type="button" class="del">Delete</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>`;

      body.querySelectorAll('.del').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const tr = btn.closest('tr');
          const track = tr.dataset.track;
          const id = tr.dataset.id;
          if (!confirm('Delete course "' + id + '" from ' + track + '?')) return;
          btn.disabled = true;
          try {
            const res = await API.post('/api/course?action=adminDelete', { track, id });
            if (res.success) { tr.remove(); }
            else { alert(res.message || 'Delete failed'); btn.disabled = false; }
          } catch (e) { alert(e.message || 'Delete failed'); btn.disabled = false; }
        });
      });
    } catch (e) {
      body.innerHTML = '<div class="ac-empty">Failed to load: ' + esc(e.message) + '</div>';
    }
  }

  Page.ready(load);
})();
