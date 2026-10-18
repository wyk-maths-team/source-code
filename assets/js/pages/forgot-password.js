    // 已登录用户直接去设置页改密码，不用走这条路
    if (typeof isLoggedIn === 'function' && isLoggedIn()) {
      window.location.href = '/settings';
    }

    const params = new URLSearchParams(location.search);
    const err = params.get('error');
    if (err) {
      const box = document.getElementById('errorBox');
      box.style.display = 'block';
      const msgs = {
        'domain': '<strong>Wrong email domain</strong>You must sign in with your @cloud.wyk.edu.hk school account.',
        'not_registered': '<strong>No account found</strong>This Microsoft account has not been registered on the OJ yet. <a href="/login" style="color:inherit;text-decoration:underline;">Sign in normally</a> to create one.',
        'oauth_failed': '<strong>Verification failed</strong>Microsoft login was interrupted. Please try again.',
      };
      box.innerHTML = msgs[err] || '<strong>Something went wrong</strong>Please try again or contact an admin.';
    }
  