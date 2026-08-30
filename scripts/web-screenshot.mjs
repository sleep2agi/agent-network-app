#!/usr/bin/env node
// GUI 验收：对 `npm run web`（Expo / react-native-web）起的页面截图。
//
// 为什么需要它：这个 app 的原生窗口在 headless 会话里**观察不到** ——
// macOS 的 Accessibility 报 0 个 window、`screencapture` 报
// `could not create image from display`。两个不同的节点各自独立撞到过，
// 于是「徽标显示对不对」「toast 有没有弹」这类验收长期没人能做。
//
// 但那是**原生窗口**这一条路。web 目标渲染的是同一套 React 组件，
// 而无头浏览器不依赖 macOS 窗口服务器。2026-08-31 实测：登录页完整渲染，
// 控制台零错误。
//
// 🔴 这个脚本最重要的一行不是截图，是**拒绝把白屏当成功**：
//    一张白屏截图也是一张「成功」的截图，命令退出码同样是 0。
//    所以下面显式断言页面有可见文本，没有就以非零退出。
//
// 用法：
//   node scripts/web-screenshot.mjs <url> <out.png> [--min-text N] [--viewport WxH] [--wait-text "…"]
//
// 已知限制（不要当成原生端的证据）：
//   - 渲染的是 react-native-web，不是 macOS 原生控件；布局/字体可能有差异。
//   - 只能证明「组件渲染成了什么」，不能证明原生打包后的窗口行为。

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadChromium() {
  // playwright-core 可能装在仓外（本机全局）。按 require 解析，找不到就明说，
  // 不要静默退化成「没截图但退出 0」。
  for (const id of ['playwright-core', 'playwright']) {
    try { return require(id).chromium; } catch { /* 下一个 */ }
  }
  console.error('[web-screenshot] 找不到 playwright-core / playwright。');
  console.error('  装一个：npm i -D playwright-core  （浏览器二进制走 PLAYWRIGHT_BROWSERS_PATH 或 npx playwright install chromium）');
  console.error('  或者指向已装好的一份：NODE_PATH=/path/to/node_modules node scripts/web-screenshot.mjs …');
  process.exit(2);
}

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error('用法: node scripts/web-screenshot.mjs <url> <out.png> [--min-text N] [--viewport WxH] [--wait-text "…"]');
  process.exit(2);
}
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const minText = Number(flag('--min-text', '10'));
const [vw, vh] = flag('--viewport', '1280x900').split('x').map(Number);
const waitText = flag('--wait-text', '');
const navTimeout = Number(flag('--timeout', '240000'));

const chromium = loadChromium();
// 🔴 --no-sandbox：本机（以及多数 CI 容器）没有可用的 user namespace 沙箱，
//    不加这个 flag 会以 `No usable sandbox!` 直接崩，而那和页面本身无关。
const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: vw, height: vh } });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

let navFailed = null;
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
  // Metro 首次打包可能很慢；等到有可见文本为止，而不是等一个固定秒数。
  await page.waitForFunction(
    n => (document.body?.innerText || '').trim().length >= n,
    minText,
    { timeout: navTimeout },
  ).catch(() => {});
  if (waitText) {
    await page.waitForFunction(
      t => (document.body?.innerText || '').includes(t),
      waitText,
      { timeout: navTimeout },
    ).catch(() => {});
  }
} catch (e) {
  navFailed = String(e).slice(0, 300);
}

const text = (await page.evaluate(() => document.body?.innerText || '')).trim();
await page.screenshot({ path: out, fullPage: false });
await browser.close();

console.log(`URL      : ${url}`);
console.log(`OUT      : ${out}${existsSync(out) ? '' : '  🔴 文件没写出来'}`);
console.log(`TEXTLEN  : ${text.length}  (--min-text ${minText})`);
console.log(`TEXT     : ${JSON.stringify(text.slice(0, 300))}`);
console.log(`ERRORS   : ${errors.length ? errors.slice(0, 5).join(' | ') : '(none)'}`);

// 🔴 判据在这里，不在「命令跑完了」。
const problems = [];
if (navFailed) problems.push(`导航失败: ${navFailed}`);
if (!existsSync(out)) problems.push('截图文件不存在');
if (text.length < minText) problems.push(`页面可见文本只有 ${text.length} 字符（阈值 ${minText}）—— 这很可能是白屏`);
if (waitText && !text.includes(waitText)) problems.push(`页面里找不到要求的文本: ${JSON.stringify(waitText)}`);
if (problems.length) {
  console.error('\n🔴 判定为「没渲染出来」，不是成功的截图：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\n✅ 页面有可见内容，截图可作为验收证据（注意：这是 react-native-web，不是原生窗口）');
