if (!isLoggedIn()) window.location.href = '/index.html';
(function () {
  const s = localStorage.getItem('fontSize') || '16';
  document.documentElement.style.fontSize = s + 'px';
})();

const parts = window.location.pathname.split('/');
const subid = parts[parts.length - 2];
const container = document.getElementById('mainContent');

// ============ 工具 ============
function escapeHtml(s) { return ((window.DSHUI && window.DSHUI.esc) || function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; }); })(s); }

function computeStatus(sub) {
  if (sub.status === 'Violation') return { text: 'Violation', cls: 'status-system' };
  if (sub.marked && sub.score !== undefined) {
    if (sub.score === 100) return { text: 'Accepted', cls: 'status-accepted' };
    if (sub.score === 0) return { text: 'Wrong Answer', cls: 'status-wrong' };
    return { text: `Partial Score (${sub.score}%)`, cls: 'status-partial' };
  }
  if (sub.type === 'image' && !sub.marked) {
    return { text: 'Pending', cls: 'status-pending' };
  }
  if (sub.systemError) {
    return { text: 'System Error', cls: 'status-system' };
  }
  if (typeof sub.correct === 'boolean') {
    return sub.correct
      ? { text: 'Accepted', cls: 'status-accepted' }
      : { text: 'Wrong Answer', cls: 'status-wrong' };
  }
  return { text: 'Pending', cls: 'status-pending' };
}

// ============ 動態亂碼 ============
const SCRAMBLE_LENGTH = 32;
const SCRAMBLE_CHARS = '░▒▓'; // █▚▞▙▟

let scrambleTimer = null;

function randomScramble() {
  let s = '';
  for (let i = 0; i < SCRAMBLE_LENGTH; i++) {
    s += SCRAMBLE_CHARS.charAt(Math.floor(Math.random() * SCRAMBLE_CHARS.length));
  }
  return s;
}

function startScramble() {
  const els = document.querySelectorAll('.scramble-text');
  if (!els.length) return;
  if (scrambleTimer) clearInterval(scrambleTimer);
  els.forEach(el => { el.textContent = randomScramble(); });
  scrambleTimer = setInterval(() => {
    const nodes = document.querySelectorAll('.scramble-text');
    if (!nodes.length) {
      clearInterval(scrambleTimer);
      scrambleTimer = null;
      return;
    }
    nodes.forEach(el => { el.textContent = randomScramble(); });
  }, 20);
}

function hiddenScrambleHtml(label) {
  return `<span class="hidden-scramble" title="${escapeHtml(label)}">` +
         `<i class="fas fa-lock"></i> ` +
         `<span class="scramble-text">${randomScramble()}</span> ` +
         `<i class="fas fa-eye-slash"></i>` +
         `</span>`;
}

// ============ 渲染 ============
function renderDetail(sub, problemName, attempts) {
  const status = computeStatus(sub);

  const submitTime = new Date(sub.timestamp);
  const submitTimeStr = submitTime.toLocaleString('zh-HK', { timeZone: 'Asia/Hong_Kong' });
  const judgeTime = sub.markedAt ? new Date(sub.markedAt) : submitTime;
  
  // ⭐ 修复 1：处理 judgingMs 未定义和负数时间差
  let diffSec = Math.max(Math.floor((judgeTime - submitTime) / 1000), 0);
  if (sub.judgingMs) {
    diffSec = Math.max(diffSec, Math.floor(sub.judgingMs / 1000));
  }
  
  const timeStr = diffSec < 60
    ? `${diffSec} seconds`
    : `${Math.floor(diffSec / 60)} min ${diffSec % 60} sec`;

  let answerHtml;
  if (sub.type === 'image' && sub.image) {
    answerHtml = `<img src="${escapeHtml(sub.image)}" class="answer-image" alt="Submission image">`;
  } else if (sub.answerHidden) {
    answerHtml = `<div class="answer-text">${hiddenScrambleHtml('Answer hidden')}</div>`;
  } else {
    answerHtml = `<div class="answer-text"><strong>Answer:</strong> ${escapeHtml(String(sub.answer || 'No answer recorded'))}</div>`;
  }

  let commentHtml;
  if (sub.commentHidden) {
    commentHtml = hiddenScrambleHtml('Comment hidden');
  } else if (sub.comment) {
    commentHtml = escapeHtml(sub.comment).replace(/\n/g, '<br>');
  } else {
    commentHtml = '<span class="no-comment">No comment yet.</span>';
  }

  // ⭐ 修复 2：用 data-* 把用户和题目 ID 绑在按钮上，杜绝 DOM 瞎抓和未定义
  return `<div class="detail-container" id="detailRoot">
    <div class="submission-header">
      <h2>Submission #${escapeHtml(sub.subid)}</h2>
      <div class="badge-group">
        <span class="badge ${status.cls}">${escapeHtml(status.text)}</span>
        <button onclick="flagSubmission('red', '${escapeHtml(sub.username)}', '${escapeHtml(sub.problemId)}')" style="margin-left:10px; background:#d93025; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Red Flag</button>
        <button onclick="flagSubmission('yellow', '${escapeHtml(sub.username)}', '${escapeHtml(sub.problemId)}')" style="margin-left:5px; background:#e3a008; color:#fff; border:none; padding:4px 8px; border-radius:4px; cursor:pointer;">Yellow Flag</button>
      </div>
    </div>
    <div class="meta-row">
      <div class="meta-item"><strong>User:</strong> <a href="/users/${encodeURIComponent(sub.username)}">${escapeHtml(sub.username)}</a></div>
      <div class="meta-item"><strong>Problem:</strong> <a href="/problems/${encodeURIComponent(sub.problemId)}">${escapeHtml(sub.problemId)} - ${escapeHtml(problemName)}</a></div>
      <div class="meta-item"><strong>Submitted:</strong> ${escapeHtml(submitTimeStr)}</div>
      <div class="meta-item"><strong>Judging time:</strong> ${escapeHtml(timeStr)}</div>
      
      ${sub.tokenUsage > 0 ? `
        <div class="meta-item" style="color:#4a90d9; font-weight:bold;">
          <i class="fas fa-microchip"></i> AI Cost: ${sub.tokenUsage} tokens 
          ${sub.usedModel ? `<span style="font-size:12px; opacity:0.7;">(${escapeHtml(sub.usedModel)})</span>` : ''}
        </div>
      ` : ''}
    </div>
    <div class="attempts-info"><strong>Total attempts on this problem:</strong> ${attempts}</div>
    <div id="answerPlaceholder">${answerHtml}</div>
    <div class="comment-box"><h3>Teacher's Comment</h3><p id="commentText">${commentHtml}</p></div>
    <a href="javascript:history.back()" class="back-link">← Back to submissions</a>
  </div>`;
}

// ============ 載入 ============
async function loadDetail() {
  container.innerHTML = '<div class="detail-container" style="text-align:center;padding:2rem;"><span class="spinner"></span> Loading...</div>';
  try {
    const data = await apiCall(`/api/submissions?action=detail&subid=${encodeURIComponent(subid)}`);
    if (!data.success) throw new Error(data.message || 'Failed to load');

    container.innerHTML = renderDetail(data.submission, data.problemName, data.attempts);

    startScramble();

    if (typeof renderMathInElement !== 'undefined') {
      renderMathInElement(container, {
        delimiters: [
          { left: '$$',  right: '$$',  display: true  },
          { left: '\\[', right: '\\]', display: true  },
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

window.addEventListener('beforeunload', () => {
  if (scrambleTimer) clearInterval(scrambleTimer);
});

// ⭐ 修复 3：修改 flagSubmission，直接从参数接收 username 和 problemId
window.flagSubmission = async (flagType, targetUsername, problemId) => {
  if (!confirm(`Are you sure you want to issue a ${flagType.toUpperCase()} card to ${targetUsername}? This will reset their progress on this problem.`)) return;
  
  try {
    const res = await apiCall('/api/submissions?action=flag', 'POST', { subid, flagType });
    if (!res.success) throw new Error(res.message || 'Failed to flag');
    
    // 跳转到发信页面，带上准确的 URL 参数
    const urlParams = new URLSearchParams({
      username: targetUsername,
      problemid: problemId,
      subid: subid,
      flag: flagType
    });
    window.location.href = `/admin/send-message?${urlParams.toString()}`;
  } catch (e) {
    alert(e.message);
  }
};

loadDetail();