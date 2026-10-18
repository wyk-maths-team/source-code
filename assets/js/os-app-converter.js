/* WYK OS App: Unit Converter */
(function () {
  window.OSApps = window.OSApps || {};

  // 各類單位（value 是相對基準單位的倍率）
  const CATEGORIES = {
    base: {
      label: 'Number Base',
      icon: 'fa-hashtag',
      units: [
        { key: '2',  name: 'Binary (2)' },
        { key: '8',  name: 'Octal (8)' },
        { key: '10', name: 'Decimal (10)' },
        { key: '16', name: 'Hexadecimal (16)' },
      ],
      convert: (v, from, to) => {
        const n = BigInt(Math.trunc(v));
        const s = n.toString(parseInt(to, 10)).toUpperCase();
        return s;
      },
      format: 'string',
    },
    length: {
      label: 'Length',
      icon: 'fa-ruler',
      units: [
        { key: 'm',   name: 'Meter (m)',          factor: 1 },
        { key: 'km',  name: 'Kilometer (km)',     factor: 1000 },
        { key: 'cm',  name: 'Centimeter (cm)',    factor: 0.01 },
        { key: 'mm',  name: 'Millimeter (mm)',    factor: 0.001 },
        { key: 'in',  name: 'Inch (in)',          factor: 0.0254 },
        { key: 'ft',  name: 'Foot (ft)',          factor: 0.3048 },
        { key: 'yd',  name: 'Yard (yd)',          factor: 0.9144 },
        { key: 'mi',  name: 'Mile (mi)',          factor: 1609.344 },
        { key: 'nmi', name: 'Nautical Mile (nmi)',factor: 1852 },
      ],
      format: 'number',
    },
    mass: {
      label: 'Mass',
      icon: 'fa-weight-hanging',
      units: [
        { key: 'kg', name: 'Kilogram (kg)',  factor: 1 },
        { key: 'g',  name: 'Gram (g)',       factor: 0.001 },
        { key: 'mg', name: 'Milligram (mg)', factor: 1e-6 },
        { key: 't',  name: 'Tonne (t)',      factor: 1000 },
        { key: 'lb', name: 'Pound (lb)',     factor: 0.45359237 },
        { key: 'oz', name: 'Ounce (oz)',     factor: 0.028349523125 },
      ],
      format: 'number',
    },
    temperature: {
      label: 'Temperature',
      icon: 'fa-temperature-half',
      units: [
        { key: 'C', name: 'Celsius (°C)' },
        { key: 'F', name: 'Fahrenheit (°F)' },
        { key: 'K', name: 'Kelvin (K)' },
      ],
      convert: (v, from, to) => {
        // 先轉成 C
        let c;
        if (from === 'C') c = v;
        else if (from === 'F') c = (v - 32) * 5 / 9;
        else if (from === 'K') c = v - 273.15;
        else c = v;
        // 從 C 轉到目標
        if (to === 'C') return c;
        if (to === 'F') return c * 9 / 5 + 32;
        if (to === 'K') return c + 273.15;
        return c;
      },
      format: 'number',
    },
    time: {
      label: 'Time',
      icon: 'fa-clock',
      units: [
        { key: 's',   name: 'Second (s)',       factor: 1 },
        { key: 'ms',  name: 'Millisecond (ms)', factor: 0.001 },
        { key: 'us',  name: 'Microsecond (μs)', factor: 1e-6 },
        { key: 'min', name: 'Minute (min)',     factor: 60 },
        { key: 'h',   name: 'Hour (h)',         factor: 3600 },
        { key: 'd',   name: 'Day (d)',          factor: 86400 },
        { key: 'wk',  name: 'Week (wk)',        factor: 604800 },
        { key: 'yr',  name: 'Year (yr)',        factor: 31536000 },
      ],
      format: 'number',
    },
    angle: {
      label: 'Angle',
      icon: 'fa-drafting-compass',
      units: [
        { key: 'deg', name: 'Degree (°)',     factor: 1 },
        { key: 'rad', name: 'Radian (rad)',   factor: 180 / Math.PI },
        { key: 'grad',name: 'Gradian (grad)', factor: 0.9 },
        { key: 'turn',name: 'Turn (rev)',     factor: 360 },
      ],
      format: 'number',
    },
    area: {
      label: 'Area',
      icon: 'fa-vector-square',
      units: [
        { key: 'm2',  name: 'm²',        factor: 1 },
        { key: 'km2', name: 'km²',       factor: 1e6 },
        { key: 'cm2', name: 'cm²',       factor: 1e-4 },
        { key: 'ft2', name: 'ft²',       factor: 0.09290304 },
        { key: 'in2', name: 'in²',       factor: 0.00064516 },
        { key: 'ac',  name: 'Acre (ac)', factor: 4046.8564224 },
        { key: 'ha',  name: 'Hectare (ha)', factor: 10000 },
      ],
      format: 'number',
    },
  };

  function fmtNumber(v) {
    if (typeof v === 'string') return v;
    if (!isFinite(v)) return '—';
    if (v === 0) return '0';
    const abs = Math.abs(v);
    if (abs < 1e-6 || abs >= 1e12) return v.toExponential(6);
    // 6 位有效數字，去掉尾部 0
    return Number(v.toPrecision(8)).toString();
  }

  window.OSApps.converter = {
    mount(container, ctx) {
      const style = document.createElement('style');
      style.id = 'os-app-converter-style';
      style.textContent = `
.conv{display:flex;flex-direction:column;height:100%;background:#f5f7fb;font-family:'Segoe UI',sans-serif;color:#2c3e50}
.conv-tabs{display:flex;gap:2px;background:#fff;border-bottom:1px solid #e1e5eb;padding:0 8px;overflow-x:auto;flex-shrink:0}
.conv-tabs::-webkit-scrollbar{height:0}
.conv-tab{padding:12px 14px;border:none;background:none;color:#6b7d8e;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;border-bottom:3px solid transparent;display:flex;align-items:center;gap:6px;white-space:nowrap;transition:all .15s}
.conv-tab:hover{color:#4a90d9;background:rgba(74,144,217,.06)}
.conv-tab.active{color:#4a90d9;border-bottom-color:#4a90d9}
.conv-tab i{font-size:12px}
.conv-body{flex:1;padding:20px;overflow-y:auto}
.conv-input-row{display:flex;gap:10px;margin-bottom:18px}
.conv-input{flex:1;padding:14px 16px;border:1px solid #d0d7e0;border-radius:10px;font-size:22px;font-family:'Consolas',monospace;font-weight:600;color:#2c3e50;outline:none;background:#fff;transition:all .15s;min-width:0}
.conv-input:focus{border-color:#4a90d9;box-shadow:0 0 0 3px rgba(74,144,217,.15)}
.conv-select{padding:0 16px;border:1px solid #d0d7e0;border-radius:10px;font-size:14px;font-family:inherit;color:#2c3e50;background:#fff;cursor:pointer;outline:none;min-width:140px;font-weight:600}
.conv-select:focus{border-color:#4a90d9}
.conv-results{display:grid;gap:10px}
.conv-result{background:#fff;border:1px solid #e1e5eb;border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;transition:all .15s;cursor:pointer}
.conv-result:hover{border-color:#4a90d9;box-shadow:0 2px 8px rgba(74,144,217,.12)}
.conv-result.primary{border-color:#4a90d9;background:linear-gradient(135deg,rgba(74,144,217,.06) 0%,rgba(74,144,217,.02) 100%)}
.conv-result-label{font-size:13px;color:#6b7d8e;font-weight:600}
.conv-result-value{font-family:'Consolas',monospace;font-size:20px;font-weight:700;color:#1a3a6a;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%}
.conv-copy{font-size:11px;color:#8b9bc0;margin-left:8px;opacity:0;transition:opacity .15s}
.conv-result:hover .conv-copy{opacity:1}
.conv-empty{padding:60px 20px;text-align:center;color:#8b9bc0;font-size:14px}
`;
      container.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'conv';
      const cats = Object.keys(CATEGORIES);
      wrap.innerHTML = `
        <div class="conv-tabs" id="conv-tabs">
          ${cats.map((k, i) => {
            const c = CATEGORIES[k];
            return `<button class="conv-tab${i === 0 ? ' active' : ''}" data-cat="${k}">
              <i class="fas ${c.icon}"></i> ${c.label}
            </button>`;
          }).join('')}
        </div>
        <div class="conv-body">
          <div class="conv-input-row">
            <input type="text" class="conv-input" id="conv-input" value="1" spellcheck="false">
            <select class="conv-select" id="conv-from"></select>
          </div>
          <div class="conv-results" id="conv-results"></div>
        </div>
      `;
      container.appendChild(wrap);

      const $ = s => wrap.querySelector(s);
      const inputEl = $('#conv-input');
      const fromSel = $('#conv-from');
      const resultsEl = $('#conv-results');

      let currentCat = cats[0];

      function switchCategory(key) {
        currentCat = key;
        const cat = CATEGORIES[key];
        fromSel.innerHTML = cat.units.map(u => `<option value="${u.key}">${ctx.escapeHtml(u.name)}</option>`).join('');
        // 觸發計算
        convert();
      }

      function parseInput() {
        const raw = inputEl.value.trim();
        if (!raw) return null;
        // 支援 0x, 0b, 0o 前綴
        let n;
        if (/^0x[0-9a-f]+$/i.test(raw)) n = parseInt(raw, 16);
        else if (/^0b[01]+$/i.test(raw)) n = parseInt(raw, 2);
        else if (/^0o[0-7]+$/i.test(raw)) n = parseInt(raw, 8);
        else n = parseFloat(raw);
        return Number.isFinite(n) ? n : null;
      }

      function convert() {
        const v = parseInput();
        const fromKey = fromSel.value;
        const cat = CATEGORIES[currentCat];
        const fromUnit = cat.units.find(u => u.key === fromKey);
        if (v === null || !fromUnit) {
          resultsEl.innerHTML = `<div class="conv-empty"><i class="fas fa-arrow-up" style="font-size:32px;display:block;margin-bottom:10px;opacity:.4;"></i>Enter a number to convert</div>`;
          return;
        }

        const results = cat.units.map(u => {
          let val;
          if (cat.convert) {
            val = cat.convert(v, fromKey, u.key);
          } else {
            // 基準單位為 factor 1 的單位
            const baseVal = v * fromUnit.factor;
            val = baseVal / u.factor;
          }
          let display;
          if (cat.format === 'string') display = String(val);
          else display = fmtNumber(val);
          return { key: u.key, name: u.name, value: display, isFrom: u.key === fromKey };
        });

        resultsEl.innerHTML = results.map(r => `
          <div class="conv-result${r.isFrom ? ' primary' : ''}" data-copy="${ctx.escapeHtml(r.value)}">
            <span class="conv-result-label">${ctx.escapeHtml(r.name)}</span>
            <span class="conv-result-value">
              ${ctx.escapeHtml(r.value)}
              <i class="fas fa-copy conv-copy"></i>
            </span>
          </div>
        `).join('');
      }

      $('#conv-tabs').addEventListener('click', e => {
        const tab = e.target.closest('.conv-tab');
        if (!tab) return;
        wrap.querySelectorAll('.conv-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        switchCategory(tab.dataset.cat);
      });

      inputEl.addEventListener('input', convert);
      fromSel.addEventListener('change', convert);

      resultsEl.addEventListener('click', e => {
        const item = e.target.closest('.conv-result');
        if (!item) return;
        const val = item.dataset.copy;
        if (!val) return;
        navigator.clipboard.writeText(val).then(() => {
          ctx.flashToast('Copied: ' + val);
        }).catch(() => {
          // fallback
          const ta = document.createElement('textarea');
          ta.value = val;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); ctx.flashToast('Copied: ' + val); } catch (e) {}
          ta.remove();
        });
      });

      switchCategory(cats[0]);
    },
  };
})();
