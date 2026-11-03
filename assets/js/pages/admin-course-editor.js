// 课程编辑器：/admin/create/course（新建） 与 /admin/course/:id?track=M（编辑）
(function () {
  'use strict';
  const u = getCurrentUser();
  if (!u || (u.role !== 'admin' && u.role !== 'root')) { location.href = '/index.html'; return; }
  Page.boot({ title: 'Course Editor', requireAuth: true });

  const parts = location.pathname.split('/').filter(Boolean);   // admin/(create/course|course/:id)
  const isEdit = parts[1] === 'course' && parts[2] && parts[2] !== 'create';
  const originId = isEdit ? decodeURIComponent(parts[2]) : '';
  const queryTrack = new URLSearchParams(location.search).get('track') || '';

  const el = (id) => document.getElementById(id);
  const trackSel = el('ceTrack');
  const idInput = el('ceId');
  const topicInput = el('ceTopic');
  const diffSel = el('ceDifficulty');
  const contentInput = el('ceContent');
  const saveBtn = el('ceSave');
  const msg = el('ceMsg');
  const preview = el('cePreview');

  function setMsg(text, kind) {
    msg.textContent = text || '';
    msg.className = 'ce-msg' + (kind ? ' ' + kind : '');
  }

  function renderMath(node) {
    if (!node || typeof window.renderMathInElement !== 'function') return;
    try {
      window.renderMathInElement(node, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* ignore */ }
  }

  // 预览：把 <div pid> 换成占位框，保证布局和真页面一致
  function updatePreview() {
    if (!preview) return;
    preview.innerHTML = contentInput.value || '<p style="color:var(--text-secondary);">Nothing to preview yet.</p>';

    preview.querySelectorAll('[pid]').forEach((ph) => {
      const stub = document.createElement('div');
      stub.className = 'ce-prob-stub';
      stub.innerHTML = '<i class="fas fa-square-poll-vertical"></i> Problem <b>' +
        ph.getAttribute('pid').replace(/[<>&"]/g, '') + '</b> will render here';
      ph.replaceWith(stub);
    });

    renderMath(preview);
  }

  let previewTimer = null;
  contentInput.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 300);
  });

  async function loadExisting() {
    if (!isEdit) { setMsg(''); return; }
    if (!queryTrack) { setMsg('Missing ?track= — open this from the course list.', 'err'); saveBtn.disabled = true; return; }

    try {
      const data = await API.get('/api/course?action=adminGet&track=' + encodeURIComponent(queryTrack) + '&id=' + encodeURIComponent(originId));
      const c = data.course;
      trackSel.value = c.track;
      idInput.value = c.id;
      topicInput.value = c.topic || '';
      diffSel.value = c.difficulty || 'easy';
      contentInput.value = c.content || '';
      updatePreview();
    } catch (e) {
      setMsg(e.message || 'Failed to load course', 'err');
      saveBtn.disabled = true;
    }
  }

  saveBtn.addEventListener('click', async () => {
    const track = trackSel.value;
    const id = idInput.value.trim();
    const topic = topicInput.value.trim();
    const difficulty = diffSel.value;
    const content = contentInput.value;

    if (!id) { setMsg('ID is required', 'err'); return; }

    saveBtn.disabled = true;
    setMsg('Saving…', '');

    try {
      if (isEdit) {
        const res = await API.post('/api/course?action=adminUpdate', {
          track: queryTrack, id: originId, newId: id, topic, difficulty, content,
        });
        if (!res.success) throw new Error(res.message || 'Save failed');
        setMsg('Saved', 'ok');
        if (id !== originId) {
          // id 改了，URL 同步更新
          history.replaceState(null, '', '/admin/course/' + encodeURIComponent(id) + '?track=' + encodeURIComponent(track));
        }
      } else {
        const res = await API.post('/api/course?action=adminCreate', { track, id, topic, difficulty, content });
        if (!res.success) throw new Error(res.message || 'Create failed');
        setMsg('Created', 'ok');
        setTimeout(() => { location.href = '/admin/course'; }, 600);
      }
    } catch (e) {
      setMsg(e.message || 'Save failed', 'err');
    } finally {
      saveBtn.disabled = false;
    }
  });

  Page.ready(async () => {
    if (isEdit) {
      document.getElementById('ceTitle').textContent = 'Edit Course';
      if (queryTrack) trackSel.value = queryTrack;
      idInput.value = originId;
    }
    await loadExisting();
    updatePreview();
  });
})();
