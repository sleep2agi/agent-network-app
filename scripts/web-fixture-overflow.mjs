#!/usr/bin/env node
// 夹具溢出巡检:在手机宽度下逐个加载验收夹具,报告**横向溢出**与**空白**。
//
// 为什么需要:0.2.293 之前「原会话」那一条在 390px 上被挤成 `Original OpenC…`,是我拿到
// 用户截图才知道的。截图能看,但要人一张张看;溢出与白屏可以机器判 —— 这两类正是
// 「手机上一眼就丑」的主要来源(内容被裁、整页空白)。
//
// 用法:
//   npx expo start --web --port 8150        # 另开一个终端
//   node scripts/web-fixture-overflow.mjs http://localhost:8150 [--width 390] [--height 844]
//
// 判定:
//   OVERFLOW  document.documentElement.scrollWidth > innerWidth + 1   → 有东西被推到屏幕外
//   BLANK     可见文本 < 40 字符                                      → 大概没渲染出来
// 退出码非零当且仅当有 OVERFLOW 或 BLANK。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
function loadChromium() {
  for (const id of ['playwright-core', 'playwright']) {
    try { return require(id).chromium; } catch { /* next */ }
  }
  console.error('[fixture-overflow] need playwright-core or playwright');
  process.exit(2);
}

const base = process.argv[2] || 'http://localhost:8150';
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const width = Number(arg('width', 390));
const height = Number(arg('height', 844));

const FIXTURES = [
  'chat-session-strip&state=running',
  'chat-session-strip&state=error',
  'clone-node',
  'daemon-overview&mode=demo',
  'hub-scope&section=skills',
  'hub-scope&section=tokens',
  'hub-scope&section=providers',
  'notify-settings&platform=android',
  'unread-badge',
  'update-prompt',
];

const chromium = loadChromium();
const launch = { args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.PW_CHROMIUM_EXECUTABLE) launch.executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch(launch);

let bad = 0;
for (const fixture of FIXTURES) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
  const url = `${base}/?fixture=${fixture}&theme=light`;
  let verdict = 'ok';
  let detail = '';
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2500);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
    }));
    if (metrics.scrollWidth > metrics.innerWidth + 1) {
      verdict = 'OVERFLOW';
      detail = `${metrics.scrollWidth} > ${metrics.innerWidth}`;
    } else if (metrics.text.length < 40) {
      verdict = 'BLANK';
      detail = `${metrics.text.length} chars`;
    } else {
      detail = `${metrics.text.length} chars`;
    }
  } catch (e) {
    verdict = 'ERROR';
    detail = String(e).slice(0, 120);
  }
  if (verdict !== 'ok') bad++;
  const errs = errors.length ? `  console-errors=${errors.length}` : '';
  console.log(`${verdict.padEnd(9)} ${fixture.padEnd(34)} ${detail}${errs}`);
  await page.close();
}
await browser.close();
console.log(bad ? `\n${bad} fixture(s) need a look` : '\nall fixtures fit the phone width');
process.exit(bad ? 1 : 0);
