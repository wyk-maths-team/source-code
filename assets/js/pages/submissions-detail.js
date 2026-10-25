if (!isLoggedIn()) window.location.href = '/index.html';
(function () {
  const s = localStorage.getItem('fontSize') || '16';
  document.documentElement.style.fontSize = s + 'px';
})();

const parts = window.location.pathname.split('/');
const subid = parts[parts.length - 2];
const container = document.getElementById('mainContent');

function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

function computeStatus(sub) {
  if (sub.status === 'Violation') return { text: 'Violation', cls: 'status-system' };
  if (sub.marked && sub.score !== undefined) {
    if (sub.score === 100) return { text: 'Accepted', cls: 'status-accepted' };
    if (sub.score === 0) return { text: 'Wrong Answer', cls: 'status-wrong' };
    return { text: `Partial Score (${sub.score}%)`, cls: 'status-partial' };
  }
  if (sub.type === 'image' && !sub.marked) return { text: 'Pending', cls: 'status-pending' };
  if (sub.systemError) return { text: 'System Error', cls: 'status-system' };
  if (typeof sub.correct === 'boolean') return sub.correct ? { text: 'Accepted', cls: 'status-accepted' } : { text: 'Wrong Answer', cls: 'status-wrong' };
  return { text: 'Pending', cls: 'status-pending' };
}

const SCRAMBLE_LENGTH = 32;
const SCRAMBLE_CHARS = '░▒▓';
let scrambleTimer = null;

// 由 loadDetail 从后端返回值填充：
//   CAN_REPORT —— 不是本人提交、且提交者不是 root（后端也会再挡一次）
//   IS_ADMIN   —— 当前登录者是 admin 或 root
let CAN_REPORT = false;
let IS_ADMIN = false;

function randomScramble() {
  let s = '';
  for (let i = 0; i < SCRAMBLE_LENGTH; i++) s += SCRAMBLE_CHARS.charAt(Math.floor(Math.random() * SCRAMBLE_CHARS.length));
  return s;
}

function startScramble() {
  const els = document.querySelectorAll('.scramble-text');
  if (!els.length) return;
  if (scrambleTimer) clearInterval(scrambleTimer);
  els.forEach(el => { el.textContent = randomScramble(); });
  scrambleTimer = setInterval(() => {
    const nodes = document.querySelectorAll('.scramble-text');
    if (!nodes.length) { clearInterval(scrambleTimer); scrambleTimer = null; return; }
    nodes.forEach(el => { el.textContent = randomScramble(); });
  }, 20);
}

function hiddenScrambleHtml(label) {
  return `<span class="hidden-scramble" title="${escapeHtml(label)}"><i class="fas fa-lock"></i> <span class="scramble-text">${randomScramble()}</span> <i class="fas fa-eye-slash"></i></span>`;
}

function renderDetail(sub, problemName, attempts) {
  const status = computeStatus(sub);
  const submitTime = new Date(sub.timestamp);
  const submitTimeStr = submitTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
  const judgeTime = sub.markedAt ? new Date(sub.markedAt) : submitTime;
  let diffSec = Math.max(Math.floor((judgeTime - submitTime) / 1000), 0);
  if (sub.judgingMs) diffSec = Math.max(diffSec, Math.floor(sub.judgingMs / 1000));
  const timeStr = diffSec < 60 ? `${diffSec} seconds` : `${Math.floor(diffSec / 60)} min ${diffSec % 60} sec`;

  let answerHtml;
  if (sub.type === 'image' && sub.image) answerHtml = `<img src="${escapeHtml(sub.image)}" class="answer-image" alt="Submission image">`;
  else if (sub.answerHidden) answerHtml = `<div class="answer-text">${hiddenScrambleHtml('Answer hidden')}</div>`;
  else answerHtml = `<div class="answer-text"><strong>Answer:</strong> ${escapeHtml(String(sub.answer || 'No answer recorded'))}</div>`;

  let commentHtml;
  if (sub.commentHidden) commentHtml = hiddenScrambleHtml('Comment hidden');
  else if (sub.comment) commentHtml = escapeHtml(sub.comment).replace(/\n/g, '<br>');
  else commentHtml = '<span class="no-comment">No comment yet.</span>';

  return `<div class="detail-container" id="detailRoot">
    <div class="submission-header">
      <h2>Submission #${escapeHtml(sub.subid)}</h2>
      <div class="badge-group">
        <span class="badge ${status.cls}">${escapeHtml(status.text)}</span>
        <button onclick="flagSubmission('red', '${escapeHtml(sub.username)}', '${escapeHtml(sub.problemId)}')" style="margin-left:10px; background:#d93025; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Red Flag</button>
        <button onclick="flagSubmission('yellow', '${escapeHtml(sub.username)}', '${escapeHtml(sub.problemId)}')" style="margin-left:5px; background:#e3a008; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Yellow Flag</button>
        ${CAN_REPORT ? `<button onclick="reportSubmission('${escapeHtml(sub.subid)}')" title="Report this submission"
          style="margin-left:5px; background:#7d5bb0; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">
          <i class="fas fa-flag"></i> Report</button>` : ''}
        ${IS_ADMIN ? `<button onclick="deleteSubmission('${escapeHtml(sub.subid)}')" title="Delete this submission"
          style="margin-left:5px; background:#444; color:#fff; border:none; padding:4px 9px; border-radius:4px; cursor:pointer;">
          <i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>
    <div class="meta-row">
      <div class="meta-item"><strong>User:</strong> <a href="/users/${encodeURIComponent(sub.username)}">${escapeHtml(sub.username)}</a></div>
      <div class="meta-item"><strong>Problem:</strong> <a href="/problems/${encodeURIComponent(sub.problemId)}">${escapeHtml(sub.problemId)} - ${escapeHtml(problemName)}</a></div>
      <div class="meta-item"><strong>Submitted:</strong> ${escapeHtml(submitTimeStr)}</div>
      <div class="meta-item"><strong>Judging time:</strong> ${escapeHtml(timeStr)}</div>
      ${sub.tokenUsage > 0 ? `<div class="meta-item" style="color:#4a90d9; font-weight:bold;"><i class="fas fa-microchip"></i> AI Cost: ${sub.tokenUsage} tokens ${sub.usedModel ? `<span style="font-size:12px; opacity:0.7;">(${escapeHtml(sub.usedModel)})</span>` : ''}</div>` : ''}
    </div>
    <div class="attempts-info"><strong>Total attempts on this problem:</strong> ${attempts}</div>
    <div id="answerPlaceholder">${answerHtml}</div>
    <div class="comment-box"><h3>Teacher's Comment</h3><p id="commentText">${commentHtml}</p></div>
    <a href="javascript:history.back()" class="back-link">← Back to submissions</a>
  </div>`;
}

async function loadDetail() {
  container.innerHTML = '<div class="detail-container" style="text-align:center;padding:2rem;"><span class="spinner"></span> Loading...</div>';
  try {
    const data = await apiCall(`/api/submissions?action=detail&subid=${encodeURIComponent(subid)}`);
    if (!data.success) throw new Error(data.message || 'Failed to load');
    // 权限标志由后端决定，前端只负责渲染
    CAN_REPORT = !!data.canReport;
    IS_ADMIN = !!data.isAdmin;
    container.innerHTML = renderDetail(data.submission, data.problemName, data.attempts);
    startScramble();

    // ⭐ 修复并确认 LaTeX 渲染
    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$',  right: '$$',  display: true  },
          { left: '\\[', right: '\\]', display: true  }, // 增加 \[ \]
          { left: '\\(', right: '\\)', display: false },
          { left: '$',   right: '$',   display: false },
        ],
        throwOnError: false,
        errorColor: '#cc0000',
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
      });
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="detail-container error-msg">Submission not found or access denied.</div>';
  }
}

window.addEventListener('beforeunload', () => { if (scrambleTimer) clearInterval(scrambleTimer); });

window.flagSubmission = async (flagType, targetUsername, problemId) => {
  if (!confirm(`Are you sure you want to issue a ${flagType.toUpperCase()} card to ${targetUsername}? This will reset their progress on this problem.`)) return;
  try {
    const res = await apiCall('/api/submissions?action=flag', 'POST', { subid, flagType });
    if (!res.success) throw new Error(res.message || 'Failed to flag');
    const urlParams = new URLSearchParams({ username: targetUsername, problemid: problemId, subid: subid, flag: flagType });
    window.location.href = `/admin/send-message?${urlParams.toString()}`;
  } catch (e) { alert(e.message); }
};

// 举报这条提交。后端会再挡一次「不能举报自己 / 不能举报 root」。
window.reportSubmission = async (targetSubid) => {
  const reason = prompt('Why are you reporting this submission?\n(e.g. judge seems wrong, answer leaked, suspicious content)');
  if (reason === null) return;                       // 取消
  try {
    const res = await apiCall('/api/submissions?action=report', 'POST', {
      subid: targetSubid || subid,
      reason: String(reason).slice(0, 1000),
    });
    if (!res.success) throw new Error(res.message || 'Failed to report');
    if (window.DSHUI && DSHUI.toast) DSHUI.toast('Report submitted', 'ok');
    else alert('Report submitted. Thank you!');
  } catch (e) {
    if (window.DSHUI && DSHUI.toast) DSHUI.toast(e.message, 'err');
    else alert(e.message);
  }
};

// 删除这条提交（管理员）。后端同时会把该用户在这题的状态重算。
window.deleteSubmission = async (targetSubid) => {
  if (!confirm('Delete this submission permanently?\nThis cannot be undone.')) return;
  try {
    const res = await apiCall('/api/submissions?action=delete', 'POST', { subid: targetSubid || subid });
    if (!res.success) throw new Error(res.message || 'Failed to delete');
    if (window.DSHUI && DSHUI.toast) DSHUI.toast('Submission deleted', 'ok');
    setTimeout(() => { window.location.href = '/submissions'; }, 600);
  } catch (e) {
    if (window.DSHUI && DSHUI.toast) DSHUI.toast(e.message, 'err');
    else alert(e.message);
  }
};

loadDetail();