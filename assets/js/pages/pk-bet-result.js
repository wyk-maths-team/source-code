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

  const playerCards = r.players.map(p => {
    const isWinner = p.winner;
    const tag = p.role === 'weak'
      ? '<span class="tag weak">weaker side</span>'
      : '<span class="tag strong">stronger side</span>';
    const rows = (p.attempts || []).length
      ? p.attempts.map(a => `<div>Q: ${esc(a.problemId)} — score ${a.score} at ${a.timeSec}s → ${Number(a.weighted).toLocaleString()}</div>`).join('')
      : '<div>No submissions</div>';
    return `
      <div class="pkr-p ${isWinner ? 'winner' : ''}">
        <div class="nm">${esc(p.displayName)}${isWinner ? ' 🏆' : ''}${tag}</div>
        <div class="pkr-sub">rating ${p.rating} · stake ${p.stake.toLocaleString()}</div>
        <div class="pkr-score">${Number(p.totalScore).toLocaleString()}</div>
        <div class="pkr-detail">${rows}</div>
        <div class="pkr-prize">+${Number(p.prize).toLocaleString()} tokens</div>
      </div>`;
  }).join('');

  const scoreTable = r.problemIds.map((pid, i) => {
    const cells = r.players.map(p => {
      const a = (p.attempts || []).find(x => x.problemId === pid);
      if (!a) return '<td style="color:var(--text-secondary)">—</td>';
      return `<td>${a.score} @ ${a.timeSec}s → <b>${Number(a.weighted).toLocaleString()}</b></td>`;
    }).join('');
    return `<tr><td>${esc(pid)}</td><td>${r.problemDifficulties?.[i] ?? '—'}</td>${cells}</tr>`;
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
