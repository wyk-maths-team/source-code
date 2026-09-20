// sidebar-public.js
(function() {
  const sidebar = document.getElementById('sidebarContainer');
  if (!sidebar) return;

  const isAdmin = false;

  const sidebarHTML = `
    <nav class="sidebar-nav">
      <ul>
        <li><a href="/problems" class="sidebar-link" data-page="problems">Problems</a></li>
        <li><a href="/submissions" class="sidebar-link" data-page="submissions">Your submissions</a></li>
        <li><a href="/submissions" class="sidebar-link" data-page="all-submissions">All submissions</a></li>
        <li><a href="/ranklist.html" class="sidebar-link" data-page="ranklist">Leaderboard</a></li>
        <li><a href="/resources" class="sidebar-link" data-page="resources">Resources</a></li>
        <li><a href="/contest" class="sidebar-link" data-page="contest">Contests</a></li>
        <li><a href="/settings" class="sidebar-link" data-page="template">Settings</a></li>
        <li><a href="/credits" class="sidebar-link" data-page="credits">Credits</a></li>
        <li><a href="/guide" class="sidebar-link" data-page="guide">Guides</a></li>
      </ul>
    </nav>
  `;

  sidebar.innerHTML = sidebarHTML;

  const path = window.location.pathname;
  const links = sidebar.querySelectorAll('.sidebar-link');
  links.forEach(link => {
    const page = link.getAttribute('data-page');
    if (page === 'problems' && path.startsWith('/problems')) link.classList.add('active');
    else if (page === 'resources' && path.startsWith('/resources')) link.classList.add('active');
    else if (page === 'contest' && path.startsWith('/contest')) link.classList.add('active');
    else if (page === 'template' && path.startsWith('/settings')) link.classList.add('active');
    else if (page === 'credits' && path.startsWith('/credits')) link.classList.add('active');
    else if (page === 'guide' && path.startsWith('/guide')) link.classList.add('active');
    else if (page === 'ranklist' && path.startsWith('/ranklist')) link.classList.add('active');
    else if (page === 'submissions' && path.startsWith('/submissions')) link.classList.add('active');
    else if (page === 'all-submissions' && path === '/submissions') link.classList.add('active');
    else if (path.includes(page) && !path.startsWith('/admin')) link.classList.add('active');
  });

  const savedState = localStorage.getItem('sidebarOpen');
  const isOpen = savedState === null ? true : savedState === 'true';
  if (isOpen) {
    sidebar.classList.add('open');
  } else {
    sidebar.classList.remove('open');
  }

  const toggleBtn = document.getElementById('sidebarToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      localStorage.setItem('sidebarOpen', sidebar.classList.contains('open'));
    });
  }
})();