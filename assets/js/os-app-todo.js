/* WYK OS App: Todo List */
(function () {
  window.OSApps = window.OSApps || {};
  const STORAGE_KEY = 'os_todo_items';

  function uid() { return 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

  window.OSApps.todo = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-todo-style';
      style.textContent = `
.todo{display:flex;flex-direction:column;height:100%;background:#f5f7fb;font-family:'Segoe UI',sans-serif;color:#2c3e50}
.todo-header{padding:14px 16px 10px;background:#fff;border-bottom:1px solid #e1e5eb;display:flex;gap:8px}
.todo-input{flex:1;padding:10px 14px;border:1px solid #d0d7e0;border-radius:8px;font-size:14px;font-family:inherit;outline:none;color:#2c3e50}
.todo-input:focus{border-color:#4a90d9;box-shadow:0 0 0 3px rgba(74,144,217,.15)}
.todo-add{padding:10px 20px;border:none;border-radius:8px;background:#4a90d9;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;transition:background .15s}
.todo-add:hover{background:#3a7bc8}
.todo-list{flex:1;overflow-y:auto;padding:8px 12px}
.todo-item{display:flex;align-items:center;gap:10px;padding:11px 12px;background:#fff;border-radius:8px;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,.05);transition:all .15s;border:1px solid transparent}
.todo-item:hover{border-color:#d0d7e0;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.todo-item.done{opacity:.55}
.todo-item.done .todo-text{text-decoration:line-through;color:#8b9bc0}
.todo-check{width:20px;height:20px;border-radius:50%;border:2px solid #d0d7e0;background:#fff;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .15s}
.todo-check:hover{border-color:#4a90d9}
.todo-item.done .todo-check{background:#4a90d9;border-color:#4a90d9;color:#fff}
.todo-check i{font-size:11px;color:#fff;opacity:0;transition:opacity .15s}
.todo-item.done .todo-check i{opacity:1}
.todo-text{flex:1;font-size:14px;line-height:1.4;word-break:break-word}
.todo-del{background:none;border:none;color:#c0c8d4;font-size:15px;cursor:pointer;padding:4px 8px;border-radius:4px;transition:all .15s}
.todo-del:hover{background:#fef2f2;color:#e74c3c}
.todo-empty{text-align:center;padding:60px 20px;color:#8b9bc0;font-size:14px}
.todo-empty i{font-size:48px;opacity:.4;display:block;margin-bottom:12px}
.todo-footer{padding:10px 16px;background:#fff;border-top:1px solid #e1e5eb;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#8b9bc0}
.todo-clear{background:none;border:1px solid #d0d7e0;border-radius:6px;padding:5px 12px;font-size:11.5px;font-weight:600;color:#6b7d8e;cursor:pointer;font-family:inherit}
.todo-clear:hover{background:#fef2f2;color:#e74c3c;border-color:#e74c3c}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'todo';
      wrap.innerHTML = `
        <div class="todo-header">
          <input type="text" class="todo-input" id="todo-input" placeholder="Add a task... (press Enter)" maxlength="200">
          <button class="todo-add" id="todo-add">Add</button>
        </div>
        <div class="todo-list" id="todo-list"></div>
        <div class="todo-footer">
          <span id="todo-count">0 tasks</span>
          <button class="todo-clear" id="todo-clear">Clear Completed</button>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const listEl = $('#todo-list');
      const inputEl = $('#todo-input');

      let items = [];
      try { items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { items = []; }
      if (!Array.isArray(items)) items = [];

      const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {} };

      function render() {
        if (!items.length) {
          listEl.innerHTML = `<div class="todo-empty"><i class="fas fa-clipboard-list"></i>No tasks yet.<br>Add one above to get started.</div>`;
        } else {
          // 未完成先
          const sorted = [...items].sort((a, b) => {
            if (a.done !== b.done) return a.done ? 1 : -1;
            return b.createdAt - a.createdAt;
          });
          listEl.innerHTML = sorted.map(it => `
            <div class="todo-item${it.done ? ' done' : ''}" data-id="${it.id}">
              <button class="todo-check" data-act="toggle" title="${it.done ? 'Mark undone' : 'Mark done'}">
                <i class="fas fa-check"></i>
              </button>
              <span class="todo-text">${ctx.escapeHtml(it.text)}</span>
              <button class="todo-del" data-act="del" title="Delete"><i class="fas fa-times"></i></button>
            </div>
          `).join('');
        }
        const undone = items.filter(i => !i.done).length;
        const done = items.length - undone;
        $('#todo-count').textContent = `${undone} active · ${done} done · ${items.length} total`;
      }

      function addItem() {
        const text = inputEl.value.trim();
        if (!text) return;
        items.push({ id: uid(), text, done: false, createdAt: Date.now() });
        inputEl.value = '';
        save();
        render();
        inputEl.focus();
      }

      $('#todo-add').addEventListener('click', addItem);
      inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

      listEl.addEventListener('click', e => {
        const item = e.target.closest('.todo-item');
        if (!item) return;
        const id = item.dataset.id;
        const target = items.find(i => i.id === id);
        if (!target) return;

        if (e.target.closest('[data-act="toggle"]')) {
          target.done = !target.done;
          save(); render();
        } else if (e.target.closest('[data-act="del"]')) {
          items = items.filter(i => i.id !== id);
          save(); render();
        }
      });

      $('#todo-clear').addEventListener('click', () => {
        const doneCount = items.filter(i => i.done).length;
        if (!doneCount) return;
        if (!confirm(`Remove ${doneCount} completed task${doneCount > 1 ? 's' : ''}?`)) return;
        items = items.filter(i => !i.done);
        save(); render();
      });

      render();
      setTimeout(() => inputEl.focus(), 100);
    },
  };
})();
