
    const me = getCurrentUser();
    if (!isLoggedIn() || (me?.role !== 'admin' && me?.role !== 'root')) {
      window.location.href = '/index.html';
      throw new Error('Forbidden');
    }

    const pathMatch = location.pathname.match(/^\/admin\/pkproblems\/([^/]+)$/);
    const idFromPath = pathMatch ? decodeURIComponent(pathMatch[1]) : new URLSearchParams(location.search).get('id');
    if (!idFromPath) {
      document.getElementById('mainContent').innerHTML =
        '<div style="text-align:center;padding:60px;color:var(--danger)">Missing problem ID</div>';
      throw new Error('No id');
    }
        // ═══════════════ 图片上传 ═══════════════
    const pkImgPick      = document.getElementById('pkImgPick');
    const pkImgFile      = document.getElementById('pkImgFile');
    const pkImgProgress  = document.getElementById('pkImgProgress');
    const pkImgProgressTxt = document.getElementById('pkImgProgressText');
    const pkImgResult    = document.getElementById('pkImgResult');
    const pkImgPreview   = document.getElementById('pkImgPreview');
    const pkImgUrl       = document.getElementById('pkImgUrl');
    const pkImgHtml      = document.getElementById('pkImgHtml');
    const pkImgWidth     = document.getElementById('pkImgWidth');
    const pkImgInsert    = document.getElementById('pkImgInsert');
    const pkImgCopyUrl   = document.getElementById('pkImgCopyUrl');
    const pkImgCopyHtml  = document.getElementById('pkImgCopyHtml');

    let uploadedImageUrl = '';

    function buildImgHtml(url) {
      const w = (pkImgWidth.value || '').trim();
      const style = w
        ? `max-width:${w}px;width:100%;height:auto;display:block;margin:.6rem auto;`
        : `max-width:66.67%;width:100%;height:auto;display:block;margin:.6rem auto;`;
      return `<img src="${url}" alt="problem image" loading="lazy" style="${style}" />`;
    }

    function refreshImageFields() {
      if (!uploadedImageUrl) return;
      pkImgUrl.value = uploadedImageUrl;
      pkImgHtml.value = buildImgHtml(uploadedImageUrl);
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

    async function uploadImage(file) {
      pkImgPick.disabled = true;
      pkImgResult.classList.remove('show');
      pkImgProgress.classList.add('show');
      pkImgProgressTxt.textContent = 'Compressing…';
      try {
        const base64 = await readAndCompress(file);
        pkImgProgressTxt.textContent = 'Uploading to GitHub…';
        const res = await apiCall('/api/problem?action=adminUploadImage', 'POST', {
          image: base64,
          problemId: idFromPath,
        });
        if (!res.success) throw new Error(res.message || 'Upload failed');
        uploadedImageUrl = res.url;
        pkImgPreview.src = res.url;
        refreshImageFields();
        pkImgResult.classList.add('show');
        pkImgProgress.classList.remove('show');
        pkMsg.textContent = '✓ Image uploaded';
        pkMsg.style.color = '#2e7d32';
      } catch (err) {
        pkImgProgress.classList.remove('show');
        pkMsg.textContent = 'Upload failed: ' + err.message;
        pkMsg.style.color = 'var(--danger)';
      } finally {
        pkImgPick.disabled = false;
      }
    }

    pkImgPick.addEventListener('click', () => pkImgFile.click());
    pkImgFile.addEventListener('change', () => {
      const f = pkImgFile.files && pkImgFile.files[0];
      pkImgFile.value = '';
      if (f) uploadImage(f);
    });
    pkImgWidth.addEventListener('input', refreshImageFields);

    // ⭐ Ctrl+V 粘贴图片上传
    document.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        // 只看文件类型的项
        if (it.kind !== 'file') continue;
        if (!it.type || !it.type.startsWith('image/')) continue;

        const file = it.getAsFile();
        if (!file) continue;

        // 阻止把二进制垃圾或文件名文本粘进 textarea
        e.preventDefault();

        // 覆盖式地触发上传（跟选文件同一个流程）
        uploadImage(file);
        return;
      }
    });

    pkImgInsert.addEventListener('click', () => {
      if (!uploadedImageUrl) return;
      const ta = document.getElementById('pkStatement');
      const html = buildImgHtml(uploadedImageUrl);
      const pos = ta.selectionStart ?? ta.value.length;
      const before = ta.value.slice(0, pos);
      const after  = ta.value.slice(pos);
      const nl = (before.length && !before.endsWith('\n')) ? '\n' : '';
      ta.value = before + nl + html + '\n' + after;
      const newPos = pos + nl.length + html.length + 1;
      ta.setSelectionRange(newPos, newPos);
      ta.focus();
    });

    function copyTo(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        const old = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => { btn.innerHTML = old; }, 1200);
      }).catch(() => (window.DSHUI ? DSHUI.toast('Copy failed', 'err') : alert('Copy failed')));
    }
    pkImgCopyUrl.addEventListener('click', () => { if (uploadedImageUrl) copyTo(uploadedImageUrl, pkImgCopyUrl); });
    pkImgCopyHtml.addEventListener('click', () => { if (uploadedImageUrl) copyTo(buildImgHtml(uploadedImageUrl), pkImgCopyHtml); });
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let choices = ['', '', '', ''];
    let currentAns = 'A';

    function esc(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

    function renderChoices() {
      const wrap = document.getElementById('pkChoices');
      wrap.innerHTML = choices.map((c, i) => `
        <div class="choice-row">
          <span class="letter">${LETTERS[i]}</span>
          <input type="text" data-idx="${i}" value="${esc(c)}" placeholder="Option ${LETTERS[i]}" />
          ${choices.length > 2
            ? `<button type="button" class="rm" data-rm="${i}" title="Remove"><i class="fas fa-times"></i></button>`
            : ''}
        </div>
      `).join('');

      wrap.querySelectorAll('input[data-idx]').forEach(inp => {
        inp.addEventListener('input', () => {
          choices[Number(inp.dataset.idx)] = inp.value;
        });
      });
      wrap.querySelectorAll('button[data-rm]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.rm);
          choices.splice(idx, 1);
          if (choices.length < 2) choices.push('');
          // 修正 ans
          if (LETTERS.indexOf(currentAns) >= choices.length) {
            currentAns = LETTERS[0];
          }
          renderChoices();
          renderAnsPicker();
        });
      });
    }

    function renderAnsPicker() {
      const wrap = document.getElementById('pkAnsPicker');
      wrap.innerHTML = choices.map((_, i) => {
        const L = LETTERS[i];
        return `
          <label class="${currentAns === L ? 'active' : ''}" data-ans="${L}">
            <input type="radio" name="ans" value="${L}" ${currentAns === L ? 'checked' : ''} />
            ${L}
          </label>
        `;
      }).join('');
      wrap.querySelectorAll('label[data-ans]').forEach(lbl => {
        lbl.addEventListener('click', () => {
          currentAns = lbl.dataset.ans;
          renderAnsPicker();
        });
      });
    }

    document.getElementById('pkAddChoice').addEventListener('click', () => {
      if (choices.length >= 10) return (window.DSHUI ? DSHUI.toast('Max 10 options', 'err') : alert('Max 10 options'));
      choices.push('');
      renderChoices();
      renderAnsPicker();
    });

    async function load() {
      document.getElementById('pkId').textContent = idFromPath;
      try {
        const data = await apiCall(`/api/admin-pkproblem?action=get&id=${encodeURIComponent(idFromPath)}`);
        if (!data.success) throw new Error(data.message);
        const p = data.problem;
        document.getElementById('pkStatement').value = p.statement || '';
        choices = Array.isArray(p.choice) && p.choice.length >= 2 ? [...p.choice] : ['', '', '', ''];
        currentAns = String(p.ans || 'A').toUpperCase();
        renderChoices();
        renderAnsPicker();
      } catch (err) {
        document.getElementById('pkMsg').textContent = 'Load failed: ' + err.message;
        document.getElementById('pkMsg').style.color = 'var(--danger)';
      }
    }

    document.getElementById('pkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('pkSaveBtn');
      const msg = document.getElementById('pkMsg');
      const statement = document.getElementById('pkStatement').value;

      if (choices.some(c => !c.trim())) {
        msg.textContent = 'All options must be filled';
        msg.style.color = 'var(--danger)';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
      msg.textContent = '';

      try {
        const res = await apiCall('/api/admin-pkproblem?action=update', 'PUT', {
          id: idFromPath,
          statement,
          choice: choices,
          ans: currentAns,
        });
        if (res.success) {
          msg.textContent = '✓ Saved';
          msg.style.color = '#2e7d32';
        } else {
          msg.textContent = res.message || 'Failed';
          msg.style.color = 'var(--danger)';
        }
      } catch (err) {
        msg.textContent = 'Error: ' + err.message;
        msg.style.color = 'var(--danger)';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Save';
      }
    });

    load();
  