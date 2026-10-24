    if (!isLoggedIn() || (getCurrentUser()?.role !== 'admin' && getCurrentUser()?.role !== 'root')) {
      window.location.href = '/index.html';
    }

    function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    function highlightHTML(code) {
      let escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const latexBlocks = [];
      escaped = escaped.replace(/(\$+)([\s\S]*?)\1/g, (match, delim, content) => {
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

    function getCurrentTimeString() {
      const d = new Date();
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    }

    // 初始化編輯器
    const textarea = document.getElementById('newContent');
    const lineNumbers = document.getElementById('newContentLineNumbers');
    const highlightPre = document.getElementById('newContentHighlight');
    const toolbar = document.getElementById('newContentToolbar');
    initCodeEditor(textarea, lineNumbers, highlightPre, toolbar);

    // 提交
    document.getElementById('newUpdateForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const badge = document.getElementById('newBadge').value;
      const badgeText = document.getElementById('newBadgeText').value.trim();
      const title = document.getElementById('newTitle').value.trim();
      const content = document.getElementById('newContent').value.trim();
      const locked = document.getElementById('newLocked').checked;
      const time = getCurrentTimeString();

      if (!badgeText || !content) {
        const msgEl = document.getElementById('message');
        msgEl.textContent = 'Please fill in badge text and content.';
        msgEl.style.color = 'var(--danger)';
        return;
      }

      try {
        const result = await apiCall('/api/updates?action=adminCreate', 'POST', {
          badge, badgeText, time, title, content, locked
        });
        const msgEl = document.getElementById('message');
        msgEl.textContent = result.message;
        msgEl.style.color = result.success ? '#2e7d32' : 'var(--danger)';

        if (result.success) {
          // 清空內容欄位，保留 badge / locked 方便連續創建
          document.getElementById('newBadgeText').value = '';
          document.getElementById('newTitle').value = '';
          document.getElementById('newContent').value = '';
          updateLineNumbers(textarea, lineNumbers);
          updateHighlight(textarea, highlightPre);
          msgEl.textContent = `"${badgeText}" created. Ready for next.`;
          document.getElementById('newBadgeText').focus();
        }
      } catch (err) {
        const msgEl = document.getElementById('message');
        msgEl.textContent = 'Error creating update.';
        msgEl.style.color = 'var(--danger)';
      }
    });

    document.getElementById('newBadgeText').focus();
  