/* WYK OS App: Formula Reference */
(function () {
  window.OSApps = window.OSApps || {};

  const FORMULAS = [
    {
      cat: 'Algebra',
      icon: 'fa-square-root-variable',
      items: [
        { name: 'Quadratic Formula', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', note: 'ax² + bx + c = 0' },
        { name: 'Difference of Squares', tex: 'a^2 - b^2 = (a-b)(a+b)' },
        { name: 'Perfect Square', tex: '(a \\pm b)^2 = a^2 \\pm 2ab + b^2' },
        { name: 'Sum of Cubes', tex: 'a^3 + b^3 = (a+b)(a^2 - ab + b^2)' },
        { name: 'Difference of Cubes', tex: 'a^3 - b^3 = (a-b)(a^2 + ab + b^2)' },
        { name: 'Binomial Theorem', tex: '(a+b)^n = \\sum_{k=0}^n \\binom{n}{k} a^{n-k} b^k' },
        { name: 'Exponent Rules', tex: 'a^m \\cdot a^n = a^{m+n},\\quad (a^m)^n = a^{mn}' },
        { name: 'Log Rules', tex: '\\log_b(xy) = \\log_b x + \\log_b y' },
        { name: 'Change of Base', tex: '\\log_b x = \\frac{\\ln x}{\\ln b}' },
      ],
    },
    {
      cat: 'Trigonometry',
      icon: 'fa-wave-square',
      items: [
        { name: 'Pythagorean Identity', tex: '\\sin^2\\theta + \\cos^2\\theta = 1' },
        { name: 'Sum Formulas', tex: '\\sin(a \\pm b) = \\sin a \\cos b \\pm \\cos a \\sin b' },
        { name: 'Cos Sum', tex: '\\cos(a \\pm b) = \\cos a \\cos b \\mp \\sin a \\sin b' },
        { name: 'Double Angle (sin)', tex: '\\sin 2\\theta = 2 \\sin\\theta \\cos\\theta' },
        { name: 'Double Angle (cos)', tex: '\\cos 2\\theta = \\cos^2\\theta - \\sin^2\\theta' },
        { name: 'Half Angle', tex: '\\sin^2\\theta = \\frac{1 - \\cos 2\\theta}{2}' },
        { name: 'Law of Sines', tex: '\\frac{a}{\\sin A} = \\frac{b}{\\sin B} = \\frac{c}{\\sin C} = 2R' },
        { name: 'Law of Cosines', tex: 'c^2 = a^2 + b^2 - 2ab\\cos C' },
        { name: 'Euler Formula', tex: 'e^{i\\theta} = \\cos\\theta + i\\sin\\theta' },
      ],
    },
    {
      cat: 'Calculus',
      icon: 'fa-integral',
      items: [
        { name: 'Derivative Definition', tex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}" },
        { name: 'Product Rule', tex: "(fg)' = f'g + fg'" },
        { name: 'Quotient Rule', tex: "\\left(\\frac{f}{g}\\right)' = \\frac{f'g - fg'}{g^2}" },
        { name: 'Chain Rule', tex: "\\frac{d}{dx}f(g(x)) = f'(g(x)) \\cdot g'(x)" },
        { name: 'Integration by Parts', tex: '\\int u\\,dv = uv - \\int v\\,du' },
        { name: 'Power Rule (Integral)', tex: '\\int x^n\\,dx = \\frac{x^{n+1}}{n+1} + C' },
        { name: 'Taylor Series', tex: 'f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n' },
        { name: 'Fundamental Theorem', tex: '\\int_a^b f(x)\\,dx = F(b) - F(a)' },
      ],
    },
    {
      cat: 'Geometry',
      icon: 'fa-draw-polygon',
      items: [
        { name: 'Circle Area', tex: 'A = \\pi r^2' },
        { name: 'Circle Circumference', tex: 'C = 2\\pi r' },
        { name: 'Sphere Volume', tex: 'V = \\frac{4}{3}\\pi r^3' },
        { name: 'Sphere Surface', tex: 'S = 4\\pi r^2' },
        { name: 'Cylinder Volume', tex: 'V = \\pi r^2 h' },
        { name: 'Cone Volume', tex: 'V = \\frac{1}{3}\\pi r^2 h' },
        { name: "Heron's Formula", tex: 'S = \\sqrt{s(s-a)(s-b)(s-c)}' },
        { name: 'Triangle Area (SAS)', tex: 'A = \\frac{1}{2}ab\\sin C' },
        { name: 'Distance Formula', tex: 'd = \\sqrt{(x_2-x_1)^2 + (y_2-y_1)^2}' },
      ],
    },
    {
      cat: 'Sequences & Series',
      icon: 'fa-list-ol',
      items: [
        { name: 'Arithmetic nth Term', tex: 'a_n = a_1 + (n-1)d' },
        { name: 'Arithmetic Sum', tex: 'S_n = \\frac{n(a_1 + a_n)}{2}' },
        { name: 'Geometric nth Term', tex: 'a_n = a_1 r^{n-1}' },
        { name: 'Geometric Sum', tex: 'S_n = a_1 \\frac{1 - r^n}{1 - r},\\quad r \\neq 1' },
        { name: 'Infinite Geometric', tex: 'S_\\infty = \\frac{a_1}{1 - r},\\quad |r| < 1' },
        { name: 'Sum of Integers', tex: '1 + 2 + \\cdots + n = \\frac{n(n+1)}{2}' },
        { name: 'Sum of Squares', tex: '1^2 + 2^2 + \\cdots + n^2 = \\frac{n(n+1)(2n+1)}{6}' },
      ],
    },
    {
      cat: 'Probability',
      icon: 'fa-dice',
      items: [
        { name: 'Permutation (nPr)', tex: 'P(n, r) = \\frac{n!}{(n-r)!}' },
        { name: 'Combination (nCr)', tex: 'C(n, r) = \\binom{n}{r} = \\frac{n!}{r!(n-r)!}' },
        { name: 'Conditional Probability', tex: 'P(A|B) = \\frac{P(A \\cap B)}{P(B)}' },
        { name: 'Bayes Theorem', tex: 'P(A|B) = \\frac{P(B|A)P(A)}{P(B)}' },
        { name: 'Expected Value', tex: 'E[X] = \\sum_i x_i P(x_i)' },
        { name: 'Variance', tex: '\\text{Var}(X) = E[X^2] - (E[X])^2' },
        { name: 'Binomial Distribution', tex: 'P(X=k) = \\binom{n}{k} p^k (1-p)^{n-k}' },
        { name: 'Normal PDF', tex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}' },
      ],
    },
  ];

  const KATEX_CSS = 'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css';
  const KATEX_JS  = 'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js';
  const _loaded = new Set();
  function loadOnce(url) {
    if (_loaded.has(url)) return Promise.resolve();
    if (document.querySelector(`script[src="${url}"]`)) { _loaded.add(url); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => { _loaded.add(url); resolve(); };
      s.onerror = () => reject(new Error('Failed: ' + url));
      document.head.appendChild(s);
    });
  }
  function loadCss(url) {
    if (document.querySelector(`link[href="${url}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = url;
    document.head.appendChild(l);
  }

  window.OSApps.formula = {
    async mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-formula-style';
      style.textContent = `
.fm{display:flex;flex-direction:column;height:100%;background:#f5f7fb;font-family:'Segoe UI',sans-serif;color:#2c3e50}
.fm-tabs{display:flex;gap:2px;background:#fff;border-bottom:1px solid #e1e5eb;padding:0 8px;overflow-x:auto;flex-shrink:0}
.fm-tabs::-webkit-scrollbar{height:0}
.fm-tab{padding:12px 14px;border:none;background:none;color:#6b7d8e;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;border-bottom:3px solid transparent;display:flex;align-items:center;gap:6px;white-space:nowrap;transition:all .15s}
.fm-tab:hover{color:#4a90d9;background:rgba(74,144,217,.06)}
.fm-tab.active{color:#4a90d9;border-bottom-color:#4a90d9}
.fm-tab i{font-size:12px}
.fm-body{flex:1;overflow-y:auto;padding:18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;align-content:start}
.fm-card{background:#fff;border:1px solid #e1e5eb;border-radius:10px;padding:16px;transition:all .15s;position:relative;cursor:pointer}
.fm-card:hover{border-color:#4a90d9;box-shadow:0 4px 14px rgba(74,144,217,.15);transform:translateY(-2px)}
.fm-card-name{font-size:12px;font-weight:700;color:#4a5568;letter-spacing:.5px;margin-bottom:10px;text-transform:uppercase;padding-right:24px}
.fm-card-note{font-size:11.5px;color:#8b9bc0;margin-top:8px;font-style:italic}
.fm-card-tex{font-size:15px;overflow-x:auto;overflow-y:hidden;min-height:38px;display:flex;align-items:center;padding:4px 0}
.fm-card-tex::-webkit-scrollbar{height:4px}
.fm-card-tex::-webkit-scrollbar-thumb{background:rgba(100,150,220,.3);border-radius:2px}
.fm-copy{position:absolute;top:10px;right:10px;width:28px;height:28px;border:none;border-radius:6px;background:#f0f2f5;color:#6b7d8e;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;opacity:0;transition:all .15s}
.fm-card:hover .fm-copy{opacity:1}
.fm-copy:hover{background:#4a90d9;color:#fff}
.fm-toast{position:absolute;bottom:14px;left:50%;transform:translateX(-50%) translateY(10px);background:rgba(20,30,55,.95);color:#d6e4ff;padding:8px 18px;border-radius:20px;font-size:12px;font-weight:600;pointer-events:none;opacity:0;transition:opacity .2s,transform .2s;z-index:10}
.fm-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.fm-loading{padding:60px;text-align:center;color:#8b9bc0;font-size:14px;grid-column:1/-1}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'fm';
      wrap.innerHTML = `
        <div class="fm-tabs" id="fm-tabs">
          ${FORMULAS.map((c, i) => `
            <button class="fm-tab${i === 0 ? ' active' : ''}" data-cat="${i}">
              <i class="fas ${c.icon}"></i> ${c.cat}
            </button>
          `).join('')}
        </div>
        <div class="fm-body" id="fm-body">
          <div class="fm-loading"><i class="fas fa-spinner fa-spin"></i> Loading math renderer...</div>
        </div>
        <div class="fm-toast" id="fm-toast"></div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const tabsEl = $('#fm-tabs');
      const bodyEl = $('#fm-body');
      const toastEl = $('#fm-toast');

      // 加載 KaTeX
      loadCss(KATEX_CSS);
      let katexLoaded = false;
      try {
        await loadOnce(KATEX_JS);
        katexLoaded = typeof katex !== 'undefined';
      } catch (e) {
        console.warn('KaTeX load failed', e);
      }

      let currentIdx = 0;

      function render() {
        const c = FORMULAS[currentIdx];
        if (!c) return;
        if (!katexLoaded) {
          bodyEl.innerHTML = c.items.map(it => `
            <div class="fm-card">
              <div class="fm-card-name">${ctx.escapeHtml(it.name)}</div>
              <div class="fm-card-tex" style="font-family:Consolas,monospace;font-size:13px;color:#4a5568;word-break:break-all">${ctx.escapeHtml(it.tex)}</div>
            </div>
          `).join('');
          return;
        }
        bodyEl.innerHTML = c.items.map((it, i) => `
          <div class="fm-card" data-idx="${i}">
            <button class="fm-copy" data-idx="${i}" title="Copy LaTeX"><i class="fas fa-copy"></i></button>
            <div class="fm-card-name">${ctx.escapeHtml(it.name)}</div>
            <div class="fm-card-tex" data-tex-idx="${i}"></div>
            ${it.note ? `<div class="fm-card-note">${ctx.escapeHtml(it.note)}</div>` : ''}
          </div>
        `).join('');

        // 逐個渲染 KaTeX
        bodyEl.querySelectorAll('[data-tex-idx]').forEach(el => {
          const i = parseInt(el.dataset.texIdx, 10);
          const tex = c.items[i].tex;
          try {
            katex.render(tex, el, { throwOnError: false, displayMode: false });
          } catch (e) {
            el.textContent = tex;
          }
        });
      }

      tabsEl.addEventListener('click', e => {
        const t = e.target.closest('.fm-tab');
        if (!t) return;
        tabsEl.querySelectorAll('.fm-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        currentIdx = parseInt(t.dataset.cat, 10);
        render();
      });

      let toastTimer = null;
      function showToast(msg) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
      }

      bodyEl.addEventListener('click', async e => {
        const card = e.target.closest('.fm-card');
        if (!card) return;
        const c = FORMULAS[currentIdx];
        const idx = parseInt(card.dataset.idx, 10);
        const it = c.items[idx];
        if (!it) return;

        // 點複製按鈕或卡片都複製
        const tex = it.tex;
        try {
          await navigator.clipboard.writeText(tex);
          showToast('LaTeX copied ✓');
        } catch (err) {
          // fallback
          const ta = document.createElement('textarea');
          ta.value = tex;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); showToast('LaTeX copied ✓'); } catch (e) { showToast('Copy failed'); }
          ta.remove();
        }
      });

      render();
    },
  };
})();
