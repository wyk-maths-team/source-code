    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    let allTeams = [];
    let contestsMap = {};

    async function loadContests() {
      try {
        const r = await apiCall('/api/contests?action=list&limit=50');
        if (r.success) {
          const sel = document.getElementById('filterContest');
          r.contests.forEach(c => {
            contestsMap[c.id] = c.name;
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `#${c.id} ${c.name}`;
            sel.appendChild(opt);
          });
        }
      } catch (e) { console.error(e); }
    }

    async function loadTeams() {
      const list = document.getElementById('teamsList');
      list.innerHTML = '<div class="loading-msg"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
      try {
        const contestId = document.getElementById('filterContest').value;
        const url = '/api/teams?action=adminList' + (contestId ? `&contestId=${contestId}` : '');
        const r = await apiCall(url);
        if (!r.success) throw new Error(r.message || 'Load failed');
        allTeams = r.teams || [];
        render();
      } catch (e) {
        list.innerHTML = `<div class="empty-msg" style="color:var(--danger)">Error: ${esc(e.message)}</div>`;
      }
    }

    function render() {
      const q = document.getElementById('filterSearch').value.trim().toLowerCase();
      const filtered = allTeams.filter(t => {
        if (!q) return true;
        const hay = (t.name + ' ' + t.captain + ' ' + (t.members || []).join(' ')).toLowerCase();
        return hay.includes(q);
      });

      const list = document.getElementById('teamsList');
      if (filtered.length === 0) {
        list.innerHTML = '<div class="empty-msg">No teams found.</div>';
        return;
      }

      list.innerHTML = `
        <table class="teams-table">
          <thead><tr>
            <th>Team ID</th>
            <th>Name</th>
            <th>Contest</th>
            <th>Captain</th>
            <th>Members</th>
            <th>Mode</th>
            <th>Status</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            ${filtered.map(t => `
              <tr data-team-id="${t.id}">
                <td><span class="team-id-code">#${t.id}</span></td>
                <td><a href="/teams/${t.id}" target="_blank">${esc(t.name)}</a></td>
                <td>${contestsMap[t.contestId] ? `#${t.contestId} ${esc(contestsMap[t.contestId])}` : `#${t.contestId}`}</td>
                <td>${esc(t.captain)}</td>
                <td>
                  ${(t.members || []).map(m => `<span style="font-family:monospace;font-size:.82rem;${m === t.captain ? 'color:var(--accent);font-weight:700;' : ''}">${esc(m)}</span>`).join(', ')}
                  ${(t.formerMembers || []).length ? `<br><span style="font-size:.75rem;color:var(--text-secondary);text-decoration:line-through;">${t.formerMembers.map(esc).join(', ')}</span>` : ''}
                </td>
                <td><span class="badge mode${t.mode}">Mode ${t.mode}</span></td>
                <td>${t.locked ? '<span class="badge locked">LOCKED</span>' : '<span class="badge team">OPEN</span>'}</td>
                <td>
                  <button class="btn" data-action="rename">Rename</button>
                  <button class="btn danger" data-action="delete">Delete</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      list.querySelectorAll('[data-action="rename"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tr = btn.closest('tr');
          const teamId = Number(tr.dataset.teamId);
          const team = allTeams.find(t => t.id === teamId);
          if (!team) return;
          const name = prompt('New team name (≤30 chars):', team.name);
          if (name === null) return;
          doRename(teamId, name);
        });
      });

      list.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tr = btn.closest('tr');
          const teamId = Number(tr.dataset.teamId);
          const team = allTeams.find(t => t.id === teamId);
          if (!team) return;
          if (!confirm(`Delete team "${team.name}" (#${teamId})?\nThis will remove all submissions and contest results for this team.`)) return;
          doDelete(teamId);
        });
      });
    }

    async function doRename(teamId, name) {
      const clean = String(name).trim();
      if (!clean || clean.length > 30) {
        showMsg('Name must be 1-30 characters', 'error');
        return;
      }
      try {
        const r = await apiCall('/api/teams?action=adminRename', 'POST', { teamId, name: clean });
        if (!r.success) throw new Error(r.message);
        showMsg('Renamed', 'success');
        loadTeams();
      } catch (e) {
        showMsg(e.message, 'error');
      }
    }

    async function doDelete(teamId) {
      try {
        const r = await apiCall('/api/teams?action=adminDelete', 'POST', { teamId });
        if (!r.success) throw new Error(r.message);
        showMsg('Deleted', 'success');
        loadTeams();
      } catch (e) {
        showMsg(e.message, 'error');
      }
    }

    function showMsg(msg, type) {
      const el = document.getElementById('message');
      el.textContent = msg;
      el.style.color = type === 'error' ? 'var(--danger)' : '#2e7d32';
      setTimeout(() => el.textContent = '', 4000);
    }

    document.getElementById('reloadBtn').addEventListener('click', loadTeams);
    document.getElementById('filterContest').addEventListener('change', loadTeams);

    let _searchTimer;
    document.getElementById('filterSearch').addEventListener('input', () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(render, 150);
    });

    (async function init() {
      await loadContests();
      await loadTeams();
    })();
  