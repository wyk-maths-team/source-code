/* WYK OS App: Notepad */
(function () {
  window.OSApps = window.OSApps || {};
  window.OSApps.notepad = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.textContent = `
.notepad{display:flex;flex-direction:column;height:100%;background:#1e1e1e;color:#d4d4d4}
.notepad-toolbar{display:flex;gap:8px;padding:8px 10px;background:#252526;border-bottom:1px solid #333;align-items:center;flex-shrink:0}
.np-btn{padding:5px 12px;background:#3a3a3d;color:#d4d4d4;border:1px solid #4a4a4d;border-radius:4px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600}
.np-btn:hover{background:#4a4a4d}
.np-status{margin-left:auto;font-size:11px;color:#7a8aa8;font-family:Consolas,monospace}
.np-status + .np-status{margin-left:12px}
#np-text{flex:1;width:100%;padding:14px;border:none;outline:none;background:#1e1e1e;color:#d4d4d4;font-family:'Fira Code','Consolas',monospace;font-size:13px;line-height:1.6;resize:none;tab-size:2}
#np-text::placeholder{color:#555}`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'notepad';
      wrap.innerHTML = `
        <div class="notepad-toolbar">
          <button id="np-new" class="np-btn">New</button>
          <button id="np-save" class="np-btn">Save as TXT</button>
          <span class="np-status" id="np-info"></span>
          <span class="np-status" id="np-status"></span>
        </div>
        <textarea id="np-text" spellcheck="false" placeholder="Start typing..."></textarea>`;
      container.appendChild(wrap);

      const text    = wrap.querySelector('#np-text');
      const statusEl = wrap.querySelector('#np-status');
      const infoEl   = wrap.querySelector('#np-info');
      const STORAGE_KEY = 'os_notepad_content';

      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) text.value = saved;
      } catch (e) {}

      function updateInfo() {
        const lines = text.value.split('\n').length;
        infoEl.textContent = `${lines} lines · ${text.value.length} chars`;
      }

      let saveTimer = null;
      text.addEventListener('input', () => {
        updateInfo();
        statusEl.textContent = 'Saving...';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          try {
            localStorage.setItem(STORAGE_KEY, text.value);
            statusEl.textContent = 'Saved ✓';
            setTimeout(() => { if (statusEl.textContent === 'Saved ✓') statusEl.textContent = ''; }, 1500);
          } catch (e) { statusEl.textContent = 'Save failed'; }
        }, 500);
      });

      wrap.querySelector('#np-new').addEventListener('click', () => {
        if (text.value && !confirm('Discard current content?')) return;
        text.value = ''; updateInfo(); statusEl.textContent = '';
        localStorage.removeItem(STORAGE_KEY);
      });
      wrap.querySelector('#np-save').addEventListener('click', () => {
        const blob = new Blob([text.value], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'notepad-' + Date.now() + '.txt';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      });

      updateInfo();
      setTimeout(() => text.focus(), 100);
    },
  };
})();
