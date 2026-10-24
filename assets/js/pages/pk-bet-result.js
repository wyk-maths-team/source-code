// assets/js/pages/pk-bet-result.js —— PK 结算页（永久）
Page.boot({ title: 'PK Result', requireAuth: true });

Page.ready(async (user) => {
  const params = new URLSearchParams(location.search);
  const resultId = params.get('id') || params.get('resultId');
  const root = document.getElementById('pkrRoot');

  function esc(s) {
    return (window.DSHUI && DSHUI.esc) ? DSHUI.esc(s) : String(s == null ? '' : s);
  }

  if (!resultId) {
    root.innerHTML = '<div class="pkr-card" style="color:#e74c3c;">Missing result id.</div>';
    return;
  }

  let res;
  try {
    res = await apiCall(`/api/pk-bet?action=result&resultId=${encodeURIComponent(resultId)}`);
  } catch (e) {
    root.innerHTML = '<div class="pkr-card" style="color:#e74c3c;">Network error.</div>';
    return;
  }

  if (!res.success || !res.result) {
    root.innerHTML = `<div class="pkr-card" style="color:#e74c3c;">${esc(res.message || 'Result not found')}</div>`;
    return;
  }

  const r = res.result;
  const me = (getCurrentUser() || {}).username;
  const started = new Date(r.startAt);
  const ended = new Date(r.endAt);

  // ⭐ 修改一：替换 Emoji 并优化玩家卡片
  const playerCards = r.players.map(p => {
    const isWinner = p.winner;
    const tag = p.role === 'weak'
      ? '<span class="tag weak"><i class="fas fa-shield-halved"></i> Weaker</span>'
      : '<span class="tag strong"><i class="fas fa-fire"></i> Stronger</span>';
    const rows = (p.attempts || []).length
      ? p.attempts.map(a => `<div class="pkr-atk"><i class="fas fa-crosshairs" style="opacity:0.5"></i> ${esc(a.problemId)} <span class="val">${a.score} pts</span> <span class="tm">(${a.timeSec}s)</span></div>`).join('')
      : '<div class="pkr-atk" style="opacity:0.5">No submissions</div>';
    
    // 使用 FontAwesome 的皇冠
    const crown = isWinner ? '<i class="fas fa-crown" style="color: #f1c40f; text-shadow: 0 0 8px #f1c40f; margin-left: 6px;"></i>' : '';

    return `
      <div class="pkr-p ${isWinner ? 'winner' : 'loser'}">
        <div class="nm">${esc(p.displayName)} ${crown} ${tag}</div>
        <div class="pkr-sub">Rating ${p.rating} · Stake ${p.stake.toLocaleString()}</div>
        <div class="pkr-score">${Number(p.totalScore).toLocaleString()}</div>
        <div class="pkr-detail">${rows}</div>
        <div class="pkr-prize"><i class="fas fa-coins"></i> +${Number(p.prize).toLocaleString()}</div>
      </div>`;
  }).join('');

  // ⭐ 修改二：表格空数据使用 FontAwesome 图标
  const scoreTable = r.problemIds.map((pid, i) => {
    const cells = r.players.map(p => {
      const a = (p.attempts || []).find(x => x.problemId === pid);
      if (!a) return '<td style="color:var(--text-secondary)"><i class="fas fa-minus"></i></td>';
      return `<td><span class="t-score">${a.score}</span> <span class="t-time">@ ${a.timeSec}s</span> <br><span class="t-weighted">${Number(a.weighted).toLocaleString()}</span></td>`;
    }).join('');
    return `<tr><td class="t-pid">${esc(pid)}</td><td class="t-diff">${r.problemDifficulties?.[i] ?? '—'}</td>${cells}</tr>`;
  }).join('');

  root.innerHTML = `
    <div class="pkr-card">
      <div class="pkr-title">PK Result</div>
      <div class="pkr-sub">
        ${esc(started.toLocaleString())} → ${esc(ended.toLocaleString())}
        · duration 30 min · result ${esc(r.id)}
      </div>
      <div class="pkr-row">
        <span>Pool <b>${Number(r.pool).toLocaleString()}</b></span>
        <span>Fee (20%) <b>${Number(r.fee).toLocaleString()}</b></span>
        <span>Prize <b>${Number(r.prize).toLocaleString()}</b></span>
        <span>Subsidy factor <b>F = ${r.subsidyFactor}</b></span>
        <span>Weaker share <b>${(r.ratioWeak * 100).toFixed(1)}%</b></span>
      </div>
      <div class="pkr-grid">${playerCards}</div>

      <table class="pkr-table">
        <thead>
          <tr>
            <th>Problem</th><th>Diff</th>
            ${r.players.map(p => `<th>${esc(p.displayName)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${scoreTable}</tbody>
      </table>

      <div class="pkr-note">
        Per-problem score = (1800 − T) × 100, where T is the second you last submitted that problem.
        Only the last submission per problem counts. The weaker side (lower total score) receives
        <code>prize × share × F</code>, where F is a token-balance based subsidy (F = 1 means a plain
        split by score share). The stronger side receives the remainder, always non-negative.
      </div>
    </div>
  `;
});
