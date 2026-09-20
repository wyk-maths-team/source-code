if (!isLoggedIn()) window.location.href = '/index.html';
if (!localStorage.getItem('cacheClean_v3')) {
  localStorage.removeItem('problemListCache');
  localStorage.removeItem('problemListVersion');
  localStorage.setItem('cacheClean_v3', '1');
}

const mainContainer = document.getElementById('mainContent');
let userStates = {};
let activeTags = new Set();
let currentPage = 1;
const pageLimit = 60;
let totalPages = 1;
let allProblems = [];
let filteredProblems = [];
let allTags = [];
let sortBy = 'id';
let sortOrder = 'asc';
let idFilterPattern = '';
window.favorites = new Set();

function getPageFromURL() {
  const p = parseInt(new URLSearchParams(window.location.search).get('page'));
  return (p > 0) ? p : 1;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
}

async function loadUserStates() {
  try {
    const data = await apiCall('/api/users?action=stats');
    if (data.success) userStates = data.states;
  } catch (err) { userStates = {}; }
  try {
    const favRes = await apiCall('/api/users?action=favorites');
    if (favRes.success) window.favorites = new Set(favRes.favorites);
  } catch (err) { window.favorites = new Set(); }
}

async function checkVersionAndUpdate() {
  try {
    const verRes = await apiCall('/api/problem?checkVersion=1');
    if (!verRes.success) return;
    const newVersion = verRes.version;
    const cachedVersion = localStorage.getItem('problemListVersion');
    if (cachedVersion && parseInt(cachedVersion) === newVersion) return;
    await fetchFreshList();
    applySortAndFilter();
    renderFullPage();
    localStorage.setItem('problemListVersion', newVersion);
  } catch (e) {
    console.error('Version check failed:', e);
  }
}

function loadFromCache() {
  const cacheKey = `problemListCache_${sortBy}_${sortOrder}`;
  const cached = localStorage.getItem(cacheKey);
  if (!cached) return false;
  try {
    const data = JSON.parse(cached);
    if (data.timestamp && Date.now() - data.timestamp > 24 * 60 * 60 * 1000) return false;
    if (!data.problems || !data.allTags) return false;
    allProblems = data.problems;
    allTags = data.allTags;
    applySortAndFilter();
    return true;
  } catch (e) { return false; }
}

function bindEvents() {
  document.querySelectorAll('.sortable').forEach(th => {
    if (th.dataset.listener) return;
    th.dataset.listener = 'true';
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortBy === field) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        sortBy = field;
        sortOrder = 'asc';
      }
      currentPage = 1;
      applySortAndFilter();
      updateURL();
      renderFullPage();
    });
  });

  document.querySelectorAll('.filter-tag-btn').forEach(btn => {
    if (btn.dataset.listener) return;
    btn.dataset.listener = 'true';
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      if (activeTags.has(tag)) activeTags.delete(tag);
      else activeTags.add(tag);
      localStorage.setItem('problemFilterTags', JSON.stringify(Array.from(activeTags)));
      currentPage = 1;
      applySortAndFilter();
      updateURL();
      renderFullPage();
    });
  });

  document.querySelectorAll('.pagination a').forEach(link => {
    if (link.dataset.listener) return;
    link.dataset.listener = 'true';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (!href) return;
      const page = parseInt(new URLSearchParams(href.substring(href.indexOf('?'))).get('page'));
      if (page && page !== currentPage) {
        currentPage = page;
        updateURL();
        renderFullPage();
      }
    });
  });

  const randomBtn = document.getElementById('randomUnsolvedBtn');
  if (randomBtn && !randomBtn.dataset.listener) {
    randomBtn.dataset.listener = 'true';
    randomBtn.onclick = async () => {
      try {
        const idsRes = await apiCall('/api/problem?ids=1');
        if (!idsRes.success) return;
        const unsolved = idsRes.ids.filter(id => userStates[id] !== 'passed');
        if (unsolved.length === 0) { alert('All problems solved!'); return; }
        location.href = `/problems/${unsolved[Math.floor(Math.random() * unsolved.length)]}`;
      } catch (e) { alert('Error'); }
    };
  }

  const idInput = document.getElementById('idFilterInput');
  if (idInput && !idInput.dataset.listener) {
    idInput.dataset.listener = 'true';
    idInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyIdFilter();
      }
    });
  }

  const clearBtn = document.getElementById('idFilterClearBtn');
  if (clearBtn && !clearBtn.dataset.listener) {
    clearBtn.dataset.listener = 'true';
    clearBtn.addEventListener('click', () => {
      const input = document.getElementById('idFilterInput');
      if (input) input.value = '';
      idFilterPattern = '';
      currentPage = 1;
      applySortAndFilter();
      updateURL();
      renderFullPage();
    });
  }
}

function applyIdFilter() {
  const input = document.getElementById('idFilterInput');
  if (!input) return;
  const raw = input.value.trim();
  idFilterPattern = raw;
  currentPage = 1;
  applySortAndFilter();
  updateURL();
  renderFullPage();
}

function applySortAndFilter() {
  let problems = allProblems;
  if (idFilterPattern) {
    const pattern = idFilterPattern;
    problems = problems.filter(prob => {
      const id = String(prob.id);
      if (pattern.startsWith('%') && pattern.endsWith('%')) {
        const middle = pattern.slice(1, -1);
        return id.includes(middle);
      } else if (pattern.startsWith('%')) {
        const suffix = pattern.slice(1);
        return id.endsWith(suffix);
      } else if (pattern.endsWith('%')) {
        const prefix = pattern.slice(0, -1);
        return id.startsWith(prefix);
      } else {
        return id === pattern;
      }
    });
  }

  if (activeTags.size > 0) {
    problems = problems.filter(p => p.tags && p.tags.some(t => activeTags.has(t)));
  }

  const sorted = [...problems].sort((a, b) => {
    let valA, valB;
    if (sortBy === 'difficulty') {
      valA = a.difficulty || 0;
      valB = b.difficulty || 0;
    } else if (sortBy === 'solves') {
      valA = a.solves || 0;
      valB = b.solves || 0;
    } else {
      const regex = /^([A-Za-z]*)(\d+)$/;
      const matchA = a.id.match(regex);
      const matchB = b.id.match(regex);
      if (matchA && matchB) {
        const prefixA = matchA[1].toLowerCase();
        const prefixB = matchB[1].toLowerCase();
        if (prefixA !== prefixB) {
          return sortOrder === 'asc' ? prefixA.localeCompare(prefixB) : prefixB.localeCompare(prefixA);
        }
        const numA = parseInt(matchA[2], 10);
        const numB = parseInt(matchB[2], 10);
        return sortOrder === 'asc' ? numA - numB : numB - numA;
      }
      if (a.id < b.id) return sortOrder === 'asc' ? -1 : 1;
      if (a.id > b.id) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    }
    if (sortOrder === 'asc') return valA - valB;
    return valB - valA;
  });

  if (activeTags.size === 0) {
    filteredProblems = sorted;
  } else {
    filteredProblems = sorted.filter(p => p.tags && p.tags.some(t => activeTags.has(t)));
  }
  totalPages = Math.ceil(filteredProblems.length / pageLimit);
  if (currentPage > totalPages) currentPage = Math.max(1, totalPages);
}

async function fetchFreshList() {
  try {
    const idsRes = await apiCall('/api/problem?ids=1');
    if (!idsRes.success || !idsRes.ids || idsRes.ids.length === 0) {
      allProblems = []; allTags = []; filteredProblems = []; totalPages = 0;
      return;
    }
    const idsParam = idsRes.ids.join(',');
    const data = await apiCall(`/api/problem?ids=${encodeURIComponent(idsParam)}&sortBy=${sortBy}&order=${sortOrder}`);
    if (data.success && data.problems) {
      allProblems = data.problems;
      allTags = data.allTags || [];
      const cacheKey = `problemListCache_${sortBy}_${sortOrder}`;
      localStorage.setItem(cacheKey, JSON.stringify({
        problems: allProblems,
        allTags: allTags,
        timestamp: Date.now()
      }));
      const verRes = await apiCall('/api/problem?checkVersion=1');
      if (verRes.success) localStorage.setItem('problemListVersion', verRes.version);
      applySortAndFilter();
    } else {
      allProblems = []; allTags = []; filteredProblems = []; totalPages = 0;
    }
  } catch (e) {
    console.error(e);
    allProblems = []; allTags = []; filteredProblems = []; totalPages = 0;
  }
}

async function initializeData() {
  const cachedVersion = localStorage.getItem('problemListVersion');
  const cacheKey = `problemListCache_${sortBy}_${sortOrder}`;
  const cached = localStorage.getItem(cacheKey);
  let cacheValid = false;
  if (cached) {
    try {
      const data = JSON.parse(cached);
      if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        cacheValid = true;
      }
    } catch (e) {}
  }
  if (!cachedVersion || !cacheValid) {
    await fetchFreshList();
    return;
  }
  try {
    const versionRes = await apiCall('/api/problem?checkVersion=1');
    if (versionRes.success && versionRes.version === parseInt(cachedVersion)) {
      if (!loadFromCache()) {
        await fetchFreshList();
      }
    } else {
      await fetchFreshList();
    }
  } catch (e) {
    if (!loadFromCache()) {
      allProblems = []; allTags = []; filteredProblems = []; totalPages = 0;
    }
  }
}

function getDifficultyColor(diff, isDark) {
  if (diff <= 0) return null;
  let hue, sat, light;
  if (diff < 3) {
    return isDark ? '#999999' : '#dddddd';
  } else if (diff < 4) {
    hue = 120; sat = 60; light = isDark ? 35 : 50;
  } else if (diff < 5) {
    hue = 210; sat = 70; light = isDark ? 40 : 55;
  } else if (diff < 6) {
    hue = 280; sat = 60; light = isDark ? 40 : 55;
  } else if (diff < 7) {
    hue = 45; sat = 80; light = isDark ? 45 : 60;
  } else if (diff < 8) {
    hue = 0; sat = 70; light = isDark ? 35 : 45;
  } else if (diff >= 8 && diff < 9) {
    extraClass = 'rainbow-bg';
    colorStyle = `color:#ffffff!important;border-radius:4px;padding:0 6px;`;
  } else if (diff >= 9 && diff < 10) {
    extraClass = 'star-shine';
    colorStyle = `color:#ffffff!important;border-radius:4px;padding:0 6px;`;
  } else {
    extraClass = 'chaos';
    colorStyle = `color:#ffffff!important;border-radius:4px;padding:0 6px;`;
  }
  sat = Math.max(10, Math.min(100, sat));
  light = Math.max(15, Math.min(80, light));
  return `hsl(${Math.round(hue)}, ${Math.round(sat)}%, ${Math.round(light)}%)`;
}

function renderFullPage() {
  const container = document.getElementById('skeletonPanel');
  if (!container) return;
  const showTags = localStorage.getItem('showTags') === 'true';
  const start = (currentPage - 1) * pageLimit;
  const pageProblems = filteredProblems.slice(start, start + pageLimit);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  // 构建过滤标签栏
  let filterHtml = '<span style="font-weight:600;">Filter tags:</span>';
  if (allTags.length === 0) {
    filterHtml += '<span style="color:var(--text-secondary);">(none)</span>';
  } else {
    allTags.forEach(tag => {
      const active = activeTags.has(tag) ? 'active' : '';
      filterHtml += `<button class="filter-tag-btn ${active}" data-tag="${tag}">${escapeHtml(tag)}</button>`;
    });
  }

  // 构建表格行
  let rowsHtml = '';
  pageProblems.forEach(prob => {
    const state = userStates[prob.id] || 'not_started';
    const rowClass = state === 'failed' ? 'state-failed' : (state === 'passed' ? 'state-passed' : 'state-not_started');
    const isFav = window.favorites?.has(prob.id) || false;
    const starIcon = `<i class="favorite-star ${isFav ? 'fas' : 'far'} fa-star" style="cursor:pointer;font-size:1.2rem;color:${isFav ? '#f1c40f' : '#aaa'};"></i>`;
    let statusIcon = '';
    if (state === 'passed') statusIcon = '<i class="fa fa-check-circle fa-green"></i>';
    else if (state === 'failed') statusIcon = '<i class="fa fa-times-circle fa-red"></i>';
    const tagsHtml = (prob.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

    let diffDisplay;
    let colorStyle = '';
    let extraClass = '';
    if (prob.difficulty === 0) {
      diffDisplay = '∞';
    } else {
      const diff = prob.difficulty;
      diffDisplay = diff.toFixed(2);
      if (diff >= 1 && diff < 2) {
        const lightness = 85;
        colorStyle = `background-color:hsl(0,0%,${lightness}%)!important;color:#000000!important;border-radius:4px;padding:0 6px;`;
      } else if (diff >= 2 && diff < 3) {
        const t = (diff - 2) / 1;
        const lightness = 70 - t * 35;
        colorStyle = `background-color:hsl(120,60%,${lightness}%)!important;color:#ffffff!important;border-radius:4px;padding:0 6px;`;
      } else if (diff >= 3 && diff < 4) {
        const t = (diff - 3) / 1;
        const lightness = 65 - t * 30;
        colorStyle = `background-color:hsl(210,70%,${lightness}%)!important;color:#ffffff!important;border-radius:4px;padding:0 6px;`;
      } else if (diff >= 4 && diff < 5) {
        const t = (diff - 4) / 1;
        const lightness = 65 - t * 30;
        colorStyle = `background-color:hsl(280,60%,${lightness}%)!important;color:#ffffff!important;border-radius:4px;padding:0 6px;`;
      } else if (diff >= 5 && diff < 6) {
        const t = (diff - 5) / 1;
        const lightness = 70 - t * 30;
        colorStyle = `background-color:hsl(45,80%,${lightness}%)!important;color:#000000!important;border-radius:4px;padding:0 6px;`;
      } else if (diff >= 6 && diff < 7) {
        const t = (diff - 6) / 1;
        const lightness = 60 - t * 25;
        colorStyle = `background-color:hsl(0,70%,${lightness}%)!important;color:#ffffff!important;border-radius:4px;padding:0 6px;`;
      } else if (diff >= 7 && diff < 8) {
        extraClass = 'rainbow-bg';
        colorStyle = `color:#000000!important;border-radius:4px;padding:0 6px;`;
      } else if (diff >= 8 && diff < 9) {
        extraClass = 'star-shine';
        colorStyle = `color:#000000!important;border-radius:4px;padding:0 6px;`;
      } else {
        extraClass = 'chaos';
        colorStyle = `color:#ffffff!important;border-radius:4px;padding:0 6px;`;
      }
    }

    rowsHtml += `<tr class="problem-row ${rowClass}" data-id="${prob.id}" onclick="sessionStorage.setItem('problemListScroll',window.scrollY);location.href='/problems/${encodeURIComponent(prob.id)}'">
      <td class="col-fav" onclick="event.stopPropagation(); toggleFavorite('${prob.id}', this)">${starIcon}</td>
      <td class="col-id">${prob.id}</td>
      <td class="col-name">${escapeHtml(prob.name)} ${statusIcon}</td>
      <td class="col-tags"><div class="tags-container">${tagsHtml}</div></td>
      <td class="col-level difficulty-cell ${extraClass}" style="${colorStyle}">${diffDisplay}</td>
      <td class="col-solves">${prob.solves || 0}</td>
    </tr>`;
  });

  if (!pageProblems.length) {
    rowsHtml = '<tr><td colspan="6" class="loading-msg">No problems found.</td></tr>';
  }

  const pagHtml = renderPagination();

  // 替换整个骨架容器内容
  container.innerHTML = `
    <div class="updates-header">
      <h2>Problem Set</h2>
      <div>
        <button id="randomUnsolvedBtn" class="btn btn-primary" style="margin-left:1rem;">Random Unsolved</button>
        <a href="/problems/bookmarked" class="btn btn-secondary" style="margin-left:0.5rem;">Bookmarked</a>
      </div>
    </div>
    <div class="filter-bar">${filterHtml}</div>
    <div class="id-filter-bar" style="margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
      <span style="font-weight:600;">Filter ID:</span>
      <input type="text" id="idFilterInput" style="padding:0.2rem 0.5rem; border:1px solid var(--border-color); border-radius:4px; flex:1; min-width:150px;" value="${escapeHtml(idFilterPattern)}">
      <button class="btn btn-secondary" id="idFilterClearBtn" style="padding:0.2rem 0.8rem;">Clear</button>
    </div>
    <div id="paginationTopContainer">${pagHtml}</div>
    <div class="table-responsive">
      <table class="problems-table ${showTags ? 'show-tags' : ''}">
        <thead>
          <tr>
            <th class="col-fav"></th>
            <th class="col-id sortable" data-sort="id">ID</th>
            <th class="col-name sortable" data-sort="id">Name</th>
            <th class="col-tags">Tags</th>
            <th class="col-level sortable" data-sort="difficulty">Level</th>
            <th class="col-solves sortable" data-sort="solves">Solves</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div id="paginationContainer">${pagHtml}</div>
  `;

  bindEvents();
}

function renderPagination() {
  if (totalPages <= 1) return '';
  let html = '<div class="pagination">';
  for (let i = 1; i <= totalPages; i++) {
    const params = new URLSearchParams(window.location.search);
    params.set('page', i);
    html += `<a class="${i === currentPage ? 'active' : ''}" href="?${params.toString()}">${i}</a>`;
  }
  html += '</div>';
  return html;
}

function updateURL() {
  const params = new URLSearchParams();
  params.set('page', currentPage);
  if (sortBy !== 'id') params.set('sortBy', sortBy);
  if (sortOrder !== 'asc') params.set('order', sortOrder);
  if (activeTags.size > 0) params.set('tags', Array.from(activeTags).join(','));
  if (idFilterPattern) params.set('idfilter', idFilterPattern);
  window.history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
}

async function toggleFavorite(problemId, starCell) {
  const starIcon = starCell.querySelector('i');
  const reallyFav = starIcon.classList.contains('fas');
  if (reallyFav) {
    starIcon.classList.replace('fas', 'far');
    starIcon.style.color = '#aaa';
  } else {
    starIcon.classList.replace('far', 'fas');
    starIcon.style.color = '#f1c40f';
  }
  try {
    const res = await apiCall('/api/users?action=favorite', 'POST', { problemId });
    if (res.success) {
      window.favorites = new Set(res.favorites);
    } else {
      if (reallyFav) {
        starIcon.classList.replace('far', 'fas');
        starIcon.style.color = '#f1c40f';
      } else {
        starIcon.classList.replace('fas', 'far');
        starIcon.style.color = '#aaa';
      }
      alert('Error toggling favorite');
    }
  } catch (e) {
    if (reallyFav) {
      starIcon.classList.replace('far', 'fas');
      starIcon.style.color = '#f1c40f';
    } else {
      starIcon.classList.replace('fas', 'far');
      starIcon.style.color = '#aaa';
    }
    alert('Network error');
  }
}

async function init() {
  // 先显示骨架（已存在，无需操作）
  // 从 URL 读取参数
  const params = new URLSearchParams(window.location.search);
  sortBy = params.get('sortBy') || 'id';
  sortOrder = params.get('order') || 'asc';
  if (params.has('tags')) {
    activeTags = new Set(params.get('tags').split(','));
  } else {
    const saved = localStorage.getItem('problemFilterTags');
    if (saved) { try { activeTags = new Set(JSON.parse(saved)); } catch (e) {} }
  }
  if (params.has('idfilter')) {
    idFilterPattern = params.get('idfilter');
  } else {
    idFilterPattern = '';
  }
  currentPage = getPageFromURL();

  const cacheKey = `problemListCache_${sortBy}_${sortOrder}`;
  const cached = localStorage.getItem(cacheKey);
  let cacheValid = false;
  if (cached) {
    try {
      const data = JSON.parse(cached);
      if (data.timestamp && Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
        allProblems = data.problems;
        allTags = data.allTags;
        applySortAndFilter();
        cacheValid = true;
      }
    } catch (e) {}
  }

  if (cacheValid) {
    await loadUserStates();
    renderFullPage();
    checkVersionAndUpdate();
  } else {
    await initializeData();
    applySortAndFilter();
    await loadUserStates();
    renderFullPage();
  }

  const savedScroll = sessionStorage.getItem('problemListScroll');
  if (savedScroll) {
    window.scrollTo(0, parseInt(savedScroll));
    sessionStorage.removeItem('problemListScroll');
  }
}

window.addEventListener('popstate', init);
init();