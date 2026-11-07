// assets/js/pages/admin-editpaper.js
// 试卷布局编辑器：拖动每题底部的手柄改画板高度，整份卷子跟着往下推。
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { track: 'M0', year: 2025, items: [], questions: [] };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function toast(msg, ok) {
    const el = $('epStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#22c55e' : '#ef4444';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.textContent = ''; }, 3000);
  }
  async function api(url, method, body) {
    const opts = { method: method || 'GET', headers: {} };
    const t = localStorage.getItem('auth_token');
    if (t) opts.headers['Authorization'] = 'Bearer ' + t;
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const r = await fetch(url, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || d.error || ('HTTP ' + r.status));
    return d;
  }

  async function load() {
    try {
      const d = await api('/api/paper?action=get&track=' + state.track + '&year=' + state.year);
      state.questions = d.paper.questions;
      const byPid = new Map((d.paper.layout.items || []).map((it) => [it.pid, it]));
      state.items = state.questions.map((q, i) => {
        const it = byPid.get(q.id) || {};
        return { pid: q.id, page: it.page || i + 1, height: it.height || 260, statement: q.statement };
      });
      render();
    } catch (e) {
      toast('Load failed: ' + e.message, false);
    }
  }

  function render() {
    const list = $('epList');
    list.innerHTML = '';
    state.items.forEach((it, i) => {
      const card = document.createElement('section');
      card.className = 'ep-card';
      card.innerHTML = `
        <div class="ep-head">
          <span class="ep-no">Q${i + 1}</span>
          <span class="ep-id">${esc(it.pid)}</span>
          <span class="ep-size" id="epSize${i}">${it.height}px</span>
        </div>
        <div class="ep-stmt">${esc(String(it.statement || '').replace(/<[^>]+>/g, ' ').slice(0, 120))}</div>
        <div class="ep-board" id="epBoard${i}" style="height:${it.height}px"></div>
        <div class="ep-handle" data-i="${i}" title="Drag to change the board height">
          <span></span><span></span><span></span>
        </div>`;
      list.appendChild(card);
    });
    bindHandles();
    drawRuledBoards();
  }

  // 画板只是示意：画灰色横线，不接绘画逻辑
  function drawRuledBoards() {
    state.items.forEach((it, i) => {
      const b = document.getElementById('epBoard' + i);
      if (!b) return;
      b.style.backgroundImage = 'repeating-linear-gradient(to bottom, transparent 0px, transparent 27px, rgba(0,0,0,.13) 27px, rgba(0,0,0,.13) 28px)';
      b.style.backgroundPosition = '0 4px';
    });
  }

  function bindHandles() {
    const host = $('epList');
    let drag = null;

    // 全局监听：以前 pointermove 只挂在列表上，最后一题往下拖时指针一旦
    // 离开列表范围（比如滑到页面底部空白或窗口外）事件就断了，手柄跟手
    // 走一小段就停，表现为「每次只能拉一点」。挂到 window 后拖多远都跟手。
    if (bindHandles._bound) {
      window.removeEventListener('pointermove', bindHandles._move);
      window.removeEventListener('pointerup', bindHandles._end);
      window.removeEventListener('pointercancel', bindHandles._end);
    }

    const onMove = (e) => {
      if (!drag) return;
      e.preventDefault();
      const delta = e.clientY - drag.startY;
      const h = Math.max(120, Math.min(2000, Math.round(drag.startH + delta)));
      state.items[drag.i].height = h;
      const board = document.getElementById('epBoard' + drag.i);
      const label = document.getElementById('epSize' + drag.i);
      if (board) board.style.height = h + 'px';
      if (label) label.textContent = h + 'px';

      // 拖到视口上下边缘时自动滚动，长卷子也能一口气拉到底
      const margin = 80;
      if (e.clientY > window.innerHeight - margin) {
        window.scrollBy(0, 14);
      } else if (e.clientY < margin) {
        window.scrollBy(0, -14);
      }
    };

    const end = () => {
      if (!drag) return;
      drag = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    bindHandles._bound = true;
    bindHandles._move = onMove;
    bindHandles._end = end;

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    host.querySelectorAll('.ep-handle').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const i = Number(h.dataset.i);
        drag = { i, startY: e.clientY, startH: state.items[i].height };
        try { h.setPointerCapture(e.pointerId); } catch (err) {}
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'ns-resize';
      });
    });
  }

  async function save() {
    try {
      const items = state.items.map((it) => ({ pid: it.pid, page: it.page, height: it.height }));
      const d = await api('/api/paper?action=saveLayout', 'POST', { track: state.track, year: state.year, items });
      toast('Saved ' + (d.saved || items.length) + ' questions', true);
    } catch (e) {
      toast('Save failed: ' + e.message, false);
    }
  }

  Page.boot({ title: 'Edit Paper', requireAuth: true, skeleton: true });
  Page.ready(async (user) => {
    if (user.role !== 'admin' && user.role !== 'root') {
      $('mainContent').innerHTML = '<h2 style="text-align:center;padding:40px;">403 Forbidden</h2>';
      Page.hideSkeleton();
      return;
    }
    const parts = location.pathname.split('/').filter(Boolean);
    state.track = decodeURIComponent(parts[2] || 'M0');
    state.year = Number(parts[3]) || 2025;
    const title = $('epTitle');
    if (title) title.textContent = 'Layout · ' + state.track + ' ' + state.year;

    const qLink = $('epQuestions');
    if (qLink) qLink.href = '/admin/paper/' + encodeURIComponent(state.track) + '/' + state.year + '/questions';

    $('epSave').addEventListener('click', save);
    $('epReset').addEventListener('click', async () => {
      state.items.forEach((it, i) => { it.height = 260; it.page = i + 1; });
      render();
      toast('Reset to 260px (not saved yet)', true);
    });

    Page.hideSkeleton();
    await load();
  });
})();
