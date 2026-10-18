/* WYK OS App: Matrix Calculator */
(function () {
  window.OSApps = window.OSApps || {};

  window.OSApps.matrix = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-matrix-style';
      style.textContent = `
.mtx{display:flex;flex-direction:column;height:100%;background:#f5f7fb;font-family:'Segoe UI',sans-serif;color:#2c3e50;padding:16px;overflow:auto}
.mtx-top{display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.mtx-top label{font-size:12.5px;font-weight:600;color:#4a5568;display:flex;align-items:center;gap:6px}
.mtx-top select{padding:6px 10px;border:1px solid #d0d7e0;border-radius:6px;font-size:13px;font-family:inherit;background:#fff;color:#2c3e50;cursor:pointer}
.mtx-grids{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}
.mtx-block{background:#fff;border:1px solid #e1e5eb;border-radius:10px;padding:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.mtx-block-title{font-size:12px;font-weight:700;color:#4a90d9;margin-bottom:8px;letter-spacing:1.5px}
.mtx-table{border-collapse:separate;border-spacing:4px}
.mtx-table td{padding:0}
.mtx-cell{width:56px;padding:8px 4px;border:1px solid #d0d7e0;border-radius:6px;font-family:'Consolas',monospace;font-size:13.5px;text-align:center;outline:none;color:#2c3e50;background:#fafbfc;transition:all .15s}
.mtx-cell:focus{border-color:#4a90d9;background:#fff;box-shadow:0 0 0 3px rgba(74,144,217,.15)}
.mtx-ops{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0;padding-top:14px;border-top:1px solid #e1e5eb}
.mtx-op{padding:9px 18px;border:none;border-radius:8px;background:#4a90d9;color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s;box-shadow:0 2px 6px rgba(74,144,217,.25)}
.mtx-op:hover{background:#3a7bc8;transform:translateY(-1px);box-shadow:0 4px 10px rgba(74,144,217,.35)}
.mtx-op:active{transform:translateY(0)}
.mtx-op.secondary{background:#fff;color:#4a5568;border:1px solid #d0d7e0;box-shadow:none}
.mtx-op.secondary:hover{background:#f0f2f5;transform:none}
.mtx-result{background:#fff;border:1px solid #e1e5eb;border-radius:10px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);min-height:80px;display:none}
.mtx-result.show{display:block}
.mtx-result-title{font-size:12px;font-weight:700;color:#4a90d9;margin-bottom:10px;letter-spacing:1.5px;text-transform:uppercase}
.mtx-result-content{font-family:'Consolas',monospace;font-size:14px;color:#2c3e50;white-space:pre-wrap;word-break:break-word}
.mtx-result-content table{border-collapse:separate;border-spacing:6px}
.mtx-result-content td{padding:6px 12px;background:#f0f2f5;border-radius:4px;text-align:right;min-width:48px}
.mtx-error{color:#e74c3c;font-size:13px;font-weight:600}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'mtx';
      wrap.innerHTML = `
        <div class="mtx-top">
          <label>Size:
            <select id="mtx-size">
              <option value="2">2 × 2</option>
              <option value="3" selected>3 × 3</option>
              <option value="4">4 × 4</option>
              <option value="5">5 × 5</option>
            </select>
          </label>
          <button class="mtx-op secondary" id="mtx-clear">Clear All</button>
        </div>
        <div class="mtx-grids">
          <div class="mtx-block">
            <div class="mtx-block-title">MATRIX A</div>
            <table class="mtx-table" id="mtx-A"></table>
          </div>
          <div class="mtx-block">
            <div class="mtx-block-title">MATRIX B</div>
            <table class="mtx-table" id="mtx-B"></table>
          </div>
        </div>
        <div class="mtx-ops">
          <button class="mtx-op" data-op="add">A + B</button>
          <button class="mtx-op" data-op="sub">A − B</button>
          <button class="mtx-op" data-op="mul">A × B</button>
          <button class="mtx-op" data-op="trans">Aᵀ</button>
          <button class="mtx-op" data-op="det">det(A)</button>
          <button class="mtx-op" data-op="rank">rank(A)</button>
          <button class="mtx-op secondary" data-op="inv">A⁻¹</button>
        </div>
        <div class="mtx-result" id="mtx-result">
          <div class="mtx-result-title" id="mtx-result-title">RESULT</div>
          <div class="mtx-result-content" id="mtx-result-content"></div>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const tableA = $('#mtx-A');
      const tableB = $('#mtx-B');
      const resultBox = $('#mtx-result');
      const resultTitle = $('#mtx-result-title');
      const resultContent = $('#mtx-result-content');

      let size = 3;

      function buildTable(table) {
        let html = '';
        for (let i = 0; i < size; i++) {
          html += '<tr>';
          for (let j = 0; j < size; j++) {
            html += `<td><input type="text" class="mtx-cell" value="0" inputmode="decimal"></td>`;
          }
          html += '</tr>';
        }
        table.innerHTML = html;
        table.querySelectorAll('.mtx-cell').forEach(cell => {
          cell.addEventListener('focus', () => cell.select());
          cell.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // 移動到下一個
              const cells = Array.from(table.querySelectorAll('.mtx-cell'));
              const idx = cells.indexOf(cell);
              if (idx >= 0 && idx < cells.length - 1) cells[idx + 1].focus();
            }
          });
        });
      }

      function readMatrix(table) {
        const rows = table.querySelectorAll('tr');
        const m = [];
        for (const tr of rows) {
          const row = [];
          for (const cell of tr.querySelectorAll('.mtx-cell')) {
            const v = parseFloat(cell.value);
            if (isNaN(v)) throw new Error('Invalid number in matrix');
            row.push(v);
          }
          m.push(row);
        }
        return m;
      }

      function matrixToHtml(m) {
        if (typeof m === 'number') {
          return `<span style="font-size:18px;font-weight:700;color:#1a3a6a">${m}</span>`;
        }
        let html = '<table>';
        for (const row of m) {
          html += '<tr>';
          for (const v of row) {
            const txt = Math.abs(v) < 1e-9 ? '0' : Number(v.toFixed(6)).toString();
            html += `<td>${ctx.escapeHtml(txt)}</td>`;
          }
          html += '</tr>';
        }
        html += '</table>';
        return html;
      }

      function showResult(title, content, isError) {
        resultBox.classList.add('show');
        resultTitle.textContent = title;
        if (isError) {
          resultContent.innerHTML = `<span class="mtx-error">${ctx.escapeHtml(content)}</span>`;
        } else {
          resultContent.innerHTML = content;
        }
      }

      // 運算
      function opAdd(a, b) {
        return a.map((row, i) => row.map((v, j) => v + b[i][j]));
      }
      function opSub(a, b) {
        return a.map((row, i) => row.map((v, j) => v - b[i][j]));
      }
      function opMul(a, b) {
        const n = a.length;
        const r = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            let sum = 0;
            for (let k = 0; k < n; k++) sum += a[i][k] * b[k][j];
            r[i][j] = sum;
          }
        }
        return r;
      }
      function opTranspose(m) {
        return m[0].map((_, j) => m.map(row => row[j]));
      }
      function opDet(m) {
        const n = m.length;
        if (n === 1) return m[0][0];
        if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
        // 高斯消元法
        const a = m.map(r => [...r]);
        let det = 1;
        for (let i = 0; i < n; i++) {
          let pivot = i;
          for (let k = i + 1; k < n; k++) {
            if (Math.abs(a[k][i]) > Math.abs(a[pivot][i])) pivot = k;
          }
          if (Math.abs(a[pivot][i]) < 1e-12) return 0;
          if (pivot !== i) { [a[i], a[pivot]] = [a[pivot], a[i]]; det = -det; }
          det *= a[i][i];
          for (let k = i + 1; k < n; k++) {
            const factor = a[k][i] / a[i][i];
            for (let j = i; j < n; j++) a[k][j] -= factor * a[i][j];
          }
        }
        return det;
      }
      function opRank(m) {
        const n = m.length;
        const a = m.map(r => [...r]);
        let rank = 0;
        const EPS = 1e-9;
        for (let col = 0; col < n && rank < n; col++) {
          let pivot = -1;
          for (let k = rank; k < n; k++) {
            if (Math.abs(a[k][col]) > EPS) { pivot = k; break; }
          }
          if (pivot === -1) continue;
          [a[rank], a[pivot]] = [a[pivot], a[rank]];
          const pv = a[rank][col];
          for (let j = 0; j < n; j++) a[rank][j] /= pv;
          for (let k = 0; k < n; k++) {
            if (k === rank) continue;
            const f = a[k][col];
            for (let j = 0; j < n; j++) a[k][j] -= f * a[rank][j];
          }
          rank++;
        }
        return rank;
      }
      function opInverse(m) {
        const n = m.length;
        // 擴增矩陣 [A|I]
        const a = m.map((r, i) => [
          ...r,
          ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0),
        ]);
        const EPS = 1e-9;
        for (let col = 0; col < n; col++) {
          let pivot = -1;
          for (let k = col; k < n; k++) {
            if (Math.abs(a[k][col]) > EPS) { pivot = k; break; }
          }
          if (pivot === -1) throw new Error('Matrix is singular (no inverse)');
          [a[col], a[pivot]] = [a[pivot], a[col]];
          const pv = a[col][col];
          for (let j = 0; j < 2 * n; j++) a[col][j] /= pv;
          for (let k = 0; k < n; k++) {
            if (k === col) continue;
            const f = a[k][col];
            for (let j = 0; j < 2 * n; j++) a[k][j] -= f * a[col][j];
          }
        }
        return a.map(row => row.slice(n));
      }

      // 按鈕事件
      wrap.querySelectorAll('.mtx-op[data-op]').forEach(btn => {
        btn.addEventListener('click', () => {
          try {
            const A = readMatrix(tableA);
            const B = readMatrix(tableB);
            const op = btn.dataset.op;
            if (op === 'add')      showResult('A + B', matrixToHtml(opAdd(A, B)));
            else if (op === 'sub') showResult('A − B', matrixToHtml(opSub(A, B)));
            else if (op === 'mul') showResult('A × B', matrixToHtml(opMul(A, B)));
            else if (op === 'trans') showResult('Aᵀ', matrixToHtml(opTranspose(A)));
            else if (op === 'det') showResult('det(A)', matrixToHtml(opDet(A)));
            else if (op === 'rank') showResult('rank(A)', matrixToHtml(opRank(A)));
            else if (op === 'inv') showResult('A⁻¹', matrixToHtml(opInverse(A)));
          } catch (e) {
            showResult('ERROR', e.message, true);
          }
        });
      });

      // 尺寸切換
      $('#mtx-size').addEventListener('change', e => {
        size = parseInt(e.target.value, 10) || 3;
        buildTable(tableA);
        buildTable(tableB);
        resultBox.classList.remove('show');
      });

      // 清空
      $('#mtx-clear').addEventListener('click', () => {
        if (!confirm('Clear both matrices?')) return;
        wrap.querySelectorAll('.mtx-cell').forEach(c => { c.value = '0'; });
        resultBox.classList.remove('show');
      });

      buildTable(tableA);
      buildTable(tableB);
    },
  };
})();
