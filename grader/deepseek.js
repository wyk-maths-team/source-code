// deepseek.js
// Playwright 透過 CDP 附著到使用者手動啟動的 Chrome
const { chromium } = require('playwright');
const config = require('./config');

const ASSISTANT_SELECTOR = '.ds-assistant-message-main-content';

// ⭐ 輸入框 / 按鈕選擇器（集中管理）
const INPUT_SELECTOR     = 'textarea[name="search"], textarea[placeholder*="DeepSeek"]';
const SEND_BTN_SELECTOR  = 'div[role="button"].ds-button--primary.ds-button--circle';
// 回形針上傳按鈕（用戶提供的 SVG 路徑前綴 M5.5498）
const UPLOAD_BTN_SELECTOR =
  'div[role="button"].ds-button--iconLabelPrimary:has(svg path[d^="M5.5498"])';

// ═══ 分級 logger ═══
// 符號約定（bridge.js 的 styleFor 會依此上色）：
//   ℹ  一般訊息
//   ✔  成功
//   ✖  錯誤
//   ⚠  警告
//   ▶  發送 / 開始
//   ◀  接收 / 結束
//   ⏳  等待
//   ⌛  輪詢進度
//   🔗  連線
const TAG = '[deepseek]';
const log = {
  info: (m) => console.log(`${TAG} ℹ ${m}`),
  ok:   (m) => console.log(`${TAG} ✔ ${m}`),
  warn: (m) => console.log(`${TAG} ⚠ ${m}`),
  err:  (m) => console.log(`${TAG} ✖ ${m}`),
  send: (m) => console.log(`${TAG} ▶ ${m}`),
  recv: (m) => console.log(`${TAG} ◀ ${m}`),
  wait: (m) => console.log(`${TAG} ⏳ ${m}`),
  poll: (m) => console.log(`${TAG} ⌛ ${m}`),
  link: (m) => console.log(`${TAG} 🔗 ${m}`),
  raw:  (m) => console.log(`${TAG}   ${m}`),
};

let _browser = null;
let _context = null;
let _page = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════ 連線 ═══════════════
async function launch() {
  console.log('');
  console.log(`${TAG} ╔══════════════════════════════════════════╗`);
  console.log(`${TAG} ║  連接 Chrome (CDP :9222)                 ║`);
  console.log(`${TAG} ╚══════════════════════════════════════════╝`);

  try {
    _browser = await chromium.connectOverCDP('http://localhost:9222', {
      timeout: 10_000,
    });
  } catch (e) {
    log.err(`connectOverCDP 失敗: ${e.message}`);
    log.raw('請先執行 start-chrome.bat 並確認 Chrome 已開啟');
    throw new Error(`connectOverCDP 失敗: ${e.message}`);
  }

  log.ok('已連接到 Chrome (CDP)');

  const contexts = _browser.contexts();
  if (contexts.length === 0) {
    throw new Error('找不到任何 browser context');
  }
  _context = contexts[0];

  const pages = _context.pages();
  _page = pages.find(p => p.url().includes('chat.deepseek.com'));

  if (!_page) {
    log.info('找不到 DeepSeek 頁籤，開新的...');
    _page = await _context.newPage();
    await _page.goto(config.DEEPSEEK_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  }

  await _page.bringToFront();
  log.info(`當前頁面: ${_page.url()}`);

  return { browser: _browser, context: _context, page: _page };
}

// ═══════════════ 登入檢查 ═══════════════
async function isLoggedIn() {
  try {
    await _page.waitForSelector(INPUT_SELECTOR, { timeout: 5000, state: 'visible' });
    return true;
  } catch {
    return false;
  }
}

async function waitForManualLogin() {
  console.log('');
  console.log(`${TAG} ╔═══════════════════════════════════════════════╗`);
  console.log(`${TAG} ║  ⚠  請在 Chrome 視窗中手動登入 DeepSeek      ║`);
  console.log(`${TAG} ║     完成後程式會自動繼續（最多等 10 分鐘）   ║`);
  console.log(`${TAG} ╚═══════════════════════════════════════════════╝`);
  console.log('');

  await _page.waitForSelector(INPUT_SELECTOR, { timeout: 600_000, state: 'visible' });

  log.ok('已登入');
  await sleep(1500);
}

// ═══════════════ 模式切換 ═══════════════
async function setDeepThink(enabled) {
  const result = await _page.evaluate((want) => {
    const btn = Array.from(document.querySelectorAll('.ds-toggle-button'))
      .find(b => (b.textContent || '').includes('深度思考'));
    if (!btn) return { found: false };

    const isSelected = btn.classList.contains('ds-toggle-button--selected');
    if (isSelected === want) return { found: true, already: true, isSelected };

    btn.click();
    return { found: true, already: false, before: isSelected };
  }, enabled);

  if (!result.found) {
    log.warn('找不到「深度思考」按鈕，略過切換');
    return false;
  }
  if (result.already) return true;

  await sleep(200);
  log.info(`切換模式 → ${enabled ? 'R1（深度思考）' : 'V3（快速）'}`);
  return true;
}

// ═══════════════ 輸入框：貼文字 ═══════════════
async function pasteText(text) {
  const ok = await _page.evaluate((args) => {
    const [t, sel] = args;
    const input = document.querySelector(sel);
    if (!input) return false;

    // React 受控組件需要 dispatch input 事件
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    nativeSetter.call(input, t);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, [text, INPUT_SELECTOR]);

  if (!ok) throw new Error('找不到輸入框');
  await sleep(150);
}

// ═══════════════ 點發送按鈕 ═══════════════
async function clickSend({ maxWaitMs = 15_000 } = {}) {
  const start = Date.now();
  let attempt = 0;
  let lastReason = '';

  while (Date.now() - start < maxWaitMs) {
    attempt++;

    const r = await _page.evaluate((sel) => {
      const btns = document.querySelectorAll(sel);
      if (btns.length === 0) return { ok: false, reason: 'no-buttons' };

      const btn = btns[btns.length - 1];

      // 檢查 disabled 狀態（class 或 attr）
      if (btn.classList.contains('ds-button--disabled')) {
        return { ok: false, reason: 'disabled-class' };
      }
      if (btn.disabled === true) {
        return { ok: false, reason: 'disabled-attr' };
      }

      // 點擊
      btn.click();
      return { ok: true };
    }, SEND_BTN_SELECTOR);

    if (r.ok) {
      if (attempt > 1) log.info(`發送按鈕第 ${attempt} 次嘗試成功`);
      return true;
    }

    lastReason = r.reason;

    // 每 200ms 一次
    await sleep(200);
  }

  throw new Error(
    `發送按鈕持續不可用（${maxWaitMs}ms / ${attempt} 次嘗試，last: ${lastReason}）`
  );
}

// ═══════════════ 發送訊息（純文字，向後兼容） ═══════════════
async function sendMessage(text) {
  await pasteText(text);
  await clickSend();
  log.send(`訊息已送出 (${text.length} chars)`);
}

// ═══════════════ 圖片上傳 ═══════════════
async function uploadImage(buffer, mimeType) {
  // 1. 統計上傳前的圖片數（用於等待新縮圖出現）
  const beforeCount = await _page.evaluate(() => {
    return document.querySelectorAll(
      'img[src^="blob:"], img[src^="data:image"]'
    ).length;
  });

  // 2. 找 file input
  let fileInput = await _page.$('input[type="file"]');

  // 若沒找到，點回形針按鈕觸發
  if (!fileInput) {
    log.info('未找到 file input，嘗試點擊上傳按鈕…');
    try {
      await _page.click(UPLOAD_BTN_SELECTOR, { timeout: 3000 });
    } catch (e) {
      log.warn(`點擊上傳按鈕失敗: ${e.message}`);
    }
    try {
      await _page.waitForSelector('input[type="file"]', {
        state: 'attached',
        timeout: 5000,
      });
      fileInput = await _page.$('input[type="file"]');
    } catch {}
  }

  if (!fileInput) throw new Error('找不到圖片上傳 input');

  // 3. 用 Playwright 塞檔案
  const ext = mimeType.includes('png')  ? 'png'
            : mimeType.includes('webp') ? 'webp'
            : mimeType.includes('gif')  ? 'gif'
            : 'jpg';

  await fileInput.setInputFiles({
    name: `solution.${ext}`,
    mimeType,
    buffer,
  });

  // 4. 等縮圖出現
  try {
    await _page.waitForFunction(
      (before) => {
        const now = document.querySelectorAll(
          'img[src^="blob:"], img[src^="data:image"]'
        ).length;
        return now > before;
      },
      beforeCount,
      { timeout: 20_000, polling: 200 }
    );
    log.ok(`圖片已上傳 (${Math.round(buffer.length / 1024)} KB)`);
  } catch {
    log.warn(`等待縮圖超時，可能已上傳但 DOM 未更新`);
  }

  // 5. UI 穩定
  await sleep(400);
}

// ═══════════════ DOM 查詢工具 ═══════════════
async function countAssistantMessages() {
  try {
    return await _page.evaluate((sel) =>
      document.querySelectorAll(sel).length,
      ASSISTANT_SELECTOR
    );
  } catch {
    return 0;
  }
}

async function getLastAssistantText() {
  try {
    return await _page.evaluate((sel) => {
      const nodes = document.querySelectorAll(sel);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const t = (nodes[i].innerText || nodes[i].textContent || '').trim();
        if (t) return t;
      }
      return '';
    }, ASSISTANT_SELECTOR);
  } catch {
    return '';
  }
}

/**
 * 精確定位「最後一條 assistant 消息」的複製按鈕
 */
async function clickLastMessageCopyButton({ timeoutMs = 10_000 } = {}) {
  const COPY_SVG_PREFIX = 'M6.14929';
  const start = Date.now();
  let lastReason = '';

  while (Date.now() - start < timeoutMs) {
    const r = await _page.evaluate((prefix) => {
      const msgs = document.querySelectorAll('.ds-assistant-message-main-content');
      if (msgs.length === 0) return { ok: false, reason: 'no-messages' };

      const lastMsg = msgs[msgs.length - 1];

      let node = lastMsg;
      for (let depth = 0; depth < 10; depth++) {
        if (!node) break;

        const btns = node.querySelectorAll(
          'div[role="button"].ds-button--iconLabelTertiary'
        );
        for (const b of btns) {
          const path = b.querySelector('svg path');
          if (path && (path.getAttribute('d') || '').startsWith(prefix)) {
            b.click();
            return { ok: true, depth };
          }
        }
        node = node.parentElement;
      }
      return { ok: false, reason: 'btn-not-found-near-last' };
    }, COPY_SVG_PREFIX);

    if (r.ok) {
      log.info(`點到複製按鈕（容器深度 ${r.depth}）`);
      return true;
    }

    lastReason = r.reason || '';
    await sleep(300);
  }

  log.warn(`等待複製按鈕超時（${timeoutMs}ms）— 最後狀態: ${lastReason}`);
  return false;
}

/**
 * 透過「複製」按鈕拿最後一條回覆的原始 Markdown
 */
async function copyLastReply() {
  try {
    // ⭐ 1. 注入剪貼板攔截（冪等）
    await _page.evaluate(() => {
      if (!window.__dsClipboardHook) {
        window.__dsClipboardHook = { text: null };

        document.addEventListener('copy', (e) => {
          try {
            const t = e.clipboardData?.getData('text/plain') || '';
            if (t) window.__dsClipboardHook.text = t;
          } catch {}
        }, true);

        if (navigator.clipboard && navigator.clipboard.writeText) {
          const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
          navigator.clipboard.writeText = (text) => {
            window.__dsClipboardHook.text = text;
            return orig(text).catch(() => {});
          };
        }
      }
      window.__dsClipboardHook.text = null;
    });

    // ⭐ 2. 記錄訊息數
    const beforeCount = await countAssistantMessages();

    // ⭐ 3. 精確點擊
    const clicked = await clickLastMessageCopyButton({ timeoutMs: 10_000 });
    if (!clicked) return null;

    await sleep(300);

    // ⭐ 4. 檢查是否觸發新回覆
    const afterCount = await countAssistantMessages();
    if (afterCount > beforeCount) {
      log.warn(`⚠️ 點擊後訊息數 ${beforeCount} → ${afterCount}，可能誤觸了重新生成`);
      return null;
    }

    // ⭐ 5. 讀剪貼板
    const text = await _page.evaluate(() => window.__dsClipboardHook?.text || '');

    if (!text) {
      log.warn('點擊後剪貼板仍為空');
      return null;
    }

    log.ok(`成功從複製按鈕取得 ${text.length} chars`);
    return text;

  } catch (e) {
    log.warn(`copyLastReply 異常: ${e.message}`);
    return null;
  }
}

// ═══════════════ 診斷 ═══════════════
async function debugDump() {
  const info = await _page.evaluate(() => {
    const sel = '.ds-assistant-message-main-content';
    const nodes = Array.from(document.querySelectorAll(sel));

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

  log.info('=== DOM DUMP ===');
  console.log(JSON.stringify(info, null, 2));
  return info;
}

// ═══════════════ 即時進度條 ═══════════════
const _PROGRESS_WIDTH = 20;
let _progressActive = false;

function _formatProgress(elapsedMs, timeoutMs) {
  const elapsedSec = elapsedMs / 1000;
  const timeoutSec = timeoutMs / 1000;
  const pct = Math.min(100, elapsedMs / timeoutMs * 100);

  const filled = Math.round(pct * _PROGRESS_WIDTH / 100);
  const empty  = _PROGRESS_WIDTH - filled;

  const bar =
    '\x1b[31m' + '█'.repeat(filled) +
    '\x1b[90m' + '░'.repeat(empty) +
    '\x1b[0m';

  return `⌛ \x1b[36m${elapsedSec.toFixed(1)}s\x1b[0m / ${timeoutSec.toFixed(1)}s [${bar}] \x1b[33m${pct.toFixed(1)}%\x1b[0m`;
}

function _drawProgress(text) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  const prefix = `\x1b[90m${hh}:${mm}:${ss}\x1b[0m \x1b[37m·\x1b[0m  \x1b[90m  │\x1b[0m `;
  const plain  = text.replace(/\x1b\[[0-9;]*m/g, '');
  const pad    = ' '.repeat(Math.max(0, 67 - plain.length));
  const suffix = `\x1b[90m│\x1b[0m`;

  process.stdout.write('\r\x1b[K' + prefix + text + pad + suffix);
  _progressActive = true;
}

function _endProgress() {
  if (_progressActive) {
    process.stdout.write('\n');
    _progressActive = false;
  }
}

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

  const stopProgress = () => {
    if (_progressActive) _endProgress();
  };

  try {
    _drawProgress(_formatProgress(0, timeoutMs));

    while (Date.now() - startTime < timeoutMs) {
      const count = await countAssistantMessages();
      const currentText = await getLastAssistantText();

      const countIncreased = count > baselineCount;
      const textChanged =
        currentText && baselineText !== undefined && currentText !== baselineText;

      if (countIncreased || textChanged) {
        if (!sawNewContent) {
          stopProgress();
          log.recv(
            `偵測到新回覆 (count: ${baselineCount}→${count}, ` +
            `textChanged: ${textChanged})`
          );
        }
        sawNewContent = true;
      }

      if (currentText && currentText !== lastText) {
        lastText = currentText;
        lastChangeAt = Date.now();
        everSawText = true;
      }

      if (sawNewContent && everSawText && Date.now() - lastChangeAt >= 800) {
        return lastText;
      }

      if (!sawNewContent) {
        _drawProgress(_formatProgress(Date.now() - startTime, timeoutMs));
      }

      await sleep(200);
    }
  } finally {
    stopProgress();
  }

  log.warn(
    `waitForReply 超時 (${timeoutMs}ms) — ` +
    `sawNewContent=${sawNewContent}, everSawText=${everSawText}, ` +
    `lastTextLen=${lastText.length}, baselineCount=${baselineCount}`
  );

  if (lastText) return lastText;

  throw new Error(
    `等待 AI 回覆超時 (${timeoutMs}ms)。` +
    `可能是 selector 失效，請呼叫 deepseek.debugDump() 檢查 DOM。`
  );
}

// ═══════════════ 完整流程（純文字） ═══════════════
async function ask(text, { model = 'r1', timeoutMs = 60_000 } = {}) {
  await setDeepThink(model === 'r1');

  const baselineCount = await countAssistantMessages();
  const baselineText = await getLastAssistantText();
  log.info(`baseline: count=${baselineCount}, textLen=${baselineText.length}`);

  await sendMessage(text);

  const replyDom = await waitForReply({ timeoutMs, baselineCount, baselineText });
  log.recv(`DOM 回覆完成 (${replyDom.length} chars)`);

  await sleep(150);
  const replyClean = await copyLastReply();

  return (replyClean && replyClean.length > 0) ? replyClean : replyDom;
}

// ═══════════════ 完整流程（文字 + 圖片） ═══════════════
async function askWithImage(text, buffer, mimeType, {
  model = 'r1',
  timeoutMs = 180_000,
} = {}) {
  await setDeepThink(model === 'r1');

  const baselineCount = await countAssistantMessages();
  const baselineText  = await getLastAssistantText();
  log.info(`baseline: count=${baselineCount}, textLen=${baselineText.length}`);

  // ⭐ 順序：先圖後文
  await uploadImage(buffer, mimeType);
  await pasteText(text);
  await clickSend();
  log.send(
    `訊息 + 圖片已送出 (${text.length} chars, ` +
    `${Math.round(buffer.length / 1024)} KB)`
  );

  const replyDom = await waitForReply({ timeoutMs, baselineCount, baselineText });
  log.recv(`DOM 回覆完成 (${replyDom.length} chars)`);

  await sleep(150);
  const replyClean = await copyLastReply();

  return (replyClean && replyClean.length > 0) ? replyClean : replyDom;
}

// ═══════════════ 截圖 ═══════════════
async function screenshot(filename) {
  try {
    await _page.screenshot({ path: filename, fullPage: false });
    log.ok(`已截圖: ${filename}`);
    return filename;
  } catch (e) {
    log.err(`截圖失敗: ${e.message}`);
    return null;
  }
}

// ═══════════════ 關閉 ═══════════════
async function close() {
  if (_browser) {
    try {
      await _browser.close();
      log.info('已斷開 CDP 連接');
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
  pasteText,
  clickSend,
  uploadImage,
  askWithImage,
  countAssistantMessages,
  getLastAssistantText,
  copyLastReply,
  debugDump,
  waitForReply,
  ask,
  screenshot,
  close,
};