    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }
    async function load() {
      const data = await apiCall('/api/admin?action=markerList');
      if (!data.success) return;
      const mc = document.getElementById('mainContent');
      mc.innerHTML = `<h2>Image Submissions to Mark</h2>`;
      if (data.submissions.length === 0) mc.innerHTML += '<p>All caught up!</p>';
      else {
        let html = '';
        data.submissions.forEach(s => {
          html += `<div class="sub-row highlight">
            <span class="sub-id">${s.subid}</span>
            <span>${s.username} — ${s.problemId}</span>
            <span style="margin-left: auto;">${new Date(s.timestamp).toLocaleString()}</span>
            <a href="/admin/marker/${s.subid}" class="btn btn-primary">Mark</a>
          </div>`;
        });
        mc.innerHTML += html;
      }
    }
    load();
  