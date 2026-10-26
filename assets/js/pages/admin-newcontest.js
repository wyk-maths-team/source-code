    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    /* ⭐ 題目列表解析 */
    const problemListInput = document.getElementById('problemListInput');
    const problemListPreview = document.getElementById('problemListPreview');

    /**
     * 解析 textarea → problems 陣列
     * 規則：
     *   每行一道題
     *   去除首尾空白後為空 → 略過
     *   以 # 開頭 → 註解，略過
     *   行末有 ; （允許分號前後有空白）→ image_model
     *   否則 → numeric
     */
    function parseProblemList(text) {
      const out = [];
      const lines = String(text || '').split(/\r?\n/);
      for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#')) continue;

        let evalType = 'numeric';
        // 檢查行末是否有分號（允許 ; 前有空白，; 後無其他字）
        if (/;\s*$/.test(line)) {
          evalType = 'image_model';
          line = line.replace(/;\s*$/, '').trim();
        }
        if (!line) continue;

        out.push({ problemId: line, evalType });
      }
      return out;
    }

    /* ⭐ 即時預覽 */
    function updateProblemListPreview() {
      const problems = parseProblemList(problemListInput.value);
      if (!problems.length) {
        problemListPreview.style.display = 'none';
        return;
      }
      problemListPreview.style.display = 'block';
      problemListPreview.innerHTML = problems.map((p, i) => `
        <div class="pv-row">
          <span style="color:#8b9bc0;font-size:.72rem;min-width:22px;">#${i + 1}</span>
          <span class="pv-id">${escapeHtml(p.problemId)}</span>
          <span class="pv-type ${p.evalType === 'image_model' ? 'image' : 'numeric'}">
            ${p.evalType === 'image_model' ? 'Photo' : 'Numeric'}
          </span>
        </div>
      `).join('');
    }

    problemListInput.addEventListener('input', updateProblemListPreview);

    document.getElementById('newContestForm').addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('contestName').value.trim();
      const startTime = document.getElementById('startTime').value;
      const duration = parseInt(document.getElementById('duration').value, 10);
      const participantsInput = document.getElementById('participants').value.trim();
      const isPublic = document.getElementById('isPublic').checked;

      if (!name || !startTime || !duration) {
        document.getElementById('message').textContent = 'Please fill in all required fields.';
        return;
      }

      // ⭐ 先解析 problems，再做檢查
      const problems = parseProblemList(problemListInput.value);
      if (!problems.length) {
        document.getElementById('message').textContent = 'Please add at least one problem.';
        document.getElementById('message').style.color = 'var(--danger)';
        return;
      }

      const participants = participantsInput.split(',').map(u => u.trim()).filter(u => u);

            const body = {
        name,
        startTime: new Date(startTime).toISOString(),
        duration,
        problems,
        participants,
        public: isPublic,
        special: document.getElementById('isSpecial').checked
      };

      try {
        const result = await apiCall('/api/contests?action=adminCreate', 'POST', body);
        if (result.success) {
          document.getElementById('message').style.color = '#2e7d32';
          document.getElementById('message').textContent = `Contest created with ID: ${result.id}. Redirecting...`;
          setTimeout(() => { window.location.href = '/admin/contest'; }, 1500);
        } else {
          document.getElementById('message').style.color = 'var(--danger)';
          document.getElementById('message').textContent = result.message || 'Error';
        }
      } catch (err) {
        document.getElementById('message').style.color = 'var(--danger)';
        document.getElementById('message').textContent = 'Network error';
      }
    });

  