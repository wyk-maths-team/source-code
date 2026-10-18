
    // 权限检查
    if(isLoggedIn())apiCall('/api/users?action=markAdminVisit', 'POST').catch(() => {});
    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    const pathMatch = window.location.pathname.match(/\/admin\/marker\/([^/]+)$/);
    if (!pathMatch) {
      document.getElementById('mainContent').innerHTML = '<div class="error-msg">Invalid URL.</div>';
      throw new Error('No subid');
    }
    const subid = decodeURIComponent(pathMatch[1]);
    document.title = `Marking ${subid} - WYK Maths Team`;

    const mainContainer = document.getElementById('mainContent');

    async function loadSubmission() {
      try {
        const data = await apiCall(`/api/admin?action=markerDetail&subid=${encodeURIComponent(subid)}`);
        if (!data.success || !data.submission) {
          return null;
        }
        return data.submission;
      } catch (err) {
        console.error(err);
        return null;
      }
    }

    function escapeHtml(s) { return (window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); }; }

    let currentRotation = 0;

    async function renderForm() {
      const submission = await loadSubmission();
      if (!submission) {
        mainContainer.innerHTML = '<div class="error-msg">Submission not found or already marked.</div>';
        return;
      }

      const alreadyMarked = submission.marked === true;
      const markedNotice = alreadyMarked ? '<p style="color: var(--danger);">⚠️ This submission has already been marked. Editing is allowed.</p>' : '';

      const html = `
        <div class="marker-container">
          <h2>Mark Submission ${escapeHtml(subid)}</h2>
          ${markedNotice}
          <div class="submission-info">
            <p><strong>Student:</strong> ${escapeHtml(submission.username)}</p>
            <p><strong>Problem:</strong> ${escapeHtml(submission.problemId)}</p>
            <p><strong>Submitted at:</strong> ${new Date(submission.timestamp).toLocaleString()}</p>
          </div>

          <div id="problemStatement" class="problem-statement" style="display:none;"></div>

          ${submission.image ? `
            <div class="image-container">
              <button class="rotate-btn" id="rotateLeftBtn">↺ Rotate Left</button>
              <button class="rotate-btn" id="rotateRightBtn">↻ Rotate Right</button>
              <button class="rotate-btn" id="resetRotationBtn">↺ Reset</button>
            </div>
            <img src="${submission.image}" alt="Submission image" class="image-preview" id="submissionImage" onerror="this.style.display='none'; this.parentElement.innerHTML+='<p style=color:var(--danger)>Image failed to load</p>'">
          ` : '<p>No image attached.</p>'}

          <form id="markForm">
            <div class="form-group">
              <label for="scoreInput">Score (0-100)</label>
              <input type="number" id="scoreInput" name="score" min="0" max="100" required value="${submission.score || 0}">
            </div>
            <div class="form-group">
              <label for="commentBox">Comment</label>
              <textarea id="commentBox" name="comment" rows="4">${escapeHtml(submission.comment || '')}</textarea>
            </div>
            <div style="margin-top: 1.5rem;">
              <button type="submit" class="btn btn-primary">Save Mark</button>
              <a href="/admin/marker" class="btn btn-secondary">Cancel</a>
            </div>
          </form>
          <div id="message" class="message"></div>
        </div>
      `;

      mainContainer.innerHTML = html;

      // 加载题目内容
      const problemId = submission.problemId;
      const statementDiv = document.getElementById('problemStatement');
      try {
        const probData = await apiCall(`/api/problem?id=${encodeURIComponent(problemId)}`);
        if (probData.success && probData.problem) {
          const statement = probData.problem.statement;
          const cleanStatement = DOMPurify.sanitize(statement, {
            ALLOWED_TAGS: [
              'b','i','u','strong','em','a','p','br','ul','ol','li','span','div','code','pre',
              'svg','g','defs','clipPath','foreignObject','path','circle','line','polyline','polygon','rect','text','tspan',
              'linearGradient','radialGradient','stop','image','use'
            ],
            ALLOWED_ATTR: [
              'href','target','rel','class','id','style',
              'xmlns','viewBox','width','height','d','cx','cy','r','x','y','x1','x2','y1','y2','points',
              'fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','fill-opacity','stroke-opacity','opacity',
              'font-size','text-anchor','dominant-baseline','transform'
            ]
          });
          statementDiv.innerHTML = cleanStatement;
          statementDiv.style.display = 'block';

          if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(statementDiv, {
              delimiters: [
                {left: '$$', right: '$$', display: true},
                {left: '$', right: '$', display: false}
              ]
            });
          }
        }
      } catch (err) {
        console.error('Failed to load problem statement', err);
      }

      // 图片旋转功能
      const imageEl = document.getElementById('submissionImage');
      if (imageEl) {
        document.getElementById('rotateLeftBtn').addEventListener('click', () => {
          currentRotation -= 90;
          imageEl.style.transform = `rotate(${currentRotation}deg)`;
        });
        document.getElementById('rotateRightBtn').addEventListener('click', () => {
          currentRotation += 90;
          imageEl.style.transform = `rotate(${currentRotation}deg)`;
        });
        document.getElementById('resetRotationBtn').addEventListener('click', () => {
          currentRotation = 0;
          imageEl.style.transform = 'rotate(0deg)';
        });
      }

      // 表单提交事件
      document.getElementById('markForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const score = parseInt(document.getElementById('scoreInput').value, 10);
        const comment = document.getElementById('commentBox').value.trim();

        if (isNaN(score) || score < 0 || score > 100) {
          document.getElementById('message').textContent = 'Score must be between 0 and 100.';
          document.getElementById('message').style.color = 'var(--danger)';
          return;
        }

        try {
          const result = await apiCall('/api/admin?action=markSubmit', 'PUT', {
            subid,
            score,
            comment
          });
          const msgEl = document.getElementById('message');
          if (result.success) {
            msgEl.textContent = 'Mark saved successfully!';
            msgEl.style.color = '#2e7d32';
            setTimeout(() => {
              window.location.href = '/admin/marker';
            }, 1500);
          } else {
            msgEl.textContent = result.message || 'Error saving mark.';
            msgEl.style.color = 'var(--danger)';
          }
        } catch (err) {
          document.getElementById('message').textContent = 'Network error.';
          document.getElementById('message').style.color = 'var(--danger)';
        }
      });
    }

    renderForm();
  