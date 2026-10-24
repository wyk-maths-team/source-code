    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    // 从 URL 提取竞赛 ID
    const pathMatch = window.location.pathname.match(/^\/admin\/contests\/(\d+)$/);
    if (!pathMatch) {
      document.getElementById('formContainer').innerHTML = '<div class="error-msg">Invalid contest ID.</div>';
      throw new Error('No ID');
    }
    const contestId = parseInt(pathMatch[1], 10);
    document.title = `Edit Contest #${contestId} - WYK Maths Team`;

    async function loadContest() {
      try {
        const data = await apiCall(`/api/contests?action=adminDetail&id=${contestId}`);
        if (data.success && data.contest) return data.contest;
        return null;
      } catch (err) {
        console.error(err);
        return null;
      }
    }

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }
        /* ⭐ 題目列表解析（與 new.html 相同邏輯） */
    function parseProblemList(text) {
      const out = [];
      const lines = String(text || '').split(/\r?\n/);
      for (const rawLine of lines) {
        let line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('#')) continue;

        let evalType = 'numeric';
        if (/;\s*$/.test(line)) {
          evalType = 'image_model';
          line = line.replace(/;\s*$/, '').trim();
        }
        if (!line) continue;

        out.push({ problemId: line, evalType });
      }
      return out;
    }

    /* ⭐ 把 contest.problems 轉回 textarea 內容 */
    function problemsToText(problems) {
      if (!Array.isArray(problems)) return '';
      return problems.map(p => {
        const id = (typeof p === 'object' && p.problemId) ? p.problemId : String(p || '');
        const isImg = (typeof p === 'object' && p.evalType === 'image_model');
        return isImg ? `${id};` : id;
      }).join('\n');
    }

    function updateProblemListPreview() {
      const input = document.getElementById('problemListInput');
      const preview = document.getElementById('problemListPreview');
      if (!input || !preview) return;
      const problems = parseProblemList(input.value);
      if (!problems.length) {
        preview.style.display = 'none';
        return;
      }
      preview.style.display = 'block';
      preview.innerHTML = problems.map((p, i) => `
        <div class="pv-row">
          <span style="color:#8b9bc0;font-size:.72rem;min-width:22px;">#${i + 1}</span>
          <span class="pv-id">${escapeHtml(p.problemId)}</span>
          <span class="pv-type ${p.evalType === 'image_model' ? 'image' : 'numeric'}">
            ${p.evalType === 'image_model' ? 'Photo' : 'Numeric'}
          </span>
        </div>
      `).join('');
    }

    function renderForm(contest) {
      const container = document.getElementById('formContainer');
      if (!contest) {
        container.innerHTML = '<div class="error-msg">Contest not found.</div>';
        return;
      }

      const startTimeLocal = contest.startTime
  ? (() => {
      const d = new Date(contest.startTime);
      // 如果日期无效，返回空
      if (isNaN(d.getTime())) return '';
      // 转为北京时间（Asia/Hong_Kong）
      const localStr = d.toLocaleString('sv', { timeZone: 'Asia/Hong_Kong' });
      return localStr.replace(' ', 'T').slice(0, 16);
    })()
  : '';

      const participantsStr = (contest.participants || []).join(', ');

      let html = `
        <h2>Edit Contest #${contest.id}</h2>
        <form id="editContestForm">
          <div class="form-group">
            <label for="contestName">Name *</label>
            <input type="text" id="contestName" value="${escapeHtml(contest.name)}" required>
          </div>

          <div class="form-group">
            <label for="startTime">Start Time *</label>
            <input type="datetime-local" id="startTime" value="${startTimeLocal}" required>
          </div>

          <div class="form-group">
            <label for="duration">Duration (minutes, max 2016000) *</label>
            <input type="number" id="duration" min="1" max="2016000" value="${contest.duration}" required>
          </div>

                    <div class="form-group">
            <label for="problemListInput">Problems</label>
            <textarea
              class="problem-list-input"
              id="problemListInput"
              rows="10"
              placeholder="每行一道題，格式：&#10;A001&#10;A002&#10;A003;&#10;A004&#10;&#10;行末加分號 ; 表示 Photo（圖片評分），否則為 Numeric（數值評分）"
              spellcheck="false"></textarea>
            <div class="problem-list-hint">
              每行一道題：<code>A001</code> → Numeric，<code>A001;</code> → Photo。
              空行和 <code># 開頭</code> 的行會被忽略。
            </div>
            <div class="problem-list-preview" id="problemListPreview" style="display:none"></div>
          </div>

          <div class="form-group">
            <label for="participants">Participants (comma separated usernames)</label>
            <textarea id="participants" rows="3">${escapeHtml(participantsStr)}</textarea>
          </div>

          <div class="form-group">
            <label>
              <input type="checkbox" id="isPublic" ${contest.public !== false ? 'checked' : ''}> Public
            </label>
          </div>
                    <div class="form-group">
            <label>
              <input type="checkbox" id="isSpecial" ${contest.special === true ? 'checked' : ''}>
              <strong>Special Contest (Team Mode)</strong>
            </label>
            <small style="color: var(--text-secondary); display:block; margin-top: 4px;">
              Warning: testing
              <br><strong style="color: var(--danger);">Warning</strong>locked once competition starts
            </small>
          </div>

          <div class="form-group">
            <button type="submit" class="btn btn-primary">Save Changes</button>
            <a href="/admin/contest" class="btn btn-secondary">Cancel</a>
            <button type="button" id="deleteBtn" class="btn btn-danger">Delete</button>
          </div>
        </form>
        <div id="message" class="message"></div>
      `;

      container.innerHTML = html;

      // ⭐ 把 contest.problems 填進 textarea
      const problemListInput = document.getElementById('problemListInput');
      problemListInput.value = problemsToText(contest.problems || []);
      problemListInput.addEventListener('input', updateProblemListPreview);
      updateProblemListPreview();

      // 提交修改
      document.getElementById('editContestForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('contestName').value.trim();
        const startTime = document.getElementById('startTime').value;
        const duration = parseInt(document.getElementById('duration').value, 10);
        const participantsStr = document.getElementById('participants').value.trim();
        const isPublic = document.getElementById('isPublic').checked;

        // ⭐ 從 textarea 解析題目列表
        const problems = parseProblemList(
          document.getElementById('problemListInput').value
        );
        

        const participants = participantsStr.split(',').map(u => u.trim()).filter(u => u);

        try {
                  if (!problems.length) {
          const msgEl = document.getElementById('message');
          msgEl.textContent = 'Please add at least one problem.';
          msgEl.style.color = 'var(--danger)';
          return;
        }
                    const isSpecial = document.getElementById('isSpecial').checked;
          const result = await apiCall(`/api/contests?action=adminUpdate&id=${contestId}`, 'PUT', {
            name,
            startTime: new Date(startTime).toISOString(),
            duration,
            problems,
            participants,
            public: isPublic,
            special: isSpecial
          });
          const msgEl = document.getElementById('message');
          if (result.success) {
            msgEl.textContent = 'Contest updated!';
            msgEl.style.color = '#2e7d32';
          } else {
            msgEl.textContent = result.message || 'Error';
            msgEl.style.color = 'var(--danger)';
          }
        } catch (err) {
          document.getElementById('message').textContent = 'Network error';
          document.getElementById('message').style.color = 'var(--danger)';
        }
      });

      // 删除竞赛
      document.getElementById('deleteBtn').addEventListener('click', async () => {
        if (!confirm(`Delete contest #${contestId}?`)) return;
        try {
          const result = await apiCall('/api/contests?action=adminDelete', 'DELETE', { id: contestId });
          if (result.success) {
            window.location.href = '/admin/contest';
          } else {
            (window.DSHUI ? DSHUI.toast(result.message) : alert(result.message));
          }
        } catch (err) {
          (window.DSHUI ? DSHUI.toast('Error deleting', 'err') : alert('Error deleting'));
        }
      });
    }

    (async function init() {
      const contest = await loadContest();
      renderForm(contest);
    })();
  