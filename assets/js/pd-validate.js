// assets/js/pd-validate.js
//
// 管理员在题目页上多出来的一个按钮：让模型读一遍这道题，看它自相矛盾不矛盾。
//
// 为什么不塞进 pd-script.js：那个文件是学生也在跑的判题主流程，
// 加一段只有管理员用得上的东西不划算，而且它已经很长了。
// 这里改成自己挂载：拿不到管理员身份就什么都不做。
//
// 链式题（MO{年}FI{序号}）由后端补上一题的答案，前端不用管。

(function () {
  'use strict';

  function getToken() {
    try { return localStorage.getItem('auth_token') || ''; } catch (e) { return ''; }
  }

  function mount() {
    var token = getToken();
    if (!token) return;

    // 只在题目页出现，而且只挂一次
    if (document.getElementById('pdValidateBtn')) return;

    var host = document.querySelector('.pd-header-actions')
      || document.querySelector('[data-pd-actions]')
      || document.querySelector('.pd-meta')
      || document.querySelector('.pd-title')
      || document.querySelector('main')
      || document.body;

    var bar = document.createElement('div');
    bar.className = 'pdv-bar';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'pdValidateBtn';
    btn.className = 'pdv-btn';
    btn.innerHTML = '<i class="fas fa-stethoscope"></i> Validate';

    var out = document.createElement('div');
    out.className = 'pdv-out';
    out.hidden = true;

    bar.appendChild(btn);
    bar.appendChild(out);

    if (host === document.body) document.body.appendChild(bar);
    else host.parentNode.insertBefore(bar, host.nextSibling);

    var busy = false;

    btn.addEventListener('click', function () {
      if (busy) return;
      var pid = new URLSearchParams(location.search).get('id')
        || (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
      if (!pid) return;

      busy = true;
      btn.disabled = true;
      out.hidden = false;
      out.className = 'pdv-out';
      out.textContent = 'Checking ' + pid + '…';
      var t0 = Date.now();
      var ticker = setInterval(function () {
        out.textContent = 'Checking ' + pid + '… ' + Math.round((Date.now() - t0) / 1000) + 's';
      }, 500);

      fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ problemId: pid }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          clearInterval(ticker);
          if (!d || !d.success) {
            out.className = 'pdv-out pdv-bad';
            out.textContent = (d && d.message) || 'Validation failed.';
            return;
          }
          var label = d.verdict === 'ok' ? 'OK'
            : d.verdict === 'suspicious' ? 'Suspicious'
            : d.verdict === 'broken' ? 'Broken'
            : 'Unknown';
          out.className = 'pdv-out ' + (d.verdict === 'ok' ? 'pdv-good'
            : d.verdict === 'suspicious' ? 'pdv-warn' : 'pdv-bad');
          var parts = ['<b>' + label + '</b>'];
          if (d.previousPart) {
            parts.push('<span class="pdv-prev">chained after ' + d.previousPart.id
              + ' (answer ' + String(d.previousPart.ans) + ')</span>');
          }
          parts.push('<div class="pdv-reason">' + (d.reason || d.raw || '(no reason given)') + '</div>');
          out.innerHTML = parts.join(' ');
          out.title = d.raw || '';
        })
        .catch(function (e) {
          clearInterval(ticker);
          out.className = 'pdv-out pdv-bad';
          out.textContent = 'Request failed: ' + String(e && e.message || e).slice(0, 140);
        })
        .finally(function () {
          busy = false;
          btn.disabled = false;
        });
    });
  }

  // 题目页的数据是异步加载的，等 DOM 稳定再挂
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 1200); });
  } else {
    setTimeout(mount, 1200);
  }
})();
