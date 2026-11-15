// assets/js/core/latex-doc.js —— 把整份 LaTeX 文档转成可在页面上渲染的形式
//
// 学生交上来的答案常常不是「一段公式」，而是完整的一份 .tex 源文件：
//   \documentclass[12pt]{ctexart}
//   \usepackage{amsmath,amssymb,amsthm}
//   \begin{document}
//   ...
//   \end{document}
//
// KaTeX 只认数学片段，这些包装会原样漏到屏幕上。这里只做「剥壳 + 把少数
// 文本命令换成 HTML」，真正的公式仍然交给 renderMathInElement 处理。
// 不追求完整实现 LaTeX —— 只保证这种作业能读。

(function () {
  'use strict';
  if (window.LatexDoc) return;

  // 整行级别的包装：直接删掉
  var DROP_PATTERNS = [
    /^\\documentclass(\[[^\]]*\])?\{[^}]*\}\s*$/gm,
    /^\\usepackage(\[[^\]]*\])?\{[^}]*\}\s*$/gm,
    /^\\begin\{document\}\s*$/gm,
    /^\\end\{document\}\s*$/gm,
    /^\\maketitle\s*$/gm,
    /^\\tableofcontents\s*$/gm,
    /^\\newpage\s*$/gm,
    /^\\clearpage\s*$/gm,
    /^\\pagestyle\{[^}]*\}\s*$/gm,
    /^\\thispagestyle\{[^}]*\}\s*$/gm,
  ];

  // 文本命令 → HTML。参数里若含 $...$ 会保留，公式照旧渲染。
  var TEXT_COMMANDS = [
    ['textbf', 'strong'],
    ['textit', 'em'],
    ['textsl', 'em'],
    ['emph', 'em'],
    ['underline', 'u'],
    ['texttt', 'code'],
  ];

  function expandTextCommand(src, name, tag) {
    // 处理 \textbf{...}，允许参数里嵌套一层花括号
    var re = new RegExp('\\\\' + name + '\\{((?:[^{}]|\\{[^{}]*\\})*)\\}', 'g');
    return src.replace(re, function (_, inner) {
      return '<' + tag + '>' + inner + '</' + tag + '>';
    });
  }

  /**
   * @param {string} input  已经过 HTML 转义的答案文本
   * @returns {string}      可交给 renderMathInElement 的 HTML
   */
  function convert(input) {
    var s = String(input == null ? '' : input);
    if (!s) return '';

    // 只在这种明确的文档包装存在时才动手，避免误伤普通答案
    var looksLikeDoc = /\\documentclass|\\begin\{document\}/.test(s);
    if (!looksLikeDoc) return s;

    DROP_PATTERNS.forEach(function (re) { s = s.replace(re, ''); });

    // 单行形式（整段挤在一行里的写法）
    s = s.replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}/g, '');
    s = s.replace(/\\usepackage(\[[^\]]*\])?\{[^}]*\}/g, '');
    s = s.replace(/\\begin\{document\}/g, '');
    s = s.replace(/\\end\{document\}/g, '');

    // 文本命令
    TEXT_COMMANDS.forEach(function (pair) {
      s = expandTextCommand(s, pair[0], pair[1]);
    });

    // 分段 / 换行：\ 在公式外是换行，公式内由 KaTeX 自己处理。
    // 这里只把「不在 $$...$$ 里」的 \ 换成 <br>。
    s = replaceOutsideMath(s, /\\\\/g, '<br>');
    // 空行 → 段落
    s = s.replace(/\n{2,}/g, '</p><p>');

    return s.trim();
  }

  /** 把 $...$ / $$...$$ 之外的内容交给 fn 处理 */
  function replaceOutsideMath(src, re, replacement) {
    var out = '';
    var i = 0;
    while (i < src.length) {
      var dd = src.indexOf('$$', i);
      var sd = src.indexOf('$', i);
      // 找最近的一个起始定界符（$$ 优先）
      if (dd !== -1 && (sd === -1 || dd <= sd)) {
        out += src.slice(i, dd).replace(re, replacement);
        var endDD = src.indexOf('$$', dd + 2);
        if (endDD === -1) { out += src.slice(dd); return out; }
        out += src.slice(dd, endDD + 2);
        i = endDD + 2;
      } else if (sd !== -1) {
        out += src.slice(i, sd).replace(re, replacement);
        var endSD = src.indexOf('$', sd + 1);
        if (endSD === -1) { out += src.slice(sd); return out; }
        out += src.slice(sd, endSD + 1);
        i = endSD + 1;
      } else {
        out += src.slice(i).replace(re, replacement);
        break;
      }
    }
    return out;
  }

  window.LatexDoc = { convert: convert, looksLikeDoc: function (s) { return /\\documentclass|\\begin\{document\}/.test(String(s || '')); } };
})();
