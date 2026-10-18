/* WYK OS App: Notes (Markdown + LaTeX) */
(function () {
  window.OSApps = window.OSApps || {};
  const STORAGE_KEY = 'os_notes_list';
  const SEL_KEY     = 'os_notes_selected';
  const CDN = 'https://cdn.jsdelivr.net/npm/';
  const _loaded = new Set();

  function loadOnce(url) {
    if (_loaded.has(url)) return Promise.resolve();
    if (document.querySelector(`script[src="${url}"]`)) { _loaded.add(url); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => { _loaded.add(url); resolve(); };
      s.onerror = () => reject(new Error('Failed: ' + url));
      document.head.appendChild(s);
    });
  }
  function loadCssOnce(url) {
    if (document.querySelector(`link[href="${url}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = url;
    document.head.appendChild(l);
  }

  const uid = () => 'n-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

  window.OSApps.notes = {
    async mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-notes-style';
      style.textContent = `
.notes{display:flex;height:100%;background:#fff;font-family:'Segoe UI',sans-serif;color:#2c3e50}
.notes-side{width:220px;flex-shrink:0;background:#f5f7fb;border-right:1px solid #e1e5eb;display:flex;flex-direction:column}
.notes-side-head{padding:12px;border-bottom:1px solid #e1e5eb;display:flex;gap:6px}
.notes-new{flex:1;padding:8px;border:none;border-radius:6px;background:#4a90d9;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit}
.notes-new:hover{background:#3a7bc8}
.notes-list{flex:1;overflow-y:auto;padding:6px}
.notes-item{padding:9px 10px;border-radius:6px;cursor:pointer;font-size:13px;color:#4a5568;margin-bottom:2px;display:flex;align-items:center;gap:8px;transition:background .15s;overflow:hidden}
.notes-item:hover{background:#e8f2ff}
.notes-item.active{background:#d6e9ff;color:#1a3a6a;font-weight:600}
.notes-item-title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.notes-item-del{opacity:0;background:none;border:none;color:#c0c8d4;cursor:pointer;font-size:11px;padding:2px 4px;border-radius:3px;transition:opacity .15s,color .15s}
.notes-item:hover .notes-item-del{opacity:1}
.notes-item-del:hover{color:#e74c3c;background:#fef2f2}
.notes-empty{text-align:center;padding:30px 12px;color:#8b9bc0;font-size:12px}
.notes-main{flex:1;display:flex;flex-direction:column;min-width:0}
.notes-toolbar{padding:10px 12px;border-bottom:1px solid #e1e5eb;background:#fff;display:flex;gap:8px;align-items:center}
.notes-title-input{flex:1;padding:7px 12px;border:1px solid #d0d7e0;border-radius:6px;font-size:14px;font-family:inherit;outline:none;font-weight:600;color:#2c3e50}
.notes-title-input:focus{border-color:#4a90d9}
.notes-status{font-size:11px;color:#8b9bc0;font-family:'Consolas',monospace;flex-shrink:0}
.notes-body{flex:1;display:flex;min-height:0}
.notes-editor,.notes-preview{flex:1;overflow-y:auto;padding:18px;min-width:0}
.notes-editor{border-right:1px solid #e1e5eb;border:none;outline:none;resize:none;font-family:'Fira Code','Consolas',monospace;font-size:13.5px;line-height:1.7;background:#fafbfc;color:#2c3e50;white-space:pre-wrap;word-wrap:break-word}
.notes-preview{background:#fff;font-size:14px;line-height:1.7}
.notes-preview h1,.notes-preview h2,.notes-preview h3{margin:16px 0 8px;font-weight:700;color:#1a3a6a}
.notes-preview h1{font-size:1.5em;border-bottom:2px solid #e1e5eb;padding-bottom:4px}
.notes-preview h2{font-size:1.25em}
.notes-preview p{margin:8px 0}
.notes-preview code{background:#f0f2f5;padding:2px 6px;border-radius:4px;font-family:'Consolas',monospace;font-size:.9em;color:#c7254e}
.notes-preview pre{background:#1e1e1e;color:#d4d4d4;padding:12px;border-radius:6px;overflow-x:auto;margin:12px 0}
.notes-preview pre code{background:none;color:inherit;padding:0}
.notes-preview blockquote{border-left:3px solid #4a90d9;padding:4px 14px;margin:10px 0;color:#6b7d8e;background:#f5f7fb}
.notes-preview ul,.notes-preview ol{padding-left:24px;margin:8px 0}
.notes-preview a{color:#4a90d9}
.notes-preview img{max-width:100%;border-radius:6px}
.notes-preview table{border-collapse:collapse;margin:12px 0;width:100%}
.notes-preview th,.notes-preview td{border:1px solid #e1e5eb;padding:6px 10px;text-align:left}
.notes-preview th{background:#f5f7fb;font-weight:700}
.notes-placeholder{display:flex;align-items:center;justify-content:center;height:100%;color:#8b9bc0;font-size:14px;text-align:center;padding:20px}
@media (max-width: 620px) {
  .notes-side{width: 140px}
  .notes-body{flex-direction: column}
  .notes-editor{border-right:none;border-bottom:1px solid #e1e5eb;max-height:45%}
}
`;
      container.appendChild(style);

      // 動態加載渲染庫
      try {
        loadCssOnce(CDN + 'katex@0.16.10/dist/katex.min.css');
        await loadOnce(CDN + 'marked/marked.min.js');
        await loadOnce(CDN + 'katex@0.16.10/dist/katex.min.js');
        await loadOnce(CDN + 'katex@0.16.10/dist/contrib/auto-render.min.js');
      } catch (e) {
        console.warn('Notes: library load failed', e);
      }

      const wrap = document.createElement('div');
      wrap.className = 'notes';
      wrap.innerHTML = `
        <div class="notes-side">
          <div class="notes-side-head">
            <button class="notes-new" id="notes-new"><i class="fas fa-plus"></i> New Note</button>
          </div>
          <div class="notes-list" id="notes-list"></div>
        </div>
        <div class="notes-main">
          <div class="notes-toolbar">
            <input type="text" class="notes-title-input" id="notes-title" placeholder="Note title" maxlength="80">
            <span class="notes-status" id="notes-status"></span>
          </div>
          <div class="notes-body">
            <textarea class="notes-editor" id="notes-editor" placeholder="Write in Markdown... LaTeX supported with $...$ or $$...$$" spellcheck="false"></textarea>
            <div class="notes-preview" id="notes-preview"></div>
          </div>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const listEl = $('#notes-list');
      const titleEl = $('#notes-title');
      const editorEl = $('#notes-editor');
      const previewEl = $('#notes-preview');
      const statusEl = $('#notes-status');

      let notes = [];
      try { notes = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) {}
      if (!Array.isArray(notes)) notes = [];
      let selectedId = localStorage.getItem(SEL_KEY) || null;
      if (!notes.find(n => n.id === selectedId)) selectedId = notes[0]?.id || null;

      const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); } catch (e) {} };

      function renderList() {
        if (!notes.length) {
          listEl.innerHTML = `<div class="notes-empty">No notes yet.<br>Click <b>+ New Note</b> to start.</div>`;
          return;
        }
        listEl.innerHTML = notes.map(n => `
          <div class="notes-item${n.id === selectedId ? ' active' : ''}" data-id="${n.id}">
            <span class="notes-item-title">${ctx.escapeHtml(n.title || 'Untitled')}</span>
            <button class="notes-item-del" data-act="del" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        `).join('');
      }

      function renderEditor() {
        const n = notes.find(x => x.id === selectedId);
        if (!n) {
          titleEl.value = '';
          editorEl.value = '';
          previewEl.innerHTML = `<div class="notes-placeholder"><div><i class="fas fa-book-open" style="font-size:48px;opacity:.3;display:block;margin-bottom:12px;"></i>Select or create a note</div></div>`;
          titleEl.disabled = true;
          editorEl.disabled = true;
          return;
        }
        titleEl.disabled = false;
        editorEl.disabled = false;
        titleEl.value = n.title || '';
        editorEl.value = n.content || '';
        renderPreview();
      }

      function renderPreview() {
        const raw = editorEl.value || '';
        let html = '';
        if (typeof marked !== 'undefined') {
          try { html = marked.parse(raw); } catch (e) { html = '<p style="color:red">Markdown error</p>'; }
        } else {
          html = `<pre>${ctx.escapeHtml(raw)}</pre>`;
        }
        previewEl.innerHTML = html;
        if (typeof renderMathInElement !== 'undefined') {
          try {
            renderMathInElement(previewEl, {
              delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
                { left: '\\[', right: '\\]', display: true },
              ],
              throwOnError: false,
            });
          } catch (e) {}
        }
      }

      let saveTimer = null;
      function scheduleSave() {
        statusEl.textContent = 'Saving...';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          const n = notes.find(x => x.id === selectedId);
          if (n) {
            n.content = editorEl.value;
            n.updatedAt = Date.now();
            save();
          }
          statusEl.textContent = 'Saved ✓';
          setTimeout(() => { if (statusEl.textContent === 'Saved ✓') statusEl.textContent = ''; }, 1500);
        }, 600);
      }

      // 事件
      $('#notes-new').addEventListener('click', () => {
        const n = { id: uid(), title: 'Untitled', content: '', createdAt: Date.now(), updatedAt: Date.now() };
        notes.unshift(n);
        selectedId = n.id;
        localStorage.setItem(SEL_KEY, selectedId);
        save();
        renderList();
        renderEditor();
        titleEl.focus();
        titleEl.select();
      });

      listEl.addEventListener('click', e => {
        const item = e.target.closest('.notes-item');
        if (!item) return;
        const id = item.dataset.id;
        if (e.target.closest('[data-act="del"]')) {
          const n = notes.find(x => x.id === id);
          if (!n) return;
          if (!confirm(`Delete note "${n.title || 'Untitled'}"?`)) return;
          notes = notes.filter(x => x.id !== id);
          if (selectedId === id) selectedId = notes[0]?.id || null;
          localStorage.setItem(SEL_KEY, selectedId || '');
          save();
          renderList();
          renderEditor();
          return;
        }
        if (id === selectedId) return;
        selectedId = id;
        localStorage.setItem(SEL_KEY, selectedId);
        renderList();
        renderEditor();
      });

      titleEl.addEventListener('input', () => {
        const n = notes.find(x => x.id === selectedId);
        if (!n) return;
        n.title = titleEl.value;
        save();
        // 只更新對應列表項文字，避免整表重繪
        const row = listEl.querySelector(`.notes-item[data-id="${CSS.escape(selectedId)}"] .notes-item-title`);
        if (row) row.textContent = titleEl.value || 'Untitled';
      });

      editorEl.addEventListener('input', () => {
        renderPreview();
        scheduleSave();
      });

      renderList();
      renderEditor();
    },
  };
})();
