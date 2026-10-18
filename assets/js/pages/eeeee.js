    if (!isLoggedIn()) window.location.href = '/index.html';

    // ═══════════════ DOM ═══════════════
    const toggle        = document.getElementById('showNekosToggle');
    const categorySel   = document.getElementById('nekoCategorySelect');
    const customInput   = document.getElementById('nekoCustomInput');

    // ═══════════════ 读取已保存的设置 ═══════════════
    const showNekos = localStorage.getItem('showNekos') === 'true';
    const unlocked  = localStorage.getItem('nekoModeUnlocked') === 'true';
    const savedCategory = localStorage.getItem('nekoCategory') || 'neko';

    if (toggle) toggle.checked = showNekos && unlocked;

    // 判断是否为自定义类别（不在预设选项中）
    const PRESET_CATEGORIES = [
      'neko','hug','pat','kiss','wink','wave','highfive','poke','dance',
      'smile','happy','cuddle','baka','blush','cry','laugh','sleep','smug',
      'think','thumbsup','tickle','yawn'
    ];
    const isCustom = !PRESET_CATEGORIES.includes(savedCategory);

    if (isCustom) {
      categorySel.value = '__custom__';
      customInput.value = savedCategory;
      customInput.classList.add('visible');
    } else {
      categorySel.value = savedCategory;
      customInput.classList.remove('visible');
    }

    // ═══════════════ 下拉框切换逻辑 ═══════════════
    categorySel.addEventListener('change', () => {
      if (categorySel.value === '__custom__') {
        customInput.classList.add('visible');
        customInput.focus();
      } else {
        customInput.classList.remove('visible');
        customInput.value = '';
      }
    });

    // ═══════════════ 保存 ═══════════════
    document.getElementById('saveBtn').addEventListener('click', function() {
      const checked = toggle.checked;
      localStorage.setItem('showNekos', checked);
      if (checked) localStorage.setItem('nekoModeUnlocked', 'true');

      // 保存类别
      let category = categorySel.value;
      if (category === '__custom__') {
        category = customInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!category) category = 'neko';   // fallback
      }
      localStorage.setItem('nekoCategory', category);

      const msg = document.getElementById('saveMessage');
      msg.textContent = '✅ Saved!';
      msg.style.color = '#2e7d32';
      setTimeout(() => { msg.textContent = ''; }, 2000);
    });
  