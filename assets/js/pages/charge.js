// charge.js —— 用 token 換時間
//
// 左邊：滑條選要花多少 token（每 10,000 = 1 分鐘，第 N 次乘 0.9^N），綠色 Confirm 兌換。
// 右邊：時間顯示 + 滑條（1 分鐘一檔）+ 紅色 Confirm 減少時間（樂觀更新，先動 UI）。
(function () {
  'use strict';

  Page.boot({ title: 'Charge', requireAuth: true, skeleton: true });

  const COST_PER_MINUTE = 10000;

  const $ = (id) => document.getElementById(id);

  const buySlider = $('buySlider');
  const buyTokens = $('buyTokens');
  const buyPreview = $('buyPreview');
  const buyNote = $('buyNote');
  const buyBtn = $('buyBtn');

  const timeDisplay = $('timeDisplay');
  const timeSub = $('timeSub');
  const reduceSlider = $('reduceSlider');
  const reduceLabel = $('reduceLabel');
  const reduceBtn = $('reduceBtn');

  let state = null;
  let busy = false;

  // 「？小時 ？分鐘 ？秒」：值為 0 的部分不顯示
  function fmtDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (h) parts.push(h + 'h');
    if (m) parts.push(m + 'm');
    if (sec || !parts.length) parts.push(sec + 's');
    return parts.join(' ');
  }

  function fmtTokens(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  // ── 渲染 ──

  function renderTime() {
    timeDisplay.textContent = fmtDuration(state.seconds);
    timeSub.textContent = state.seconds > 0
      ? 'Your banked time · ' + Math.floor(state.seconds / 60) + ' min available to remove'
      : 'Your banked time';

    const maxMin = Math.floor(state.seconds / 60);
    reduceSlider.max = String(maxMin);
    reduceSlider.disabled = maxMin < 1;
    if (Number(reduceSlider.value) > maxMin) reduceSlider.value = maxMin;
    updateReducePreview();
  }

  function renderBuy() {
    const maxTokens = Math.floor((Number(state.global) || 0) / COST_PER_MINUTE) * COST_PER_MINUTE;
    buySlider.max = String(maxTokens);
    buySlider.step = String(COST_PER_MINUTE);
    buySlider.disabled = maxTokens < COST_PER_MINUTE;
    if (Number(buySlider.value) > maxTokens) buySlider.value = maxTokens;

    buyNote.textContent = state.global < COST_PER_MINUTE
      ? 'Not enough global tokens yet (need ' + fmtTokens(COST_PER_MINUTE) + ').'
      : 'Next purchase ×' + state.nextMultiplier.toFixed(2) +
        ' · ' + fmtTokens(COST_PER_MINUTE) + ' tokens = ' +
        fmtDuration(COST_PER_MINUTE / COST_PER_MINUTE * state.nextMultiplier * 60);

    updateBuyPreview();
  }

  function render() {
    renderTime();
    renderBuy();
  }

  function updateBuyPreview() {
    const tokens = Number(buySlider.value) || 0;
    const seconds = (tokens / COST_PER_MINUTE) * (state.nextMultiplier || 1) * 60;

    buyTokens.textContent = fmtTokens(tokens) + ' / ' + fmtTokens(state.global) + ' tokens';
    buyPreview.textContent = '+' + fmtDuration(seconds);
    buyBtn.disabled = busy || tokens < COST_PER_MINUTE;
  }

  function updateReducePreview() {
    const mins = Math.ceil(Number(reduceSlider.value) || 0);
    reduceLabel.textContent = '-' + mins + ' min';
    reduceBtn.disabled = busy || mins < 1;
  }

  // ── 動作 ──

  async function load() {
    try {
      const data = await API.get('/api/charge');
      if (!data.success) throw new Error(data.message || 'Failed to load');
      state = data;
      render();
    } catch (e) {
      if (window.DSHUI) DSHUI.toast(e.message || 'Failed to load', 'err');
      buyNote.textContent = 'Failed to load. Try refreshing.';
    } finally {
      Page.hideSkeleton();
    }
  }

  async function buy() {
    if (busy) return;
    const tokens = Number(buySlider.value) || 0;
    if (tokens < COST_PER_MINUTE) return;

    busy = true;
    buyBtn.disabled = true;
    buyBtn.textContent = 'Confirming…';

    try {
      const res = await API.post('/api/charge', { action: 'buy', tokens });
      if (!res.success) throw new Error(res.message || 'Failed');

      state = Object.assign({}, state, res);
      buySlider.value = '0';
      render();

      // 頂欄餘額同步
      try {
        const t = await API.get('/api/token');
        if (window.updateTopbarTokens) window.updateTopbarTokens(t.daily, t.global);
      } catch (e) { /* 不影響 */ }

      if (window.DSHUI) DSHUI.toast(res.message || 'Time added', 'ok');
    } catch (e) {
      if (window.DSHUI) DSHUI.toast(e.message || 'Failed to buy', 'err');
    } finally {
      busy = false;
      buyBtn.textContent = 'Confirm';
      updateBuyPreview();
      updateReducePreview();
    }
  }

  async function reduce() {
    if (busy) return;
    const mins = Math.ceil(Number(reduceSlider.value) || 0);
    if (mins < 1) return;

    // 樂觀更新：先減 UI
    const before = state.seconds;
    state.seconds = Math.max(0, before - mins * 60);
    reduceSlider.value = '0';
    renderTime();

    busy = true;
    updateReducePreview();

    try {
      const res = await API.post('/api/charge', { action: 'reduce', minutes: mins });
      if (!res.success) throw new Error(res.message || 'Failed');
      state = Object.assign({}, state, res);
      render();
      if (window.DSHUI) DSHUI.toast(res.message || 'Time removed', 'ok');
    } catch (e) {
      // 失敗回滾
      state.seconds = before;
      renderTime();
      if (window.DSHUI) DSHUI.toast(e.message || 'Failed to remove time', 'err');
    } finally {
      busy = false;
      updateReducePreview();
      updateBuyPreview();
    }
  }

  // ── 綁定 ──

  buySlider.addEventListener('input', updateBuyPreview);
  reduceSlider.addEventListener('input', updateReducePreview);
  buyBtn.addEventListener('click', buy);
  reduceBtn.addEventListener('click', reduce);

  Page.ready(async () => {
    await load();
  });
})();
