
(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // [0] Icon registry
  // ═══════════════════════════════════════════════════════════
  const ICON = {
    // Header
    health:    'fa-solid fa-heart-pulse',
    play:      'fa-solid fa-play',
    reset:     'fa-solid fa-rotate-right',
    spinner:   'fa-solid fa-spinner fa-spin',
    warning:   'fa-solid fa-triangle-exclamation',
    shield:    'fa-solid fa-shield-halved',
    bolt:      'fa-solid fa-bolt',
    bug:       'fa-solid fa-bug',
    flask:     'fa-solid fa-flask',
    terminal:  'fa-solid fa-terminal',
    gauge:     'fa-solid fa-gauge-high',
    fileCode:  'fa-solid fa-file-code',
    paper:     'fa-solid fa-paper-plane',
    bullhorn:  'fa-solid fa-bullhorn',

    // Stats
    passed:    'fa-solid fa-circle-check',
    warn:      'fa-solid fa-triangle-exclamation',
    failed:    'fa-solid fa-circle-xmark',
    untested:  'fa-solid fa-circle-question',
    time:      'fa-solid fa-stopwatch',

    // Filters
    filter:    'fa-solid fa-filter',
    search:    'fa-solid fa-magnifying-glass',

    // HTTP methods
    GET:    'fa-solid fa-download',
    POST:   'fa-solid fa-upload',
    PUT:    'fa-solid fa-pen',
    DELETE: 'fa-solid fa-trash',

    // Auth
    'admin': 'fa-solid fa-shield-halved',
    'user':  'fa-solid fa-user',
    'none':  'fa-solid fa-lock-open',

    // Buttons
    copy:   'fa-solid fa-copy',
    check:  'fa-solid fa-check',
    xmark:  'fa-solid fa-xmark',
    eraser: 'fa-solid fa-eraser',
    info:   'fa-solid fa-circle-info',
    clock:  'fa-solid fa-clock',

    // Groups
    'System':     'fa-solid fa-server',
    'User':       'fa-solid fa-user',
    'Problem':    'fa-solid fa-file-code',
    'Submission': 'fa-solid fa-paper-plane',
    'Contest':    'fa-solid fa-trophy',
    'Updates':    'fa-solid fa-bullhorn',
    'Charts':     'fa-solid fa-chart-line',
    'PK':         'fa-solid fa-bolt',
    'Heartbeat':  'fa-solid fa-heart-pulse',
    'Admin':      'fa-solid fa-shield-halved',
    'iGEM':       'fa-solid fa-flask',
    'TR':         'fa-solid fa-flask-vial',
    'Auth':       'fa-solid fa-key',
    'Oplog':      'fa-solid fa-list-timeline',
  };

  // ═══════════════════════════════════════════════════════════
  // [1] Endpoint catalog
  // ═══════════════════════════════════════════════════════════
  const ENDPOINTS = [
    // ── System ──
    { group: 'System', name: 'System Status',   method: 'GET', url: '/api/status?action=system',  auth: 'admin', safe: true, desc: 'DB / collections / Cloudinary usage' },
    { group: 'System', name: 'Vercel Usage',    method: 'GET', url: '/api/status?action=vercel',  auth: 'admin', safe: true, desc: '30-day usage summary' },

    // ── Auth ──
    { group: 'Auth', name: 'Cron (no token)',   method: 'GET', url: '/api/cron?action=dailyBackup', auth: 'none', safe: true, desc: 'Expect 401 — verifies CRON_SECRET gate works' },

    // ── User ──
    { group: 'User', name: 'Current User Stats', method: 'GET', url: '/api/users?action=stats',              auth: 'user', safe: true, desc: 'Your own solve states' },
    { group: 'User', name: 'Preload',            method: 'GET', url: '/api/users?action=preload',            auth: 'user', safe: true, desc: 'States + favorites preload' },
    { group: 'User', name: 'Leaderboard',        method: 'GET', url: '/api/users?action=leaderboard',        auth: 'user', safe: true, desc: 'Global leaderboard' },
    { group: 'User', name: 'Achievement Stats',  method: 'GET', url: '/api/users?action=achievementsStats',  auth: 'user', safe: true, desc: 'Site-wide unlock rates' },
    { group: 'User', name: 'My Achievements',    method: 'GET', url: '/api/users?action=achievements',       auth: 'user', safe: true, desc: 'Your achievement list' },
    { group: 'User', name: 'Favorites',          method: 'GET', url: '/api/users?action=favorites',          auth: 'user', safe: true, desc: 'Your bookmarked problem IDs' },
    { group: 'User', name: 'User Profile',       method: 'GET', url: '/api/users?action=profile&username=__SELF__', auth: 'user', safe: true, desc: '__SELF__ → current username' },
    { group: 'User', name: 'Fetch PFP (batch)',  method: 'GET', url: '/api/users?action=pfp&usernames=__SELF__', auth: 'user', safe: true, desc: 'Batch PFP lookup' },

    // ── Problem ──
    { group: 'Problem', name: 'Problem List',   method: 'GET', url: '/api/problem?page=1&limit=5',       auth: 'user', safe: true, desc: 'Paginated list' },
    { group: 'Problem', name: 'ID List',        method: 'GET', url: '/api/problem?ids=1',                auth: 'user', safe: true, desc: 'All problem IDs (lightweight)' },
    { group: 'Problem', name: 'Full Dump',      method: 'GET', url: '/api/problem?all=1',                auth: 'user', safe: true, desc: 'All problems + solve counts + tags' },
    { group: 'Problem', name: 'Version Check',  method: 'GET', url: '/api/problem?checkVersion=1',       auth: 'user', safe: true, desc: 'Optimistic-lock version' },
    { group: 'Problem', name: 'Problem Detail', method: 'GET', url: '/api/problem?action=page&id=HA2501', auth: 'user', safe: true, desc: 'Replace id with a real problem' },
    { group: 'Problem', name: 'Similar Problems', method: 'GET', url: '/api/problem?action=similar&id=HA2501', auth: 'user', safe: true, desc: 'Tag-similar problem list' },

    // ── Submission ──
    { group: 'Submission', name: 'My Submissions',     method: 'GET', url: '/api/submissions?page=1&limit=5',   auth: 'user', safe: true, desc: 'Your recent submissions' },
    { group: 'Submission', name: 'Admin Submission List', method: 'GET', url: '/api/submissions?admin=1&limit=5', auth: 'admin', safe: true, desc: 'Requires admin' },
    { group: 'Submission', name: 'Pending Images',     method: 'GET', url: '/api/admin?action=markerList',      auth: 'admin', safe: true, desc: 'Image submission queue' },

    // ── Contest ──
    { group: 'Contest', name: 'Contest List',   method: 'GET', url: '/api/contests?action=list&page=1&limit=5', auth: 'user', safe: true },
    { group: 'Contest', name: 'Contest Detail', method: 'GET', url: '/api/contests?action=page&id=1',           auth: 'user', safe: true, desc: 'Replace id if 1 is missing' },

    // ── Updates ──
    { group: 'Updates', name: 'All Announcements', method: 'GET', url: '/api/updates', auth: 'none', safe: true, desc: 'Public, no auth required' },

    // ── Charts ──
    { group: 'Charts', name: 'Solve Curve', method: 'GET', url: '/api/charts', auth: 'user', safe: true, desc: '24-hour cached' },

    // ── PK ──
    { group: 'PK', name: 'Pending Invites', method: 'GET', url: '/api/pk?action=pending', auth: 'user', safe: true },

    // ── Heartbeat ──
    { group: 'Heartbeat', name: 'Heartbeat', method: 'POST', url: '/api/heartbeat', auth: 'user', safe: true, desc: 'Updates lastSeenAt (harmless)', body: null },

    // ── Admin ──
    { group: 'Admin', name: 'Audit Logs',        method: 'GET', url: '/api/admin?action=logs&page=1&limit=5', auth: 'admin', safe: true },
    { group: 'Admin', name: 'Backup List',       method: 'GET', url: '/api/admin?action=listBackups',          auth: 'admin', safe: true },
    { group: 'Admin', name: 'PK Problem List',   method: 'GET', url: '/api/admin-pkproblem?action=list&page=1&limit=5', auth: 'admin', safe: true, desc: 'PK problem catalog' },

    // ── Oplog ──
    // { group: 'Oplog', name: 'Recent Writes', method: 'GET', url: '/api/oplog?action=list&limit=5',  auth: 'admin', safe: true, desc: 'Last 24h, newest first' },
    // { group: 'Oplog', name: 'Oplog Stats',   method: 'GET', url: '/api/oplog?action=stats',          auth: 'admin', safe: true, desc: 'DB size + oplog window' },

    // ── iGEM ──
    // { group: 'iGEM', name: 'Report List', method: 'GET', url: '/api/igemreport', auth: 'user', safe: true },

    // ── TR ──
    { group: 'TR', name: 'whoami',       method: 'GET', url: '/api/tr-problems?action=whoami',              auth: 'user', safe: true },
    { group: 'TR', name: 'List (paged)', method: 'GET', url: '/api/tr-problems?action=list&page=1&limit=5', auth: 'user', safe: true },
    { group: 'TR', name: 'List All',     method: 'GET', url: '/api/tr-problems?action=list-all',            auth: 'user', safe: true },
    { group: 'TR', name: 'Stats',        method: 'GET', url: '/api/tr-problems?action=stats',              auth: 'user', safe: true, desc: 'Counts by level / difficulty / category' },
  ];

  // ═══════════════════════════════════════════════════════════
  // [2] Workflows
  // ═══════════════════════════════════════════════════════════
  const WORKFLOWS = [
    {
      id: 'problem-crud',
      icon: 'fa-solid fa-file-circle-plus',
      name: 'Problem Lifecycle (CRUD)',
      desc: 'Create a temp problem → read it back → delete it → verify it is gone',
      steps: [
        {
          name: 'Create test problem',
          method: 'POST', url: '/api/problem?action=adminProblems',
          body: {
            id: '{{TEST_ID}}', name: 'Health Check Test',
            statement: 'Auto-generated by health check. Safe to delete.',
            ans: '1', difficulty: 1, tags: ['_healthcheck'], public: false,
          },
          expectStatus: [200, 201],
        },
        {
          name: 'Read it back',
          method: 'GET', url: '/api/problem?action=adminProblems&id={{TEST_ID}}',
          expectStatus: [200],
          onSuccess: (data, vars) => {
            const p = data.problem || data;
            if (!p || p.id !== vars.TEST_ID) throw new Error('Returned problem id mismatch');
          },
        },
        {
          name: 'Delete it',
          method: 'DELETE', url: '/api/problem?action=adminProblems',
          body: { id: '{{TEST_ID}}' },
          expectStatus: [200],
        },
        {
          name: 'Verify gone (expect 404)',
          method: 'GET', url: '/api/problem?action=adminProblems&id={{TEST_ID}}',
          expectStatus: [404],
        },
      ],
      setup: (vars) => { vars.TEST_ID = 'ZT' + Date.now().toString(36).toUpperCase().slice(-6); },
    },

    {
      id: 'submission-lifecycle',
      icon: 'fa-solid fa-paper-plane',
      name: 'Submission Lifecycle',
      desc: 'Submit a test answer to problem 0000 → verify it appears → delete it → verify gone',
      steps: [
        {
          name: 'Check problem 0000 exists',
          method: 'GET', url: '/api/problem?action=page&id=0000',
          expectStatus: [200],
          onFail: 'Problem 0000 not found — create it first or change the workflow.',
        },
        {
          name: 'Submit test answer',
          method: 'POST', url: '/api/submit',
          body: { problemId: '0000', answer: '0', type: 'text' },
          expectStatus: [200],
          onSuccess: (data, vars) => {
            if (!data.subid) throw new Error('Response missing subid');
            vars.SUBID = data.subid;
          },
        },
        {
          name: 'Find it in admin list',
          method: 'GET', url: '/api/submissions?admin=1&problem_id=0000&limit=10',
          expectStatus: [200],
          onSuccess: (data, vars) => {
            const list = data.submissions || [];
            const found = list.find(s => s.subid === vars.SUBID);
            if (!found) throw new Error(`Submission ${vars.SUBID} not in list`);
            if (!found._id) throw new Error('Submission has no _id (cannot clean up)');
            vars.OID = found._id;
          },
        },
        {
          name: 'Delete submission',
          method: 'DELETE', url: '/api/submissions?admin=1',
          body: { submissionId: '{{OID}}' },
          expectStatus: [200],
        },
        {
          name: 'Verify gone',
          method: 'GET', url: '/api/submissions?admin=1&problem_id=0000&limit=10',
          expectStatus: [200],
          onSuccess: (data, vars) => {
            const list = data.submissions || [];
            if (list.find(s => s.subid === vars.SUBID)) throw new Error('Submission still present');
          },
        },
      ],
    },

    {
      id: 'announcement-lifecycle',
      icon: 'fa-solid fa-bullhorn',
      name: 'Announcement Lifecycle',
      desc: 'Create → list → delete an announcement',
      steps: [
        {
          name: 'Create announcement',
          method: 'POST', url: '/api/updates?action=adminCreate',
          body: {
            badge: 'info', badgeText: '{{MARKER}}', time: 'now',
            title: 'Health Check', content: 'Auto-generated. Safe to delete.',
          },
          expectStatus: [200, 201],
        },
        {
          name: 'List & find it',
          method: 'GET', url: '/api/updates?action=adminList',
          expectStatus: [200],
          onSuccess: (data, vars) => {
            const list = data.updates || [];
            const found = list.find(u => u.badgeText === vars.MARKER);
            if (!found) throw new Error(`Announcement with marker ${vars.MARKER} not found`);
            vars.OID = found._id;
          },
        },
        {
          name: 'Delete it',
          method: 'DELETE', url: '/api/updates?action=adminDelete',
          body: { id: '{{OID}}' },
          expectStatus: [200],
        },
        {
          name: 'Verify gone',
          method: 'GET', url: '/api/updates?action=adminList',
          expectStatus: [200],
          onSuccess: (data, vars) => {
            if ((data.updates || []).find(u => u.badgeText === vars.MARKER))
              throw new Error('Announcement still present');
          },
        },
      ],
      setup: (vars) => { vars.MARKER = 'HC-' + Date.now().toString(36).toUpperCase().slice(-6); },
    },

    {
      id: 'cmd-sandbox',
      icon: 'fa-solid fa-terminal',
      name: 'Admin Cmd Sandbox (Read-only)',
      desc: 'Verify the VM sandbox executes simple expressions and returns the right result.',
      steps: [
        {
          name: 'Execute "1 + 1"',
          method: 'POST', url: '/api/admin?action=cmd',
          body: { mode: 'js', code: 'return 1 + 1;' },
          expectStatus: [200],
          onSuccess: (data) => {
            const r = data.result;
            if (r !== '2' && r !== 2) throw new Error(`Expected "2", got "${r}"`);
          },
        },
        {
          name: 'Count users collection',
          method: 'POST', url: '/api/admin?action=cmd',
          body: { mode: 'db', code: 'return await db.collection("users").countDocuments({});' },
          expectStatus: [200],
          onSuccess: (data) => {
            const n = Number(data.result);
            if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid count: ${data.result}`);
          },
        },
      ],
    },

    {
      id: 'auth-boundary',
      icon: 'fa-solid fa-shield-halved',
      name: 'Auth Boundary Probe',
      desc: 'Confirm RBAC works: admin endpoints must return 200 (admin) or 403 (student) — never 500.',
      steps: [
        {
          name: 'Probe /api/admin?action=logs',
          method: 'GET', url: '/api/admin?action=logs&limit=1',
          expectStatus: [200, 403],
          onSuccess: (data, vars) => {
            // Data is null on 403 (we don't get it here)
            // Just record — success means we got one of the two expected codes
          },
        },
        {
          name: 'Probe /api/admin?action=listBackups',
          method: 'GET', url: '/api/admin?action=listBackups',
          expectStatus: [200, 403],
        },
        // {
        //   name: 'Probe /api/oplog?action=stats',
        //   method: 'GET', url: '/api/oplog?action=stats',
        //   expectStatus: [200, 403, 404],
        // },
      ],
    },

    {
      id: 'input-fuzz',
      icon: 'fa-solid fa-bug',
      name: 'Input Validation Fuzz',
      desc: 'Send malformed requests to /api/submit — every one must be rejected with 400. No data is written.',
      steps: [
        {
          name: 'Empty body (expect 400)',
          method: 'POST', url: '/api/submit',
          body: {},
          expectStatus: [400],
        },
        {
          name: 'Missing answer (expect 400)',
          method: 'POST', url: '/api/submit',
          body: { problemId: 'ZZ' },
          expectStatus: [400],
        },
        {
          name: 'Answer too long (expect 400)',
          method: 'POST', url: '/api/submit',
          body: { problemId: 'ZZ', answer: 'x'.repeat(600) },
          expectStatus: [400],
        },
        {
          name: 'Image type but no image data (expect 400)',
          method: 'POST', url: '/api/submit',
          body: { problemId: 'ZZ', answer: 'x', type: 'image' },
          expectStatus: [400],
        },
        {
          name: 'Problem ID not a string (expect 400)',
          method: 'POST', url: '/api/submit',
          body: { problemId: 12345, answer: 'x' },
          expectStatus: [400],
        },
        {
          name: 'Valid shape, nonexistent problem (expect 404)',
          method: 'POST', url: '/api/submit',
          body: { problemId: 'ZZ', answer: 'x', type: 'text' },
          expectStatus: [404],
        },
      ],
    },

    {
      id: 'rate-limit-probe',
      icon: 'fa-solid fa-gauge-high',
      name: 'Rate Limit Probe ⚠️',
      desc: 'Blast 32 requests at 1/s window. May trigger the global 30s IP ban — run this LAST.',
      steps: [
        // We generate one "step" that internally runs 32 fetches and reports the count of 429s.
        {
          name: 'Fire 32 requests rapidly',
          method: 'CUSTOM_RATE_PROBE',
          url: '/api/problem?ids=1',
          expectStatus: [200],
          custom: true,
        },
      ],
    },
  ];

  // ═══════════════════════════════════════════════════════════
  // [3] State
  // ═══════════════════════════════════════════════════════════
  const STATE = {
    results: {},
    testing: {},
    expanded: {},
    wfState: {},
    wfExpanded: {},
    filters: { group: 'all', search: '', onlyFailed: false },
    runAll: { running: false, done: 0, total: 0 },
  };

  // ═══════════════════════════════════════════════════════════
  // [4] Utilities
  // ═══════════════════════════════════════════════════════════
  function getToken() {
    for (const k of ['token', 'jwt', 'authToken', 'auth_token']) {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (v) return v;
    }
    return '';
  }

  function getUsername() {
    try { const u = JSON.parse(localStorage.getItem('user') || '{}'); return u.username || u.displayName || ''; }
    catch { return ''; }
  }

  function epId(ep) { return (ep.method + ' ' + ep.url).replace(/[^a-zA-Z0-9:_\-./?=&]/g, '_'); }

  function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

  function fmtSize(b) {
    if (b == null) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }

  function fmtTime(ms) {
    if (ms == null) return '';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function timeSeverity(ms) {
    if (ms == null) return '';
    if (ms < 500) return 'ok';
    if (ms < 2000) return 'warn';
    return 'fail';
  }

  function statusSeverity(code) {
    if (code == null) return '';
    if (code >= 200 && code < 300) return 'ok';
    if (code >= 300 && code < 500) return 'warn';
    return 'fail';
  }

  function methodIcon(m) { return ICON[m] || 'fa-solid fa-circle'; }
  function authIcon(a)   { return ICON[a] || 'fa-solid fa-key'; }
  function groupIcon(g)  { return ICON[g] || 'fa-solid fa-cube'; }

  function interpolate(str, vars) {
    return String(str).replace(/\{\{(\w+)\}\}/g, (_, k) => {
      if (!(k in vars)) throw new Error(`Missing variable: {{${k}}}`);
      return vars[k];
    });
  }

  function interpolateBody(body, vars) {
    if (body == null) return body;
    const json = JSON.stringify(body);
    const replaced = json.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      if (!(k in vars)) throw new Error(`Missing variable: {{${k}}}`);
      return String(vars[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    });
    return JSON.parse(replaced);
  }

  const delay = ms => new Promise(r => setTimeout(r, ms));

  // ═══════════════════════════════════════════════════════════
  // [5] HTTP helper
  // ═══════════════════════════════════════════════════════════
  async function doFetch(method, url, body) {
    const opts = {
      method,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
      cache: 'no-store',
    };
    const token = getToken();
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;

    if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    const t0 = performance.now();
    const res = await fetch(url, opts);
    const dt = performance.now() - t0;
    const text = await res.text();

    let parsed = null, isJson = false;
    try { parsed = JSON.parse(text); isJson = true; } catch {}

    return {
      status: res.status, statusText: res.statusText, ok: res.ok,
      time: dt, size: text.length, text, json: parsed, isJson,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // [6] Single endpoint test
  // ═══════════════════════════════════════════════════════════
  async function testEndpoint(ep, customBody) {
    const id = epId(ep);
    const username = getUsername();
    const url = ep.url.replace(/__SELF__/g, encodeURIComponent(username || 'anonymous'));

    let body;
    if (customBody !== undefined && customBody !== null && customBody.trim() !== '') {
      try { body = JSON.parse(customBody); }
      catch (e) {
        STATE.results[id] = { error: 'Request body is not valid JSON: ' + e.message, testedAt: Date.now() };
        render(); return;
      }
    } else if (ep.body !== undefined) {
      body = ep.body;
    }

    STATE.testing[id] = true; render();

    const result = { testedAt: Date.now() };
    try {
      const r = await doFetch(ep.method, url, body);
      Object.assign(result, {
        status: r.status, statusText: r.statusText, time: r.time,
        size: r.size, ok: r.ok,
        body: r.isJson ? r.json
            : (r.text.length > 3000 ? r.text.slice(0, 3000) + '\n... [truncated]' : r.text),
      });
    } catch (e) {
      result.error = e.message || String(e);
    } finally {
      delete STATE.testing[id];
    }
    STATE.results[id] = result;
    render();
  }

  // ═══════════════════════════════════════════════════════════
  // [7] Run all safe endpoints
  // ═══════════════════════════════════════════════════════════
  async function runAll() {
    if (STATE.runAll.running) return;
    const safeEps = ENDPOINTS.filter(e => e.safe);
    STATE.runAll = { running: true, done: 0, total: safeEps.length };

    const queue = [...safeEps];
    await Promise.all(Array.from({ length: 10 }, async () => {
      while (queue.length) {
        const ep = queue.shift();
        if (!ep) return;
        await testEndpoint(ep);
        STATE.runAll.done++;
        render();
      }
    }));
    STATE.runAll.running = false;
    render();
  }

  // ═══════════════════════════════════════════════════════════
  // [8] Custom step executors (for special workflows)
  // ═══════════════════════════════════════════════════════════
  async function execRateProbe(url) {
    const N = 32;
    const codes = [];
    const times = [];
    const t0 = performance.now();

    // Fire all at once — no await between calls
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push((async () => {
        const t = performance.now();
        try {
          const r = await fetch(url, {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin', cache: 'no-store',
          });
          codes.push(r.status);
          times.push(performance.now() - t);
        } catch (e) {
          codes.push(0); times.push(performance.now() - t);
        }
      })());
    }
    await Promise.all(promises);
    const totalTime = performance.now() - t0;

    const summary = {
      requests: N,
      ok:    codes.filter(c => c === 200).length,
      banned: codes.filter(c => c === 429).length,
      errors: codes.filter(c => c === 0 || (c >= 500)).length,
      totalTimeMs: Math.round(totalTime),
      avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
      codes: codes.join(','),
    };
    return {
      status: summary.banned > 0 ? 429 : 200,
      statusText: summary.banned > 0 ? `Rate limit triggered (${summary.banned}/32)` : 'No limit hit',
      time: totalTime, size: 0,
      body: summary,
      ok: true,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // [9] Run a workflow
  // ═══════════════════════════════════════════════════════════
  async function runWorkflow(wf) {
    if (STATE.wfState[wf.id]?.running) return;

    const ok = window.confirm(
      `⚠️  DANGEROUS WORKFLOW\n\n${wf.name}\n\n${wf.desc}\n\nProceed?`
    );
    if (!ok) return;

    const vars = {};
    try { if (wf.setup) wf.setup(vars); }
    catch (e) { (window.DSHUI ? DSHUI.toast('Setup failed: ' + e.message, 'err') : alert('Setup failed: ' + e.message)); return; }

    const runState = {
      running: true,
      steps: wf.steps.map(() => ({ status: 'pending' })),
      vars, startedAt: Date.now(),
    };
    STATE.wfState[wf.id] = runState;
    STATE.wfExpanded[wf.id] = true;
    render();

    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i];
      runState.steps[i] = { status: 'running', startedAt: Date.now() };
      render();

      try {
        if (i > 0) await delay(150);

        let r;
        if (step.custom === true && step.method === 'CUSTOM_RATE_PROBE') {
          const url = interpolate(step.url, vars);
          r = await execRateProbe(url);
          runState.steps[i] = {
            status: 'ok', statusCode: r.status, statusText: r.statusText,
            time: r.time, size: 0, body: r.body, finishedAt: Date.now(),
          };
          render();
          continue;
        }

        const url = interpolate(step.url, vars);
        const body = step.body !== undefined ? interpolateBody(step.body, vars) : undefined;
        r = await doFetch(step.method, url, body);

        const expect = step.expectStatus || [200];
        const passed = expect.includes(r.status);

        runState.steps[i] = {
          status: passed ? 'ok' : 'fail',
          statusCode: r.status, statusText: r.statusText,
          time: r.time, size: r.size,
          body: r.isJson ? r.json
              : (r.text.length > 2000 ? r.text.slice(0, 2000) + '\n... [truncated]' : r.text),
          finishedAt: Date.now(),
        };

        if (!passed) {
          runState.steps[i].error = step.onFail || `Expected status ${expect.join('/')}, got ${r.status}`;
          runState.failed = true; render(); break;
        }

        if (step.onSuccess) {
          try { step.onSuccess(r.json || {}, vars); }
          catch (e) {
            runState.steps[i].status = 'fail';
            runState.steps[i].error = 'onSuccess hook: ' + e.message;
            runState.failed = true; render(); break;
          }
        }
      } catch (e) {
        runState.steps[i] = { status: 'fail', error: e.message || String(e), finishedAt: Date.now() };
        runState.failed = true; render(); break;
      }
    }

    runState.running = false;
    runState.finishedAt = Date.now();
    runState.totalTime = runState.finishedAt - runState.startedAt;
    render();
  }

  // ═══════════════════════════════════════════════════════════
  // [10] Stats
  // ═══════════════════════════════════════════════════════════
  function computeStats() {
    let ok = 0, warn = 0, fail = 0, untested = 0, totalTime = 0;
    for (const ep of ENDPOINTS) {
      const r = STATE.results[epId(ep)];
      if (!r || (r.status == null && !r.error)) { untested++; continue; }
      if (r.error) { fail++; continue; }
      if (r.status >= 200 && r.status < 300) ok++;
      else if (r.status >= 500) fail++;
      else warn++;
      if (r.time) totalTime += r.time;
    }
    return { ok, warn, fail, untested, totalTime };
  }

  // ═══════════════════════════════════════════════════════════
  // [11] Render
  // ═══════════════════════════════════════════════════════════
  function visibleEndpoints() {
    const { group, search, onlyFailed } = STATE.filters;
    const q = search.trim().toLowerCase();
    return ENDPOINTS.filter(ep => {
      if (group !== 'all' && ep.group !== group) return false;
      if (q && !(ep.url.toLowerCase().includes(q) || ep.name.toLowerCase().includes(q))) return false;
      if (onlyFailed) {
        const r = STATE.results[epId(ep)];
        if (!r) return false;
        if (r.error) return true;
        if (r.status != null && (r.status < 200 || r.status >= 300)) return true;
        return false;
      }
      return true;
    });
  }

  function render() {
    const app = document.getElementById('hcApp');
    if (!app) return;

    const stats = computeStats();
    const groups = [...new Set(ENDPOINTS.map(e => e.group))];
    const visible = visibleEndpoints();

    app.innerHTML = `
      <div class="hc-header">
        <h1><i class="${ICON.health}"></i>System Health Check</h1>
        <div class="hc-actions">
          <button class="hc-btn hc-btn-primary" id="hc-run-all" ${STATE.runAll.running ? 'disabled' : ''}>
            <i class="${STATE.runAll.running ? ICON.spinner : ICON.play}"></i>
            ${STATE.runAll.running ? `Testing ${STATE.runAll.done}/${STATE.runAll.total}` : 'Run All (Safe)'}
          </button>
          <button class="hc-btn" id="hc-reset" ${STATE.runAll.running ? 'disabled' : ''}>
            <i class="${ICON.reset}"></i>Reset Results
          </button>
        </div>
      </div>

      <div class="hc-summary">
        <div class="hc-stat ok">
          <div class="hc-stat-head"><i class="${ICON.passed}" style="color:#2ecc71"></i>
            <span class="hc-stat-label">Passed</span></div>
          <div class="hc-stat-num ok">${stats.ok}</div>
        </div>
        <div class="hc-stat warn">
          <div class="hc-stat-head"><i class="${ICON.warn}" style="color:#f0ad4e"></i>
            <span class="hc-stat-label">Warn (3xx/4xx)</span></div>
          <div class="hc-stat-num warn">${stats.warn}</div>
        </div>
        <div class="hc-stat fail">
          <div class="hc-stat-head"><i class="${ICON.failed}" style="color:var(--danger)"></i>
            <span class="hc-stat-label">Failed</span></div>
          <div class="hc-stat-num fail">${stats.fail}</div>
        </div>
        <div class="hc-stat">
          <div class="hc-stat-head"><i class="${ICON.untested}"></i>
            <span class="hc-stat-label">Untested</span></div>
          <div class="hc-stat-num">${stats.untested}</div>
        </div>
        <div class="hc-stat">
          <div class="hc-stat-head"><i class="${ICON.time}"></i>
            <span class="hc-stat-label">Total Time</span></div>
          <div class="hc-stat-num">${fmtTime(stats.totalTime) || '—'}</div>
        </div>
      </div>

      <div class="hc-filters">
        <div class="hc-filter-group">
          <i class="${ICON.filter}"></i>
          <select id="hc-group-filter">
            <option value="all" ${STATE.filters.group === 'all' ? 'selected' : ''}>All Groups</option>
            ${groups.map(g => `<option value="${escapeHtml(g)}" ${STATE.filters.group === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
          </select>
        </div>
        <div class="hc-filter-group" style="flex:1 1 220px;">
          <i class="${ICON.search}"></i>
          <input type="search" id="hc-search" placeholder="Search name or path…"
                 value="${escapeHtml(STATE.filters.search)}">
        </div>
        <label class="hc-filter-check">
          <input type="checkbox" id="hc-only-failed" ${STATE.filters.onlyFailed ? 'checked' : ''}>
          <i class="${ICON.xmark}"></i>Only failures
        </label>
      </div>

      <div class="hc-list">
        ${visible.length === 0
          ? `<div class="hc-empty"><i class="${ICON.search}"></i>No matching endpoints</div>`
          : visible.map(renderCard).join('')}
      </div>

      ${renderWorkflowsSection()}
    `;

    bindEvents();
  }

  function renderCard(ep) {
    const id = epId(ep);
    const r = STATE.results[id];
    const testing = STATE.testing[id];

    let statusCls = '', statusIcon = ICON.untested, statusTxt = 'Untested';
    if (testing) {
      statusCls = 'run'; statusIcon = ICON.spinner; statusTxt = 'Testing';
    } else if (r) {
      if (r.error) { statusCls = 'fail'; statusIcon = ICON.failed; statusTxt = 'Network error'; }
      else if (r.status != null) {
        statusCls = statusSeverity(r.status);
        statusIcon = statusCls === 'ok' ? ICON.check : (statusCls === 'warn' ? ICON.warn : ICON.xmark);
        statusTxt = r.status + ' ' + (r.statusText || '');
      }
    }

    return `
      <details class="hc-card" data-id="${escapeHtml(id)}" ${STATE.expanded[id] ? 'open' : ''}>
        <summary>
          <span class="hc-method hc-method-${ep.method.toLowerCase()}">
            <i class="${methodIcon(ep.method)}"></i>${ep.method}
          </span>
          <span class="hc-url">${escapeHtml(ep.url)}</span>
          <span class="hc-auth hc-auth-${ep.auth}">
            <i class="${authIcon(ep.auth)}"></i>${ep.auth}
          </span>
          <span class="hc-status ${statusCls}">
            <i class="${statusIcon}"></i>${escapeHtml(statusTxt)}
          </span>
        </summary>
        <div class="hc-body">
          <div class="hc-desc"><i class="${ICON.info}"></i>
            <span>${escapeHtml(ep.name)}${ep.desc ? ' — ' + escapeHtml(ep.desc) : ''}</span>
          </div>
          ${ep.method !== 'GET' ? `
            <div class="hc-field">
              <label><i class="${ICON.fileCode}"></i>Request Body (JSON)</label>
              <textarea data-body-for="${escapeHtml(id)}" placeholder='{"key": "value"}'>${escapeHtml(
                STATE.expanded[id + '__body'] ?? (ep.body === null ? '' : JSON.stringify(ep.body || {}, null, 2))
              )}</textarea>
            </div>
          ` : ''}
          <div class="hc-body-actions">
            <button class="hc-btn hc-btn-sm hc-btn-primary" data-test="${escapeHtml(id)}" ${testing ? 'disabled' : ''}>
              <i class="${testing ? ICON.spinner : ICON.play}"></i>Test
            </button>
            ${r ? `<button class="hc-btn hc-btn-sm" data-copy="${escapeHtml(id)}"><i class="${ICON.copy}"></i>Copy Response</button>` : ''}
          </div>
          ${renderResult(r)}
        </div>
      </details>
    `;
  }

  function renderResult(r) {
    if (!r) {
      return `<div class="hc-result"><div class="hc-result-empty"><i class="${ICON.info}"></i>Not tested yet</div></div>`;
    }
    if (r.error) {
      return `
        <div class="hc-result">
          <div class="hc-result-meta"><span><i class="${ICON.failed}"></i><span class="hc-meta-label">Error</span></span></div>
          <pre class="hc-result-body">${escapeHtml(r.error)}</pre>
        </div>`;
    }
    const timeSev = timeSeverity(r.time);
    const bodyStr = typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2);
    const truncated = bodyStr.length > 5000;
    const shown = truncated ? bodyStr.slice(0, 5000) : bodyStr;

    return `
      <div class="hc-result">
        <div class="hc-result-meta">
          <span><i class="${ICON.passed}"></i><span class="hc-meta-label">Status</span>
            <span class="hc-meta-val">${r.status} ${escapeHtml(r.statusText || '')}</span></span>
          <span><i class="${ICON.time}"></i><span class="hc-meta-label">Time</span>
            <span class="hc-meta-val hc-meta-time ${timeSev}">${fmtTime(r.time)}</span></span>
          <span><i class="${ICON.fileCode}"></i><span class="hc-meta-label">Size</span>
            <span class="hc-meta-val hc-meta-size">${fmtSize(r.size)}</span></span>
          <span style="margin-left:auto;opacity:.6;">
            <i class="${ICON.clock}"></i> ${new Date(r.testedAt).toLocaleTimeString()}
          </span>
        </div>
        <pre class="hc-result-body">${escapeHtml(shown)}</pre>
        ${truncated ? `<div class="hc-truncated"><i class="${ICON.warn}"></i>Response truncated to 5000 chars</div>` : ''}
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  // [12] Workflow rendering
  // ═══════════════════════════════════════════════════════════
  function renderWorkflowsSection() {
    return `
      <div class="hc-wf-section">
        <h2><i class="${ICON.warning}"></i>Dangerous Workflows</h2>
        <div class="hc-wf-warning">
          <i class="${ICON.warning}"></i>
          <div>
            These workflows <strong>write to the database</strong>. Most clean up after themselves
            (create → test → delete), but a mid-run failure may leave orphans requiring manual cleanup.
            <br><br>
            <strong>Run them one at a time and read the results.</strong> The
            <em>Rate Limit Probe</em> in particular may trigger a 30-second IP ban — run it <strong>last</strong>.
          </div>
        </div>
        <div class="hc-wf-list">${WORKFLOWS.map(renderWorkflowCard).join('')}</div>
      </div>`;
  }

  function renderWorkflowCard(wf) {
    const rs = STATE.wfState[wf.id];
    const expanded = STATE.wfExpanded[wf.id] || !!rs;
    const running = rs?.running;

    let summaryTxt = '', summaryCls = '', summaryIcon = '';
    if (rs && !running) {
      const okCount = rs.steps.filter(s => s.status === 'ok').length;
      if (rs.failed) { summaryTxt = `Failed at step ${okCount + 1}`; summaryCls = 'fail'; summaryIcon = ICON.failed; }
      else { summaryTxt = `All ${okCount} steps passed · ${fmtTime(rs.totalTime)}`; summaryCls = 'ok'; summaryIcon = ICON.passed; }
    } else if (running) {
      const done = rs.steps.filter(s => s.status === 'ok' || s.status === 'fail').length;
      summaryTxt = `Running ${done}/${rs.steps.length}…`; summaryIcon = ICON.spinner;
    }

    return `
      <details class="hc-wf-card" data-wf="${escapeHtml(wf.id)}" ${expanded ? 'open' : ''}>
        <summary>
          <span class="hc-wf-icon"><i class="${wf.icon}"></i></span>
          <span class="hc-wf-title">
            <strong>${escapeHtml(wf.name)}</strong>
            <small>${escapeHtml(wf.desc)}</small>
          </span>
          <span class="hc-wf-badge"><i class="${ICON.warning}"></i>Dangerous</span>
        </summary>
        <div class="hc-wf-body">
          <div class="hc-wf-steps">
            ${wf.steps.map((step, i) => renderWorkflowStep(step, i, rs)).join('')}
          </div>
          <div class="hc-wf-footer">
            <button class="hc-btn hc-btn-sm hc-btn-danger" data-run-wf="${escapeHtml(wf.id)}" ${running ? 'disabled' : ''}>
              <i class="${running ? ICON.spinner : ICON.play}"></i>${running ? 'Running…' : 'Run Workflow'}
            </button>
            ${rs ? `<button class="hc-btn hc-btn-sm" data-clear-wf="${escapeHtml(wf.id)}"><i class="${ICON.eraser}"></i>Clear</button>` : ''}
            ${summaryTxt ? `<span class="hc-wf-summary ${summaryCls}"><i class="${summaryIcon}"></i>${escapeHtml(summaryTxt)}</span>` : ''}
          </div>
        </div>
      </details>`;
  }

  function renderWorkflowStep(step, i, rs) {
    const s = rs?.steps[i] || { status: 'pending' };
    const stepCls = s.status === 'running' ? 'running' : s.status === 'ok' ? 'ok' : s.status === 'fail' ? 'fail' : '';

    let numHtml = String(i + 1);
    if (s.status === 'ok')   numHtml = `<i class="${ICON.check}" style="font-size:.6rem"></i>`;
    if (s.status === 'fail') numHtml = `<i class="${ICON.xmark}" style="font-size:.6rem"></i>`;
    if (s.status === 'running') numHtml = `<i class="${ICON.spinner}" style="font-size:.6rem"></i>`;

    let metaHtml = '';
    if (step.custom === true) {
      metaHtml += `<span class="hc-method" style="background:rgba(74,144,217,.15);color:var(--accent);font-size:.65rem;padding:1px 5px;"><i class="${ICON.gauge}"></i>CUSTOM</span>`;
    } else {
      metaHtml += `<span class="hc-method hc-method-${step.method.toLowerCase()}" style="font-size:.65rem;padding:1px 5px;">
        <i class="${methodIcon(step.method)}"></i>${step.method}</span>`;
    }
    metaHtml += `<span style="opacity:.7;font-size:.7rem;">${escapeHtml(step.url)}</span>`;

    if (s.statusCode != null) {
      const sev = s.status === 'ok' ? 'ok' : 'fail';
      metaHtml += `<span class="${sev}"><i class="${statusSeverity(s.statusCode) === 'ok' ? ICON.check : ICON.warn}"></i> ${s.statusCode} ${escapeHtml(s.statusText || '')}</span>`;
    }
    if (s.time != null) {
      metaHtml += `<span class="${timeSeverity(s.time)}"><i class="${ICON.time}"></i> ${fmtTime(s.time)}</span>`;
    }

    let resultHtml = '';
    if (s.status === 'ok' && s.body !== undefined) {
      const bodyStr = typeof s.body === 'string' ? s.body : JSON.stringify(s.body, null, 2);
      const shown = bodyStr.length > 1200 ? bodyStr.slice(0, 1200) + '\n…' : bodyStr;
      resultHtml = `<pre class="hc-wf-step-result">${escapeHtml(shown)}</pre>`;
    } else if (s.status === 'fail' && s.error) {
      resultHtml = `<pre class="hc-wf-step-result error"><i class="${ICON.failed}"></i> ${escapeHtml(s.error)}</pre>`;
    }

    return `
      <div class="hc-wf-step ${stepCls}">
        <div class="hc-wf-step-num">${numHtml}</div>
        <div class="hc-wf-step-body">
          <div class="hc-wf-step-name">${escapeHtml(step.name)}</div>
          <div class="hc-wf-step-meta">${metaHtml}</div>
          ${resultHtml}
        </div>
      </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  // [13] Event binding
  // ═══════════════════════════════════════════════════════════
  function bindEvents() {
    const app = document.getElementById('hcApp');

    const runAllBtn = document.getElementById('hc-run-all');
    if (runAllBtn) runAllBtn.addEventListener('click', runAll);

    const resetBtn = document.getElementById('hc-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      STATE.results = {}; STATE.testing = {}; STATE.expanded = {};
      render();
    });

    const groupSel = document.getElementById('hc-group-filter');
    if (groupSel) groupSel.addEventListener('change', e => {
      STATE.filters.group = e.target.value; render();
    });

    const searchInput = document.getElementById('hc-search');
    if (searchInput) {
      let timer;
      searchInput.addEventListener('input', e => {
        clearTimeout(timer);
        const v = e.target.value;
        timer = setTimeout(() => {
          STATE.filters.search = v;
          render();
          const el = document.getElementById('hc-search');
          if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
        }, 200);
      });
    }

    const onlyFailedChk = document.getElementById('hc-only-failed');
    if (onlyFailedChk) onlyFailedChk.addEventListener('change', e => {
      STATE.filters.onlyFailed = e.target.checked; render();
    });

    // Endpoint cards
    app.querySelectorAll('details.hc-card').forEach(det => {
      const id = det.getAttribute('data-id');
      det.addEventListener('toggle', () => { STATE.expanded[id] = det.open; });

      const ta = det.querySelector('textarea[data-body-for]');
      if (ta) ta.addEventListener('input', () => { STATE.expanded[id + '__body'] = ta.value; });

      const testBtn = det.querySelector('button[data-test]');
      if (testBtn) testBtn.addEventListener('click', () => {
        const ep = ENDPOINTS.find(e => epId(e) === id);
        if (ep) testEndpoint(ep, ta ? ta.value : undefined);
      });

      const copyBtn = det.querySelector('button[data-copy]');
      if (copyBtn) copyBtn.addEventListener('click', () => {
        const r = STATE.results[id];
        if (!r) return;
        const text = r.error ? 'ERROR: ' + r.error
                    : typeof r.body === 'string' ? r.body
                    : JSON.stringify(r.body, null, 2);
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.innerHTML = `<i class="${ICON.check}"></i>Copied`;
          setTimeout(() => { copyBtn.innerHTML = `<i class="${ICON.copy}"></i>Copy Response`; }, 1200);
        }).catch(() => {
          copyBtn.innerHTML = `<i class="${ICON.failed}"></i>Failed`;
          setTimeout(() => { copyBtn.innerHTML = `<i class="${ICON.copy}"></i>Copy Response`; }, 1200);
        });
      });
    });

    // Workflow cards
    app.querySelectorAll('details.hc-wf-card').forEach(det => {
      const wfId = det.getAttribute('data-wf');
      det.addEventListener('toggle', () => { STATE.wfExpanded[wfId] = det.open; });
    });

    app.querySelectorAll('button[data-run-wf]').forEach(btn => {
      btn.addEventListener('click', () => {
        const wf = WORKFLOWS.find(w => w.id === btn.getAttribute('data-run-wf'));
        if (wf) runWorkflow(wf);
      });
    });

    app.querySelectorAll('button[data-clear-wf]').forEach(btn => {
      btn.addEventListener('click', () => {
        delete STATE.wfState[btn.getAttribute('data-clear-wf')];
        render();
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // [14] Init
  // ═══════════════════════════════════════════════════════════
  function init() {
    const app = document.getElementById('hcApp');
    if (app) app.innerHTML = `<div class="hc-empty"><i class="${ICON.spinner}"></i>Loading…</div>`;

    if (!getToken()) {
      if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
        window.location.href = '/index.html'; return;
      }
    }
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
