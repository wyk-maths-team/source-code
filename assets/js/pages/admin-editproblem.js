
    if(isLoggedIn())apiCall('/api/users?action=markAdminVisit', 'POST').catch(() => {});
    const user = getCurrentUser();
    if (!isLoggedIn() || (user?.role !== 'admin' && user?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    const pathMatch = window.location.pathname.match(/^\/admin\/problems\/([^/]+)$/);
    if (!pathMatch) {
      document.getElementById('mainContent').innerHTML = '<div class="error-msg">Invalid URL.</div>';
      throw new Error('No problem ID');
    }
    const problemId = decodeURIComponent(pathMatch[1]);
    document.title = `Edit ${problemId} - WYK Maths Team`;

    const mainContainer = document.getElementById('mainContent');

    // ---- 單次 API：一次拿 problem + discussions ----
    async function loadProblemAndDiscussions() {
      try {
        const data = await apiCall(`/api/problem?action=adminEditProblem&id=${encodeURIComponent(problemId)}&limit=50`);
        if (data.success && data.problem) {
          return { problem: data.problem, discussions: data.discussions || [] };
        }
        return null;
      } catch (err) { console.error(err); return null; }
    }

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    function highlightHTML(code) {
      let escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const latexBlocks = [];
      escaped = escaped.replace(/(\$+)([\s\S]*?)\1/g, (match) => {
        latexBlocks.push(match);
        return `%%LATEX${latexBlocks.length-1}%%`;
      });
      escaped = escaped.replace(/(&lt;\/?)([\w-]+)([\s\S]*?)(\/?&gt;)/g, (match, open, tagName, attrs, close) => {
        let result = `<span class="hl-tag">${open}</span><span class="hl-tag">${tagName}</span>`;
        if (attrs) {
          attrs = attrs.replace(/([\w-]+)(=)(\"[^\"]*\"|'[^']*'|\S+)?/g, (m, attr, eq, val) => {
            let html = `<span class="hl-attr">${attr}</span>`;
            if (eq) html += eq;
            if (val) html += `<span class="hl-value">${val}</span>`;
            return html;
          });
        }
        result += attrs + `<span class="hl-tag">${close}</span>`;
        return result;
      });
      escaped = escaped.replace(/([{}])/g, '<span class="hl-brace">$1</span>');
      escaped = escaped.replace(/%%LATEX(\d+)%%/g, (m, idx) => {
        const latex = latexBlocks[parseInt(idx)];
        return `<span class="hl-latex">${latex}</span>`;
      });
      return escaped;
    }

    function updateHighlight(textarea, pre) { pre.innerHTML = highlightHTML(textarea.value) + '\n'; }
    function updateLineNumbers(textarea, lineNumbersDiv) {
      const lines = textarea.value.split('\n').length;
      let nums = ''; for (let i = 1; i <= lines; i++) nums += i + '\n';
      lineNumbersDiv.textContent = nums;
    }
    function insertTextAtCursor(textarea, text) { textarea.focus(); document.execCommand('insertText', false, text); }
    function wrapSelectionWithExec(textarea, before, after) {
      const start = textarea.selectionStart, end = textarea.selectionEnd;
      const selected = textarea.value.substring(start, end);
      insertTextAtCursor(textarea, before + selected + after);
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = start + before.length + selected.length;
    }

    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
    const selfClosing = new Set(['br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr']);

    // ---- 渲染討論列表（供首次載入與刷新共用） ----
    function renderDiscussionList(container, discussions) {
      if (!container) return;
      if (!discussions || !discussions.length) {
        container.innerHTML = '<p>No discussions.</p>';
        return;
      }

      let html = '';
      discussions.forEach(d => {
        html += `
          <div class="admin-discussion-row" data-id="${d._id}" style="border:1px solid var(--border-color); border-radius:4px; padding:0.7rem; margin-bottom:0.6rem; background:var(--card-bg);">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <div>
                <strong><a href="/users/${encodeURIComponent(d.username)}">${escapeHtml(d.username)}</a></strong>
                <span style="color:var(--text-secondary); font-size:0.85rem; margin-left:0.5rem;">${new Date(d.createdAt).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}</span>
                ${d.likes ? `<span style="color:#e74c3c; margin-left:0.5rem;">❤ ${d.likes}</span>` : ''}
              </div>
              <div>
                <button class="btn btn-danger btn-sm ban-user-btn" data-username="${escapeHtml(d.username)}">
                  <i class="fas fa-user-slash"></i> Ban User
                </button>
              </div>
            </div>
            <div style="margin:0.5rem 0; word-wrap:break-word; white-space:pre-wrap;">${escapeHtml(d.content)}</div>
            <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
              <span>Likes: <input type="number" value="${d.likes || 0}" data-id="${d._id}" class="set-likes-input" style="width:60px; padding:0.2rem;"></span>
              <button class="btn btn-primary btn-sm save-likes-btn" data-id="${d._id}">Set Likes</button>
              <button class="btn btn-danger btn-sm delete-discussion-btn" data-id="${d._id}">Delete Post</button>
            </div>
          </div>
        `;
      });
      container.innerHTML = html;

      if (typeof renderMathInElement !== 'undefined') {
        renderMathInElement(container, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false }
          ]
        });
      }

      container.querySelectorAll('.delete-discussion-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this post?')) return;
          const id = btn.dataset.id;
          btn.disabled = true;
          try {
            const res = await apiCall('/api/problem?action=adminDeleteDiscussion', 'DELETE', { id });
            if (res.success) {
              const row = btn.closest('.admin-discussion-row');
              if (row) {
                row.style.transition = 'opacity 0.2s';
                row.style.opacity = '0';
                setTimeout(() => {
                  row.remove();
                  if (!container.querySelector('.admin-discussion-row')) {
                    container.innerHTML = '<p>No discussions.</p>';
                  }
                }, 200);
              }
            } else {
              (window.DSHUI ? DSHUI.toast(res.message || 'Delete failed', 'err') : alert(res.message || 'Delete failed'));
              btn.disabled = false;
            }
          } catch (e) {
            (window.DSHUI ? DSHUI.toast('Error: ' + e.message, 'err') : alert('Error: ' + e.message));
            btn.disabled = false;
          }
        });
      });

      container.querySelectorAll('.save-likes-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const input = container.querySelector(`.set-likes-input[data-id="${id}"]`);
          const likes = parseInt(input.value, 10);
          if (isNaN(likes)) return (window.DSHUI ? DSHUI.toast('Invalid number', 'err') : alert('Invalid number'));
          try {
            const res = await apiCall('/api/problem?action=adminSetDiscussionLikes', 'PUT', { id, likes });
            if (res.success) {
              (window.DSHUI ? DSHUI.toast('Likes updated', 'ok') : alert('Likes updated'));
              loadAdminDiscussions(problemId);
            } else {
              (window.DSHUI ? DSHUI.toast(res.message || 'Update failed', 'err') : alert(res.message || 'Update failed'));
            }
          } catch (e) { (window.DSHUI ? DSHUI.toast('Error: ' + e.message, 'err') : alert('Error: ' + e.message)); }
        });
      });

      const currentUser = getCurrentUser() || {};
      container.querySelectorAll('.ban-user-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const targetUser = btn.dataset.username;
          if (!targetUser) return;
          if (targetUser === currentUser.username) {
            (window.DSHUI ? DSHUI.toast('You cannot ban yourself.', 'err') : alert('You cannot ban yourself.'));
            return;
          }
          if (!confirm(`Ban user "${targetUser}"? They will be logged out and unable to login.`)) return;
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Banning...';
          try {
            const res = await apiCall(`/api/admin?action=users&username=${encodeURIComponent(targetUser)}`, 'PUT', {
              banned: true
            });
            if (res.success) {
              btn.innerHTML = '<i class="fas fa-check"></i> Banned';
              btn.style.background = '#6c757d';
              btn.style.borderColor = '#6c757d';
              setTimeout(() => { loadAdminDiscussions(problemId); }, 1200);
            } else {
              (window.DSHUI ? DSHUI.toast(res.message || 'Ban failed', 'err') : alert(res.message || 'Ban failed'));
              btn.disabled = false;
              btn.innerHTML = '<i class="fas fa-user-slash"></i> Ban User';
            }
          } catch (e) {
            (window.DSHUI ? DSHUI.toast('Network error: ' + e.message, 'err') : alert('Network error: ' + e.message));
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-user-slash"></i> Ban User';
          }
        });
      });
    }

    // ---- 刷新討論（Set Likes 後使用） ----
    async function loadAdminDiscussions(problemId) {
      const container = document.getElementById('discussionListAdmin');
      if (!container) return;
      container.innerHTML = '<p style="color:var(--text-secondary);">Loading discussions...</p>';
      try {
        const data = await apiCall(`/api/problem?action=discussions&problemId=${encodeURIComponent(problemId)}&limit=50`);
        if (!data.success) {
          container.innerHTML = `<p>Error loading discussions: ${escapeHtml(data.message || 'unknown')}</p>`;
          return;
        }
        renderDiscussionList(container, data.discussions || []);
      } catch (err) {
        console.error('loadAdminDiscussions error:', err);
        container.innerHTML = `<p style="color:var(--danger);">Failed to load discussions: ${escapeHtml(err.message)}</p>`;
      }
    }

    function initCodeEditor(textarea, lineNumbersDiv, highlightPre, toolbar) {
      if (!textarea) return;
      updateLineNumbers(textarea, lineNumbersDiv); updateHighlight(textarea, highlightPre);
      textarea.addEventListener('input', () => { updateLineNumbers(textarea, lineNumbersDiv); updateHighlight(textarea, highlightPre); });
      textarea.addEventListener('scroll', () => { lineNumbersDiv.scrollTop = textarea.scrollTop; highlightPre.scrollTop = textarea.scrollTop; });
      textarea.addEventListener('keydown', function(e) {
        const key = e.key, start = this.selectionStart, end = this.selectionEnd;
        if (Object.prototype.hasOwnProperty.call(pairs, key)) {
          e.preventDefault();
          if (start !== end) wrapSelectionWithExec(this, key, pairs[key]);
          else { insertTextAtCursor(this, key + pairs[key]); this.selectionStart = this.selectionEnd = start + 1; }
          return;
        }
        if (key === 'Backspace' && start === end && start > 0) {
          const leftChar = this.value[start-1], rightChar = this.value[start];
          if (pairs[leftChar] === rightChar) { e.preventDefault(); this.setSelectionRange(start-1, start+1); insertTextAtCursor(this, ''); }
          return;
        }
        if (key === '>' && start === end) {
          const beforeCursor = this.value.substring(0, start);
          const ltIndex = beforeCursor.lastIndexOf('<');
          if (ltIndex !== -1) {
            const afterLt = beforeCursor.substring(ltIndex+1);
            const match = afterLt.match(/^([a-zA-Z][a-zA-Z0-9]*)$/);
            if (match && !selfClosing.has(match[1].toLowerCase())) {
              e.preventDefault();
              insertTextAtCursor(this, `></${match[1]}>`);
              this.selectionStart = this.selectionEnd = start + 1;
            }
          }
        }
      });
      if (toolbar) {
        toolbar.addEventListener('click', function(e) {
          const btn = e.target.closest('button');
          if (!btn) return;
          const template = btn.getAttribute('data-insert');
          if (template) {
            e.preventDefault();
            let text = template;
            let cursorOffset = text.indexOf('...');
            if (cursorOffset === -1) cursorOffset = text.indexOf('{}');
            if (cursorOffset === -1) cursorOffset = text.length;
            text = text.replace('...', '').replace('{}', '');
            insertTextAtCursor(textarea, text);
            if (template.includes('{}')) {
              const idx = text.indexOf('{}');
              if (idx !== -1) textarea.selectionStart = textarea.selectionEnd = textarea.selectionEnd - (text.length - idx - 1);
            } else if (template.includes('...')) {
              textarea.selectionStart = textarea.selectionEnd = textarea.selectionEnd - (text.length - cursorOffset);
            }
          }
        });
      }
    }

    function renderForm(problem, discussions) {
      if (!problem) {
        mainContainer.innerHTML = '<div class="error-msg">Problem not found.</div>';
        return;
      }
      const rawStatement = problem.statement || '';
      const html = `
        <div class="admin-container">
          <h2>Edit Problem: ${escapeHtml(problem.id)}</h2>
          <form id="editForm">
            <div class="form-group"><label>ID: <input type="text" value="${escapeHtml(problem.id)}" /></label><small style="color:#666;">ID cannot be changed</small></div>
            <div class="form-group"><label>Name: <input type="text" id="editName" value="${escapeHtml(problem.name)}" required /></label></div>
            <div class="form-group">
              <label>Statement (HTML / LaTeX):</label>
              <div class="code-editor-wrapper">
                <div class="code-editor-toolbar" id="editToolbar">
                  <button type="button" data-insert="$...$">$...$</button>
                  <button type="button" data-insert="$$...$$">$$...$$</button>
                  <button type="button" data-insert="\\begin{}...\\end{}">\\begin{}...\\end{}</button>
                  <button type="button" data-insert="\\frac{}{}">\\frac{}{}</button>
                  <button type="button" data-insert="\\sqrt{}">\\sqrt{}</button>
                  <button type="button" data-insert="\\sum_{}^{}">\\sum_{}^{}</button>
                  <button type="button" data-insert="\\int_{}^{}">\\int_{}^{}</button>
                  <button type="button" data-insert="\\text{}">\\text{}</button>
                </div>
                <div class="editor-area">
                  <div class="line-numbers" id="lineNumbers"></div>
                  <pre id="editHighlight"></pre>
                  <textarea id="editStatement" rows="10" required></textarea>
                </div>
              </div>
              <div class="img-up-panel" id="imgUpPanel" style="margin-top:1rem;">
                <div class="img-up-bar">
                  <input type="file" id="imgUpInput" accept="image/*" style="display:none">
                  <button type="button" class="btn btn-primary" id="imgUpPickBtn">
                    <i class="fas fa-upload"></i> Upload Image
                  </button>
                  <span class="img-up-hint">Max 2 MB · JPG / PNG / GIF / WebP · 自動壓縮到 1920px</span>
                </div>
                <textarea class="img-up-paste-input" id="imgUpPasteInput" readonly
                  placeholder="Click here and paste images"></textarea>
                <div class="img-up-progress" id="imgUpProgress" style="display:none;">
                  <span class="spinner"></span>
                  <span id="imgUpProgressText">Uploading...</span>
                </div>
                <div class="img-up-result" id="imgUpResult" style="display:none;">
                  <img id="imgUpPreview" class="img-up-preview" alt="preview">
                  <div class="img-up-meta">
                    <div class="img-up-field">
                      <span class="lbl">URL</span>
                      <input type="text" id="imgUpUrl" readonly>
                      <button type="button" class="img-up-copy" id="imgUpCopyUrl"><i class="fas fa-copy"></i> Copy</button>
                    </div>
                    <div class="img-up-field">
                      <span class="lbl">HTML</span>
                      <input type="text" id="imgUpHtml" readonly>
                      <button type="button" class="img-up-copy" id="imgUpCopyHtml"><i class="fas fa-copy"></i> Copy</button>
                    </div>
                    <div class="img-up-field">
                      <span class="lbl">Width</span>
                      <input type="number" id="imgUpWidth" min="40" max="1600" step="10" placeholder="auto">
                      <span class="img-up-hint" style="margin-left:0;">px(Empty=66.67%)</span>
                    </div>
                    <div class="img-up-actions">
                      <button type="button" class="btn btn-primary" id="imgUpInsertBtn">
                        <i class="fas fa-arrow-down"></i> Insert into Statement
                      </button>
                      <button type="button" class="btn btn-secondary" id="imgUpClearBtn">
                        <i class="fas fa-times"></i> Clear
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="form-group"><label>Answer: <input type="text" id="editAns" value="${escapeHtml(problem.ans)}" required /></label></div>
            <div class="form-group">
              <label>Logic (JavaScript function body, returns {score, comment}):</label>
              <textarea id="editLogic" rows="4" style="width:100%; padding:0.5rem; border:1px solid var(--border-color); border-radius:4px; font-family:monospace;"></textarea>
              <small style="color:#666;">Example: <code>(ans, uans) => { let score = (uans === ans) ? 100 : 0; return { score, comment: uans === ans ? 'Correct' : 'Wrong' }; }</code></small>
            </div>
            <div class="form-group"><label>Difficulty: <input type="number" id="editDifficulty" step="0.01" value="${problem.difficulty || 0}" /></label></div>
            <div class="form-group">
              <div class="dc-panel">
                <div class="dc-title"><i class="fas fa-calculator"></i> Difficulty Calculator</div>
                <div class="dc-row">
                  <span class="dc-label">你的 MO 水平：</span>
                  <div class="dc-levels" id="dcLevels">
                    <button type="button" class="dc-level" data-level="5">5</button>
                    <button type="button" class="dc-level" data-level="6">6</button>
                    <button type="button" class="dc-level" data-level="7">7</button>
                    <button type="button" class="dc-level" data-level="8">8</button>
                    <button type="button" class="dc-level" data-level="9">9</button>
                  </div>
                </div>
                <div class="dc-row">
                  <span class="dc-label">解題時間：</span>
                  <span class="dc-time-group">
                    <input type="number" id="dcMin" class="dc-time-input" placeholder="Min" min="0">
                    <span>:</span>
                    <input type="number" id="dcSec" class="dc-time-input" placeholder="Sec" min="0" max="59">
                  </span>
                </div>
                <div class="dc-row" style="flex-direction: column; align-items: flex-start; gap: 0.3rem;">
                  <span class="dc-label" style="min-width: auto;">思維難度 / 解答長度微調：</span>
                  <div class="dc-slider-wrap">
                    <input type="range" id="dcAdjust" min="-0.5" max="0.5" step="0.01" value="0">
                    <span class="dc-slider-val" id="dcAdjustVal">0.00</span>
                    <span class="dc-hint">EZ ← → HD</span>
                  </div>
                </div>
                <div class="dc-row" style="flex-direction: column; align-items: flex-start; gap: 0.3rem;">
                  <span class="dc-label" style="min-width: auto;">投機取巧：</span>
                  <div class="dc-cheat-btns" id="dcCheatBtns">
                    <button type="button" class="dc-cheat-btn active" data-cheat="0">無</button>
                    <button type="button" class="dc-cheat-btn" data-cheat="-0.5">難發現 (−0.5)</button>
                    <button type="button" class="dc-cheat-btn" data-cheat="-1">容易發現 (−1)</button>
                  </div>
                </div>
                <div class="dc-row" style="margin-top: 0.4rem;">
                  <button type="button" class="btn btn-primary" id="dcComputeBtn" style="padding: 0.5rem 1.2rem;">
                    <i class="fas fa-arrow-down"></i> 套用建議難度
                  </button>
                  <button type="button" class="btn btn-secondary" id="dcResetBtn" style="padding: 0.5rem 1rem;">
                    <i class="fas fa-rotate-left"></i> 重置
                  </button>
                </div>
                <div class="dc-result" id="dcResult" style="display:none">
                  <div class="dc-result-row"><span>標準化時間 (Level 5 基準)</span><strong id="dcStdTime">—</strong></div>
                  <div class="dc-result-row"><span>基礎難度</span><strong id="dcBaseDiff">—</strong></div>
                  <div class="dc-result-row"><span>微調比例</span><strong id="dcAdjustShow">0.00</strong></div>
                  <div class="dc-result-row"><span>投機降級</span><strong id="dcCheatShow">0</strong></div>
                  <div class="dc-result-divider"></div>
                  <div class="dc-result-row">
                    <span style="font-weight: 700; color: var(--text-primary);">建議難度</span>
                    <strong id="dcSuggestedDiff" style="color: var(--accent); font-size: 1.35rem;">—</strong>
                  </div>
                </div>
              </div>
            </div>
            <div class="form-group"><label>Tags (comma-separated): <input type="text" id="editTags" value="${(problem.tags || []).join(', ')}" /></label></div>
            <div class="form-group"><label><input type="checkbox" id="editPublic" ${problem.public !== false ? 'checked' : ''}> Public (visible to students)</label></div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="editFS" ${problem.FS === true ? 'checked' : ''}>
                Force Steps mode (reject text submissions)
              </label>
              <small style="color:#666;display:block;margin-top:.3rem;">
                Proof problems: Text submit banned.
              </small>
            </div>
            <div style="margin-top:1.5rem;">
              <button type="submit" class="btn btn-primary">Save Changes</button>
              <a href="/admin/problems" class="btn btn-secondary">Cancel</a>
              <button type="button" class="btn btn-danger" id="deleteProblemBtn">Delete Problem</button>
              <a href="/problems/${encodeURIComponent(problemId)}" class="btn btn-secondary" style="margin-left:0.5rem;" title="View as student">👁️</a>
            </div>
          </form>
          <div id="discussionManage" style="margin-top:2rem; border-top:1px solid var(--border-color); padding-top:1rem;">
            <h3>Manage Discussions</h3>
            <div id="discussionListAdmin"></div>
          </div>
          <div id="message" class="message"></div>
        </div>
      `;
      mainContainer.innerHTML = html;

      const textarea = document.getElementById('editStatement');
      const lineNumbers = document.getElementById('lineNumbers');
      const highlightPre = document.getElementById('editHighlight');
      const toolbar = document.getElementById('editToolbar');
      textarea.value = rawStatement;
      initCodeEditor(textarea, lineNumbers, highlightPre, toolbar);
      document.getElementById('editLogic').value = problem.logic || '';
            // ⭐ 檢測 paper-mount → 渲染答案表格
      (function detectPaper() {
        const m = String(rawStatement || '').match(/<div[^>]*class=["'][^"']*paper-mount[^"']*["'][^>]*>/i);
        if (!m) return;
        const total = parseInt((m[0].match(/data-total=["']?(\d+)/) || [])[1], 10);
        if (!Number.isFinite(total) || total < 1) return;
        renderPaperAnswersTable(m[0], total);
      })();
      // 首次渲染討論（用 adminEditProblem 帶回的資料，不再打第二次 API）
      renderDiscussionList(document.getElementById('discussionListAdmin'), discussions);

      // 圖片上傳
      (function initImageUpload() {
        const panel       = document.getElementById('imgUpPanel');
        const pickBtn     = document.getElementById('imgUpPickBtn');
        const fileInput   = document.getElementById('imgUpInput');
        const pasteInput  = document.getElementById('imgUpPasteInput');
        const progress    = document.getElementById('imgUpProgress');
        const progressTxt = document.getElementById('imgUpProgressText');
        const resultEl    = document.getElementById('imgUpResult');
        const previewEl   = document.getElementById('imgUpPreview');
        const urlEl       = document.getElementById('imgUpUrl');
        const htmlEl      = document.getElementById('imgUpHtml');
        const copyUrlBtn  = document.getElementById('imgUpCopyUrl');
        const copyHtmlBtn = document.getElementById('imgUpCopyHtml');
        const widthEl     = document.getElementById('imgUpWidth');
        const insertBtn   = document.getElementById('imgUpInsertBtn');
        const clearBtn    = document.getElementById('imgUpClearBtn');
        if (!panel) return;

        let currentUrl = '';
        let isUploading = false;

        // ⭐ Statement 光標位置追蹤
        const stmtTA = document.getElementById('editStatement');
        let stmtPos = { start: null, end: null };
        function recordStmtPos() {
          if (!stmtTA) return;
          stmtPos.start = stmtTA.selectionStart;
          stmtPos.end   = stmtTA.selectionEnd;
        }
        if (stmtTA) {
          ['keyup','click','select','input','blur','mouseup'].forEach(ev =>
            stmtTA.addEventListener(ev, recordStmtPos));
        }

        // ⭐ width 留空 → 66.67%（auto 的 2/3）
        function buildImgHtml(url) {
          const w = (widthEl.value || '').trim();
          const style = w
            ? `max-width:${w}px;width:100%;height:auto;display:block;margin:.6rem auto;`
            : `max-width:66.67%;width:100%;height:auto;display:block;margin:.6rem auto;`;
          return `<img src="${url}" alt="problem image" loading="lazy" style="${style}" />`;
        }
        function refreshFields() {
          if (!currentUrl) return;
          urlEl.value = currentUrl;
          htmlEl.value = buildImgHtml(currentUrl);
        }

        function readAndCompress(file, maxWidth = 1920, quality = 0.85) {
          return new Promise((resolve, reject) => {
            if (!file.type.startsWith('image/')) return reject(new Error('Not an image'));
            if (file.size > 2 * 1024 * 1024) return reject(new Error('Image too large (max 2 MB)'));
            const reader = new FileReader();
            reader.onload = (e) => {
              const img = new Image();
              img.onload = () => {
                let w = img.width, h = img.height;
                if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
                const canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
              };
              img.onerror = () => reject(new Error('Cannot decode image'));
              img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('Cannot read file'));
            reader.readAsDataURL(file);
          });
        }

        // ⭐ 把圖片插到 Statement 的記錄光標處（無光標則 append 到末尾）
        function insertImageIntoStatement(url) {
          if (!stmtTA) return;
          const html = buildImgHtml(url);
          let start = stmtPos.start;
          let end   = stmtPos.end;
          if (start === null || start > stmtTA.value.length) {
            start = stmtTA.value.length;
            end   = start;
          }
          const before = stmtTA.value.substring(0, start);
          const after  = stmtTA.value.substring(end);
          const needsNL = before.length > 0 && !before.endsWith('\n');
          const insertText = (needsNL ? '\n' : '') + html + '\n';
          stmtTA.value = before + insertText + after;
          stmtTA.dispatchEvent(new Event('input', { bubbles: true }));
          const newPos = start + insertText.length;
          stmtTA.setSelectionRange(newPos, newPos);
          stmtPos.start = newPos;
          stmtPos.end   = newPos;
        }

        // ⭐ 上传（autoInsert=true 时上传完自动插入）
        async function uploadFile(file, { autoInsert = false } = {}) {
          if (isUploading) return;
          isUploading = true;
          pickBtn.disabled = true;
          resultEl.style.display = 'none';
          progress.style.display = 'flex';
          progressTxt.textContent = 'Compressing...';
          try {
            const base64 = await readAndCompress(file);
            progressTxt.textContent = 'Uploading to GitHub...';
            const res = await apiCall('/api/problem?action=adminUploadImage', 'POST', {
              image: base64,
              problemId,
            });
            if (!res.success) throw new Error(res.message || 'Upload failed');
            currentUrl = res.url;
            previewEl.src = currentUrl;
            urlEl.value = currentUrl;
            htmlEl.value = buildImgHtml(currentUrl);
            resultEl.style.display = 'flex';
            progress.style.display = 'none';
            const msg = document.getElementById('message');
            if (msg) {
              msg.textContent = autoInsert
                ? '✓ 圖片已上傳並插入 Statement。'
                : 'Image uploaded. Use "Insert into Statement" to place it.';
              msg.style.color = '#2e7d32';
            }
            if (autoInsert) insertImageIntoStatement(currentUrl);
          } catch (err) {
            progress.style.display = 'none';
            (window.DSHUI ? DSHUI.toast('Upload failed: ' + err.message, 'err') : alert('Upload failed: ' + err.message));
          } finally {
            isUploading = false;
            pickBtn.disabled = false;
          }
        }

        // ⭐ 從 clipboardData 提取圖片 file
        function extractImageFile(cd) {
          if (!cd || !cd.items) return null;
          for (let i = 0; i < cd.items.length; i++) {
            const it = cd.items[i];
            if (it.kind === 'file' && it.type && it.type.startsWith('image/')) {
              const f = it.getAsFile();
              if (f) return f;
            }
          }
          return null;
        }

        // ⭐ Ctrl+V 粘貼處理（textarea + 全局）
        async function handlePaste(e) {
          const file = extractImageFile(e.clipboardData);
          if (!file) return;                     // 剪貼板無圖片 → 不攔截
          e.preventDefault();
          await uploadFile(file, { autoInsert: true });
        }
        if (pasteInput) pasteInput.addEventListener('paste', handlePaste);
        document.addEventListener('paste', (e) => {
          if (e.target === pasteInput) return;   // 已由上面處理
          handlePaste(e);
        });

        pickBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
          const file = fileInput.files && fileInput.files[0];
          fileInput.value = '';
          if (file) uploadFile(file, { autoInsert: true });
        });
        panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.style.borderColor = 'var(--accent)'; });
        panel.addEventListener('dragleave', () => { panel.style.borderColor = ''; });
        panel.addEventListener('drop', (e) => {
          e.preventDefault(); panel.style.borderColor = '';
          const file = e.dataTransfer?.files?.[0];
          if (file) uploadFile(file, { autoInsert: true });
        });

        async function copyText(text, btn) {
          try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else {
              const ta = document.createElement('textarea');
              ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
              document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
            }
            const old = btn.innerHTML;
            btn.classList.add('done');
            btn.innerHTML = '<i class="fas fa-check"></i> Copied';
            setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = old; }, 1200);
          } catch (err) { (window.DSHUI ? DSHUI.toast('Copy failed: ' + err.message, 'err') : alert('Copy failed: ' + err.message)); }
        }
        copyUrlBtn.addEventListener('click', () => { if (currentUrl) copyText(currentUrl, copyUrlBtn); });
        copyHtmlBtn.addEventListener('click', () => { if (currentUrl) copyText(buildImgHtml(currentUrl), copyHtmlBtn); });
        widthEl.addEventListener('input', refreshFields);

        insertBtn.addEventListener('click', () => {
          if (!currentUrl) return;
          insertImageIntoStatement(currentUrl);
        });
        clearBtn.addEventListener('click', () => {
          currentUrl = ''; previewEl.src = ''; urlEl.value = ''; htmlEl.value = '';
          resultEl.style.display = 'none';
        });
      })();
      // ═══════ Difficulty Calculator ═══════
      const LEVEL_TIME_FACTOR = { 5: 1.00, 6: 0.75, 7: 0.55, 8: 0.40, 9: 0.28 };
      let dcLevel = 5;
      let dcCheat = 0;

      const dcMinEl       = document.getElementById('dcMin');
      const dcSecEl       = document.getElementById('dcSec');
      const dcAdjustEl    = document.getElementById('dcAdjust');
      const dcAdjustVal   = document.getElementById('dcAdjustVal');
      const dcResultEl    = document.getElementById('dcResult');
      const dcStdTimeEl   = document.getElementById('dcStdTime');
      const dcBaseDiffEl  = document.getElementById('dcBaseDiff');
      const dcAdjustShow  = document.getElementById('dcAdjustShow');
      const dcCheatShow   = document.getElementById('dcCheatShow');
      const dcSuggestEl   = document.getElementById('dcSuggestedDiff');
      const dcDifficultyInput = document.getElementById('editDifficulty');

      function computeBaseDifficulty(stdMinutes) {
        if (stdMinutes <= 30) return 1.042 * Math.log(stdMinutes) + 3.696;
        return 0.000688 * stdMinutes * stdMinutes - 0.00657 * stdMinutes + 6.818;
      }
      function computeAll() {
        const min = parseFloat(dcMinEl.value) || 0;
        const sec = parseFloat(dcSecEl.value) || 0;
        const total = min + sec / 60;
        if (total <= 0) { dcResultEl.style.display = 'none'; return null; }
        const factor = LEVEL_TIME_FACTOR[dcLevel] || 1.0;
        const stdMinutes = total / factor;
        const baseDiff = computeBaseDifficulty(stdMinutes);
        const adjust = parseFloat(dcAdjustEl.value) || 0;
        let suggested = baseDiff * (1 + adjust);
        suggested += dcCheat;
        suggested = Math.max(0, Math.min(10, suggested));
        const ratio = 1 + adjust;
        return { total, factor, stdMinutes, baseDiff, adjust, ratio, cheat: dcCheat, suggested };
      }
      function renderResult() {
        const r = computeAll();
        if (!r) { dcResultEl.style.display = 'none'; return; }
        dcResultEl.style.display = 'flex';
        dcStdTimeEl.textContent   = r.stdMinutes.toFixed(2) + ' min';
        dcBaseDiffEl.textContent  = r.baseDiff.toFixed(2);
        dcAdjustShow.textContent  = (r.adjust >= 0 ? '+' : '') + r.adjust.toFixed(2) + ' （×' + r.ratio.toFixed(2) + '）';
        dcCheatShow.textContent   = r.cheat === 0 ? '0' : r.cheat.toFixed(1);
        dcSuggestEl.textContent   = r.suggested.toFixed(2);
      }
      document.querySelectorAll('#dcLevels .dc-level').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#dcLevels .dc-level').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          dcLevel = parseInt(btn.dataset.level, 10);
          renderResult();
        });
      });
      document.querySelector('#dcLevels .dc-level[data-level="5"]').classList.add('active');
      document.querySelectorAll('#dcCheatBtns .dc-cheat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('#dcCheatBtns .dc-cheat-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          dcCheat = parseFloat(btn.dataset.cheat) || 0;
          renderResult();
        });
      });
      dcAdjustEl.addEventListener('input', () => {
        const v = parseFloat(dcAdjustEl.value) || 0;
        dcAdjustVal.textContent = (v >= 0 ? '+' : '') + v.toFixed(1);
        renderResult();
      });
      dcMinEl.addEventListener('input', renderResult);
      dcSecEl.addEventListener('input', renderResult);
      document.getElementById('dcComputeBtn').addEventListener('click', () => {
        const r = computeAll();
        if (!r) { (window.DSHUI ? DSHUI.toast('Please enter a valid time greater than 0.') : alert('Please enter a valid time greater than 0.')); return; }
        dcDifficultyInput.value = r.suggested.toFixed(2);
        dcDifficultyInput.style.transition = 'box-shadow .3s';
        dcDifficultyInput.style.boxShadow = '0 0 0 3px rgba(74,144,217,.5)';
        setTimeout(() => { dcDifficultyInput.style.boxShadow = ''; }, 800);
      });
      document.getElementById('dcResetBtn').addEventListener('click', () => {
        dcMinEl.value = ''; dcSecEl.value = '';
        dcAdjustEl.value = '0'; dcAdjustVal.textContent = '0.00';
        dcCheat = 0;
        document.querySelectorAll('#dcCheatBtns .dc-cheat-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.cheat === '0');
        });
        dcResultEl.style.display = 'none';
      });
      [dcMinEl, dcSecEl].forEach(el => {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); document.getElementById('dcComputeBtn').click(); }
        });
      });
      dcAdjustEl.dispatchEvent(new Event('input'));

      // ---- 提交（成功後返回上一頁） ----
      document.getElementById('editForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('editName').value.trim();
        const statement = document.getElementById('editStatement').value.trim();
        const ans = document.getElementById('editAns').value.trim();
        const difficulty = parseFloat(document.getElementById('editDifficulty').value) || 0;
        const tags = document.getElementById('editTags').value.split(',').map(t => t.trim()).filter(t => t);
        const isPublic = document.getElementById('editPublic').checked;
        const logic = document.getElementById('editLogic').value.trim();
        const FS = document.getElementById('editFS').checked;
        try {
          const result = await apiCall('/api/problem?action=adminProblems', 'PUT', {
            id: problemId, name, statement, ans, difficulty, tags, public: isPublic, logic,FS
          });
          const msgEl = document.getElementById('message');
          msgEl.textContent = result.message;
          msgEl.style.color = result.success ? '#2e7d32' : 'var(--danger)';
          if (result.success) {
            // 保存成功 → 返回上一頁
            setTimeout(() => {
              if (window.history.length > 1) {
                history.back();
              } else {
                window.location.href = '/admin/problems';
              }
            }, 500);
          }
        } catch (err) {
          document.getElementById('message').textContent = 'Error updating problem.';
        }
      });

      // ---- 刪除 ----
      document.getElementById('deleteProblemBtn').addEventListener('click', async () => {
        if (!confirm(`Are you sure you want to delete problem "${problemId}"? This cannot be undone.`)) return;
        try {
          const result = await apiCall('/api/problem?action=adminProblems', 'DELETE', { id: problemId });
          const msgEl = document.getElementById('message');
          msgEl.textContent = result.message;
          msgEl.style.color = result.success ? '#2e7d32' : 'var(--danger)';
          if (result.success) {
            setTimeout(() => { window.location.href = '/admin/problems'; }, 1500);
          }
        } catch (err) {
          document.getElementById('message').textContent = 'Error deleting problem.';
        }
      });
    }
        // ═══════════════ 試卷答案批量編輯 ═══════════════
    async function renderPaperAnswersTable(tagHtml, total) {
      // 找到 statement 那個 .form-group
      const stmtTextarea = document.getElementById('editStatement');
      if (!stmtTextarea) return;
      const stmtGroup = stmtTextarea.closest('.form-group');

      const prefix = problemId.slice(0, -2);
      const lastId = prefix + String(total).padStart(2, '0');

      const wrap = document.createElement('div');
      wrap.id = 'paperAnswersWrap';
      wrap.style.cssText = 'margin:1rem 0; border:1px solid var(--border-color); border-radius:8px; padding:1rem; background:var(--card-bg);';
      wrap.innerHTML = `
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.8rem;flex-wrap:wrap;">
          <i class="fas fa-file-pen" style="color:var(--accent);"></i>
          <strong>Paper Answers (${total} questions)</strong>
          <span style="color:var(--text-secondary);font-size:.82rem;">
            <code>${escapeHtml(prefix)}01</code> ~ <code>${escapeHtml(lastId)}</code>
          </span>
          <span style="flex:1;"></span>
          <button type="button" class="btn btn-primary btn-sm" id="paperSaveBtn" style="padding:.35rem 1rem;">
            <i class="fas fa-save"></i> Save All
          </button>
        </div>
        <div id="paperTableBody">
          <div style="text-align:center;padding:1rem;color:var(--text-secondary);">
            <i class="fas fa-spinner fa-spin"></i> Loading sub-problems...
          </div>
        </div>
        <div id="paperTableMsg" style="margin-top:.5rem;font-size:.85rem;min-height:1.2em;"></div>
      `;

      // 插在 statement .form-group 之後
      stmtGroup.parentNode.insertBefore(wrap, stmtGroup.nextSibling);

      try {
        const res = await apiCall(
          `/api/problem?action=adminPaperQuestions&paperId=${encodeURIComponent(problemId)}`
        );
        if (!res.success) throw new Error(res.message || 'Load failed');
        renderPaperTable(res.questions || [], prefix);
      } catch (err) {
        document.getElementById('paperTableBody').innerHTML =
          `<div style="color:var(--danger);padding:1rem;">Error: ${escapeHtml(err.message)}</div>`;
      }
    }

    function renderPaperTable(questions, prefix) {
      const body = document.getElementById('paperTableBody');
      if (!questions.length) {
        body.innerHTML = '<div style="color:var(--text-secondary);padding:1rem;">No questions.</div>';
        return;
      }

      const inputStyle = `width:100%;padding:4px 8px;border:1px solid var(--border-color);border-radius:4px;font-family:Consolas,monospace;font-size:.85rem;background:var(--card-bg);color:var(--text-primary);outline:none;`;
      const numStyle = `width:72px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-family:Consolas,monospace;font-size:.85rem;text-align:center;background:var(--card-bg);color:var(--text-primary);outline:none;`;

      const rows = questions.map(q => {
        const shortId = q.id.slice(-2);
        return `
          <tr data-qid="${escapeHtml(q.id)}" style="border-bottom:1px solid var(--border-color);">
            <td style="padding:6px 8px;text-align:center;font-family:Consolas,monospace;font-weight:700;color:var(--accent);width:40px;">
              ${escapeHtml(shortId)}
            </td>
            <td style="padding:6px 8px;font-family:Consolas,monospace;font-size:.78rem;color:var(--text-secondary);width:90px;">
              ${escapeHtml(q.id)}
            </td>
            <td style="padding:6px 8px;">
              <input type="text" class="paper-ans-input" data-qid="${escapeHtml(q.id)}"
                     value="${escapeHtml(q.ans || '')}" style="${inputStyle}" placeholder="answer">
            </td>
            <td style="padding:6px 8px;width:90px;">
              <input type="number" step="0.01" class="paper-diff-input" data-qid="${escapeHtml(q.id)}"
                     value="${q.difficulty ?? 5}" style="${numStyle}">
            </td>
            <td style="padding:6px 8px;text-align:center;width:60px;">
              <input type="checkbox" class="paper-public-input" data-qid="${escapeHtml(q.id)}"
                     ${q.public ? 'checked' : ''}>
            </td>
            <td style="padding:6px 8px;text-align:center;width:60px;">
              <span class="paper-exists-badge ${q.exists ? 'ok' : 'new'}"
                    style="font-size:.7rem;font-weight:700;padding:2px 7px;border-radius:8px;">
                ${q.exists ? 'edit' : 'new'}
              </span>
            </td>
          </tr>
        `;
      }).join('');

      body.innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:.9rem;">
          <thead>
            <tr style="border-bottom:2px solid var(--border-color);background:rgba(0,0,0,.02);">
              <th style="padding:7px 8px;text-align:center;font-size:.72rem;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);">#</th>
              <th style="padding:7px 8px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);">ID</th>
              <th style="padding:7px 8px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);">Answer</th>
              <th style="padding:7px 8px;text-align:left;font-size:.72rem;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);">Diff</th>
              <th style="padding:7px 8px;text-align:center;font-size:.72rem;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);">Public</th>
              <th style="padding:7px 8px;text-align:center;font-size:.72rem;text-transform:uppercase;letter-spacing:.4px;color:var(--text-secondary);">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:.6rem;font-size:.78rem;color:var(--text-secondary);">
          <i class="fas fa-info-circle"></i>
          「<b>new</b>」表示此子題尚未建立；按 Save All 會一併建立。
        </div>
        <style>
          .paper-exists-badge.ok  { background:rgba(74,144,217,.15); color:#2a6cb0; }
          .paper-exists-badge.new { background:rgba(255,193,7,.2);  color:#b28500; }
          [data-theme="dark"] .paper-exists-badge.ok  { color:#8ec3ff; }
          [data-theme="dark"] .paper-exists-badge.new { color:#ffd54f; }
          .paper-ans-input:focus, .paper-diff-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(74,144,217,.15);
          }
        </style>
      `;

      // 綁定 Save All
      document.getElementById('paperSaveBtn').addEventListener('click', async () => {
        const btn = document.getElementById('paperSaveBtn');
        const msg = document.getElementById('paperTableMsg');
        if (btn.disabled) return;

        btn.disabled = true;
        const oldHtml = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        msg.textContent = '';

        const list = Array.from(document.querySelectorAll('#paperTableBody tbody tr')).map(tr => {
          const qid = tr.dataset.qid;
          const ans = tr.querySelector('.paper-ans-input').value;
          const difficulty = parseFloat(tr.querySelector('.paper-diff-input').value) || 0;
          const isPublic = tr.querySelector('.paper-public-input').checked;
          return { id: qid, ans, difficulty, public: isPublic };
        });

        try {
          const res = await apiCall('/api/problem?action=adminPaperQuestions', 'PUT', {
            paperId: problemId,
            questions: list,
          });

          if (res.success) {
            msg.style.color = '#2e7d32';
            msg.textContent = `✓ Saved — ${res.created} created, ${res.updated} updated` +
              (res.errors && res.errors.length ? `, ${res.errors.length} errors` : '');

            // 更新 badge：new → edit
            document.querySelectorAll('#paperTableBody tbody tr').forEach(tr => {
              const badge = tr.querySelector('.paper-exists-badge');
              if (badge && badge.classList.contains('new')) {
                badge.classList.remove('new');
                badge.classList.add('ok');
                badge.textContent = 'edit';
              }
            });
          } else {
            msg.style.color = 'var(--danger)';
            msg.textContent = '✗ ' + (res.message || 'Save failed');
          }
        } catch (err) {
          msg.style.color = 'var(--danger)';
          msg.textContent = '✗ ' + err.message;
        } finally {
          btn.disabled = false;
          btn.innerHTML = oldHtml;
          setTimeout(() => { msg.textContent = ''; }, 6000);
        }
      });
    }
    (async function init() {
      const data = await loadProblemAndDiscussions();
      if (!data) {
        mainContainer.innerHTML = '<div class="error-msg">Problem not found.</div>';
        return;
      }
      renderForm(data.problem, data.discussions);
    })();
  