
        if (!isLoggedIn()) window.location.href = '/index.html';

        const mainContainer = document.getElementById('mainContent');
        let userStates = {};
        let bookmarks = [];
        let sortBy = 'id';
        let sortOrder = 'asc';

        function escapeHtml(s) { return (window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }; }

        async function loadData() {
            try {
                // 获取解题状态
                const statsRes = await apiCall('/api/users?action=stats');
                if (statsRes.success) userStates = statsRes.states;

                // 获取收藏列表
                const favRes = await apiCall('/api/users?action=favorites');
                if (favRes.success && favRes.favorites.length > 0) {
                    const idsParam = favRes.favorites.join(',');
                    const problemsRes = await apiCall(`/api/problem?ids=${encodeURIComponent(idsParam)}`);
                    if (problemsRes.success && problemsRes.problems) {
                        bookmarks = problemsRes.problems;
                    } else {
                        bookmarks = [];
                    }
                } else {
                    bookmarks = [];
                }
            } catch (err) {
                userStates = {};
                bookmarks = [];
            }
        }

        // 取消收藏函数
        async function unfavorite(problemId) {
            try {
                const res = await apiCall('/api/users?action=favorite', 'POST', { problemId });
                if (res.success) {
                    // 从列表中移除
                    bookmarks = bookmarks.filter(p => p.id !== problemId);
                    renderTable();
                }
            } catch (e) {
                (window.DSHUI ? DSHUI.toast('Error', 'err') : alert('Error'));
            }
        }

        function renderTable() {
            document.title = 'Bookmarked Problems - WYK Maths Team';

            if (bookmarks.length === 0) {
                mainContainer.innerHTML = `<div style="padding:2rem; text-align:center;">
                    <p>No bookmarked problems.</p>
                    <a href="/problems" class="back-link">← Back to Problem Set</a>
                </div>`;
                return;
            }

            // 排序
            bookmarks.sort((a, b) => {
                let valA, valB;
                if (sortBy === 'difficulty') {
                    valA = a.difficulty || 0;
                    valB = b.difficulty || 0;
                } else if (sortBy === 'solves') {
                    valA = a.solves || 0;
                    valB = b.solves || 0;
                } else { // id
                    valA = a.id;
                    valB = b.id;
                    if (typeof valA === 'string' && typeof valB === 'string') {
                        const regex = /^([A-Za-z]*)(\d+)$/;
                        const matchA = valA.match(regex);
                        const matchB = valB.match(regex);
                        if (matchA && matchB) {
                            const prefixA = matchA[1].toLowerCase();
                            const prefixB = matchB[1].toLowerCase();
                            if (prefixA !== prefixB) return sortOrder === 'asc' ? prefixA.localeCompare(prefixB) : prefixB.localeCompare(prefixA);
                            return sortOrder === 'asc' ? parseInt(matchA[2]) - parseInt(matchB[2]) : parseInt(matchB[2]) - parseInt(matchA[2]);
                        }
                    }
                    if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
                    if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
                    return 0;
                }
                if (sortOrder === 'asc') return valA - valB;
                return valB - valA;
            });

            let html = `
                <div style="padding:1rem;">
                    <a href="/problems" class="back-link">← Back to Problem Set</a>
                    <h2 style="margin: 0.5rem 0 1rem;">Bookmarked Problems</h2>
                    <table class="problems-table">
                        <thead><tr>
                            <th style="width:30px;"></th>
                            <th class="sortable" data-sort="id">ID ${sortBy==='id' ? (sortOrder==='asc'?'▲':'▼') : ''}</th>
                            <th>Name</th>
                            <th>Tags</th>
                            <th class="sortable" data-sort="difficulty">Level ${sortBy==='difficulty' ? (sortOrder==='asc'?'▲':'▼') : ''}</th>
                            <th class="sortable" data-sort="solves">Solves ${sortBy==='solves' ? (sortOrder==='asc'?'▲':'▼') : ''}</th>
                        </tr></thead><tbody>`;

            bookmarks.forEach(prob => {
                const state = userStates[prob.id] || 'not_started';
                const rowClass = state === 'failed' ? 'state-failed' : (state === 'passed' ? 'state-passed' : 'state-not_started');
                const statusIcon = state === 'passed' ? '<span style="color:#2e7d32;">✔</span>' : (state === 'failed' ? '<span style="color:#c62828;">✘</span>' : '');

                html += `
                    <tr class="problem-row ${rowClass}" onclick="window.location.href='/problems/${encodeURIComponent(prob.id)}'">
                        <td onclick="event.stopPropagation(); unfavorite('${prob.id}')" class="star-cell">
                            <span class="star-favorite">★</span>
                        </td>
                        <td class="problem-id">${prob.id}</td>
                        <td class="problem-name">${escapeHtml(prob.name)} ${statusIcon}</td>
                        <td class="tags-container">${(prob.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</td>
                        <td class="difficulty">${prob.difficulty===0?'∞':prob.difficulty.toFixed(2)}</td>
                        <td class="solves">${prob.solves||0}</td>
                    </tr>`;
            });
            html += '</tbody></table></div>';

            mainContainer.innerHTML = html;

            // 绑定排序事件
            document.querySelectorAll('.sortable').forEach(th => {
                th.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const field = th.getAttribute('data-sort');
                    if (sortBy === field) sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
                    else { sortBy = field; sortOrder = 'asc'; }
                    renderTable();
                });
            });
        }

        (async function init() {
            await loadData();
            renderTable();
        })();
    