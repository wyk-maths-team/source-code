    // ===== 权限检查 =====
    if (!isLoggedIn() || getCurrentUser()?.role !== 'root') {
      window.location.href = '/index.html';
    }

    // ===== Tab 切换 =====
    const tabs = document.querySelectorAll('.cmd-tab');
    const panels = {
      server: document.getElementById('panel-server'),
      db: document.getElementById('panel-db')
    };
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const mode = tab.dataset.mode;
        Object.keys(panels).forEach(key => {
          panels[key].classList.toggle('active', key === mode);
        });
      });
    });

    // ===== 帮助折叠 =====
    document.querySelectorAll('.help-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (target) target.style.display = target.style.display === 'block' ? 'none' : 'block';
      });
    });

    // ===== 执行逻辑 =====
    const serverInput = document.getElementById('serverInput');
    const serverOutput = document.getElementById('serverOutput');
    const serverExecBtn = document.getElementById('serverExecBtn');
    const dbInput = document.getElementById('dbInput');
    const dbOutput = document.getElementById('dbOutput');
    const dbExecBtn = document.getElementById('dbExecBtn');

    async function executeCommand(mode, code) {
      const outputEl = mode === 'server' ? serverOutput : dbOutput;
      outputEl.textContent = 'Executing...';
      try {
        const result = await apiCall('/api/admin?action=cmd', 'POST', { mode, code });
        if (result.success) {
          let out = result.output || '';
          if (result.result !== undefined && result.result !== null) {
            out += '\n' + JSON.stringify(result.result, null, 2);
          }
          outputEl.textContent = out || 'Done (no output)';
        } else {
          outputEl.textContent = 'Error: ' + (result.message || 'Unknown error');
        }
      } catch (err) {
        outputEl.textContent = 'Network error: ' + err.message;
      }
    }

    serverExecBtn.addEventListener('click', () => {
      const code = serverInput.value.trim();
      if (!code) return;
      executeCommand('server', code);
    });
    dbExecBtn.addEventListener('click', () => {
      const code = dbInput.value.trim();
      if (!code) return;
      executeCommand('db', code);
    });

    // Ctrl+Enter 快捷键
    serverInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        serverExecBtn.click();
      }
    });
    dbInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dbExecBtn.click();
      }
    });
  