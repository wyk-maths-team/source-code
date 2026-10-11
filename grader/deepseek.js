// deepseek.js
// Playwright 透過 CDP 附著到使用者手動啟動的 Chrome
const { chromium } = require('playwright');
const config = require('./config');

const ASSISTANT_SELECTOR = '.ds-assistant-message-main-content';

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
    await _page.waitForSelector(
      'textarea[name="search"], textarea[placeholder*="DeepSeek"]',
      { timeout: 5000, state: 'visible' }
    );
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

  await _page.waitForSelector(
    'textarea[name="search"], textarea[placeholder*="DeepSeek"]',
    { timeout: 600_000, state: 'visible' }
  );

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

  // 等 UI 反應（400ms 太保守，200ms 夠）
  await sleep(200);
  log.info(`切換模式 → ${enabled ? 'R1（深度思考）' : 'V3（快速）'}`);
  return true;
}
// ═══════════════ 發送訊息 ═══════════════
async function sendMessage(text) {
  // 用 evaluate 找元素 + 直接设值（绕过 Playwright 的 fill）
  const ok = await _page.evaluate((t) => {
    const input = document.querySelector('textarea[name="search"], textarea[placeholder*="DeepSeek"]');
    if (!input) return false;

    // React 受控组件需要 dispatch input 事件
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeSetter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    nativeSetter.call(input, t);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, text);

  if (!ok) throw new Error('找不到輸入框');

  await sleep(150);  // 让 React 完成状态更新（300 → 150）

  // 找發送按鈕 + 點擊
  const clicked = await _page.evaluate(() => {
    const btns = document.querySelectorAll(
      'div[role="button"].ds-button--primary.ds-button--circle'
    );
    const btn = btns[btns.length - 1];
    if (!btn) return false;
    if (btn.classList.contains('ds-button--disabled')) return false;
    btn.click();
    return true;
  });

  if (!clicked) throw new Error('發送按鈕不可用');

  log.send(`訊息已送出 (${text.length} chars)`);
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
 * 精确定位「最后一条 assistant 消息」的复制按钮，并在必要时重试
 * 关键：从最后一条消息往上找容器，只在该容器里找复制按钮
 *       这样若最新消息的工具栏还没渲染，不会误点上一条的
 *
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} 是否成功点到了按钮
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

      // 從最後一條消息往上找容器，逐層檢查是否含複製按鈕
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
 * @returns {Promise<string|null>}
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

    // ⭐ 2. 記錄訊息數（防誤觸重新生成）
    const beforeCount = await countAssistantMessages();

    // ⭐ 3. 精確點擊（含輪詢等待）
    const clicked = await clickLastMessageCopyButton({ timeoutMs: 10_000 });
    if (!clicked) return null;

    await sleep(300);

    // ⭐ 4. 檢查是否觸發新回覆（防誤觸重新生成）
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

// 紅色進度條 + 秒數（1 位小數）+ 百分比
function _formatProgress(elapsedMs, timeoutMs) {
  const elapsedSec = elapsedMs / 1000;
  const timeoutSec = timeoutMs / 1000;
  const pct = Math.min(100, elapsedMs / timeoutMs * 100);

  const filled = Math.round(pct * _PROGRESS_WIDTH / 100);
  const empty  = _PROGRESS_WIDTH - filled;

  // 紅色填充，灰色背景，充滿即 timeout
  const bar =
    '\x1b[31m' + '█'.repeat(filled) +
    '\x1b[90m' + '░'.repeat(empty) +
    '\x1b[0m';

  return `⌛ \x1b[36m${elapsedSec.toFixed(1)}s\x1b[0m / ${timeoutSec.toFixed(1)}s [${bar}] \x1b[33m${pct.toFixed(1)}%\x1b[0m`;
}

// 原地重寫一行（不換行，不進 log 檔）
function _drawProgress(text) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');

  const prefix = `\x1b[90m${hh}:${mm}:${ss}\x1b[0m \x1b[37m·\x1b[0m  \x1b[90m  │\x1b[0m `;
  const plain  = text.replace(/\x1b\[[0-9;]*m/g, '');
  const pad    = ' '.repeat(Math.max(0, 67 - plain.length));
  const suffix = `\x1b[90m│\x1b[0m`;

  // \r 回行首 + \x1b[K 清到行尾 + 寫新內容
  process.stdout.write('\r\x1b[K' + prefix + text + pad + suffix);
  _progressActive = true;
}

// 結束進度行（寫一個換行，讓下一個 log 從新行開始）
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
    // ⭐ 立即顯示初始進度（不等第一次輪詢）
    _drawProgress(_formatProgress(0, timeoutMs));

    while (Date.now() - startTime < timeoutMs) {
      const count = await countAssistantMessages();
      const currentText = await getLastAssistantText();

      const countIncreased = count > baselineCount;
      const textChanged =
        currentText && baselineText !== undefined && currentText !== baselineText;

      if (countIncreased || textChanged) {
        if (!sawNewContent) {
          // ⭐ 先清進度行，再印 log
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

      // 穩定判斷
      if (sawNewContent && everSawText && Date.now() - lastChangeAt >= 800) {
        return lastText;
      }

      // ⭐ 有新內容 → 停止畫進度條；否則持續更新
      if (!sawNewContent) {
        _drawProgress(_formatProgress(Date.now() - startTime, timeoutMs));
      }

      await sleep(200);
    }
  } finally {
    stopProgress();
  }

  // 超時
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

// ═══════════════ 完整流程 ═══════════════
async function ask(text, { model = 'r1', timeoutMs = 60_000 } = {}) {
  await setDeepThink(model === 'r1');
  // ⭐ 删掉 sleep(500)，setDeepThink 内部已等

  const baselineCount = await countAssistantMessages();
  const baselineText = await getLastAssistantText();
  log.info(`baseline: count=${baselineCount}, textLen=${baselineText.length}`);

  await sendMessage(text);

  const replyDom = await waitForReply({ timeoutMs, baselineCount, baselineText });
  log.recv(`DOM 回覆完成 (${replyDom.length} chars)`);

  // ⭐ sleep(500) → sleep(150)
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
  countAssistantMessages,
  getLastAssistantText,
  copyLastReply, 
  debugDump,
  waitForReply,
  ask,
  screenshot,
  close,
};