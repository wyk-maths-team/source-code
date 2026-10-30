// dev/test-token-hub-e2e.mjs —— Token Hub 的浏览器端到端回归
//
// 起一个本地 express（把 api/*.js 按 Vercel serverless 签名挂上）+ 真开 Chromium，
// 用临时用户把「进入页面 → 看任务 → 领每日登入 → 点去做题跳转」走一遍。
//
//   npm run test:e2e:hub
//
// 需要：.env / .env.local 里有 MONGODB_URI、JWT_SECRET；
//       playwright 的 chromium 已安装（npx playwright install chromium）。
// 注意：会在数据库里创建并删除 __dsh_e2e_user__，不碰真实用户。

import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'], override: false });

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.E2E_PORT || 4174);
const BASE = 'http://127.0.0.1:' + PORT;
const USER = '__dsh_e2e_user__';

// ───────── 本地服务器（对齐 Vercel）─────────
function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api', async (req, res) => {
    const seg = (req.path || '').replace(/^\/+/, '').split('/')[0].replace(/\.js$/, '');
    if (!seg || seg.includes('..')) return res.status(400).json({ error: 'bad api name' });
    const file = path.join(ROOT, 'api', seg + '.js');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'api not found: ' + seg });
    try {
      const mod = await import(pathToFileURL(file).href);
      if (typeof mod.default !== 'function') return res.status(500).json({ error: 'no default export' });
      await mod.default(req, res);
    } catch (e) {
      console.error('[api ' + seg + ']', e);
      if (!res.headersSent) res.status(500).json({ success: false, error: String((e && e.message) || e) });
    }
  });

  app.get('/problems/:id', (req, res) => {
    res.sendFile(path.join(ROOT, 'problems', '[id].html'));
  });

  app.use(express.static(ROOT, { extensions: ['html'] }));

  return new Promise((resolve) => {
    const server = app.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

// ───────── 准备/清理临时用户 ─────────
async function prepUser(db) {
  await cleanup(db);
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  await db.collection('users').insertOne({
    username: USER, displayName: 'E2E User', role: 'student', banned: false, password: 'x',
    // 故意做成「昨天领过、今天还没结算」的状态，正是原来那个 bug 的现场
    token: { daily: 0, global: 0, lastReset: '2000-01-01', dailyLoginClaimed: true, dailyQuestClaimed: true },
    dailyQuests: { date: '2000-01-01', claimed: [] },
  });
  await db.collection('userstats').updateOne(
    { username: USER }, { $setOnInsert: { username: USER, states: {} } }, { upsert: true }
  );
  return today;
}

async function cleanup(db) {
  await db.collection('users').deleteMany({ username: USER });
  await db.collection('userstats').deleteMany({ username: USER });
  await db.collection('submissions').deleteMany({ username: USER });
}

// ───────── 主流程 ─────────
const { connectToDatabase } = await import('../api/_db.js');
const { chromium } = await import('playwright');

const db = await connectToDatabase();
const today = await prepUser(db);
const server = await startServer();

let browser;
let exitCode = 0;
try {
  const token = jwt.sign({ username: USER }, process.env.JWT_SECRET, { expiresIn: '1h' });
  let browserError = null;
  try {
    browser = await chromium.launch();
  } catch (e) {
    browserError = e;
  }
  if (!browser) {
    throw new Error('无法启动 Chromium，请先运行 npx playwright install chromium\n' + (browserError && browserError.message));
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });

  await page.addInitScript((t) => {
    localStorage.setItem('auth_token', t);
  }, token);

  await page.goto(BASE + '/token-hub.html', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('#quest-list .quest-item', { timeout: 15000 });

  // 1. 任务卡
  assert.equal(await page.locator('#quest-list .quest-item').count(), 6, '应渲染 6 个任务卡');
  console.log('✓ 渲染 6 个任务卡');

  // 2. 跨天重置：昨天领过，今天必须能领
  const hint = await page.locator('#quest-reset-hint').textContent();
  assert.ok(hint.includes(today), '提示里应显示今天');
  const loginBtn = page.locator('[data-claim="login"]');
  assert.ok(await loginBtn.count(), '昨天领过，今天仍应有「领取」按钮（这就是原 bug）');
  console.log('✓ 跨天重置：每日登入重新可领');

  // 3. 每日挑战有具体题目 + 去做题
  const dailyCard = page.locator('.quest-item[data-qid="daily"]');
  const dailyText = (await dailyCard.textContent()).replace(/\s+/g, ' ');
  assert.ok(/难度/.test(dailyText), '每日挑战应显示题目难度');
  const goBtn = dailyCard.locator('[data-go="daily"]');
  assert.equal(await goBtn.count(), 1, '未完成时应是「去做题」');
  console.log('✓ 每日挑战：' + dailyText.trim().slice(0, 80));

  // 4. 领取每日登入
  const before = await db.collection('users').findOne({ username: USER }, { projection: { token: 1 } });
  await loginBtn.click();
  await page.waitForTimeout(1200);
  const after = await db.collection('users').findOne(
    { username: USER }, { projection: { token: 1, dailyQuests: 1 } }
  );
  assert.equal(after.token.global, (before.token.global || 0) + 10000, '登入应 +10000');
  assert.ok(after.dailyQuests.claimed.includes('login'), '领取记录应落库');
  assert.equal(await page.locator('[data-claim="login"]').count(), 0, '领取后按钮应消失');
  assert.equal(await page.locator('.quest-item[data-qid="login"] .btn-complete').count(), 1);
  console.log('✓ 领取每日登入：+10,000 落库，按钮变「已领取」');

  // 5. 未完成的任务不能领
  assert.equal(await page.locator('[data-claim="practice"]').count(), 0, '未完成任务不应有领取按钮');
  console.log('✓ 未完成任务没有领取按钮');

  // 6. 去做题 → 跳题目页
  await Promise.all([page.waitForURL(/\/problems\/[^/]+$/, { timeout: 15000 }), goBtn.click()]);
  console.log('✓ 「去做题」跳转：' + new URL(page.url()).pathname);

  // 7. 控制台干净
  const fatal = problems.filter((p) => !/favicon|Failed to load resource|404/i.test(p));
  assert.equal(fatal.length, 0, '不应有页面错误：\n' + fatal.join('\n'));
  console.log('✓ 控制台无报错');

  console.log('\nALL E2E PASS');
} catch (e) {
  console.error('\nE2E FAILED:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack);
  exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
  await cleanup(db);
}
process.exit(exitCode);
