    if (!isLoggedIn()) window.location.href = '/index.html';

    async function loadStatus() {
      try {
        const data = await apiCall('/api/status');
        if (!data.success) throw new Error(data.message);
        return data;
      } catch (err) {
        console.error(err);
        return null;
      }
    }

    function renderStatus(data) {
      const mc = document.getElementById('mainContent');
      if (!data) {
        mc.innerHTML = '<div class="error-msg">Failed to load status.</div>';
        return;
      }

      // MongoDB 部分
      const usedPercent = Math.min(100, ((parseFloat(data.dbSizeMB) / 512) * 100)).toFixed(2);

      let html = `<div class="status-container">
        <h2>Server Status</h2>
        <h3>MongoDB</h3>
        <div class="status-item">
          <span class="status-label">Database Storage Used</span>
          <span class="status-value">${data.dbSizeMB} MB / 512 MB</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${usedPercent}%;">${usedPercent}%</div>
        </div>
        <div class="status-item">
          <span class="status-label">Data Size</span>
          <span class="status-value">${data.dataSizeMB} MB</span>
        </div>
        <div class="status-item">
          <span class="status-label">Index Size</span>
          <span class="status-value">${data.indexSizeMB} MB</span>
        </div>
        <div class="status-item">
          <span class="status-label">Free Space</span>
          <span class="status-value">${data.freeMB} MB</span>
        </div>
        <div class="status-item">
          <span class="status-label">Server Time</span>
          <span class="status-value">${new Date(data.serverTime).toLocaleString()}</span>
        </div>
        <div class="status-item" style="color: var(--text-secondary);">
          <span>Load data not available on Vercel free plan.</span>
        </div>`;

      // Cloudinary 状态
      if (data.cloudinary) {
        if (data.cloudinary.error) {
          html += `<h3>Cloudinary Status</h3>
          <p style="color: var(--danger);">Error: ${data.cloudinary.message}</p>`;
        } else {
          const storageUsedMB = parseFloat(data.cloudinary.storageUsedMB) || 0;
          const storageLimitMB = parseFloat(data.cloudinary.limitMB) || 25600; // 25 GB free
          const storagePercent = Math.min(100, ((storageUsedMB / storageLimitMB) * 100)).toFixed(2);
          const bandwidthUsedMB = parseFloat(data.cloudinary.bandwidthUsedMB) || 0;
          const bandwidthLimitMB = parseFloat(data.cloudinary.limitMB) || 25600; // 25 GB free
          const bandwidthPercent = Math.min(100, ((bandwidthUsedMB / bandwidthLimitMB) * 100)).toFixed(2);

          html += `<h3>Cloudinary Status</h3>
          <div class="status-item">
            <span class="status-label">Storage Used</span>
            <span class="status-value">${storageUsedMB.toFixed(2)} MB / ${storageLimitMB.toLocaleString()} MB</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${storagePercent}%;">${storagePercent}%</div>
          </div>
          <div class="status-item">
            <span class="status-label">Bandwidth Used</span>
            <span class="status-value">${bandwidthUsedMB.toFixed(2)} MB / ${bandwidthLimitMB.toLocaleString()} MB</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${bandwidthPercent}%;">${bandwidthPercent}%</div>
          </div>`;
        }
      }

      // 集合详情
      html += `<h3>Collections</h3>
        <table class="collection-table">
          <thead><tr><th>Name</th><th>Documents</th><th>Size (MB)</th><th>Avg. Obj Size (bytes)</th></tr></thead>
          <tbody>`;

      data.collections.forEach(c => {
        html += `<tr>
          <td>${c.name}</td>
          <td>${c.documentCount}</td>
          <td>${c.storageSizeMB}</td>
          <td>${c.avgObjSize}</td>
        </tr>`;
      });

      html += '</tbody></table></div>';
      mc.innerHTML = html;
    }
    // ═══════════════ Vercel 用量 ═══════════════
const VERCEL_ICONS = {
  invocations: 'fa-bolt',
  cpu: 'fa-microchip',
  memory: 'fa-memory',
  fastOriginTransfer: 'fa-right-left',
  fastDataTransfer: 'fa-cloud-arrow-down',
  cdnRequests: 'fa-globe',
  observabilityEvents: 'fa-wave-square',
};

function fmtBytes(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(2) + ' MB';
  return (bytes / 1024 ** 3).toFixed(2) + ' GB';
}

function fmtCpuMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms.toFixed(0) + ' ms';
  if (ms < 3_600_000) return (ms / 1000).toFixed(1) + ' s';
  return (ms / 3_600_000).toFixed(2) + ' hr';
}

function fmtGbMs(v) {
  if (v == null) return '—';
  // Vercel 里可能是 GB-ms 或 GB-hr；小于 1000 时当作 GB-hr
  if (v < 1000) return v.toFixed(2) + ' GB·hr';
  return (v / 3_600_000).toFixed(2) + ' GB·hr';
}
function fmtGbHr(v) {
  if (v == null) return '—';
  if (v < 1) return (v * 1000).toFixed(0) + ' MB·hr';
  return v.toFixed(2) + ' GB·hr';
}
function fmtGbSec(v) {
  if (v == null) return '—';
  return v.toFixed(3) + ' GB·s';
}
function fmtGb(v) {
  if (v == null) return '—';
  if (v < 1) return (v * 1024).toFixed(1) + ' MB';
  if (v < 1024) return v.toFixed(2) + ' GB';
  return (v / 1024).toFixed(2) + ' TB';
}
function fmtCount(v) {
  if (v == null) return '—';
  if (v < 1000) return v.toString();
  if (v < 1_000_000) return (v / 1000).toFixed(1) + 'K';
  return (v / 1_000_000).toFixed(2) + 'M';
}
function fmtMetric(metric) {
  const v = metric.usage;
  switch (metric.unit) {
    case 'bytes':   return fmtBytes(v);
    case 'kb':      return v.toFixed(2) + ' KB';
    case 'mb':      return v.toFixed(2) + ' MB';
    case 'gb':      return fmtGb(v);
    case 'gbhr':    return fmtGbHr(v);
    case 'gbmonth': return v.toFixed(2) + ' GB·mo';
    case 'ms':      return fmtCpuMs(v);
    case 'sec':     return v < 60 ? v.toFixed(2) + ' s' : (v / 60).toFixed(1) + ' min';
    case 'min':     return v < 60 ? v.toFixed(1) + ' min' : (v / 60).toFixed(2) + ' hr';
    case 'hr':      return v < 1 ? (v * 60).toFixed(1) + ' min' : v.toFixed(2) + ' hr';
    case 'usd':     return '$' + v.toFixed(2);
    default:        return fmtCount(v);
  }
}

function fmtLimit(metric) {
  if (metric.limit == null) return '';
  return '/ ' + fmtMetric({ ...metric, usage: metric.limit });
}


function severity(pct) {
  if (pct == null) return '';
  if (pct >= 80) return 'danger';
  if (pct >= 50) return 'warn';
  return '';
}
function escapeHtmlVc(s) {
  return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
}
function renderVercelSection(container, data) {
  const wrap = document.createElement('div');
  wrap.className = 'vc-section';

  if (!data) {
    wrap.innerHTML = `<h3><i class="fas fa-triangle-exclamation"></i> Vercel Usage</h3>
      <div class="vc-error">Failed to load Vercel usage.</div>`;
    container.appendChild(wrap);
    return;
  }
  if (!data.success) {
    wrap.innerHTML = `<h3><i class="fas fa-triangle-exclamation"></i> Vercel Usage</h3>
      <div class="vc-error">${data.message || 'Not configured'}</div>`;
    container.appendChild(wrap);
    return;
  }

  const metrics = data.metrics || [];

  // 汇总：所有 metric 的 cost 之和
  const totalCost = metrics.reduce((s, m) => s + (m.cost || 0), 0);

  let html = `
    <h3>
      <i class="fas fa-chart-pie" style="color:var(--accent)"></i>
      Vercel Usage
      <span class="vc-badge">Last 30 days</span>
    </h3>
  `;

  html += `
    <div class="vc-summary">
      <div>
        <div class="vc-summary-label">预估用量成本（30 天）</div>
        <div style="font-size:.75rem;color:var(--text-secondary);margin-top:2px;">
          ${data.entryCount || 0} 条明细
        </div>
      </div>
      <div class="vc-summary-value">$${totalCost.toFixed(2)}</div>
    </div>
  `;

  if (metrics.length === 0) {
    html += `<div class="vc-loading">No usage data returned.</div>`;
  } else {
    html += `<div class="vc-grid">`;
    for (const m of metrics) {
      const pct = (m.limit && m.limit > 0) ? Math.min(100, (m.usage / m.limit) * 100) : null;
      const sev = severity(pct);
            const isSubscription = m.category === 'Subscription Licenses';
      const displayValue = isSubscription
        ? '<span style="font-size:.9rem;color:var(--text-secondary);font-weight:600;">Monthly subscription</span>'
        : fmtMetric(m);
      const icon = VERCEL_ICONS[m.key] || (isSubscription ? 'fa-id-card' : 'fa-cube');
      html += `
        <div class="vc-card ${sev}">
          <div class="vc-card-head">
            <span class="vc-card-label">
              <i class="fas ${icon}"></i>${m.label}
            </span>
            ${m.cost != null ? `<span class="vc-card-cost">$${m.cost.toFixed(2)}</span>` : ''}
          </div>
          <div class="vc-card-value">${displayValue}</div>
          ${!isSubscription && m.limit ? `<div class="vc-card-limit">${fmtLimit(m)}</div>` : ''}
          ${!isSubscription && pct != null ? `
            <div class="vc-bar"><div class="vc-bar-fill" style="width:${pct}%"></div></div>
            <div class="vc-card-pct">
              <span>${pct.toFixed(1)}%</span>
              <span>${fmtMetric({ ...m, usage: Math.max(0, m.limit - m.usage) })} left</span>
            </div>
          ` : ''}
        </div>
      `;
    }
    html += `</div>`;
  }
    // ⭐ 原始数据（调试用）
    // ⭐ 完整服务列表（包括零值）
  if (data.allServiceNames && data.allServiceNames.length) {
    html += `
      <details style="margin-top:1rem;">
        <summary style="cursor:pointer;font-size:.8rem;color:var(--text-secondary);">
          所有 Vercel 服务明细（${data.allServiceNames.length} 条聚合）
        </summary>
        <pre style="background:rgba(0,0,0,.04);border:1px solid var(--border-color);
                    border-radius:6px;padding:10px;font-size:.72rem;
                    overflow:auto;max-height:320px;margin-top:8px;">${escapeHtmlVc(data.allServiceNames.join('\n'))}</pre>
      </details>
    `;
  }
  html += `
    <div class="vc-footer">
      <span>范围：${new Date(data.from).toLocaleDateString()} — ${new Date(data.to).toLocaleDateString()}</span>
      <button id="vcRefreshBtn"><i class="fas fa-rotate"></i> Refresh</button>
    </div>
  `;

  wrap.innerHTML = html;
  container.appendChild(wrap);

  const btn = wrap.querySelector('#vcRefreshBtn');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
      try {
        const vc = await apiCall('/api/status?action=vercel');
        wrap.remove();
        renderVercelSection(container, vc);
      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rotate"></i> Refresh';
        (window.DSHUI ? DSHUI.toast('Refresh failed: ' + err.message, 'err') : alert('Refresh failed: ' + err.message));
      }
    });
  }
}

async function loadVercelSection() {
  const mc = document.getElementById('mainContent');
  const container = mc.querySelector('.status-container');
  if (!container) return;
  try {
    const data = await apiCall('/api/status?action=vercel');
    renderVercelSection(container, data);
  } catch (err) {
    renderVercelSection(container, { success: false, message: err.message });
  }
}
    (async () => {
      const data = await loadStatus();
      renderStatus(data);
      loadVercelSection();
    })();
  