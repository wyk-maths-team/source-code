
    (function() {
      if (!isLoggedIn()) window.location.href = '/index.html';

      const mainContainer = document.getElementById('mainContent');
      const currentUser = getCurrentUser() || {};
      const currentUsername = currentUser.username || '';

      // ---- 从 URL 推断初始过滤条件 ----
      function getInitialFilters() {
        const params = new URLSearchParams(window.location.search);
        const path = window.location.pathname;
        let user = params.get('user') || '';
        let problem = params.get('problem') || '';
        let result = params.get('result') || '';

        const userMatch = path.match(/^\/submissions\/user\/(.+)$/);
        const problemMatch = path.match(/^\/submissions\/problem\/(.+)$/);
        if (userMatch) user = decodeURIComponent(userMatch[1]);
        if (problemMatch) problem = decodeURIComponent(problemMatch[1]);

        return { user, problem, result, page: Math.max(1, parseInt(params.get('page')) || 1) };
      }

      const state = getInitialFilters();
      state.hasMore = null;
      state.pagesCache = new Map();
      state.pagesInflight = new Map();
      state.maxPage = null;                  // ⭐ 已知存在的最大頁碼（null = 未知）
      let lastQuerySnapshot = null;

      // ---- 工具函数 ----
      function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }
      function statusClass(statusText) {
        if (statusText === 'Accepted') return 'status-accepted';
        if (statusText === 'Wrong Answer') return 'status-wrong';
        if (statusText.startsWith('Partial Score')) return 'status-partial';
        if (statusText === 'Pending') return 'status-pending';
        if (statusText === 'System Error') return 'status-system';
        return 'status-system';
      }
      function makeSnapshot() {
        return JSON.stringify({
          user: state.user,
          problem: state.problem,
          result: state.result,
          page: state.page
        });
      }
      // HKOI 同款时间格式：YYYY-MM-DD HH:MM:SS（Asia/Hong_Kong, UTC+8）
      function formatTime(ts) {
        const d = new Date(ts);
        const pad = n => String(n).padStart(2, '0');
        const localTime = d.getTime() + 8 * 3600000;
        const localDate = new Date(localTime);
        return `${localDate.getUTCFullYear()}-${pad(localDate.getUTCMonth() + 1)}-${pad(localDate.getUTCDate())} ` +
               `${pad(localDate.getUTCHours())}:${pad(localDate.getUTCMinutes())}:${pad(localDate.getUTCSeconds())}`;
      }

      const RESULT_LABELS = {
        accepted: 'Accepted',
        wrong: 'Wrong Answer',
        partial: 'Partial Score',
        pending: 'Pending',
        system: 'System Error'
      };

      // ---- 过滤器单元格渲染（有值显示文字，无值显示输入框） ----
      function renderUserFilterCell() {
        if (state.user) {
          return `
            <div class="filter-current">
              User: <b>${escapeHtml(state.user)}</b>
              <button type="button" class="btn-remove" data-clear="user" title="Clear">
                <i class="fas fa-times"></i>
              </button>
            </div>`;
        }
        return `
          <form class="adv-filter-form" id="formUser" autocomplete="off">
            <input type="text" id="filterUser" placeholder="Username" value="">
            <div class="adv-filter-buttons">
              <button type="submit" class="btn-apply">Apply</button>
              <button type="button" class="btn-self" id="selfBtn">Self</button>
            </div>
          </form>`;
      }

      function renderProblemFilterCell() {
        if (state.problem) {
          return `
            <div class="filter-current">
              Problem: <b>${escapeHtml(state.problem)}</b>
              <button type="button" class="btn-remove" data-clear="problem" title="Clear">
                <i class="fas fa-times"></i>
              </button>
            </div>`;
        }
        return `
          <form class="adv-filter-form" id="formProblem" autocomplete="off">
            <input type="text" id="filterProblem" placeholder="Problem ID" value="">
            <div class="adv-filter-buttons">
              <button type="submit" class="btn-apply">Apply</button>
            </div>
          </form>`;
      }

      function renderResultFilterCell() {
        if (state.result) {
          return `
            <div class="filter-current">
              Result: <b>${escapeHtml(RESULT_LABELS[state.result] || state.result)}</b>
              <button type="button" class="btn-remove" data-clear="result" title="Clear">
                <i class="fas fa-times"></i>
              </button>
            </div>`;
        }
        return `
          <form class="adv-filter-form" id="formResult" autocomplete="off">
            <select id="filterResult">
              <option value="">All</option>
              <option value="accepted">Accepted</option>
              <option value="wrong">Wrong Answer</option>
              <option value="partial">Partial Score</option>
              <option value="pending">Pending</option>
              <option value="system">System Error</option>
            </select>
            <div class="adv-filter-buttons">
              <button type="submit" class="btn-apply">Apply</button>
            </div>
          </form>`;
      }
      

// ---- 渲染过滤头部 HTML（資料由 /api/submissions 的 header 欄位帶入）----
function buildFilterHeader(header) {
  let html = '';
  const info = header || {};

  if (state.problem) {
    const p = info.problem || {};
    const name = p.name || state.problem;
    const difficulty = p.difficulty ?? 0;
    const difficultyStr = difficulty === 0 ? '∞' : difficulty.toFixed(2);

    html += `
      <div class="filter-header">
        <h2>
          <a href="/problems/${encodeURIComponent(state.problem)}">${escapeHtml(name)}</a>
        </h2>
        <div class="filter-meta">
          <span class="meta-btn">${escapeHtml(state.problem)}</span>
          <span class="meta-btn">Difficulty: ${difficultyStr}</span>
          <a href="/problems/${encodeURIComponent(state.problem)}" class="meta-btn info">View Problem</a>
        </div>
      </div>
    `;
  }

  if (state.user) {
    const u = info.user || {};
    const realName = u.realName || '';
    const displayName = u.displayName || state.user;
    const title = realName || displayName;   // ⭐ 優先顯示真名
    const pfp = u.pfp || '';
    const avatarHtml = pfp ? `<img src="${escapeHtml(pfp)}" class="profile-40" alt="avatar">` : '';

    html += `
      <div class="filter-header">
        <h2>
          <a href="/users/${encodeURIComponent(state.user)}">
            ${avatarHtml}
            ${escapeHtml(title)}
          </a>
        </h2>
        <div class="filter-meta">
          <span class="meta-btn">Username: ${escapeHtml(state.user)}</span>
          ${realName && displayName !== realName ? `<span class="meta-btn">Display: ${escapeHtml(displayName)}</span>` : ''}
          <a href="/submissions/user/${encodeURIComponent(state.user)}" class="meta-btn info">Submissions</a>
          <a href="/users/${encodeURIComponent(state.user)}" class="meta-btn purple">Profile</a>
        </div>
      </div>
    `;
  }
  return html;
}
      // ---- 渲染布局 ----
      function renderLayout(headerHtml = '') {
  mainContainer.innerHTML = `
    <div class="submissions-wrapper">
      <div class="header-actions">
        <h2>Submissions</h2>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <button id="refreshSubmissionsBtn" title="Refresh"><i class="fas fa-sync-alt"></i></button>
          <button class="btn" id="resetFiltersBtn">Reset Filters</button>
        </div>
      </div>

      ${headerHtml}

      <div class="pagination-nav" id="paginationTop"></div>

      <div class="table-responsive">
        <table class="submissions-table">
          <thead>
            <tr>
              <th class="col-datetime">Date / Time</th>
              <th class="col-user left-align">
                User
                ${renderUserFilterCell()}
              </th>
              <th class="col-problem left-align">
                Problem
                ${renderProblemFilterCell()}
              </th>
              <th class="col-answer">Answer</th>
              <th class="col-status">
                Result
                ${renderResultFilterCell()}
              </th>
            </tr>
          </thead>
          <tbody id="submissionsBody"></tbody>
        </table>
      </div>

      <div class="pagination-nav" id="paginationBottom"></div>
    </div>
  `;
  bindFilterEvents();
}
      function bindFilterEvents() {
        const formUser = document.getElementById('formUser');
        if (formUser) {
          formUser.addEventListener('submit', e => {
            e.preventDefault();
            state.user = document.getElementById('filterUser').value.trim();
            state.page = 1;
            applyFilters();
          });
        }
        const formProblem = document.getElementById('formProblem');
        if (formProblem) {
          formProblem.addEventListener('submit', e => {
            e.preventDefault();
            state.problem = document.getElementById('filterProblem').value.trim();
            state.page = 1;
            applyFilters();
          });
        }
        const formResult = document.getElementById('formResult');
        if (formResult) {
          formResult.addEventListener('submit', e => {
            e.preventDefault();
            state.result = document.getElementById('filterResult').value;
            state.page = 1;
            applyFilters();
          });
        }
        const selfBtn = document.getElementById('selfBtn');
        if (selfBtn) {
          selfBtn.addEventListener('click', () => {
            state.user = currentUsername;
            state.page = 1;
            applyFilters();
          });
        }

        document.querySelectorAll('.btn-remove[data-clear]').forEach(btn => {
          btn.addEventListener('click', () => {
            const field = btn.dataset.clear;
            if (field === 'user') state.user = '';
            else if (field === 'problem') state.problem = '';
            else if (field === 'result') state.result = '';
            state.page = 1;
            applyFilters();
          });
        });

        const refreshBtn = document.getElementById('refreshSubmissionsBtn');
        refreshBtn.addEventListener('click', async () => {
          if (refreshBtn.disabled) return;
          refreshBtn.disabled = true;
          refreshBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>';
          try {
            await loadSubmissions();
          } finally {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i>';
          }
        });

        document.getElementById('resetFiltersBtn').addEventListener('click', resetFilters);
      }

      // ---- 数据认证：快照相同则不查询 ----
      function applyFilters() {
  updateURL();
  const snap = makeSnapshot();
  if (snap === lastQuerySnapshot) return;
  // 条件变了才重绘过滤栏（因为过滤栏本身显示状态会变）
  renderLayout();
  loadSubmissions();
}

      function resetFilters() {
        state.user = '';
        state.problem = '';
        state.result = '';
        state.page = 1;
        applyFilters();  // 内部有快照校验，无变化时不查询
      }

      // ---- URL 同步 ----
        function updateURL() {
        const params = new URLSearchParams();
        let path = '/submissions';

        // 只过滤 user → /submissions/user/xxx
        if (state.user && !state.problem && !state.result) {
          path = `/submissions/user/${encodeURIComponent(state.user)}`;
        }
        // 只过滤 problem → /submissions/problem/xxx
        else if (state.problem && !state.user && !state.result) {
          path = `/submissions/problem/${encodeURIComponent(state.problem)}`;
        }
        // 其他情况保留 query string
        else {
          if (state.user) params.set('user', state.user);
          if (state.problem) params.set('problem', state.problem);
          if (state.result) params.set('result', state.result);
        }

        if (state.page > 1) params.set('page', state.page);

        const qs = params.toString();
        window.history.replaceState({}, '', qs ? `${path}?${qs}` : path);
      }
      // ---- 加载数据（單次 API，header 內嵌） ----
// ---- 記錄上次成功載入的過濾條件 ----
// 相同 → 內部刷新（overlay + fade）
// 不同 → 全新載入（清空 + loading icon）
      let _lastFilterKey = null;

      function getFilterKey() {
        return [state.user || '', state.problem || '', state.result || ''].join('|');
      }
      // ⭐ 更新已知最大頁碼
      // - 有資料 + hasMore=false → page 就是最後一頁
      // - 有資料 + hasMore=true  → 至少 page+1 存在
      // - 空資料                 → page 超出範圍（page-1 是最大頁）
      function updateMaxPage(page, data) {
        if (!data || !Array.isArray(data.submissions)) return;
        if (data.submissions.length > 0) {
          if (data.hasMore === false) {
            state.maxPage = page;             // 明確的最後一頁
          } else if (data.hasMore === true) {
            state.maxPage = Math.max(state.maxPage ?? 0, page + 1);
          }
        } else if (page > 1) {
          state.maxPage = Math.min(state.maxPage ?? Infinity, page - 1);
        }
      }

      // ---- 更新 filter-header 區塊 ----
      function updateFilterHeader(header) {
        const headerHtml = buildFilterHeader(header);
        const wrapper = document.querySelector('.submissions-wrapper');
        if (!wrapper) return;
        wrapper.querySelectorAll('.filter-header').forEach(el => el.remove());
        if (headerHtml) {
          const headerActions = wrapper.querySelector('.header-actions');
          if (headerActions) {
            headerActions.insertAdjacentHTML('afterend', headerHtml);
          }
        }
      }
      // ⭐ 單頁請求（含 in-flight 去重）
      function fetchPage(page) {
        if (state.pagesInflight.has(page)) return state.pagesInflight.get(page);

        const params = new URLSearchParams({
          all: '1', page, limit: 50, includeHeader: '1'
        });
        if (state.user) params.set('user', state.user);
        if (state.problem) params.set('problem', state.problem);
        if (state.result) params.set('result', state.result);

        const promise = apiCall(`/api/submissions?${params.toString()}`)
          .then(data => {
            if (!data.success) throw new Error(data.message || 'Failed');
            return data;
          })
          .finally(() => {
            state.pagesInflight.delete(page);
          });

        state.pagesInflight.set(page, promise);
        return promise;
      }

      // ⭐ 背景預加載：page+1 / page+2
      function prefetchNearby(currentPage) {
        const targets = [currentPage + 1, currentPage + 2].filter(p => p >= 1);
        for (const p of targets) {
          if (state.pagesCache.has(p) || state.pagesInflight.has(p)) continue;
          fetchPage(p)
            .then(data => {
              state.pagesCache.set(p, data);
              updateMaxPage(p, data);            // ⭐ 讓預加載也回報邊界
            })
            .catch(() => { /* 靜默失敗 */ });
        }
      }
      async function loadSubmissions() {
        const tbody = document.getElementById('submissionsBody');
        if (!tbody) return;

        const currentKey = getFilterKey();

        // ⭐ filter 變了 → 清空快取
        if (_lastFilterKey !== null && _lastFilterKey !== currentKey) {
          state.pagesCache.clear();
          state.pagesInflight.clear();
          state.hasMore = null;
          state.maxPage = null;
        }

        // ⭐ 快取命中 → 直接套用，零網絡請求
        const cached = state.pagesCache.get(state.page);
        if (cached && _lastFilterKey === currentKey) {
          state.hasMore = cached.hasMore;         // ⭐ 同步狀態
          updateMaxPage(state.page, cached);
          updateFilterHeader(cached.header);
          renderTable(cached.submissions);
          renderPagination(cached.page, cached.hasMore);
          _lastFilterKey = currentKey;
          return;
        }

        // ⭐ 判斷是否套遮罩：已有內容 → 遮罩；空表 → 30 行骨架屏
        const tableWrap = document.querySelector('.table-responsive');
        const hasRows = !!tbody.querySelector('tr');

        if (hasRows) {
          tableWrap.classList.add('loading');
        } else {
          tbody.innerHTML = renderSkeletonRows(30);
        }

        try {
          const data = await fetchPage(state.page);
          state.pagesCache.set(state.page, data);
          state.hasMore = data.hasMore;
          updateMaxPage(state.page, data);

          updateFilterHeader(data.header);
          renderTable(data.submissions);
          renderPagination(data.page, data.hasMore);

          _lastFilterKey = currentKey;

          // ⭐ 背景預加載鄰近頁
          prefetchNearby(state.page);
        } catch (err) {
          console.error(err);
          if (!hasRows) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--danger);">Failed to load.</td></tr>';
          }
        } finally {
          if (tableWrap) tableWrap.classList.remove('loading');
        }
      }
      // ⭐ 30 行骨架屏
      function renderSkeletonRows(count = 30) {
        const widths = [
          ['80%', 'col-datetime'],
          ['70%', 'col-user left-align'],
          ['90%', 'col-problem left-align'],
          ['60%', 'col-answer'],
          ['50%', 'col-status'],
        ];
        let html = '';
        for (let i = 0; i < count; i++) {
          html += '<tr class="skeleton-row">';
          for (const [w, cls] of widths) {
            html += `<td class="${cls}"><span class="skeleton-line" style="width:${w}"></span></td>`;
          }
          html += '</tr>';
        }
        return html;
      }
      // ⭐ 答案欄位渲染：長度 > 20 加折疊
const ANSWER_COLLAPSE_THRESHOLD = 20;

function renderAnswerCell(s) {
  if (s.type === 'image') {
    return '<i>Image</i>';
  }
  if (s.answerHidden) {
    return '<span class="answer-hidden" style="color:var(--text-secondary);font-style:italic;">Hidden</span>';
  }

  const txt = String(s.answer == null ? '-' : s.answer);
  if (txt.length <= ANSWER_COLLAPSE_THRESHOLD) {
    return escapeHtml(txt);
  }

  const preview = txt.slice(0, ANSWER_COLLAPSE_THRESHOLD);
  return `<span class="answer-toggle" data-expanded="false" title="Click to expand">` +
           `<span class="answer-preview">${escapeHtml(preview)}…</span>` +
           `<span class="answer-full">${escapeHtml(txt)}</span>` +
         `</span>`;
}
      // ---- 渲染表格 ----
      function renderTable(submissions) {
        const tbody = document.getElementById('submissionsBody');
        if (!submissions || submissions.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="loading-msg">No submissions found.</td></tr>';
          return;
        }
        let html = '';
        submissions.forEach(s => {
          const time = formatTime(s.timestamp);
          const statusText = s.status || 'Pending';
          const cls = statusClass(statusText);
          const subId = s.subid || '-';
          const problemDisplay = `${escapeHtml(s.problemId)} - ${escapeHtml(s.problemName || '')}`;
          const isMine = currentUsername && s.username === currentUsername;
          const answerHtml = renderAnswerCell(s);
          html += `<tr${isMine ? ' class="mine"' : ''}>
            <td class="col-datetime"><a href="/submissions/${encodeURIComponent(subId)}/detail">${time}</a></td>
            <td class="col-user left-align">
              <a href="/users/${encodeURIComponent(s.username)}">${escapeHtml(s.username)} - ${escapeHtml(s.displayName || s.username)}</a>
            </td>
            <td class="col-problem left-align">
              <a href="/problems/${encodeURIComponent(s.problemId)}">${problemDisplay}</a>
            </td>
            <td class="col-answer">${answerHtml}</td>
            <td class="col-status"><span class="status-badge ${cls}">${escapeHtml(statusText)}</span></td>
          </tr>`;
        });
        tbody.innerHTML = html;
      }

      // ---- 渲染分页 ----
      // ⭐ 依視窗寬度決定最多顯示幾個頁碼
      function getMaxVisiblePages() {
        const w = window.innerWidth;
        if (w < 400) return 5;
        if (w < 600) return 7;
        return 9;
      }


      function renderPagination(page, hasMore) {
        window.__lastPagination = { page, hasMore };

        const render = (container) => {
          if (!container) return;

          const maxVisible = getMaxVisiblePages();
          const half = Math.max(1, Math.floor(maxVisible / 2) - 1);
          const start = Math.max(1, page - half);

          // ⭐ 上限：page + half，但不超過已知最大頁
          let end = page + half;
          if (state.maxPage != null) end = Math.min(end, state.maxPage);
          if (hasMore === false) end = Math.min(end, page);
          end = Math.max(end, page);   // 至少包含當前頁

          const items = [];

          if (start > 1) {
            items.push(1);
            if (start > 2) items.push('…');
          }

          for (let p = start; p <= end; p++) items.push(p);

          // ⭐ 尾部省略號：只在「確實還有後續頁」時顯示
          const hasMoreBeyond = (state.maxPage != null)
            ? state.maxPage > end
            : hasMore === true;
          if (hasMoreBeyond) items.push('…');

          let html = '<ul class="pagination-list">';

          // 上一頁
          html += `<li class="page-item ${page <= 1 ? 'disabled' : ''}">
            <span class="page-link arrow" ${page > 1 ? `onclick="goToPage(${page - 1})"` : ''}>‹</span>
          </li>`;

          // 頁碼 / 省略號
          for (const it of items) {
            if (it === '…') {
              html += `<li class="page-item ellipsis"><span class="page-link">…</span></li>`;
            } else if (it === page) {
              html += `<li class="page-item active"><span class="page-link">${it}</span></li>`;
            } else {
              html += `<li class="page-item"><span class="page-link" onclick="goToPage(${it})">${it}</span></li>`;
            }
          }

          // ⭐ 下一頁：hasMore=false 或已達已知最大頁 → 禁用
          const nextDisabled = hasMore === false
            || (state.maxPage != null && page >= state.maxPage);
          html += `<li class="page-item ${nextDisabled ? 'disabled' : ''}">
            <span class="page-link arrow" ${!nextDisabled ? `onclick="goToPage(${page + 1})"` : ''}>›</span>
          </li>`;

          html += '</ul>';
          container.innerHTML = html;
        };

        render(document.getElementById('paginationTop'));
        render(document.getElementById('paginationBottom'));
      }

      window.goToPage = function(newPage) {
        if (newPage === state.page) return;
        state.page = newPage;
        updateURL();
        loadSubmissions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };// ⭐ 視窗大小改變時重新渲染分頁（因為 maxVisible 變了）
      let _paginationResizeTimer = null;
      window.addEventListener('resize', () => {
        if (_paginationResizeTimer) clearTimeout(_paginationResizeTimer);
        _paginationResizeTimer = setTimeout(() => {
          const last = window.__lastPagination;
          if (last && document.getElementById('paginationTop')) {
            renderPagination(last.page, last.hasMore);
          }
        }, 200);
      });
      // ⭐ 事件委託：點擊折疊答案
      document.addEventListener('click', (e) => {
        const toggle = e.target.closest('.answer-toggle');
        if (!toggle) return;
        // 避免點在 <a> 或其他互動元素上時誤觸
        if (e.target.closest('a')) return;

        const expanded = toggle.dataset.expanded === 'true';
        toggle.dataset.expanded = expanded ? 'false' : 'true';
      });
      // ---- 启动 ----
      renderLayout();
      loadSubmissions();
    })();
  