
    const user = getCurrentUser();
    if (!isLoggedIn() || (user?.role !== 'admin' && user?.role !== 'root')) {
      window.location.href = '/index.html';
      throw new Error('Forbidden');
    }
    const isRoot = user?.role === 'root';

    // 支持 /admin/updates/<id> 和 /admin/updates/edit/<id> 两种路径
    const pathMatch = window.location.pathname.match(/^\/admin\/updates\/(?:edit\/)?([^/]+)$/);
    if (!pathMatch) {
      document.getElementById('mainContent').innerHTML = '<div class="error-msg">Invalid URL.</div>';
      throw new Error('No update ID');
    }
    const updateId = decodeURIComponent(pathMatch[1]);
    const mainContainer = document.getElementById('mainContent');

    // ═══════════ 工具函数（与 editproblem 一致） ═══════════
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
            let h = `<span class="hl-attr">${attr}</span>`;
            if (eq) h += eq;
            if (val) h += `<span class="hl-value">${val}</span>`;
            return h;
          });
        }
        result += attrs + `<span class="hl-tag">${close}</span>`;
        return result;
      });
      escaped = escaped.replace(/([{}])/g, '<span class="hl-brace">$1</span>');
      escaped = escaped.replace(/%%LATEX(\d+)%%/g, (m, idx) =>
        `<span class="hl-latex">${latexBlocks[parseInt(idx)]}</span>`);
      return escaped;
    }

    function updateHighlight(textarea, pre) { pre.innerHTML = highlightHTML(textarea.value) + '\n'; }
    function updateLineNumbers(textarea, div) {
      const lines = textarea.value.split('\n').length;
      let nums = '';
      for (let i = 1; i <= lines; i++) nums += i + '\n';
      div.textContent = nums;
    }
    function insertTextAtCursor(textarea, text) {
      textarea.focus();
      document.execCommand('insertText', false, text);
    }
    function wrapSelectionWithExec(textarea, before, after) {
      const start = textarea.selectionStart, end = textarea.selectionEnd;
      const selected = textarea.value.substring(start, end);
      insertTextAtCursor(textarea, before + selected + after);
      textarea.selectionStart = start + before.length;
      textarea.selectionEnd = start + before.length + selected.length;
    }

    const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
    const selfClosing = new Set(['br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr']);

    function initCodeEditor(textarea, lineNumbersDiv, highlightPre, toolbar) {
      if (!textarea) return;
      updateLineNumbers(textarea, lineNumbersDiv);
      updateHighlight(textarea, highlightPre);
      textarea.addEventListener('input', () => {
        updateLineNumbers(textarea, lineNumbersDiv);
        updateHighlight(textarea, highlightPre);
      });
      textarea.addEventListener('scroll', () => {
        lineNumbersDiv.scrollTop = textarea.scrollTop;
        highlightPre.scrollTop = textarea.scrollTop;
      });
      textarea.addEventListener('keydown', function (e) {
        const key = e.key, start = this.selectionStart, end = this.selectionEnd;
        if (Object.prototype.hasOwnProperty.call(pairs, key)) {
          e.preventDefault();
          if (start !== end) wrapSelectionWithExec(this, key, pairs[key]);
          else { insertTextAtCursor(this, key + pairs[key]); this.selectionStart = this.selectionEnd = start + 1; }
          return;
        }
        if (key === 'Backspace' && start === end && start > 0) {
          const l = this.value[start-1], r = this.value[start];
          if (pairs[l] === r) { e.preventDefault(); this.setSelectionRange(start-1, start+1); insertTextAtCursor(this, ''); }
          return;
        }
        if (key === '>' && start === end) {
          const before = this.value.substring(0, start);
          const lt = before.lastIndexOf('<');
          if (lt !== -1) {
            const afterLt = before.substring(lt + 1);
            const m = afterLt.match(/^([a-zA-Z][a-zA-Z0-9]*)$/);
            if (m && !selfClosing.has(m[1].toLowerCase())) {
              e.preventDefault();
              insertTextAtCursor(this, `></${m[1]}>`);
              this.selectionStart = this.selectionEnd = start + 1;
            }
          }
        }
      });
      if (toolbar) {
        toolbar.addEventListener('click', function (e) {
          const btn = e.target.closest('button');
          if (!btn || btn.disabled) return;
          const template = btn.getAttribute('data-insert');
          if (!template) return;
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
        });
      }
    }

    // ═══════════ 加载 update ═══════════
    async function loadUpdate() {
      try {
        const data = await apiCall(`/api/updates?action=adminList&id=${encodeURIComponent(updateId)}`);
        if (data.success && data.update) return data.update;
        return null;
      } catch (err) {
        console.error('loadUpdate failed:', err);
        return null;
      }
    }

    // ═══════════ 渲染 ═══════════
    function renderForm(u) {
      const canDelete = isRoot || !u.locked;
      const readOnly = u.locked && !isRoot;

      const badgeOptions = ['info', 'new', 'warning'].map(b =>
        `<option value="${b}"${u.badge === b ? ' selected' : ''}>${b[0].toUpperCase() + b.slice(1)}</option>`
      ).join('');

      const createdLine = u.date
        ? ` · Created ${new Date(u.date).toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' })}`
        : '';

      const html = `
        <div class="admin-container">
          <h2 style="margin-top:0;">Edit Update</h2>

          ${u.locked ? `
            <div class="locked-banner">
              <i class="fas fa-lock"></i>
              This update is <b>locked</b>. ${isRoot ? 'Only you (root) can edit it.' : 'Only root can edit or delete it.'}
            </div>
          ` : ''}

          <div class="meta-info">
            <i class="fas fa-fingerprint"></i>
            ID: <code>${escapeHtml(u._id)}</code>${createdLine}
          </div>

          <form id="editUpdateForm">
            <div class="form-group">
              <label>Badge Style:
                <select id="editBadge" required ${readOnly ? 'disabled' : ''}>${badgeOptions}</select>
              </label>
            </div>
            <div class="form-group">
              <label>Badge Text: <input type="text" id="editBadgeText" required ${readOnly ? 'disabled' : ''} /></label>
            </div>
            <div class="form-group">
              <label>Title (optional): <input type="text" id="editTitle" ${readOnly ? 'disabled' : ''} /></label>
            </div>
            <div class="form-group">
              <label>Content (HTML / LaTeX):</label>
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
                  <button type="button" data-insert="<...>">&lt;...&gt;</button>
                  <button type="button" data-insert="<... />">&lt;... /&gt;</button>
                </div>
                <div class="editor-area">
                  <div class="line-numbers" id="editLineNumbers"></div>
                  <pre id="editHighlight"></pre>
                  <textarea id="editContent" rows="8" required ${readOnly ? 'disabled' : ''}></textarea>
                </div>
              </div>
            </div>
            ${isRoot ? `
              <div class="form-group">
                <label>
                  <input type="checkbox" id="editLocked"${u.locked ? ' checked' : ''}>
                  Locked (only root can delete/edit)
                </label>
              </div>
            ` : ''}
            <div style="margin-top:1.5rem;">
              <button type="submit" class="btn btn-primary" ${readOnly ? 'disabled' : ''}>
                <i class="fas fa-save"></i> ${readOnly ? 'Locked' : 'Save Changes'}
              </button>
              <a href="/admin/updates" class="btn btn-secondary">Cancel</a>
              ${canDelete ? `
                <button type="button" class="btn btn-danger" id="deleteBtn" style="margin-left:0.5rem;">
                  <i class="fas fa-trash"></i> Delete
                </button>
              ` : ''}
            </div>
          </form>
          <div id="message" class="message"></div>
        </div>
      `;
      mainContainer.innerHTML = html;

      // 填值
      document.getElementById('editBadgeText').value = u.badgeText || '';
      document.getElementById('editTitle').value = u.title || '';

      const textarea = document.getElementById('editContent');
      const lineNumbers = document.getElementById('editLineNumbers');
      const highlightPre = document.getElementById('editHighlight');
      const toolbar = document.getElementById('editToolbar');

      textarea.value = u.content || '';
      initCodeEditor(textarea, lineNumbers, highlightPre, toolbar);

      // 只读时禁用工具栏
      if (readOnly) {
        toolbar.querySelectorAll('button').forEach(b => b.disabled = true);
      }

      // ═══════════ 保存 ═══════════
      document.getElementById('editUpdateForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (readOnly) return;

        const msgEl = document.getElementById('message');
        const badge = document.getElementById('editBadge').value;
        const badgeText = document.getElementById('editBadgeText').value.trim();
        const title = document.getElementById('editTitle').value.trim();
        const content = textarea.value.trim();
        const locked = isRoot ? document.getElementById('editLocked')?.checked : undefined;

        if (!badgeText || !content) {
          msgEl.textContent = 'Badge text and content are required.';
          msgEl.style.color = 'var(--danger)';
          return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        const oldText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

        try {
          const body = { id: u._id, badge, badgeText, title, content };
          if (isRoot && locked !== undefined) body.locked = locked;

          const result = await apiCall('/api/updates?action=adminUpdate', 'PUT', body);
          msgEl.textContent = result.message || (result.success ? 'Saved' : 'Failed');
          msgEl.style.color = result.success ? '#2e7d32' : 'var(--danger)';

          if (result.success) {
            setTimeout(() => {
              if (window.history.length > 1) history.back();
              else window.location.href = '/admin/updates';
            }, 500);
          } else {
            submitBtn.disabled = false;
            submitBtn.innerHTML = oldText;
          }
        } catch (err) {
          msgEl.textContent = 'Error: ' + err.message;
          msgEl.style.color = 'var(--danger)';
          submitBtn.disabled = false;
          submitBtn.innerHTML = oldText;
        }
      });

      // ═══════════ 删除 ═══════════
      const delBtn = document.getElementById('deleteBtn');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (!confirm(`Delete this update "${u.badgeText}"?\n\nThis cannot be undone.`)) return;
          delBtn.disabled = true;
          delBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
          try {
            const result = await apiCall('/api/updates?action=adminDelete', 'DELETE', { id: u._id });
            if (result.success) {
              window.location.href = '/admin/updates';
            } else {
              (window.DSHUI ? DSHUI.toast(result.message || 'Delete failed', 'err') : alert(result.message || 'Delete failed'));
              delBtn.disabled = false;
              delBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
            }
          } catch (err) {
            (window.DSHUI ? DSHUI.toast('Delete error: ' + err.message, 'err') : alert('Delete error: ' + err.message));
            delBtn.disabled = false;
            delBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
          }
        });
      }
    }

    // ═══════════ 启动 ═══════════
    (async function init() {
      const update = await loadUpdate();
      if (!update) {
        mainContainer.innerHTML = '<div class="error-msg">Update not found.</div>';
        return;
      }
      document.title = `Edit "${update.badgeText}" - WYK Maths Team`;
      renderForm(update);
    })();
  