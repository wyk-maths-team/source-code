
    if (!isLoggedIn()) window.location.href = '/index.html';

    const mainContainer = document.getElementById('mainContent');
    const tooltipEl = document.getElementById('cursorTooltip');

    const CHART_COLORS = [
      '#ae85c9', '#aab9f7', '#b6d2ff', '#c9e6f2', '#c9f0e1',
      '#e8d685', '#e0ad63', '#d48652', '#d27362', '#495fba',
      '#7a629b', '#8881cc', '#4a90d9', '#e74c3c', '#2ecc71',
      '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'
    ];

    let chartRoot = null;
    let chartDataCache = null;
    const seriesMap = {};
    let activeUsersCache = [];
    let seriesDataCache = {};

    // ⭐ 鼠標位置 & 當前日期 & pin 狀態
    let mouseClientX = 0, mouseClientY = 0;
    let currentDateMs = null;
    const tooltipState = { pinned: false, dateMs: null };

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    function colorForUser(username) {
      let hash = 0;
      for (let i = 0; i < username.length; i++) {
        hash = ((hash << 5) - hash) + username.charCodeAt(i);
        hash |= 0;
      }
      return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length];
    }

    function displayNameFor(user) {
      if (user.realName && user.realName.trim()) return user.realName + '-' + user.username;
      return user.username;
    }

    function getActiveUsers(data) {
      return data.users.filter(u => (u.daily[u.daily.length - 1] || 0) > 0);
    }

    async function loadChartData() {
      try {
        const data = await apiCall('/api/users?action=charts');
        if (!data.success) throw new Error('Failed');
        return data.data;
      } catch (err) { console.error(err); return null; }
    }

    function renderSkeleton(userCount) {
      mainContainer.innerHTML = `
        <div class="chart-page-container">
          <div class="page-header">
            <h1>Solve Progress</h1>
            <div class="btn-group">
              <a href="/leaderboard" class="btn">Leaderboard</a>
              <button class="btn btn-info disabled" disabled>Chart</button>
            </div>
          </div>
          <div class="chart-row">
            <div class="chart-main" id="chartMain">
              <div id="solveChart"></div>
            </div>
            <div class="chart-options">
              <h3>Chart Options</h3>
              <label class="opt-row">
                <input type="checkbox" id="optLog"> Logarithmic Y Axis
              </label>
              <p style="font-size:0.75rem;color:var(--text-secondary);margin:0.3rem 0 0.6rem 0;">
                💡 點擊圖表可<b>鎖定</b>當前時刻的數據，點擊其他地方解除
              </p>
              <h3>Time Range</h3>
              <div class="range-row">
                <label>Start: <input type="date" id="rangeStart"></label>
                <label>End: <input type="date" id="rangeEnd"></label>
                <div class="range-buttons">
                  <button class="btn" id="applyRangeBtn">Apply</button>
                  <button class="btn" id="resetRangeBtn">Reset</button>
                </div>
              </div>
              <h3>Users (${userCount})</h3>
              <div class="legend-toolbar">
                <a id="selectAllBtn">All</a>
                <span style="color:var(--text-secondary);">·</span>
                <a id="selectNoneBtn">None</a>
              </div>
              <div class="chart-legend-list" id="chartLegend"></div>
            </div>
          </div>
        </div>
      `;
    }

    function renderLegend(data) {
      const legendEl = document.getElementById('chartLegend');
      const activeUsers = getActiveUsers(data);

      legendEl.innerHTML = activeUsers.map(u => {
        const color = colorForUser(u.username);
        const count = u.daily[u.daily.length - 1] || 0;
        return `
          <label class="chart-legend-item">
            <input type="checkbox" checked data-username="${escapeHtml(u.username)}">
            <span class="chart-legend-swatch" style="background:${color};"></span>
            <span class="chart-legend-name">${escapeHtml(displayNameFor(u))}</span>
            <span class="chart-legend-count">${count}</span>
          </label>`;
      }).join('');

      legendEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          const s = seriesMap[cb.dataset.username];
          if (!s) return;
          if (cb.checked) s.show(); else s.hide();
          // ⭐ 若已 pinned，重新渲染 tooltip 以反映勾選變化
          if (tooltipState.pinned && tooltipState.dateMs != null) {
            showTooltipForDate(tooltipState.dateMs);
          }
        });
      });

      document.getElementById('selectAllBtn').addEventListener('click', () => {
        legendEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
        Object.values(seriesMap).forEach(s => s.show());
        if (tooltipState.pinned && tooltipState.dateMs != null) {
          showTooltipForDate(tooltipState.dateMs);
        }
      });
      document.getElementById('selectNoneBtn').addEventListener('click', () => {
        legendEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        Object.values(seriesMap).forEach(s => s.hide());
        if (tooltipState.pinned && tooltipState.dateMs != null) {
          showTooltipForDate(tooltipState.dateMs);
        }
      });
    }

    function disposeChart() {
      if (chartRoot) { chartRoot.dispose(); chartRoot = null; }
      Object.keys(seriesMap).forEach(k => delete seriesMap[k]);
    }

    // ⭐ 全局鼠標跟蹤
    document.addEventListener('mousemove', (e) => {
      mouseClientX = e.clientX;
      mouseClientY = e.clientY;
      if (tooltipEl.style.display === 'block') positionTooltip();
    });

    function positionTooltip() {
      if (tooltipState.pinned) return;   // ⭐ pinned 不跟隨
      const w = tooltipEl.offsetWidth;
      const h = tooltipEl.offsetHeight;
      let left = mouseClientX + 16;
      let top = mouseClientY + 14;
      if (left + w > window.innerWidth - 8) left = mouseClientX - w - 16;
      if (top + h > window.innerHeight - 8) top = mouseClientY - h - 14;
      tooltipEl.style.left = Math.max(8, left) + 'px';
      tooltipEl.style.top  = Math.max(8, top) + 'px';
    }

    function hideTooltip() {
      if (tooltipState.pinned) return;   // ⭐ pinned 不隱藏
      tooltipEl.style.display = 'none';
    }

    function showTooltipForDate(dateMs) {
      const rows = [];
      for (const u of activeUsersCache) {
        const s = seriesMap[u.username];
        if (!s) continue;
        if (s.get('visible') === false) continue;

        const sdata = seriesDataCache[u.username];
        if (!sdata || !sdata.length) continue;

        let bestIdx = 0, bestDiff = Infinity;
        for (let i = 0; i < sdata.length; i++) {
          const diff = Math.abs(sdata[i].date - dateMs);
          if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        }
        const val = sdata[bestIdx].value;
        if (val > 0) rows.push({ name: displayNameFor(u), value: val });
      }

      if (!rows.length) {
        if (!tooltipState.pinned) hideTooltip();
        else tooltipEl.innerHTML = `<div class="tt-header">${new Date(dateMs).toISOString().slice(0,10)}</div><div class="tt-row" style="opacity:.6;">No solves</div>`;
        return;
      }

      rows.sort((a, b) => b.value - a.value);
      const dateStr = new Date(dateMs).toISOString().slice(0, 10);
      tooltipEl.innerHTML =
        `<div class="tt-header">${escapeHtml(dateStr)}</div>` +
        rows.map(r =>
          `<div class="tt-row">` +
            `<span class="tt-name">${escapeHtml(r.name)}</span>` +
            `<span class="tt-value">${r.value}</span>` +
          `</div>`
        ).join('');

      tooltipEl.style.display = 'block';
      positionTooltip();
    }

    function pinTooltip() {
      if (currentDateMs == null) return;
      tooltipState.pinned = true;
      tooltipState.dateMs = currentDateMs;
      showTooltipForDate(currentDateMs);
      tooltipEl.classList.add('pinned');
    }

    function unpinTooltip() {
      tooltipState.pinned = false;
      tooltipState.dateMs = null;
      tooltipEl.classList.remove('pinned');
      tooltipEl.style.display = 'none';
    }

    function attachCursorTracking(cursor, xAxis) {
      cursor.events.on('cursormoved', () => {
        let x = null;
        try { x = cursor.getPrivate('positionX'); } catch (e) {}
        if (x == null) { if (!tooltipState.pinned) hideTooltip(); return; }

        let startMs = null, endMs = null;
        try {
          const s = xAxis.getPrivate('start');
          const e = xAxis.getPrivate('end');
          startMs = s instanceof Date ? s.getTime() : Number(s);
          endMs = e instanceof Date ? e.getTime() : Number(e);
        } catch (_) {}

        if (!isFinite(startMs) || !isFinite(endMs)) {
          if (!tooltipState.pinned) hideTooltip();
          return;
        }

        const dateMs = startMs + (endMs - startMs) * x;
        if (!isFinite(dateMs)) {
          if (!tooltipState.pinned) hideTooltip();
          return;
        }

        currentDateMs = dateMs;    // ⭐ 記錄當前日期
        if (tooltipState.pinned) return;
        showTooltipForDate(dateMs);
      });

      cursor.events.on('cursorhidden', () => {
        if (!tooltipState.pinned) hideTooltip();
      });
    }

    function buildChart(data) {
      const { dates } = data;
      const activeUsers = getActiveUsers(data);

      if (!activeUsers.length || !dates.length) {
        document.getElementById('solveChart').innerHTML =
          '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">No data yet.</div>';
        return;
      }

      seriesDataCache = {};
      activeUsers.forEach(u => {
        seriesDataCache[u.username] = dates.map((d, i) => ({
          date: new Date(d + 'T00:00:00Z').getTime(),
          value: u.daily[i]
        }));
      });
      activeUsersCache = activeUsers;

      // ⭐ 重置 pin 狀態
      tooltipState.pinned = false;
      tooltipState.dateMs = null;
      currentDateMs = null;
      tooltipEl.classList.remove('pinned');
      hideTooltip();

      disposeChart();

      const root = am5.Root.new('solveChart');
      chartRoot = root;
      root.setThemes([am5themes_Animated.new(root)]);

      const chart = root.container.children.push(am5xy.XYChart.new(root, {
        panX: true, panY: false,
        wheelX: 'panX', wheelY: 'zoomX',
        layout: root.verticalLayout
      }));

      const cursor = chart.set('cursor', am5xy.XYCursor.new(root, { behavior: 'none' }));
      cursor.lineY.set('visible', false);
      cursor.lineX.set('visible', true);
      cursor.lineX.set('stroke', am5.color(0x888888));
      cursor.lineX.set('strokeOpacity', 0.5);
      cursor.lineX.set('strokeDasharray', [4, 4]);

      chart.set('scrollbarX', am5.Scrollbar.new(root, { orientation: 'horizontal' }));

      const xAxis = chart.xAxes.push(am5xy.DateAxis.new(root, {
        baseInterval: { timeUnit: 'day', count: 1 },
        renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 60 })
      }));

      const isLog = document.getElementById('optLog').checked;
      const yAxis = chart.yAxes.push(am5xy.ValueAxis.new(root, {
        renderer: am5xy.AxisRendererY.new(root, {}),
        logarithmic: isLog,
        min: isLog ? 0.5 : 0,
        extraMax: 0.05
      }));

      activeUsers.forEach(u => {
        const color = am5.color(colorForUser(u.username));
        const series = chart.series.push(am5xy.LineSeries.new(root, {
          name: displayNameFor(u),
          xAxis, yAxis,
          valueYField: 'value',
          valueXField: 'date',
          stroke: color, fill: color,
          tooltip: am5.Tooltip.new(root, { labelText: '' })
        }));
        series.strokes.template.setAll({ strokeWidth: 2, strokeOpacity: 0.9 });
        series.fills.template.setAll({ visible: false });
        series.set('tooltip', undefined);
        series.set('tooltipText', '');
        series.set('showTooltipOn', 'none');

        series.data.setAll(seriesDataCache[u.username]);
        seriesMap[u.username] = series;
        series.appear(600);
      });

      attachCursorTracking(cursor, xAxis);
      setupRangeControls(xAxis, dates);

      // ⭐ 圖表區域點擊 → pin / unpin
      const chartMain = document.getElementById('chartMain');
      chartMain.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        // 若已 pinned 且再點圖表 → 解除
        if (tooltipState.pinned) { unpinTooltip(); return; }
        if (currentDateMs != null) pinTooltip();
      });

      // ⭐ 點擊圖表外部 → 解除 pin
      document.addEventListener('click', (e) => {
        if (!tooltipState.pinned) return;
        if (chartMain.contains(e.target)) return;
        unpinTooltip();
      });

      chart.appear(600, 80);
    }

    function setupRangeControls(xAxis, dates) {
      const startInput = document.getElementById('rangeStart');
      const endInput = document.getElementById('rangeEnd');
      const applyBtn = document.getElementById('applyRangeBtn');
      const resetBtn = document.getElementById('resetRangeBtn');

      startInput.value = dates[0];
      endInput.value = dates[dates.length - 1];

      function applyZoom(startStr, endStr) {
        const start = new Date(startStr + 'T00:00:00Z');
        const end = new Date(endStr + 'T23:59:59Z');
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return;
        if (start > end) { (window.DSHUI ? DSHUI.toast('Start date must be before end date.', 'err') : alert('Start date must be before end date.')); return; }
        try { xAxis.zoomToDates(start, end, true); } catch (e) { console.warn('zoomToDates failed', e); }
      }

      applyBtn.addEventListener('click', () => applyZoom(startInput.value, endInput.value));
      resetBtn.addEventListener('click', () => {
        startInput.value = dates[0];
        endInput.value = dates[dates.length - 1];
        applyZoom(dates[0], dates[dates.length - 1]);
      });
    }

    (async function init() {
      const data = await loadChartData();
      if (!data) {
        mainContainer.innerHTML = '<div class="error-msg">Failed to load chart data.</div>';
        return;
      }
      if (!data.users || !data.users.length) {
        mainContainer.innerHTML = '<div class="error-msg">No data yet.</div>';
        return;
      }
      chartDataCache = data;

      const activeCount = getActiveUsers(data).length;
      if (activeCount === 0) {
        mainContainer.innerHTML = '<div class="error-msg">No solves yet.</div>';
        return;
      }

      renderSkeleton(activeCount);
      renderLegend(data);
      buildChart(data);

      document.getElementById('optLog').addEventListener('change', () => {
        buildChart(chartDataCache);
      });
    })();
  