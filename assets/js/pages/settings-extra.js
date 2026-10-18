    if (!isLoggedIn()) window.location.href = '/index.html';

    // ============================================================
    // 工具函数
    // ============================================================
    function shuffleArray(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }

    // ============================================================
    // 第一题：二阶行列式（随机整数，-10~10，自动刷新）
    // ============================================================
    function generateDeterminantProblem() {
      const mat = [];
      for (let i = 0; i < 2; i++) {
        const row = [];
        for (let j = 0; j < 2; j++) {
          row.push(Math.floor(Math.random() * 21) - 10);
        }
        mat.push(row);
      }
      const det = mat[0][0] * mat[1][1] - mat[0][1] * mat[1][0];
      const latex = `\\begin{vmatrix} ${mat[0][0]} & ${mat[0][1]} \\\\ ${mat[1][0]} & ${mat[1][1]} \\end{vmatrix}`;
      return { latex, det };
    }

    // ============================================================
    // 第二题：洛伦兹力 F = q (v × B)（随机整数，-5~5，自动刷新）
    // ============================================================
    function generateMagneticForceProblem() {
      let q;
      do { q = Math.floor(Math.random() * 11) - 5; } while (q === 0); // 非零
      const v = [];
      const B = [];
      for (let i = 0; i < 3; i++) {
        v.push(Math.floor(Math.random() * 11) - 5);
        B.push(Math.floor(Math.random() * 11) - 5);
      }
      // 叉积 v × B
      const cross = [
        v[1] * B[2] - v[2] * B[1],
        v[2] * B[0] - v[0] * B[2],
        v[0] * B[1] - v[1] * B[0]
      ];
      const F = cross.map(c => q * c);
      const vStr = `(${v.join(', ')})`;
      const BStr = `(${B.join(', ')})`;
      const FStr = `(${F.join(', ')})`;
      return { q, v, B, F, vStr, BStr, FStr };
    }

    // ============================================================
    // 第三题：有机合成步骤排序（固定，刷新不变）
    // ============================================================
    function generateSynthesisProblem() {
      const question = `
        <strong>Synthesis Problem</strong><br>
        Starting from <strong>toluene (methylbenzene)</strong>, synthesize <strong>ethyl 4-aminobenzoate</strong> (benzocaine).
        <br><br>
        <em>What is the correct order of reagents to be added?</em>
        <br>
        Choose from the following reagents (each used once):
        <ul style="list-style: none; padding-left: 0; text-align: left; display: inline-block; margin: 0.5rem auto;">
          <li>① HNO₃ / H₂SO₄</li>
          <li>② KMnO₄ (aq, heat)</li>
          <li>③ C₂H₅OH / H⁺ (cat.)</li>
          <li>④ Sn / HCl (or H₂ / Pd)</li>
        </ul>
        <br>
        Enter the <strong>numbers</strong> in order, separated by commas.<br>
        Example: <code>①,②,③,④</code> → <code>1,2,3,4</code>.
      `;
      const answer = "1,2,4,3";
      return { question, answer };
    }

    // ============================================================
    // 主控制逻辑
    // ============================================================
    let currentStep = 0;
    const totalSteps = 3;
    let detData = null;
    let magneticData = null;
    let synthesisData = generateSynthesisProblem(); // 固定，只生成一次

    const puzzleArea = document.getElementById('puzzleArea');
    const stepIndicator = document.getElementById('stepIndicator');
    const progressFill = document.getElementById('progressFill');
    const puzzleContent = document.getElementById('puzzleContent');

    function renderStep(step) {
      stepIndicator.textContent = `Step ${step + 1} of ${totalSteps}`;
      progressFill.style.width = ((step / totalSteps) * 100) + '%';
      if (step === 0) renderDeterminant();
      else if (step === 1) renderMagneticForce();
      else if (step === 2) renderSynthesis();
    }

    // ---------- 第一题：二阶行列式 ----------
    function renderDeterminant() {
      detData = generateDeterminantProblem();
      let detHtml;
      try {
        detHtml = katex.renderToString(detData.latex, {
          throwOnError: false,
          displayMode: true
        });
      } catch (e) {
        detHtml = detData.latex;
      }
      puzzleContent.innerHTML = `
        <div class="puzzle-prompt">Compute the determinant of the following 2×2 matrix (integer answer):</div>
        <div class="math-display">${detHtml}</div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">
          <input type="number" id="detInput" class="puzzle-input" placeholder="Enter integer" autocomplete="off" />
          <button class="btn btn-primary" id="detSubmitBtn">Submit</button>
        </div>
        <div id="detFeedback" class="puzzle-feedback"></div>
      `;
      document.getElementById('detSubmitBtn').addEventListener('click', () => checkDet());
      document.getElementById('detInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkDet(); });
      document.getElementById('detInput').focus();
    }

    function checkDet() {
      const input = document.getElementById('detInput');
      const val = parseInt(input.value.trim());
      const fb = document.getElementById('detFeedback');
      if (isNaN(val)) {
        fb.textContent = 'Please enter a valid integer.';
        fb.className = 'puzzle-feedback error';
        return;
      }
      if (val === detData.det) {
        fb.textContent = '✅ Correct!';
        fb.className = 'puzzle-feedback success';
        setTimeout(() => { currentStep = 1; renderStep(1); }, 500);
      } else {
        fb.textContent = '❌ Wrong. Try again.';
        fb.className = 'puzzle-feedback error';
        input.value = '';
        input.focus();
      }
    }

    // ---------- 第二题：洛伦兹力 ----------
    function renderMagneticForce() {
      magneticData = generateMagneticForceProblem();
      puzzleContent.innerHTML = `
        <div class="puzzle-prompt">Compute the Lorentz force vector \\( \\mathbf{F} = q (\\mathbf{v} \\times \\mathbf{B}) \\).</div>
        <div class="math-display">
          \\( q = ${magneticData.q} \\) &nbsp;&nbsp;
          \\( \\mathbf{v} = ${magneticData.vStr} \\) &nbsp;&nbsp;
          \\( \\mathbf{B} = ${magneticData.BStr} \\)
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">
          <input type="text" id="forceInput" class="puzzle-input" placeholder="e.g. 1,-2,3" autocomplete="off" />
          <button class="btn btn-primary" id="forceSubmitBtn">Submit</button>
        </div>
        <div id="forceFeedback" class="puzzle-feedback"></div>
      `;
      document.getElementById('forceSubmitBtn').addEventListener('click', () => checkForce());
      document.getElementById('forceInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkForce(); });
      document.getElementById('forceInput').focus();
    }

    function checkForce() {
      const input = document.getElementById('forceInput');
      const raw = input.value.trim();
      const fb = document.getElementById('forceFeedback');
      if (!raw) {
        fb.textContent = 'Please enter three numbers separated by commas.';
        fb.className = 'puzzle-feedback error';
        return;
      }
      const parts = raw.split(',').map(s => s.trim());
      if (parts.length !== 3) {
        fb.textContent = 'Please enter exactly three numbers.';
        fb.className = 'puzzle-feedback error';
        return;
      }
      const nums = parts.map(Number);
      if (nums.some(isNaN)) {
        fb.textContent = 'Please enter valid integers.';
        fb.className = 'puzzle-feedback error';
        return;
      }
      const expected = magneticData.F;
      if (nums[0] === expected[0] && nums[1] === expected[1] && nums[2] === expected[2]) {
        fb.textContent = '✅ Correct!';
        fb.className = 'puzzle-feedback success';
        setTimeout(() => { currentStep = 2; renderStep(2); }, 500);
      } else {
        fb.textContent = '❌ Wrong. Try again.';
        fb.className = 'puzzle-feedback error';
        input.value = '';
        input.focus();
      }
    }

    // ---------- 第三题：合成排序 ----------
    function renderSynthesis() {
      const data = synthesisData;
      puzzleContent.innerHTML = `
        <div class="puzzle-prompt">${data.question}</div>
        <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">
          <input type="text" id="synthInput" class="puzzle-input" placeholder="e.g. 1,2,4,3" autocomplete="off" />
          <button class="btn btn-primary" id="synthSubmitBtn">Submit</button>
        </div>
        <div id="synthFeedback" class="puzzle-feedback"></div>
      `;
      document.getElementById('synthSubmitBtn').addEventListener('click', () => checkSynthesis());
      document.getElementById('synthInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') checkSynthesis(); });
      document.getElementById('synthInput').focus();
    }

    function checkSynthesis() {
      const input = document.getElementById('synthInput');
      const raw = input.value.trim();
      const fb = document.getElementById('synthFeedback');
      // 去除所有空格，转小写
      const normalized = raw.replace(/\s/g, '').toLowerCase();
      const expected = synthesisData.answer.replace(/\s/g, '').toLowerCase();
      if (normalized === expected) {
        fb.textContent = '✅ Correct! All challenges completed!';
        fb.className = 'puzzle-feedback success';
        setTimeout(() => completeAllChallenges(), 600);
      } else {
        fb.textContent = '❌ Wrong order. Try again. Hint: Think about the functional group transformations.';
        fb.className = 'puzzle-feedback error';
        input.value = '';
        input.focus();
      }
    }

    // ============================================================
    // 全部完成：跳转长路径
    // ============================================================
    function completeAllChallenges() {
      const longPath = atob('L3phOTg0aHA5Z3VvcTJwOTQ4dGhxcDkzMjg0dXQtcTlwODN1NGd0cjlpM3doNHA5cm9xZ2gzd3A5bzRpcmhnOWFvd3VpcmhxZzlwb3VpdzM0aC1yOXBndHEzd3A5NHVvcmloOW93dWg0MHE4MjR1eXEtMDI4NWd1bnEwMjM1OWc4NWhyYjBuOWU0dWdoMDN1d2dhaW9nOWFlcmgwZzl1YXdoZTA5cnVpaDA5d2FldWlycWc5dW93ZXJnb2V3NHJocWc5aXUzd2dyOTBxdWlhd2U0aGdxdTlpMGVyZ3VhZXc0aGdyOTBhd3VocjA4Z3FlcjlnZXJ1aWdoMDllaW91cmdoOWVhb2l1cg==');
      window.location.href = longPath;
    }

    // ============================================================
    // 初始化
    // ============================================================
    function init() {
      currentStep = 0;
      puzzleArea.style.display = 'block';
      renderStep(0);
    }
    init();
  