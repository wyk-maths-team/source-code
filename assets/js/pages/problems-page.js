  (function() {
    if (localStorage.getItem('hideDifficulty') === 'true') {
      if (document.body) {
        document.body.classList.add('hide-difficulty');
      } else {
        document.addEventListener('DOMContentLoaded', () => {
          document.body.classList.add('hide-difficulty');
        });
      }
    }
    window.addEventListener('storage', (e) => {
      if (e.key === 'hideDifficulty') {
        document.body.classList.toggle('hide-difficulty', e.newValue === 'true');
      }
    });
  })();
