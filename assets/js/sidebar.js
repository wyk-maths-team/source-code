// sidebar.js
(function() {
  console.log('sidebar.js executing...');
  const sidebar = document.getElementById('sidebarContainer');
  if (!sidebar) {
    console.warn('sidebarContainer not found');
    return;
  }

  const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const isRoot  = user && user.role === 'root';
  const isAdmin = user && (user.role === 'admin' || user.role === 'root');
  const currentUser = getCurrentUser();
  const ownSubmissionsUrl = currentUser
    ? `/submissions/user/${encodeURIComponent(currentUser.username)}`
    : '/submissions';

  // ---- 管理員：單一入口 ----
  const adminMenu = `
    <li>
      <a href="/admin" class="sidebar-link require-login sidebar-link-admin" data-page="admin">
        <i class="fa-solid fa-shield-halved fa-fw"></i> Admin Dashboard
      </a>
    </li>
  `;

  const sidebarHTML = `
    <nav class="sidebar-nav">
      <ul>
        <li><a href="/problems" class="sidebar-link require-login" data-page="problems"><i class="fa-solid fa-list-check fa-fw"></i> Problems</a></li>
        <li><a href="${ownSubmissionsUrl}" class="sidebar-link require-login" data-page="submissions"><i class="fa-solid fa-paper-plane fa-fw"></i> Your Submissions</a></li>
        <li><a href="/submissions" class="sidebar-link require-login" data-page="all-submissions"><i class="fa-solid fa-pen-to-square fa-fw"></i> All Submissions</a></li>
        <li><a href="/leaderboard" class="sidebar-link require-login" data-page="ranklist"><i class="fa-solid fa-ranking-star fa-fw"></i> Leaderboard</a></li>
        <li><a href="/resources" class="sidebar-link require-login" data-page="resources"><i class="fa-solid fa-folder-open fa-fw"></i> Resources</a></li>
        <li><a href="/contest" class="sidebar-link require-login" data-page="contest"><i class="fa-solid fa-trophy fa-fw"></i> Contests</a></li>
        ${isAdmin ? `
          <li><hr style="margin:8px 0; border-color:rgba(255,255,255,0.2);"></li>
          ${adminMenu}
          <li><hr style="margin:8px 0; border-color:rgba(255,255,255,0.2);"></li>
        ` : ''}
        <li><a href="/settings" class="sidebar-link require-login" data-page="template"><i class="fa-solid fa-gear fa-fw"></i> Settings</a></li>
        <li><a href="/credits" class="sidebar-link" data-page="credits"><i class="fa-solid fa-heart fa-fw"></i> Credits</a></li>
        <li><a href="/guide" class="sidebar-link" data-page="guide"><i class="fa-solid fa-book-open fa-fw"></i> Guides</a></li>
      </ul>
    </nav>
  `;

  sidebar.innerHTML = sidebarHTML;

  const isWide = window.innerWidth > 768;
  let isOpen;

  if (isWide) {
    isOpen = true;
  } else {
    const saved = localStorage.getItem('sidebarOpen');
    isOpen = saved === null ? false : saved === 'true';
  }

  if (!isWide) {
    sidebar.style.position = 'fixed';
    sidebar.style.top = 'var(--topbar-height)';
    sidebar.style.left = '0';
    sidebar.style.width = '100%';
    sidebar.style.height = 'calc(100vh - var(--topbar-height))';
    sidebar.style.transform = 'translateY(-100%)';
    sidebar.style.transition = 'transform 0.3s ease';
    sidebar.style.overflowY = 'auto';
    sidebar.style.zIndex = '9999';
    sidebar.style.display = isOpen ? 'block' : 'none';
  }

  sidebar.style.transition = 'none';
  if (isOpen) {
    sidebar.classList.add('open');
    document.body.classList.remove('sidebar-closed');
    if (!isWide) {
      sidebar.style.transform = 'translateY(0)';
      sidebar.style.display = 'block';
    }
  } else {
    sidebar.classList.remove('open');
    document.body.classList.add('sidebar-closed');
    if (!isWide) {
      sidebar.style.transform = 'translateY(-100%)';
      sidebar.style.display = 'none';
    }
  }
  void sidebar.offsetHeight;
  sidebar.style.transition = '';

  function saveSidebarState(open) {
    if (!isWide) localStorage.setItem('sidebarOpen', open);
  }

  function toggleSidebar() {
    if (isWide) return;
    const nowOpen = sidebar.classList.contains('open');
    if (nowOpen) {
      sidebar.classList.remove('open');
      sidebar.style.transform = 'translateY(-100%)';
      document.body.classList.add('sidebar-closed');
      const onTransitionEnd = () => {
        sidebar.removeEventListener('transitionend', onTransitionEnd);
        if (!sidebar.classList.contains('open')) sidebar.style.display = 'none';
      };
      sidebar.addEventListener('transitionend', onTransitionEnd);
      saveSidebarState(false);
    } else {
      sidebar.style.display = 'block';
      void sidebar.offsetHeight;
      sidebar.classList.add('open');
      sidebar.style.transform = 'translateY(0)';
      document.body.classList.remove('sidebar-closed');
      saveSidebarState(true);
    }
  }
  window.toggleSidebar = toggleSidebar;

  const toggleBtn = document.getElementById('sidebarToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleSidebar);
    if (isWide) toggleBtn.style.display = 'none';
  }

  let currentIsWide = isWide;
  window.addEventListener('resize', () => {
    const nowWide = window.innerWidth > 768;
    if (nowWide !== currentIsWide) {
      currentIsWide = nowWide;
      if (nowWide) {
        sidebar.style.position = '';
        sidebar.style.top = '';
        sidebar.style.left = '';
        sidebar.style.width = '';
        sidebar.style.height = '';
        sidebar.style.transform = '';
        sidebar.style.transition = '';
        sidebar.style.overflowY = '';
        sidebar.style.zIndex = '';
        sidebar.style.display = '';
        sidebar.classList.add('open');
        document.body.classList.remove('sidebar-closed');
        if (toggleBtn) toggleBtn.style.display = 'none';
      } else {
        sidebar.style.position = 'fixed';
        sidebar.style.top = 'var(--topbar-height)';
        sidebar.style.left = '0';
        sidebar.style.width = '100%';
        sidebar.style.height = 'calc(100vh - var(--topbar-height))';
        sidebar.style.transform = 'translateY(-100%)';
        sidebar.style.transition = 'transform 0.3s ease';
        sidebar.style.overflowY = 'auto';
        sidebar.style.zIndex = '9999';
        const saved = localStorage.getItem('sidebarOpen');
        const shouldOpen = saved === null ? false : saved === 'true';
        if (shouldOpen) {
          sidebar.style.display = 'block';
          sidebar.classList.add('open');
          sidebar.style.transform = 'translateY(0)';
          document.body.classList.remove('sidebar-closed');
        } else {
          sidebar.style.display = 'none';
          sidebar.classList.remove('open');
          sidebar.style.transform = 'translateY(-100%)';
          document.body.classList.add('sidebar-closed');
        }
        if (toggleBtn) toggleBtn.style.display = '';
      }
    }
  });

  // ---- Active 高亮 ----
  const path = window.location.pathname;
  const links = sidebar.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    const page = link.getAttribute('data-page');

    // Admin Dashboard：只要路徑以 /admin 開頭就高亮
    if (page === 'admin' && path.startsWith('/admin')) {
      link.classList.add('active');
      return;
    }

    if (page === 'problems' && path.startsWith('/problems')) link.classList.add('active');
    else if (page === 'resources' && path.startsWith('/resources')) link.classList.add('active');
    else if (page === 'submissions' && path.startsWith('/submissions/user')) link.classList.add('active');
    else if (page === 'all-submissions' && path === '/submissions') link.classList.add('active');
    else if (page === 'ranklist' && path.startsWith('/leaderboard')) link.classList.add('active');
    else if (page === 'template' && path.startsWith('/settings')) link.classList.add('active');
    else if (page === 'credits' && path.startsWith('/credits')) link.classList.add('active');
    else if (page === 'contest' && path.startsWith('/contest')) link.classList.add('active');
    else if (page === 'guide' && path.startsWith('/guide')) link.classList.add('active');
  });

  links.forEach(link => {
    link.addEventListener('click', function() {
      if (!isWide && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        sidebar.style.transform = 'translateY(-100%)';
        document.body.classList.add('sidebar-closed');
        const onEnd = () => {
          sidebar.removeEventListener('transitionend', onEnd);
          if (!sidebar.classList.contains('open')) sidebar.style.display = 'none';
        };
        sidebar.addEventListener('transitionend', onEnd);
        saveSidebarState(false);
      }
    });
  });

  // ---- 未登入攔截 ----
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.require-login');
    if (link && typeof isLoggedIn === 'function' && !isLoggedIn()) {
      e.preventDefault();
      const currentPath = window.location.pathname + window.location.search;
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
    }
  });
})();

// 預取
// (function () {
//   const prefetched = new Set();
//   let hoverTimer = null;
//   function prefetch(url) {
//     if (prefetched.has(url)) return;
//     prefetched.add(url);
//     fetch(url, { priority: 'low' }).catch(() => {});
//   }
//   document.addEventListener('mouseover', (e) => {
//     const a = e.target.closest('a');
//     if (!a) return;
//     const href = a.getAttribute('href');
//     if (!href) return;
//     if (a.target && a.target !== '_self') return;
//     if (a.hasAttribute('download')) return;
//     let url;
//     try { url = new URL(href, location.href); } catch { return; }
//     if (url.origin !== location.origin) return;
//     if (url.pathname === location.pathname) return;
//     clearTimeout(hoverTimer);
//     hoverTimer = setTimeout(() => prefetch(url.href), 100);
//   });
//   document.addEventListener('mouseout', () => clearTimeout(hoverTimer));
//   document.addEventListener('touchstart', (e) => {
//     const a = e.target.closest('a');
//     if (!a) return;
//     try {
//       const url = new URL(a.href, location.href);
//       if (url.origin === location.origin) prefetch(url.href);
//     } catch {}
//   }, { passive: true });
// })();
