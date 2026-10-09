// deepseek.js
// Playwright 透過 CDP 附著到使用者手動啟動的 Chrome
const { chromium } = require('playwright');
const config = require('./config');

const ASSISTANT_SELECTOR = '.ds-assistant-message-main-content';

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

  const contexts = _browser.contexts();
  if (contexts.length === 0) {
    throw new Error('找不到任何 browser context');
  }
  _context = contexts[0];

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
 * 計算目前畫面上 assistant 訊息的節點數量
 */
async function countAssistantMessages() {
  try {
    return await _page.locator(ASSISTANT_SELECTOR).count();
  } catch {
    return 0;
  }
}

/**
 * 取最後一條 assistant 訊息純文字
 * 先用 innerText（可見文字），失敗則 fallback 到 textContent
 */
async function getLastAssistantText() {
  try {
    const loc = _page.locator(ASSISTANT_SELECTOR).last();
    if ((await loc.count()) === 0) return '';
    return await loc.innerText({ timeout: 1500 });
  } catch {
    try {
      return await _page
        .locator(ASSISTANT_SELECTOR)
        .last()
        .evaluate(el => el.textContent || '');
    } catch {
      return '';
    }
  }
}

/**
 * 診斷用：印出目前 DOM 中和 assistant 相關的節點
 * 當 selector 失效時,呼叫這個看一下實際 class 是什麼
 */
async function debugDump() {
  const info = await _page.evaluate(() => {
    const sel = '.ds-assistant-message-main-content';
    const nodes = Array.from(document.querySelectorAll(sel));

    // 找所有 class 含有 assistant / markdown 的節點
    const related = Array.from(
      document.querySelectorAll('[class*="assistant"], [class*="markdown"]')
    ).slice(-20).map(n => ({
      tag: n.tagName,
      cls: n.className,
      textLen: (n.textContent || '').length,
      preview: (n.textContent || '').slice(0, 80),
    }));

    return {
      selectorCount: nodes.length,
      lastThreeBySelector: nodes.slice(-3).map(n => ({
        cls: n.className,
        textLen: (n.textContent || '').length,
        preview: (n.textContent || '').slice(0, 80),
      })),
      relatedNodes: related,
    };
  });

  console.log('[deepseek] === DOM DUMP ===');
  console.log(JSON.stringify(info, null, 2));
  return info;
}

/**
 * 等 AI 回覆穩定
 *
 * 判斷新回覆的條件（任一成立即算）：
 *   1) assistant 訊息節點數量增加
 *   2) 最後一條的文字與 baseline 不同
 *
 * 穩定判斷：最後一條文字 1.5 秒內不再變化
 *
 * @param {object} opts
 * @param {number} opts.timeoutMs
 * @param {number} opts.baselineCount 送出前的 assistant 訊息數量
 * @param {string} opts.baselineText  送出前最後一條的文字
 */
async function waitForReply({
  timeoutMs = 60_000,
  baselineCount = 0,
  baselineText = '',
} = {}) {
  const startTime = Date.now();
  let lastText = '';
  let lastChangeAt = Date.now();
  let sawNewContent = false;
  let everSawText = false;

  while (Date.now() - startTime < timeoutMs) {
    const count = await countAssistantMessages();
    const currentText = await getLastAssistantText();

    // --- 判斷是否已出現新回覆 ---
    const countIncreased = count > baselineCount;
    const textChanged =
      currentText && baselineText !== undefined && currentText !== baselineText;

    if (countIncreased || textChanged) {
      if (!sawNewContent) {
        console.log(
          `[deepseek] 偵測到新回覆 (count: ${baselineCount}→${count}, ` +
          `textChanged: ${textChanged})`
        );
      }
      sawNewContent = true;
    }

    // --- 追蹤最後一條文字是否還在變 ---
    if (currentText && currentText !== lastText) {
      lastText = currentText;
      lastChangeAt = Date.now();
      everSawText = true;
    }

    // --- 穩定判斷 ---
    if (sawNewContent && everSawText && Date.now() - lastChangeAt >= 1500) {
      return lastText;
    }

    await sleep(400);
  }

  // 超時
  const elapsed = Date.now() - startTime;
  console.error(
    `[deepseek] ⚠️ waitForReply 超時 (${elapsed}ms)。` +
    `sawNewContent=${sawNewContent}, everSawText=${everSawText}, ` +
    `lastTextLen=${lastText.length}, baselineCount=${baselineCount}`
  );

  // 若已有部分內容,寧可回傳也不要整輪丟掉
  if (lastText) return lastText;

  // 完全沒東西 → 建議使用者跑 debugDump
  throw new Error(
    `等待 AI 回覆超時 (${timeoutMs}ms)。` +
    `可能是 selector 失效,請呼叫 deepseek.debugDump() 檢查 DOM。`
  );
}

/**
 * 完整流程：切模式 → 發送 → 等回覆
 */
async function ask(text, { model = 'r1', timeoutMs = 60_000 } = {}) {
  // baseline 同時記「數量」與「文字」
  const baselineCount = await countAssistantMessages();
  const baselineText = await getLastAssistantText();

  console.log(
    `[deepseek] baseline: count=${baselineCount}, textLen=${baselineText.length}`
  );

  if (baselineCount === 0 && baselineText === '') {
    console.warn(
      '[deepseek] ⚠️ baseline 完全為空。若這是第一個問題屬正常;' +
      '若不是,可能 selector 已失效,請呼叫 debugDump() 檢查。'
    );
  }

  await setDeepThink(model === 'r1');
  await sendMessage(text);

  return waitForReply({ timeoutMs, baselineCount, baselineText });
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
  countAssistantMessages,
  getLastAssistantText,
  debugDump,
  waitForReply,
  ask,
  screenshot,
  close,
};