// assets/js/core/status.js —— 提交状态的客户端解析
//
// 和后端 lib/submission-status.js 一一对应，只做三件事：
// 把 'AC' / 'PS60' / 'WA' / 'V60' / 'SE' 变成
//   - 解析后的对象
//   - 显示文案
//   - CSS 类名
//
// 页面上不再有第二套判断 —— 以前列表、详情页、工作台各自拼一遍，
// 改一处漏一处就是这么来的。

(function () {
  'use strict';
  if (window.SubStatus) return;

  var VERDICT_LABEL = {
    AC: 'Accepted',
    WA: 'Wrong Answer',
    SE: 'System Error',
    Pending: 'Pending',
  };

  var VERDICT_CLASS = {
    AC: 'status-accepted',
    WA: 'status-wrong',
    SE: 'status-system',
    Pending: 'status-pending',
    PS: 'status-partial',     // 黄色：部分分
    V: 'status-violation',    // 紫色：违规
  };

  function parse(status) {
    var s = String(status == null ? '' : status).trim().toUpperCase();

    if (s === 'AC') return { raw: 'AC', verdict: 'AC', score: 100, correct: true, systemError: false, violation: false };
    if (s === 'WA') return { raw: 'WA', verdict: 'WA', score: 0, correct: false, systemError: false, violation: false };
    if (s === 'SE') return { raw: 'SE', verdict: 'SE', score: 0, correct: false, systemError: true, violation: false };

    var m = /^PS(\d{1,2})$/.exec(s);
    if (m) {
      var ps = Math.max(1, Math.min(99, parseInt(m[1], 10)));
      return { raw: s, verdict: 'PS', score: ps, correct: false, systemError: false, violation: false };
    }

    m = /^V(\d{1,2})$/.exec(s);
    if (m) {
      var vs = Math.max(0, Math.min(99, parseInt(m[1], 10)));
      return { raw: s, verdict: 'V', score: vs, correct: false, systemError: false, violation: true };
    }

    // 空值 = 还没批（图片提交）
    if (!s) return { raw: '', verdict: 'Pending', score: 0, correct: false, systemError: false, violation: false };
    return { raw: s, verdict: 'WA', score: 0, correct: false, systemError: false, violation: false };
  }

  function label(status) {
    var p = parse(status);
    if (p.verdict === 'PS') return 'Partial Score (' + p.score + ')';
    if (p.verdict === 'V') return 'Violation';
    return VERDICT_LABEL[p.verdict] || 'Wrong Answer';
  }

  function cls(status) {
    var p = parse(status);
    return VERDICT_CLASS[p.verdict] || 'status-wrong';
  }

  window.SubStatus = { parse: parse, label: label, cls: cls };
})();
