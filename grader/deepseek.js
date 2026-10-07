// deepseek.js
// Playwright 透過 CDP 附著到使用者手動啟動的 Chrome
const fs = require('fs');
const { chromium } = require('playwright');
const config = require('./config');

let _browser = null;
let _context = null;
let _page = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 連接到已經開好的 Chrome (port 9222)
 * 不會啟動新 Chrome,只是附著上去
 */
async function launch() {
  console.log('[deepseek] 嘗試連接 http://localhost:9222 ...');

  try {
    _browser = await chromium.connectOverCDP('http://localhost:9222', {
      timeout: 10_000,
    });
  } catch (e) {
    throw new Error(
      'connectOverCDP 失敗。請先執行 start-chrome.bat 並確認 Chrome 已開啟。\n' +
      `原始錯誤: ${e.message}`
    );
  }

  console.log('[deepseek] ✅ 已連接到 Chrome (CDP)');

  // persistent context 只會有一個
  const contexts = _browser.contexts();
  if (contexts.length === 0) {
    throw new Error('找不到任何 browser context');
  }
  _context = contexts[0];

  // 找 DeepSeek 頁籤
  const pages = _context.pages();
  _page = pages.find(p => p.url().includes('chat.deepseek.com'));

  if (!_page) {
    console.log('[deepseek] 找不到 DeepSeek 頁籤,開新的...');
    _page = await _context.newPage();
    await _page.goto(config.DEEPSEEK_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  await _page.bringToFront();

  console.log(`[deepseek] 當前頁面: ${_page.url()}`);
  return { browser: _browser, context: _context, page: _page };
}

/**
 * 檢查是否已登入
 */
async function isLoggedIn() {
  try {
    await _page.waitForSelector(
      'textarea[name="search"], textarea[placeholder*="DeepSeek"]',
      { timeout: 5000, state: 'visible' }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 阻塞等手動登入
 */
async function waitForManualLogin() {
  console.log('');
  console.log('════════════════════════════════════════════');
  console.log('  ⚠️  請在 Chrome 視窗中手動登入 DeepSeek');
  console.log('      (完成後程式會自動繼續,最多等 10 分鐘)');
  console.log('════════════════════════════════════════════');
  console.log('');

  await _page.waitForSelector(
    'textarea[name="search"], textarea[placeholder*="DeepSeek"]',
    { timeout: 600_000, state: 'visible' }
  );

  console.log('[deepseek] ✅ 已登入');
  await sleep(1500);
}

/**
 * 切換深度思考 (R1) / 一般模式 (V3)
 */
async function setDeepThink(enabled) {
  const btn = _page.locator('.ds-toggle-button', { hasText: '深度思考' }).first();

  const count = await btn.count();
  if (count === 0) {
    console.warn('[deepseek] 找不到「深度思考」按鈕,略過切換');
    return false;
  }

  const isSelected = await btn.evaluate(el =>
    el.classList.contains('ds-toggle-button--selected')
  );

  if (isSelected !== enabled) {
    await btn.click();
    await sleep(400);
    console.log(`[deepseek] 切換深度思考 → ${enabled ? 'R1' : 'V3'}`);
  }
  return true;
}

/**
 * 發送訊息
 */
async function sendMessage(text) {
  const input = _page.locator(
    'textarea[name="search"], textarea[placeholder*="DeepSeek"]'
  ).first();

  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.click();
  await input.fill('');
  await input.fill(text);
  await sleep(300);

  const sendBtn = _page.locator(
    'div[role="button"].ds-button--primary.ds-button--circle'
  ).last();

  await sendBtn.waitFor({ state: 'visible', timeout: 5000 });

  // 等它脫離 disabled
  const maxWait = 3000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const isDisabled = await sendBtn.evaluate(el =>
      el.classList.contains('ds-button--disabled') ||
      el.getAttribute('aria-disabled') === 'true'
    );
    if (!isDisabled) break;
    await sleep(100);
  }

  const stillDisabled = await sendBtn.evaluate(el =>
    el.classList.contains('ds-button--disabled')
  );
  if (stillDisabled) {
    throw new Error('發送按鈕仍為 disabled,無法送出');
  }

  await sendBtn.click();
  console.log('[deepseek] 訊息已送出');
}

/**
 * 等 AI 回覆穩定
 */
async function waitForReply({ timeoutMs = 60_000, baseline = '' } = {}) {
  const startTime = Date.now();
  let lastText = baseline;
  let lastChangeAt = Date.now();
  let hasNewReply = false;

  while (Date.now() - startTime < timeoutMs) {
    let currentText = '';
    try {
      currentText = await _page
        .locator('.ds-assistant-message-main-content')
        .last()
        .innerText({ timeout: 1500 });
    } catch {}

    if (currentText && currentText !== lastText) {
      lastText = currentText;
      lastChangeAt = Date.now();
      if (currentText !== baseline) hasNewReply = true;
    }

    if (hasNewReply && Date.now() - lastChangeAt >= 1500) {
      return currentText;
    }

    await sleep(500);
  }

  throw new Error(`等待 AI 回覆超時 (${timeoutMs}ms)`);
}

/**
 * 完整流程：切模式 → 發送 → 等回覆
 */
async function ask(text, { model = 'r1', timeoutMs = 60_000 } = {}) {
  let baseline = '';
  try {
    baseline = await _page
      .locator('.ds-assistant-message-main-content')
      .last()
      .innerText({ timeout: 1000 });
  } catch {}

  await setDeepThink(model === 'r1');
  await sendMessage(text);

  return waitForReply({ timeoutMs, baseline });
}

/**
 * 截圖
 */
async function screenshot(filename) {
  try {
    await _page.screenshot({ path: filename, fullPage: false });
    return filename;
  } catch (e) {
    console.error('[deepseek] 截圖失敗:', e.message);
    return null;
  }
}

/**
 * 斷開 CDP 連接（不關閉 Chrome）
 */
async function close() {
  if (_browser) {
    try {
      // CDP 模式下,close() 只斷開連接,不會關掉使用者的 Chrome
      await _browser.close();
    } catch {}
  }
  _browser = null;
  _context = null;
  _page = null;
}

module.exports = {
  launch,
  isLoggedIn,
  waitForManualLogin,
  setDeepThink,
  sendMessage,
  waitForReply,
  ask,
  screenshot,
  close,
};