// assets/js/pages/extra.js —— /settings/extra
//
// 原来的三步是行列式、洛伦兹力叉积、综合题 —— 对「点进来看看」的人来说太难，
// 大部分人在第一步就走了。现在换成三关小游戏：心算、猜数字、找不同。
// 通关之后（也只有通关之后）才出现小群体专属的那一项。

(function () {
  'use strict';

  if (!isLoggedIn()) { window.location.href = '/index.html'; return; }

  var stepIndicator = document.getElementById('stepIndicator');
  var progressFill = document.getElementById('progressFill');
  var puzzleContent = document.getElementById('puzzleContent');
  var TOTAL = 3;
  var currentStep = 0;

  function fb(text, ok) {
    var el = document.createElement('div');
    el.className = 'puzzle-feedback ' + (ok ? 'success' : 'error');
    el.textContent = text;
    puzzleContent.appendChild(el);
    return el;
  }

  function next() {
    currentStep += 1;
    if (currentStep < TOTAL) renderStep(currentStep);
    else renderDone();
  }

  function renderStep(step) {
    stepIndicator.textContent = 'Step ' + (step + 1) + ' of ' + TOTAL;
    progressFill.style.width = ((step / TOTAL) * 100) + '%';
    puzzleContent.innerHTML = '';
    if (step === 0) renderArithmetic();
    else if (step === 1) renderGuess();
    else renderOddOneOut();
  }

  // ── 第 1 关：心算 ──
  function renderArithmetic() {
    var a = 6 + Math.floor(Math.random() * 10);
    var b = 6 + Math.floor(Math.random() * 10);
    var answer = a * b;

    puzzleContent.innerHTML =
      '<p class="puzzle-question">' + a + ' × ' + b + ' = ?</p>' +
      '<div class="puzzle-row">' +
        '<input type="number" id="arithInput" class="puzzle-input" autocomplete="off" />' +
        '<button type="button" id="arithBtn" class="puzzle-btn">Check</button>' +
      '</div>';

    var input = document.getElementById('arithInput');
    var btn = document.getElementById('arithBtn');
    input.focus();

    function check() {
      var v = Number(input.value);
      if (v === answer) {
        input.disabled = true; btn.disabled = true;
        fb('Nice.', true);
        setTimeout(next, 450);
      } else {
        input.value = '';
        input.focus();
        fb('Not quite — try again.', false);
      }
    }
    btn.addEventListener('click', check);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
  }

  // ── 第 2 关：猜数字（4 次机会，每次提示大小）──
  function renderGuess() {
    var target = 1 + Math.floor(Math.random() * 20);
    var left = 4;

    puzzleContent.innerHTML =
      '<p class="puzzle-question">I am thinking of a number from 1 to 20.</p>' +
      '<p class="puzzle-hint" id="guessHint">You have 4 guesses.</p>' +
      '<div class="puzzle-row">' +
        '<input type="number" id="guessInput" class="puzzle-input" min="1" max="20" autocomplete="off" />' +
        '<button type="button" id="guessBtn" class="puzzle-btn">Guess</button>' +
      '</div>';

    var input = document.getElementById('guessInput');
    var btn = document.getElementById('guessBtn');
    var hint = document.getElementById('guessHint');
    input.focus();

    function submit() {
      var v = Number(input.value);
      if (!v || v < 1 || v > 20) { hint.textContent = 'Between 1 and 20.'; return; }
      if (v === target) {
        input.disabled = true; btn.disabled = true;
        hint.textContent = 'Got it.';
        fb('Correct!', true);
        setTimeout(next, 450);
        return;
      }
      left -= 1;
      if (left <= 0) {
        input.disabled = true; btn.disabled = true;
        hint.textContent = 'It was ' + target + '.';
        // 失败不卡人：告诉他答案，然后放行 —— 这是个彩蛋页，不是考试
        fb('Out of guesses — moving on.', false);
        setTimeout(next, 900);
        return;
      }
      hint.textContent = (v < target ? 'Higher' : 'Lower') + ' · ' + left + ' left';
      input.value = '';
      input.focus();
    }
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }

  // ── 第 3 关：找不同 ──
  function renderOddOneOut() {
    var pool = ['🐱', '🐶', '🐼', '🐸', '🦊', '🐧'];
    var common = pool[Math.floor(Math.random() * pool.length)];
    var odd = pool.filter(function (x) { return x !== common; })[0];
    var oddIndex = Math.floor(Math.random() * 9);

    var cells = '';
    for (var i = 0; i < 9; i++) {
      cells += '<button type="button" class="puzzle-cell" data-i="' + i + '">'
        + (i === oddIndex ? odd : common) + '</button>';
    }

    puzzleContent.innerHTML =
      '<p class="puzzle-question">One of these is not like the others.</p>' +
      '<div class="puzzle-grid">' + cells + '</div>';

    var told = false;
    puzzleContent.querySelectorAll('.puzzle-cell').forEach(function (cell) {
      cell.addEventListener('click', function () {
        if (Number(cell.dataset.i) === oddIndex) {
          cell.classList.add('ok');
          fb('Found it.', true);
          setTimeout(next, 450);
          return;
        }
        cell.classList.add('bad');
        if (!told) { told = true; fb('Look again.', false); }
      });
    });
  }

  // ── 通关：这里才有小群体的东西 ──
  function renderDone() {
    stepIndicator.textContent = 'Done';
    progressFill.style.width = '100%';
    puzzleContent.innerHTML = '<p class="puzzle-question">All three cleared.</p><div id="extraUnlock"></div>';
    loadUnlock();
  }

  async function loadUnlock() {
    var box = document.getElementById('extraUnlock');
    if (!box) return;
    box.innerHTML = '<p class="puzzle-hint">Checking…</p>';

    try {
      var res = await fetch('/api/users?action=prefs', {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      if (!res.ok) throw new Error('http ' + res.status);
      var data = await res.json();

      if (!data || data.smallGroup !== true) {
        // 不在圈内：不解释、不引导，就当这里到底了
        box.innerHTML = '<p class="puzzle-hint">Nothing else here. Thanks for playing.</p>';
        return;
      }

      box.innerHTML =
        '<label class="extra-toggle">' +
          '<input type="checkbox" id="nekosToggle"' + (data.nekos ? ' checked' : '') + ' />' +
          '<span>A neko with every submission</span>' +
        '</label>' +
        '<p class="puzzle-hint" id="nekosState"></p>';

      var cb = document.getElementById('nekosToggle');
      var state = document.getElementById('nekosState');
      state.textContent = data.nekos ? 'On. Your next submission brings one.' : 'Off.';

      cb.addEventListener('change', async function () {
        var on = cb.checked;
        state.textContent = 'Saving…';
        try {
          var r = await fetch('/api/users?action=prefs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
            body: JSON.stringify({ nekos: on }),
          });
          var d = await r.json();
          if (!r.ok || !d.success) throw new Error(d.message || 'failed');
          state.textContent = d.nekos ? 'On. Your next submission brings one.' : 'Off.';
        } catch (e) {
          cb.checked = !on;
          state.textContent = 'Could not save: ' + (e.message || 'unknown');
        }
      });
    } catch (e) {
      box.innerHTML = '<p class="puzzle-hint">Nothing else here.</p>';
    }
  }

  renderStep(0);
})();
