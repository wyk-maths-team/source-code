    if (!isLoggedIn() || (getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    const input = document.getElementById('sqlInput');
    const output = document.getElementById('output');
    const helpBox = document.getElementById('helpBox');

    document.getElementById('helpBtn').addEventListener('click', () => {
      helpBox.style.display = helpBox.style.display === 'block' ? 'none' : 'block';
    });

    // 同步版本按钮
    document.getElementById('syncBtn').addEventListener('click', async () => {
      output.textContent = 'Syncing problems version...';
      try {
        const data = await apiCall('/api/admin?action=syncVersion', 'POST');
        if (data.success) {
          output.textContent = 'Version synced successfully. New version: ' + data.version;
        } else {
          output.textContent = 'Error: ' + (data.message || 'Unknown error');
        }
      } catch (err) {
        output.textContent = 'Error: ' + (err.message || 'Network error');
      }
    });

    document.getElementById('executeBtn').addEventListener('click', async () => {
  const sql = input.value.trim();
  if (!sql) return;

  // 显示当前 SQL 语句（纯文本转义）
  const sqlEscaped = sql.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  output.innerHTML = `<div class="sql-statement"><strong>SQL:</strong> <pre>${sqlEscaped}</pre></div>`;

  // 执行
  try {
    const data = await apiCall('/api/admin?action=terminal', 'POST', { sql });
    if (data.success) {
      if (data.result.tableHtml) {
        // SELECT 结果：直接插入表格 HTML
        output.innerHTML += data.result.tableHtml;
      } else {
        // 其他操作：纯文本显示
        output.innerHTML += `<pre>${JSON.stringify(data.result, null, 2).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`;
      }
    } else {
      output.innerHTML += `<div class="error">Error: ${data.message}</div>`;
    }
  } catch (err) {
    output.innerHTML += `<div class="error">Error: ${err.message}</div>`;
  }
});
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('executeBtn').click();
      }
    });

    // ===== 难度调整 =====
    const diffOutput = document.getElementById('diffOutput');

    document.getElementById('setDifficultyBtn').addEventListener('click', async () => {
      const problemId = document.getElementById('diffProblemId').value.trim();
      const difficulty = document.getElementById('diffValue').value;
      const lock = document.getElementById('diffLock').checked;
      if (!problemId || !difficulty) {
        diffOutput.textContent = 'Please fill in problem id and difficulty.';
        return;
      }
      diffOutput.textContent = 'Setting difficulty...';
      try {
        const data = await apiCall('/api/admin?action=setDifficulty', 'POST', {
          problemId,
          difficulty: Number(difficulty),
          lock,
        });
        diffOutput.textContent = data.success
          ? `Done. problemId=${data.problemId}  difficulty=${data.difficulty}  locked=${data.locked}`
          : 'Error: ' + (data.message || 'Unknown error');
      } catch (err) {
        diffOutput.textContent = 'Error: ' + (err.message || 'Network error');
      }
    });

    document.getElementById('runAdjustBtn').addEventListener('click', async () => {
      diffOutput.textContent = 'Running auto difficulty adjustment...';
      try {
        const data = await apiCall('/api/admin?action=runDifficultyAdjust', 'POST', {});
        if (data.success) {
          const lines = (data.results || []).map(r =>
            r.skipped
              ? `${r.problemId}: skipped (${r.reason})`
              : `${r.problemId}: ${r.newDifficulty}  (Δ${r.delta}, ${r.reason}, n=${r.sampleSize})`
          );
          diffOutput.textContent =
            `Done. total=${data.total}  adjusted=${data.adjusted}  skipped=${data.skipped}\n\n` +
            lines.join('\n');
        } else {
          diffOutput.textContent = 'Error: ' + (data.message || 'Unknown error');
        }
      } catch (err) {
        diffOutput.textContent = 'Error: ' + (err.message || 'Network error');
      }
    });
  