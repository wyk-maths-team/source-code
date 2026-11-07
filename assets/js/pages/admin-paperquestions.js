// assets/js/pages/admin-paperquestions.js
// 试卷题目编辑器：一份卷子里所有题都可以在这里改题干 / 答案 / 贴图。
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { track: 'M0', year: 2025, questions: [] };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function toast(msg, ok) {
    const el = $('pqStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#22c55e' : '#ef4444';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.textContent = ''; }, 3500);
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
      state.questions = d.paper.questions || [];
      render();
    } catch (e) {
      $('pqList').innerHTML = '<div class="pq-empty">' + esc(e.message) + '</div>';
    }
  }

  async function loadFull(pid) {
    const d = await api('/api/problem?action=adminEditProblem&id=' + encodeURIComponent(pid));
    return d.problem || null;
  }

  function render() {
    const list = $('pqList');
    list.innerHTML = '';
    state.questions.forEach((q, i) => {
      const card = document.createElement('section');
      card.className = 'pq-card';
      card.dataset.pid = q.id;
      card.innerHTML = `
        <div class="pq-head">
          <span class="pq-no">Q${i + 1}</span>
          <span class="pq-id">${esc(q.id)}</span>
          <a class="pq-preview" href="/problems/${encodeURIComponent(q.id)}" target="_blank">Preview</a>
        </div>
        <div class="pq-field">
          <label>Statement</label>
          <textarea class="pq-stmt" rows="6"></textarea>
          <div class="pq-tools">
            <label class="pq-upload">Upload image<input type="file" accept="image/*" hidden></label>
            <span class="pq-hint">Uploaded images are inserted at the cursor.</span>
          </div>
        </div>
        <div class="pq-field">
          <label>Marking scheme (ans)</label>
          <textarea class="pq-ans" rows="4"></textarea>
        </div>
        <div class="pq-row">
          <button class="pq-save">Save</button>
          <span class="pq-msg"></span>
        </div>`;
      list.appendChild(card);

      const stmt = card.querySelector('.pq-stmt');
      const ans = card.querySelector('.pq-ans');
      const msg = card.querySelector('.pq-msg');
      const saveBtn = card.querySelector('.pq-save');

      // 先把预览塞进去（拿不到完整对象时至少显示已有题干）
      stmt.value = q.statement || '';
      ans.value = '';

      loadFull(q.id).then((p) => {
        if (!p) return;
        stmt.value = p.statement || '';
        ans.value = p.ans || '';
      }).catch(() => {});

      // 图片上传：插到光标处
      const fileInput = card.querySelector('input[type=file]');
      fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        if (f.size > 4 * 1024 * 1024) { msg.textContent = 'Image too large (max 4MB)'; msg.className = 'pq-msg err'; return; }
        msg.textContent = 'Uploading…'; msg.className = 'pq-msg';
        try {
          const dataUrl = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = () => rej(new Error('read failed'));
            fr.readAsDataURL(f);
          });
          const out = await api('/api/problem?action=adminUploadImage', 'POST', { image: dataUrl, problemId: q.id });
          const url = out.url || out.imageUrl;
          if (!url) throw new Error('No URL returned');
          const snippet = '<p><img src="' + url + '" alt="" style="max-width:100%;"></p>';
          const at = stmt.selectionStart || stmt.value.length;
          stmt.value = stmt.value.slice(0, at) + snippet + stmt.value.slice(at);
          msg.textContent = 'Image inserted — remember to Save';
          msg.className = 'pq-msg ok';
        } catch (e) {
          msg.textContent = 'Upload failed: ' + e.message;
          msg.className = 'pq-msg err';
        } finally {
          fileInput.value = '';
        }
      });

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        msg.textContent = 'Saving…'; msg.className = 'pq-msg';
        try {
          await api('/api/problem?action=adminProblems', 'PUT', {
            id: q.id,
            statement: stmt.value,
            ans: ans.value,
          });
          q.statement = stmt.value;
          msg.textContent = 'Saved';
          msg.className = 'pq-msg ok';
        } catch (e) {
          msg.textContent = 'Save failed: ' + e.message;
          msg.className = 'pq-msg err';
        } finally {
          saveBtn.disabled = false;
        }
      });
    });
  }

  Page.boot({ title: 'Edit Paper Questions', requireAuth: true, skeleton: true });
  Page.ready(async (user) => {
    if (user.role !== 'admin' && user.role !== 'root') {
      $('mainContent').innerHTML = '<h2 style="text-align:center;padding:40px;">403 Forbidden</h2>';
      Page.hideSkeleton();
      return;
    }
    const parts = location.pathname.split('/').filter(Boolean);   // admin paper M0 2025 questions
    state.track = decodeURIComponent(parts[2] || 'M0');
    state.year = Number(parts[3]) || 2025;
    const title = $('pqTitle');
    if (title) title.textContent = 'Questions · ' + state.track + ' ' + state.year;
    const back = $('pqBack');
    if (back) back.href = '/admin/paper/' + encodeURIComponent(state.track) + '/' + state.year;

    Page.hideSkeleton();
    await load();
  });
})();
