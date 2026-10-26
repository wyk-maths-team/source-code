
(function () {
  'use strict';
  if (!isLoggedIn()) { window.location.href = '/index.html'; return; }

  // ───────────── 状态 ─────────────
  const state = {
    monthsLoaded: new Set(),
    tasksByDate: Object.create(null),
    editingId: null,
    tooltipTaskId: null,
    loading: false,
  };

  const $scroll  = document.getElementById('calScroll');
  const $label   = document.getElementById('calMonthLabel');
  const $modal   = document.getElementById('calModal');
  const $tooltip = document.getElementById('calTooltip');

  // ───────────── 日期工具 ─────────────
  function pad2(n) { return String(n).padStart(2, '0'); }

  function ymd(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  const MTH = ['January','February','March','April','May','June','July',
               'August','September','October','November','December'];

  function monthLabel(ym) {
    const [y, m] = ym.split('-').map(Number);
    return `${MTH[m - 1]} ${y}`;
  }

  // 回传 42 天，含首尾补满整周（周一起始）
  function getMonthGrid(ym) {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    // 找到周一：getDay() 0=Sun, 1=Mon ... 6=Sat
    const dow = first.getDay();
    const offset = (dow === 0 ? 6 : dow - 1);
    const start = new Date(y, m - 1, 1 - offset);

    const out = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      out.push({ date: d, inMonth: d.getMonth() === (m - 1) });
    }
    return out;
  }

  // ───────────── 渲染 ─────────────
  const WEEKDAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

  function renderMonth(ym, prepend) {
    const old = $scroll.querySelector(`.cal-month[data-month="${ym}"]`);
    if (old) old.remove();

    const todayStr = ymd(new Date());
    const grid = getMonthGrid(ym);

    let dayHtml = '';
    for (const { date, inMonth } of grid) {
      const ds = ymd(date);
      const tasks = state.tasksByDate[ds] || [];
      const cls = [
        'cal-day',
        inMonth ? '' : 'other-month',
        ds === todayStr ? 'today' : '',
      ].filter(Boolean).join(' ');

      let taskHtml = '';
      for (const t of tasks) {
        taskHtml += `<div class="cal-task${t.done ? ' done' : ''}" data-id="${t._id}">${escapeHtml(t.title)}</div>`;
      }

      dayHtml += `
        <div class="${cls}" data-date="${ds}">
          <div class="cal-day-num">${date.getDate()}</div>
          <div class="cal-tasks">${taskHtml}</div>
          <div class="cal-day-empty"></div>
        </div>`;
    }

    const html = `
      <div class="cal-month" data-month="${ym}">
        <div class="cal-month-header">${monthLabel(ym)}</div>
        <div class="cal-weekdays">${WEEKDAYS.map(d => `<div>${d}</div>`).join('')}</div>
        <div class="cal-days">${dayHtml}</div>
      </div>`;

    if (prepend) {
      $scroll.insertAdjacentHTML('afterbegin', html);
    } else {
      $scroll.insertAdjacentHTML('beforeend', html);
    }
  }

  function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

  function updateLabel() {
    const first = $scroll.querySelector('.cal-month');
    if (first) $label.textContent = monthLabel(first.dataset.month);
  }

  // 局部重绘单个月份（保存后调用，避免重新拉数据）
  function refreshMonth(ym) {
    const el = $scroll.querySelector(`.cal-month[data-month="${ym}"]`);
    if (!el) return;
    el.outerHTML = buildMonthHtml(ym);
  }

  // 抽出 HTML 生成，方便复用
  function buildMonthHtml(ym) {
    const todayStr = ymd(new Date());
    const grid = getMonthGrid(ym);
    let dayHtml = '';
    for (const { date, inMonth } of grid) {
      const ds = ymd(date);
      const tasks = state.tasksByDate[ds] || [];
      const cls = ['cal-day', inMonth ? '' : 'other-month', ds === todayStr ? 'today' : ''].filter(Boolean).join(' ');
      let taskHtml = '';
      for (const t of tasks) {
        taskHtml += `<div class="cal-task${t.done ? ' done' : ''}" data-id="${t._id}">${escapeHtml(t.title)}</div>`;
      }
      dayHtml += `
        <div class="${cls}" data-date="${ds}">
          <div class="cal-day-num">${date.getDate()}</div>
          <div class="cal-tasks">${taskHtml}</div>
          <div class="cal-day-empty"></div>
        </div>`;
    }
    return `
      <div class="cal-month" data-month="${ym}">
        <div class="cal-month-header">${monthLabel(ym)}</div>
        <div class="cal-weekdays">${WEEKDAYS.map(d => `<div>${d}</div>`).join('')}</div>
        <div class="cal-days">${dayHtml}</div>
      </div>`;
  }

  // ───────────── 数据 ─────────────
  async function loadRange(fromYmd, toYmd) {
    const res = await apiCall(
      `/api/calendar?action=list&from=${fromYmd}&to=${toYmd}`
    );
    if (!res.success) throw new Error(res.message || 'Load failed');

    // 清空这个区间的旧数据，避免重复
    for (const t of res.tasks) {
      if (!state.tasksByDate[t.date]) state.tasksByDate[t.date] = [];
      state.tasksByDate[t.date].push(t);
    }
  }

  function monthFirstLast(ym) {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);   // 下个月第 0 天 = 本月最后一天
    return { from: ymd(first), to: ymd(last) };
  }

  async function loadMonth(ym, prepend) {
    if (state.monthsLoaded.has(ym)) return;
    const { from, to } = monthFirstLast(ym);
    await loadRange(from, to);
    state.monthsLoaded.add(ym);
    if (prepend) {
      $scroll.insertAdjacentHTML('afterbegin', buildMonthHtml(ym));
    } else {
      $scroll.insertAdjacentHTML('beforeend', buildMonthHtml(ym));
    }
  }

  // 用已有 task 数据重新排序后覆盖（保存/删除后调用）
  function resortDate(dateStr) {
    const arr = state.tasksByDate[dateStr] || [];
    arr.sort((a, b) => (a.done - b.done) || 0);
  }

  // ───────────── 无限滚动 ─────────────
  let _scrollTimer = null;

  function checkScroll() {
    if (state.loading) return;
    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(_doCheckScroll, 120);
  }

  async function _doCheckScroll() {
    const st = $scroll.scrollTop;
    const sh = $scroll.scrollHeight;
    const ch = $scroll.clientHeight;

    // 顶部：向上加载
    if (st < 200) {
      const firstMonth = $scroll.querySelector('.cal-month')?.dataset.month;
      if (!firstMonth) return;
      const [y, m] = firstMonth.split('-').map(Number);
      const prev = new Date(y, m - 2, 1);
      const prevKey = monthKey(prev);
      if (!state.monthsLoaded.has(prevKey)) {
        state.loading = true;
        const oldH = sh;
        try {
          await loadMonth(prevKey, true);
          $scroll.scrollTop = st + ($scroll.scrollHeight - oldH);
        } finally {
          state.loading = false;
        }
      }
      return;
    }

    // 底部：向下加载
    if (sh - st - ch < 400) {
      const lastMonth = [...$scroll.querySelectorAll('.cal-month')].pop()?.dataset.month;
      if (!lastMonth) return;
      const [y, m] = lastMonth.split('-').map(Number);
      const next = new Date(y, m, 1);
      const nextKey = monthKey(next);
      if (!state.monthsLoaded.has(nextKey)) {
        state.loading = true;
        try {
          await loadMonth(nextKey, false);
        } finally {
          state.loading = false;
        }
      }
    }
  }

  // ───────────── 模态框 ─────────────
  const $mDate    = document.getElementById('calModalDate');
  const $mTitle   = document.getElementById('calModalTitleInput');
  const $mDetails = document.getElementById('calModalDetails');
  const $mHead    = document.getElementById('calModalTitle');
  const $mDel     = document.getElementById('calModalDelete');

  function openModal(dateStr, task) {
    state.editingId = task ? task._id : null;
    $mHead.textContent = task ? 'Edit Task' : 'New Task';
    $mDate.value = dateStr;
    $mTitle.value = task ? task.title : '';
    $mDetails.value = task ? task.details : '';
    $mDel.style.display = task ? '' : 'none';
    $modal.classList.add('open');
    setTimeout(() => $mTitle.focus(), 50);
  }

  function closeModal() {
    $modal.classList.remove('open');
    state.editingId = null;
  }

  async function saveModal() {
    const date = $mDate.value;
    const title = $mTitle.value.trim();
    const details = $mDetails.value.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return (window.DSHUI ? DSHUI.toast('Invalid date', 'err') : alert('Invalid date'));
    if (!title) return (window.DSHUI ? DSHUI.toast('Title required', 'err') : alert('Title required'));

    try {
      if (state.editingId) {
        const r = await apiCall('/api/calendar?action=update', 'PUT', {
          id: state.editingId, title, details
        });
        if (!r.success) throw new Error(r.message);
        // 局部更新
        for (const d in state.tasksByDate) {
          const t = state.tasksByDate[d].find(x => x._id === state.editingId);
          if (t) {
            t.title = title;
            t.details = details;
            refreshMonth(d.slice(0, 7));
            break;
          }
        }
      } else {
        const r = await apiCall('/api/calendar?action=create', 'POST', {
          date, title, details
        });
        if (!r.success) throw new Error(r.message);
        if (!state.tasksByDate[date]) state.tasksByDate[date] = [];
        state.tasksByDate[date].push({
          _id: r.id, date, title, details, done: false,
        });
        refreshMonth(date.slice(0, 7));
      }
      closeModal();
    } catch (e) {
      (window.DSHUI ? DSHUI.toast('Save failed: ' + e.message, 'err') : alert('Save failed: ' + e.message));
    }
  }

  async function deleteTask() {
    if (!state.editingId) return;
    if (!confirm('Delete this task?')) return;

    try {
      const r = await apiCall('/api/calendar?action=delete', 'DELETE', {
        id: state.editingId
      });
      if (!r.success) throw new Error(r.message);

      for (const d in state.tasksByDate) {
        const before = state.tasksByDate[d].length;
        state.tasksByDate[d] = state.tasksByDate[d].filter(x => x._id !== state.editingId);
        if (state.tasksByDate[d].length !== before) {
          refreshMonth(d.slice(0, 7));
          break;
        }
      }
      closeModal();
    } catch (e) {
      (window.DSHUI ? DSHUI.toast('Delete failed: ' + e.message, 'err') : alert('Delete failed: ' + e.message));
    }
  }

  // ───────────── Tooltip ─────────────
  const $tipTitle   = document.getElementById('calTooltipTitle');
  const $tipDetails = document.getElementById('calTooltipDetails');

  function findTaskById(id) {
    for (const d in state.tasksByDate) {
      const t = state.tasksByDate[d].find(x => x._id === id);
      if (t) return { task: t, date: d };
    }
    return null;
  }

  function showTooltip(task, anchorRect) {
    state.tooltipTaskId = task._id;
    $tipTitle.textContent = task.title;
    $tipDetails.textContent = task.details || '';
    $tooltip.hidden = false;

    // 定位：靠右或靠左
    const tipW = $tooltip.offsetWidth;
    const tipH = $tooltip.offsetHeight;
    const left = anchorRect.left < window.innerWidth / 2
      ? anchorRect.right + 8
      : anchorRect.left - tipW - 8;
    let top = anchorRect.top;
    if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
    if (top < 8) top = 8;

    $tooltip.style.left = Math.max(8, left) + 'px';
    $tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    $tooltip.hidden = true;
    state.tooltipTaskId = null;
  }

  async function toggleDone() {
    if (!state.tooltipTaskId) return;
    const found = findTaskById(state.tooltipTaskId);
    if (!found) return;
    const { task, date } = found;
    const newDone = !task.done;

    try {
      const r = await apiCall('/api/calendar?action=update', 'PUT', {
        id: task._id, done: newDone
      });
      if (!r.success) throw new Error(r.message);
      task.done = newDone;
      refreshMonth(date.slice(0, 7));
      hideTooltip();
    } catch (e) {
      (window.DSHUI ? DSHUI.toast('Update failed: ' + e.message, 'err') : alert('Update failed: ' + e.message));
    }
  }

  // ───────────── 事件绑定 ─────────────
  function bindEvents() {
    $scroll.addEventListener('scroll', checkScroll, { passive: true });

    $scroll.addEventListener('click', (e) => {
      // 点空白
      const empty = e.target.closest('.cal-day-empty');
      if (empty) {
        const day = empty.closest('.cal-day');
        openModal(day.dataset.date);
        return;
      }
      // 点任务
      const taskEl = e.target.closest('.cal-task');
      if (taskEl) {
        const found = findTaskById(taskEl.dataset.id);
        if (found) showTooltip(found.task, taskEl.getBoundingClientRect());
      }
    });
  }

  function bindModalEvents() {
    document.getElementById('calModalClose').addEventListener('click', closeModal);
    document.getElementById('calModalCancel').addEventListener('click', closeModal);
    document.getElementById('calModalSave').addEventListener('click', saveModal);
    document.getElementById('calModalDelete').addEventListener('click', deleteTask);

    $modal.addEventListener('click', (e) => {
      if (e.target === $modal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeModal(); hideTooltip(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && $modal.classList.contains('open')) {
        saveModal();
      }
    });
  }

  function bindTooltipEvents() {
    document.getElementById('calTooltipClose').addEventListener('click', hideTooltip);

    document.getElementById('calTooltipEdit').addEventListener('click', () => {
      if (!state.tooltipTaskId) return;
      const found = findTaskById(state.tooltipTaskId);
      if (!found) return;
      hideTooltip();
      openModal(found.date, found.task);
    });

    document.getElementById('calTooltipDone').addEventListener('click', toggleDone);

    document.addEventListener('click', (e) => {
      if ($tooltip.hidden) return;
      if ($tooltip.contains(e.target)) return;
      if (e.target.closest('.cal-task')) return;
      hideTooltip();
    });
  }

  function bindTopbarEvents() {
    document.getElementById('calAddBtn').addEventListener('click', () => {
      openModal(ymd(new Date()));
    });
    document.getElementById('calTodayBtn').addEventListener('click', () => {
      const todayStr = ymd(new Date());
      const el = $scroll.querySelector(`.cal-day[data-date="${todayStr}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // ───────────── 初始化 ─────────────
  async function init() {
    bindEvents();
    bindModalEvents();
    bindTooltipEvents();
    bindTopbarEvents();

    // 当前月 + 前后各 2 个月（时间顺序加载，避免 scroll 补偿问题）
    const now = new Date();
    const months = [];
    for (let i = -2; i <= 2; i++) {
      months.push(monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
    }

    for (const ym of months) {
      try { await loadMonth(ym, false); }
      catch (e) { console.error('[calendar] load failed:', ym, e); }
    }

    // 滚到今天
    const todayStr = ymd(new Date());
    const el = $scroll.querySelector(`.cal-day[data-date="${todayStr}"]`);
    if (el) el.scrollIntoView({ block: 'center' });

    updateLabel();
    $scroll.addEventListener('scroll', updateLabel, { passive: true });
  }

  init();
})();
