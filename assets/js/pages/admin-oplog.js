
  (function () {
    'use strict';

    if (!isLoggedIn()) { window.location.href = '/index.html'; return; }
    const me = getCurrentUser();
    if (!me || (me.role !== 'admin' && me.role !== 'root')) {
      window.location.href = '/404.html';
      return;
    }

    // ═══════════════ 常數 ═══════════════
    const TIME_RANGES = [
      { v: '1h',  t: 'Last 1 hour',   ms: 60 * 60 * 1000 },
      { v: '6h',  t: 'Last 6 hours',  ms: 6 * 60 * 60 * 1000 },
      { v: '24h', t: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
      { v: '7d',  t: 'Last 7 days',   ms: 7 * 24 * 60 * 60 * 1000 },
      { v: '30d', t: 'Last 30 days',  ms: 30 * 24 * 60 * 60 * 1000 },
    ];

    const COLLECTIONS = [
      { v: '',                 t: 'All Collections' },
      { v: 'submissions',      t: 'Submissions' },
      { v: 'userstats',        t: 'User Stats' },
      { v: 'users',            t: 'Users' },
      { v: 'problems',         t: 'Problems' },
      { v: 'contests',         t: 'Contests' },
      { v: 'contest_results',  t: 'Contest Results' },
      { v: 'updates',          t: 'Announcements' },
      { v: 'audit_logs',       t: 'Audit Logs' },
      { v: 'userdata',         t: 'User Data' },
      { v: 'metadata',         t: 'Metadata' },
      { v: 'teams',            t: 'Teams' },
      { v: 'discussions',      t: 'Discussions' },
      { v: 'reports',          t: 'Reports' },
      { v: 'tr-problems',      t: 'TR Problems' },
    ];

    const state = {
      page: 1,
      limit: 50,
      q: '',
      total: 0,
      totalPages: 1,
      entries: [],
    };

    const mainContent = document.getElementById('mainContent');
    const drawer = document.getElementById('oplogDrawer');

    // ═══════════════ 初始化 ═══════════════
    function init() {
      mainContent.innerHTML = `
        <div class="oplog-wrap">
          <header class="oplog-header">
            <h1><i class="fas fa-history"></i> Activity Timeline</h1>
            <div class="oplog-header-spacer"></div>
            <span class="oplog-stats" id="oplogStats">—</span>
            <button class="oplog-icon-btn" id="oplogRefresh" title="Refresh">
              <i class="fas fa-sync-alt"></i>
            </button>
          </header>

          <div class="oplog-filters">
            <select id="opTimeRange">
              ${TIME_RANGES.map((r, i) =>
                `<option value="${r.v}" ${r.v === '24h' ? 'selected' : ''}>${r.t}</option>`
              ).join('')}
            </select>
            <select id="opCollection">
              ${COLLECTIONS.map(c =>
                `<option value="${c.v}">${c.t}</option>`
              ).join('')}
            </select>
            <select id="opType">
              <option value="">All Operations</option>
              <option value="i">Insert</option>
              <option value="u">Update</option>
              <option value="d">Delete</option>
            </select>
            <input type="text" id="opSearch" placeholder="Search… (username, problemId, subid)"
                   autocomplete="off" spellcheck="false">
          </div>

          <div class="oplog-list" id="oplogList">
            <div class="oplog-loading">
              <i class="fas fa-spinner fa-spin"></i>
              Loading…
            </div>
          </div>

          <div class="oplog-pagination" id="oplogPagination"></div>
        </div>
      `;

      bindFilters();
      loadList();
    }

    // ═══════════════ 事件綁定 ═══════════════
    function bindFilters() {
      const onFilterChange = () => { state.page = 1; loadList(); };

      document.getElementById('opTimeRange').addEventListener('change', onFilterChange);
      document.getElementById('opCollection').addEventListener('change', onFilterChange);
      document.getElementById('opType').addEventListener('change', onFilterChange);

      let searchTimer = null;
      document.getElementById('opSearch').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.q = e.target.value.trim();
          state.page = 1;
          loadList();
        }, 400);
      });

      document.getElementById('oplogRefresh').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        btn.classList.add('spinning');
        loadList().finally(() => {
          setTimeout(() => btn.classList.remove('spinning'), 300);
        });
      });

      drawer.addEventListener('click', (e) => {
        if (e.target === drawer) closeDrawer();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && drawer.classList.contains('open')) {
          closeDrawer();
        }
      });
    }

    // ═══════════════ 載入列表 ═══════════════
    async function loadList() {
      const listEl = document.getElementById('oplogList');
      listEl.innerHTML = `<div class="oplog-loading"><i class="fas fa-spinner fa-spin"></i>Loading…</div>`;

      const tr = document.getElementById('opTimeRange').value;
      const rangeDef = TIME_RANGES.find(r => r.v === tr) || TIME_RANGES[2];
      const until = new Date();
      const since = new Date(until.getTime() - rangeDef.ms);

      const params = new URLSearchParams({
        action: 'list',
        since: since.toISOString(),
        until: until.toISOString(),
        page: state.page,
        limit: state.limit,
      });

      const coll = document.getElementById('opCollection').value;
      const op = document.getElementById('opType').value;
      if (coll) params.set('coll', coll);
      if (op) params.set('op', op);
      if (state.q) params.set('q', state.q);

      try {
        const r = await apiCall('/api/oplog?' + params.toString());
        if (!r.success) throw new Error(r.message || 'Failed');

        state.entries = r.entries || [];
        state.total = r.total || 0;
        state.totalPages = r.totalPages || 1;

        document.getElementById('oplogStats').textContent =
          `${state.total.toLocaleString()} entries`;

        renderList();
        renderPagination();
      } catch (e) {
        listEl.innerHTML = `<div class="oplog-empty">
          <i class="fas fa-triangle-exclamation"></i>
          <div>Failed to load: ${escapeHtml(e.message)}</div>
        </div>`;
      }
    }

    // ═══════════════ 渲染列表 ═══════════════
    function renderList() {
      const listEl = document.getElementById('oplogList');

      if (!state.entries.length) {
        listEl.innerHTML = `<div class="oplog-empty">
          <i class="fas fa-inbox"></i>
          <div>No entries in this range</div>
        </div>`;
        return;
      }

      listEl.innerHTML = state.entries.map(e => {
        const dt = new Date(e.wall || (e.ts.t * 1000));
        const dateStr = fmtDate(dt);
        const timeStr = fmtTime(dt);

        return `
          <div class="oplog-item ${e.category}" data-tskey="${escapeHtml(e.tsKey)}">
            <div class="oplog-time">
              <span class="d">${dateStr}</span>
              <span>${timeStr}</span>
            </div>
            <div class="oplog-icon"><i class="fas ${opIcon(e.op)}"></i></div>
            <div class="oplog-body">
              <div class="oplog-summary">${escapeHtml(e.summary)}</div>
              <div class="oplog-sub">${escapeHtml(e.coll)}${e.actor ? ' · ' + escapeHtml(e.actor) : ''}${e.truncated ? ' · [truncated]' : ''}</div>
            </div>
            <span class="oplog-badge">${opLabel(e.op)}</span>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.oplog-item').forEach(el => {
        el.addEventListener('click', () => openDetail(el.dataset.tskey));
      });
    }

    // ═══════════════ 分頁 ═══════════════
    function renderPagination() {
      const el = document.getElementById('oplogPagination');
      if (state.totalPages <= 1) { el.innerHTML = ''; return; }

      const { page, totalPages } = state;
      const items = computePageItems(page, totalPages, 7);

      let html = `<button class="oplog-page-btn" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>
        <i class="fas fa-chevron-left"></i>
      </button>`;

      for (const it of items) {
        if (it === '…') html += `<span class="oplog-page-info">…</span>`;
        else html += `<button class="oplog-page-btn ${it === page ? 'active' : ''}" data-p="${it}">${it}</button>`;
      }

      html += `<button class="oplog-page-btn" data-p="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>
        <i class="fas fa-chevron-right"></i>
      </button>`;
      html += `<span class="oplog-page-info">${state.total.toLocaleString()} total</span>`;

      el.innerHTML = html;

      el.querySelectorAll('button[data-p]').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = parseInt(btn.dataset.p, 10);
          if (p >= 1 && p <= state.totalPages && p !== state.page) {
            state.page = p;
            loadList();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        });
      });
    }

    function computePageItems(current, total, maxVisible) {
      if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1);
      const inner = maxVisible - 2;
      const half = Math.floor(inner / 2);
      let start = Math.max(2, current - half);
      let end = Math.min(total - 1, start + inner - 1);
      start = Math.max(2, end - inner + 1);
      const items = [1];
      if (start > 2) items.push('…');
      for (let p = start; p <= end; p++) items.push(p);
      if (end < total - 1) items.push('…');
      items.push(total);
      return items;
    }

    // ═══════════════ 詳情抽屜 ═══════════════
    async function openDetail(tsKey) {
      const [t, i] = tsKey.split('-');
      if (!t || i === undefined) return;

      drawer.classList.add('open');
      drawer.innerHTML = `
        <div class="oplog-drawer-head">
          <h3><i class="fas fa-info-circle"></i> Entry Detail</h3>
          <button class="oplog-drawer-close" id="oplogDrawerClose"><i class="fas fa-times"></i></button>
        </div>
        <div class="oplog-drawer-body">
          <div class="oplog-loading"><i class="fas fa-spinner fa-spin"></i>Loading…</div>
        </div>
      `;
      document.getElementById('oplogDrawerClose').onclick = closeDrawer;

      try {
        const r = await apiCall(`/api/oplog?action=detail&t=${encodeURIComponent(t)}&i=${encodeURIComponent(i)}`);
        if (!r.success) throw new Error(r.message);
        renderDetail(r.entry, r.related || []);
      } catch (e) {
        drawer.querySelector('.oplog-drawer-body').innerHTML = `
          <div class="oplog-empty">
            <i class="fas fa-triangle-exclamation"></i>
            <div>${escapeHtml(e.message)}</div>
          </div>`;
      }
    }

    function renderDetail(entry, related) {
      const dt = new Date(entry.wall || (entry.ts.t * 1000));

      let html = `
        <div class="oplog-drawer-head">
          <h3><i class="fas ${opIcon(entry.op)}"></i> ${opLabel(entry.op)}</h3>
          <button class="oplog-drawer-close" id="oplogDrawerClose"><i class="fas fa-times"></i></button>
        </div>
        <div class="oplog-drawer-body">
          <div class="oplog-detail-section">
            <div class="oplog-detail-label">Time</div>
            <div class="oplog-detail-value">${dt.toISOString()}</div>
          </div>
          <div class="oplog-detail-section">
            <div class="oplog-detail-label">Namespace</div>
            <div class="oplog-detail-value">${escapeHtml(entry.ns)}</div>
          </div>
          <div class="oplog-detail-section">
            <div class="oplog-detail-label">Summary</div>
            <div class="oplog-detail-value">${escapeHtml(entry.summary)}</div>
          </div>
          ${entry.actor ? `
            <div class="oplog-detail-section">
              <div class="oplog-detail-label">Actor</div>
              <div class="oplog-detail-value">${escapeHtml(entry.actor)}</div>
            </div>
          ` : ''}
          ${entry.lsid ? `
            <div class="oplog-detail-section">
              <div class="oplog-detail-label">Session (lsid)</div>
              <div class="oplog-detail-value" style="font-size:.72rem">${escapeHtml(entry.lsid)}</div>
            </div>
          ` : ''}

          <div class="oplog-detail-section">
            <div class="oplog-detail-label">
              o ${entry.truncated ? '(truncated)' : ''}
            </div>
            <pre class="oplog-json">${escapeHtml(JSON.stringify(entry.o, null, 2))}</pre>
          </div>

          ${entry.o2 && Object.keys(entry.o2).length ? `
            <div class="oplog-detail-section">
              <div class="oplog-detail-label">o2</div>
              <pre class="oplog-json">${escapeHtml(JSON.stringify(entry.o2, null, 2))}</pre>
            </div>
          ` : ''}

          <div class="oplog-detail-section">
            <button class="oplog-page-btn" id="oplogCopyJson" style="width:100%;">
              <i class="fas fa-copy"></i> Copy JSON
            </button>
          </div>

          ${related.length ? `
            <div class="oplog-detail-section">
              <div class="oplog-detail-label">Related (${related.length})</div>
              ${related.map(r => {
                const rdt = new Date(r.wall || (r.ts.t * 1000));
                return `<div class="oplog-related-item ${r.category}">
                  <span style="font-family:'Consolas',monospace;color:var(--text-secondary);">${fmtDate(rdt)} ${fmtTime(rdt)}</span>
                  <span style="margin-left:8px;">${escapeHtml(r.summary)}</span>
                </div>`;
              }).join('')}
            </div>
          ` : ''}
        </div>
      `;

      drawer.innerHTML = html;
      document.getElementById('oplogDrawerClose').onclick = closeDrawer;
      document.getElementById('oplogCopyJson').onclick = async () => {
        const btn = document.getElementById('oplogCopyJson');
        try {
          await navigator.clipboard.writeText(JSON.stringify({ o: entry.o, o2: entry.o2 }, null, 2));
          btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
          setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy JSON'; }, 1500);
        } catch (e) {
          (window.DSHUI ? DSHUI.toast('Copy failed: ' + e.message, 'err') : alert('Copy failed: ' + e.message));
        }
      };
    }

    function closeDrawer() {
      drawer.classList.remove('open');
    }

    // ═══════════════ 工具 ═══════════════
    function opIcon(op) {
      return { i: 'fa-plus', u: 'fa-pen', d: 'fa-trash', c: 'fa-terminal' }[op] || 'fa-circle';
    }
    function opLabel(op) {
      return { i: 'Insert', u: 'Update', d: 'Delete', c: 'Cmd' }[op] || op;
    }
    function fmtTime(d) {
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }
    function fmtDate(d) {
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    function escapeHtml(s) { return (window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }; }

    init();
  })();
  